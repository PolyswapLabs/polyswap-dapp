import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import {
  createCowAppData,
  createCowAppDataHashOrDefault,
  registerAndConfirmCowAppData,
} from "../../src/backend/services/cowAppDataService";

const NONCE = `0x${"11".repeat(32)}` as Hex;
const OTHER_HASH = `0x${"22".repeat(32)}`;
const appData = createCowAppData({ nonce: NONCE, environment: "test" });
const options = { apiBase: "https://cow.test/polygon/" };
const confirmed = () => Response.json({ fullAppData: appData.fullAppData });

function stubFetch(t: TestContext, put: () => Response, get: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mocked = t.mock.method(globalThis, "fetch", (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return init?.method === "PUT" ? put() : get();
  }) as typeof fetch);
  return { calls, restore: () => mocked.mock.restore() };
}

test("AppData is registered, then read back from the same trimmed URL", async (t) => {
  const { calls } = stubFetch(t, () => new Response(appData.appDataHash), confirmed);

  await registerAndConfirmCowAppData(appData, options);

  const url = `https://cow.test/polygon/api/v1/app_data/${appData.appDataHash}`;
  assert.deepEqual(
    calls.map((call) => [call.url, call.init?.method ?? "GET"]),
    [
      [url, "PUT"],
      [url, "GET"],
    ]
  );
  assert.equal(calls[0]?.init?.body, JSON.stringify({ fullAppData: appData.fullAppData }));
  assert.ok(calls.every((call) => call.init?.signal instanceof AbortSignal));
});

test("a failed or mismatching registration stops before confirmation", async (t) => {
  for (const [put, message] of [
    [() => new Response("too many", { status: 429 }), /registration failed \(429\): too many/],
    [() => new Response(OTHER_HASH), /different AppData hash/],
  ] as const) {
    const { calls, restore } = stubFetch(t, put, confirmed);
    await assert.rejects(registerAndConfirmCowAppData(appData, options), message);
    assert.equal(calls.length, 1);
    restore();
  }
});

test("a confirmation that differs from what was registered is rejected", async (t) => {
  const tampered = JSON.stringify({ fullAppData: `${appData.fullAppData} ` });
  for (const [get, message] of [
    [() => new Response("gone", { status: 404 }), /confirmation failed \(404\): gone/],
    [() => new Response(tampered), /unexpected AppData content/],
    [() => new Response(""), /unexpected AppData content/],
  ] as const) {
    const { restore } = stubFetch(t, () => new Response(""), get);
    await assert.rejects(registerAndConfirmCowAppData(appData, options), message);
    restore();
  }
});

test("a read-back whose content does not hash to the registered hash is rejected", async (t) => {
  const forged = { ...appData, appDataHash: keccak256(toBytes("something else")) };
  stubFetch(t, () => new Response(""), confirmed);
  await assert.rejects(registerAndConfirmCowAppData(forged, options), /hashes to/);
});

test("an out-of-range timeout is refused before any request", async (t) => {
  const { calls } = stubFetch(t, () => new Response(""), confirmed);
  for (const timeoutMs of [249, 30_001, 1000.5]) {
    await assert.rejects(
      registerAndConfirmCowAppData(appData, { ...options, timeoutMs }),
      /timeout must be between/
    );
  }
  assert.equal(calls.length, 0);
});

test("an unconfirmed registration falls back to the default AppData", async (t) => {
  stubFetch(t, () => new Response("no", { status: 500 }), confirmed);
  const previous = process.env.APP_DATA;
  delete process.env.APP_DATA;
  t.after(() => {
    if (previous !== undefined) process.env.APP_DATA = previous;
  });
  assert.equal(await createCowAppDataHashOrDefault(options), `0x${"00".repeat(32)}`);
});
