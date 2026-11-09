import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTokenMap, toOrderView } from "../../src/hooks/orders/orderMapper";

type Row = Parameters<typeof toOrderView>[0];

const row = (status: Row["status"], gateOpenedAt: string | null) =>
  ({
    id: 1,
    status,
    gate_opened_at: gateOpenedAt,
    sell_token: "0x1111111111111111111111111111111111111111",
    buy_token: "0x2222222222222222222222222222222222222222",
    sell_amount: "1000000",
    actual_sell_amount: null,
    actual_buy_amount: null,
    start_time: "2026-01-01T00:00:00.000Z",
    end_time: "2026-02-01T00:00:00.000Z",
    outcome_selected: "Yes",
    bet_percentage: 40,
  }) as unknown as Row;

const OPENED = "2026-01-02T00:00:00.000Z";

test("a live order whose trigger fired is ready", () => {
  assert.equal(toOrderView(row("live", OPENED), new Map()).status, "ready");
});

test("a live order still waiting for its trigger is waiting", () => {
  assert.equal(toOrderView(row("live", null), new Map()).status, "waiting");
});

test("a filled order stays done even though its trigger fired", () => {
  assert.equal(toOrderView(row("filled", OPENED), new Map()).status, "done");
});

test("amounts convert to token units using each token's decimals", () => {
  const tokens = buildTokenMap([
    {
      chainId: 137,
      address: "0x1111111111111111111111111111111111111111",
      name: "Sell",
      symbol: "SELL",
      decimals: 6,
    },
    {
      chainId: 137,
      address: "0x2222222222222222222222222222222222222222",
      name: "Buy",
      symbol: "BUY",
      decimals: 2,
    },
  ]);
  const filled = {
    ...row("filled", OPENED),
    actual_sell_amount: "500000",
    actual_buy_amount: "250",
  };
  const view = toOrderView(filled, tokens);
  assert.equal(view.sellAmount, 1);
  assert.equal(view.actualSellAmount, 0.5);
  assert.equal(view.actualBuyAmount, 2.5);
});

test("unknown tokens default to 18 decimals and unfilled amounts stay null", () => {
  const view = toOrderView({ ...row("live", null), sell_amount: "2000000000000000000" }, new Map());
  assert.equal(view.sellAmount, 2);
  assert.equal(view.actualSellAmount, null);
  assert.equal(view.actualBuyAmount, null);
});
