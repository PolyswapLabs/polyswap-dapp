import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { orderRepository } = await import("../../src/backend/db/orderRepository");
const { GET } = await import("../../src/app/api/polyswap/orders/route");

const OWNER = "0x1111111111111111111111111111111111111111";
const get = (query: string) => GET(new NextRequest(`http://localhost/api/polyswap/orders${query}`));

test("listing orders without a filter is rejected and never reads the table", async (t) => {
  const read = t.mock.method(orderRepository, "getPolyswapOrdersByOwner", async () => []);

  const response = await get("");

  assert.equal(response.status, 400);
  assert.equal(read.mock.callCount(), 0);
});

test("listing orders for an owner still works", async (t) => {
  const read = t.mock.method(orderRepository, "getPolyswapOrdersByOwner", async () => []);

  const response = await get(`?owner=${OWNER}`);

  assert.equal(response.status, 200);
  assert.equal(read.mock.callCount(), 1);
});
