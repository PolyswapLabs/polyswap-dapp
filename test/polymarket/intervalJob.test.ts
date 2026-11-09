import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createIntervalJob } from "../../src/backend/listener/cron/intervalJob";

function useFakeInterval(t: TestContext) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  return (ms: number) => t.mock.timers.tick(ms);
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("each interval runs the job", (t) => {
  const tick = useFakeInterval(t);
  let runs = 0;
  const job = createIntervalJob("test-job", async () => {
    runs += 1;
  });

  job.start(1000);
  assert.equal(runs, 0, "the first run waits for the first interval");
  tick(1000);
  assert.equal(runs, 1);
  job.stop();
});

test("a tick during a running job is skipped", async (t) => {
  const tick = useFakeInterval(t);
  let runs = 0;
  let finish = () => {};
  const job = createIntervalJob(
    "test-job",
    () =>
      new Promise<void>((resolve) => {
        runs += 1;
        finish = resolve;
      })
  );

  job.start(1000);
  tick(1000);
  tick(1000);
  assert.equal(runs, 1);

  finish();
  await flush();
  tick(1000);
  assert.equal(runs, 2);
  job.stop();
});

test("a failed run is contained and the job runs again", async (t) => {
  const tick = useFakeInterval(t);
  let runs = 0;
  const job = createIntervalJob("test-job", async () => {
    runs += 1;
    throw new Error("boom");
  });

  job.start(1000);
  tick(1000);
  await flush();
  tick(1000);
  assert.equal(runs, 2);
  job.stop();
});

test("starting twice does not double the runs", (t) => {
  const tick = useFakeInterval(t);
  let runs = 0;
  const job = createIntervalJob("test-job", async () => {
    runs += 1;
  });

  job.start(1000);
  job.start(1000);
  tick(1000);
  assert.equal(runs, 1);
  job.stop();
});

test("stopping ends the runs", (t) => {
  const tick = useFakeInterval(t);
  let runs = 0;
  const job = createIntervalJob("test-job", async () => {
    runs += 1;
  });

  job.start(1000);
  job.stop();
  tick(5000);
  assert.equal(runs, 0);
});
