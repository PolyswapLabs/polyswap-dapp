import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { PublicClient } from "viem";
import {
  startWebSocketSupervisor,
  stopWebSocketSupervisor,
} from "../../src/backend/listener/webSocketSupervisor";

const CHECK_MS = 30_000;
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** A provider whose health can be changed while the supervisor runs. */
function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  const state = { up: true, hang: false };
  const events: string[] = [];
  const clients: PublicClient[] = [];
  const subscriptions: Array<{ ws: PublicClient; onError: (error: Error) => void }> = [];
  const connect = t.mock.fn(() => {
    const ws = {
      getBlockNumber: async () => {
        if (state.hang) return new Promise(() => {});
        if (!state.up) throw new Error("socket closed");
        return 1n;
      },
    } as unknown as PublicClient;
    clients.push(ws);
    events.push("connect");
    return ws;
  });
  const disconnect = t.mock.fn(() => {
    events.push("disconnect");
  });
  const unwatch = t.mock.fn(() => {
    events.push("unwatch");
  });
  const subscribe = t.mock.fn((ws: PublicClient, onError: (error: Error) => void) => {
    subscriptions.push({ ws, onError });
    events.push("subscribe");
    return [unwatch];
  });
  const recover = t.mock.fn(async () => {
    events.push("recover");
  });
  startWebSocketSupervisor({ connect, disconnect, subscribe, recover });
  t.after(() => stopWebSocketSupervisor());
  const tick = async (ms = CHECK_MS) => {
    t.mock.timers.tick(ms);
    await flush();
  };
  return {
    state,
    events,
    clients,
    subscriptions,
    connect,
    disconnect,
    unwatch,
    subscribe,
    recover,
    tick,
  };
}
const closed = new Error("socket closed");

test("starting subscribes once and needs no recovery", async (t) => {
  const { subscribe, recover, disconnect, tick } = setup(t);

  await tick();
  await tick();

  assert.equal(subscribe.mock.callCount(), 1);
  assert.equal(recover.mock.callCount(), 0);
  assert.equal(disconnect.mock.callCount(), 0);
});

test("a closed socket is rebuilt at once, subscribing before catching up so no event is missed", async (t) => {
  const { events, subscriptions, clients } = setup(t);
  events.length = 0;

  subscriptions[0]!.onError(closed);
  await flush();

  assert.deepEqual(events, ["unwatch", "disconnect", "connect", "subscribe", "recover"]);
  assert.equal(subscriptions[1]!.ws, clients[1], "the new subscriptions use the new socket");
});

test("a socket that fails its check without closing is rebuilt too", async (t) => {
  const { state, subscribe, recover, tick } = setup(t);

  state.up = false;
  await tick();
  assert.equal(subscribe.mock.callCount(), 1, "nothing to subscribe to while the provider is down");

  state.up = true;
  await tick();
  assert.equal(subscribe.mock.callCount(), 2);
  assert.equal(recover.mock.callCount(), 1);
});

test("a check that never answers counts as failed", async (t) => {
  const { state, subscribe, tick } = setup(t);

  state.hang = true;
  await tick();
  await tick(10_000);
  assert.equal(subscribe.mock.callCount(), 1, "the retry is hanging too");
  state.hang = false;
  await tick(10_000);
  await tick();

  assert.equal(subscribe.mock.callCount(), 2);
});

test("during a long outage it keeps retrying and recovers once", async (t) => {
  const { state, subscriptions, subscribe, recover, connect, tick } = setup(t);

  state.up = false;
  subscriptions[0]!.onError(closed);
  await flush();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(subscribe.mock.callCount(), 1);
  assert.ok(connect.mock.callCount() >= 6, "each retry uses a fresh socket");

  state.up = true;
  await tick();
  await tick();
  assert.equal(subscribe.mock.callCount(), 2);
  assert.equal(recover.mock.callCount(), 1);
});

test("every subscription reporting the same close causes one rebuild", async (t) => {
  const { subscriptions, subscribe } = setup(t);

  for (let i = 0; i < 5; i++) subscriptions[0]!.onError(closed);
  await flush();

  assert.equal(subscribe.mock.callCount(), 2);
});

test("late errors from the old socket are ignored", async (t) => {
  const { subscriptions, subscribe, tick } = setup(t);
  subscriptions[0]!.onError(closed);
  await flush();

  subscriptions[0]!.onError(closed);
  await tick();

  assert.equal(subscribe.mock.callCount(), 2);
});

test("a provider that closes every new socket cannot cause a rebuild loop", async (t) => {
  const { subscriptions, subscribe, tick } = setup(t);

  subscriptions[0]!.onError(closed);
  await flush();
  subscriptions[1]!.onError(closed);
  await flush();
  assert.equal(subscribe.mock.callCount(), 2, "an immediate repeat waits for the next check");

  await tick();
  assert.equal(subscribe.mock.callCount(), 3);
});

test("a failed catch-up is retried without another rebuild", async (t) => {
  const { subscriptions, subscribe, recover, tick } = setup(t);
  recover.mock.mockImplementationOnce(async () => {
    throw new Error("database down");
  });

  subscriptions[0]!.onError(closed);
  await flush();
  assert.equal(recover.mock.callCount(), 1);

  await tick();
  assert.equal(recover.mock.callCount(), 2);
  await tick();
  assert.equal(recover.mock.callCount(), 2);
  assert.equal(subscribe.mock.callCount(), 2);
});

test("an unsubscribe that throws on the dead socket does not block the rebuild", async (t) => {
  const { subscriptions, subscribe, unwatch } = setup(t);
  unwatch.mock.mockImplementationOnce(() => {
    throw new Error("socket closed");
  });

  subscriptions[0]!.onError(closed);
  await flush();

  assert.equal(subscribe.mock.callCount(), 2);
});

test("stopping unsubscribes, closes the socket and ends the checks", async (t) => {
  const { state, subscribe, unwatch, disconnect, tick } = setup(t);

  stopWebSocketSupervisor();
  assert.equal(unwatch.mock.callCount(), 1);
  assert.equal(disconnect.mock.callCount(), 1);

  state.up = false;
  await tick();
  state.up = true;
  await tick();
  assert.equal(subscribe.mock.callCount(), 1);
});

test("logs never include the provider URL, which can contain an API key", async (t) => {
  const printed: string[] = [];
  for (const method of ["warn", "error", "info", "log"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => {
      printed.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
    });
  }
  const { subscriptions, recover } = setup(t);
  const viemStyle = (shortMessage: string) =>
    Object.assign(new Error(`${shortMessage}\n\nURL: wss://provider.example/SECRETKEY`), {
      shortMessage,
    });
  recover.mock.mockImplementationOnce(async () => {
    throw viemStyle("HTTP request failed.");
  });

  subscriptions[0]!.onError(viemStyle("The socket has been closed."));
  await flush();

  const output = printed.join("\n");
  assert.match(output, /socket has been closed/);
  assert.match(output, /HTTP request failed/);
  assert.doesNotMatch(output, /SECRETKEY/);
});
