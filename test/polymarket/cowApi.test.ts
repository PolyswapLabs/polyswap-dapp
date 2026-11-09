import assert from "node:assert/strict";
import { test } from "node:test";
import { CowQuoteError, fetchCowQuote, parseCowError } from "../../src/services/cowApi";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const WPOL = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USER = "0x1111111111111111111111111111111111111111";
const params = { sellToken: NATIVE, buyToken: USDC, sellAmount: "1000", userAddress: USER };

test("a CoW error body provides the type and the message", async () => {
  const body = JSON.stringify({ errorType: "NoLiquidity", description: "No route" });
  const error = await parseCowError(new Response(body, { status: 400 }));
  assert.ok(error instanceof CowQuoteError);
  assert.equal(error.errorType, "NoLiquidity");
  assert.equal(error.description, "No route");
  assert.equal(error.message, "No route");
  assert.equal(error.status, 400);
});

test("a non-JSON CoW error falls back to the HTTP status", async () => {
  const error = await parseCowError(new Response("Bad gateway", { status: 502 }));
  assert.equal(error.errorType, null);
  assert.equal(error.description, null);
  assert.equal(error.message, "CoW quote API error (502)");
});

test("quotes request the wrapped token for the native placeholder", async (t) => {
  let sent: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return Response.json({ quote: { buyAmount: "5", sellAmount: "1000" } });
  });
  assert.deepEqual(await fetchCowQuote(params), { buyAmount: "5", sellAmount: "1000" });
  assert.equal(sent.sellToken, WPOL);
  assert.equal(sent.buyToken, USDC);
  assert.equal(sent.from, USER);
  assert.equal(sent.receiver, USER);
  assert.equal(sent.sellAmountBeforeFee, "1000");
});

test("a quote response without amounts is rejected", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ quote: {} }));
  await assert.rejects(fetchCowQuote(params), /missing buyAmount/);
});

test("a response without a quote is rejected", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(fetchCowQuote(params), /unexpected API response shape/);
});
