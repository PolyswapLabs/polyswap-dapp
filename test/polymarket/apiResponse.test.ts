import assert from "node:assert/strict";
import { test } from "node:test";
import { readApiResponse } from "../../src/client/api/polyswapApi";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const hasSuccess = (value: unknown): value is { success: true } =>
  (value as { success?: unknown }).success === true;

test("a successful response returns the parsed body", async () => {
  assert.deepEqual(await readApiResponse(json({ success: true }), hasSuccess), { success: true });
});

test("a failed response surfaces the API error and its id", async () => {
  await assert.rejects(
    readApiResponse(json({ message: "Nope", errorId: "abc" }, 400), hasSuccess),
    /Nope Error ID: abc/
  );
});

test("a failed response without details reports the status", async () => {
  await assert.rejects(readApiResponse(json({}, 503), hasSuccess), /HTTP 503/);
});

test("a success status with an unexpected body is rejected", async () => {
  await assert.rejects(
    readApiResponse(json({ success: false }), hasSuccess),
    /Invalid API response/
  );
});
