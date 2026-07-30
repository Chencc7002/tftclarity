import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  millisecondsUntilDailyRun,
  runCurrentStatsJob
} from "../src/knowledge/current-stats-job-runner.js";

async function temporaryJob(testFunction) {
  const directory = await mkdtemp(join(tmpdir(), "current-stats-job-"));
  try {
    return await testFunction({
      lockPath: join(directory, "job.lock"),
      manifestPath: join(directory, "manifest.json")
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("current stats job retries and records a successful manifest", async () => {
  await temporaryJob(async (paths) => {
    let calls = 0;
    const run = await runCurrentStatsJob({
      ...paths,
      maxAttempts: 3,
      retryDelayMs: 0,
      delayImpl: async () => {},
      task: async () => {
        calls += 1;
        if (calls < 3) throw new Error("temporary");
        return { documents: 121 };
      }
    });
    assert.equal(run.status, "success");
    assert.equal(run.attempts, 3);
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    assert.equal(manifest.lastRun.status, "success");
    assert.equal(manifest.lastSuccess.result.documents, 121);
  });
});

test("current stats job prevents concurrent execution", async () => {
  await temporaryJob(async (paths) => {
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const first = runCurrentStatsJob({
      ...paths,
      task: async () => {
        await blocked;
        return { ok: true };
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await runCurrentStatsJob({
      ...paths,
      task: async () => ({ shouldNotRun: true })
    });
    assert.equal(second.status, "skipped_locked");
    release();
    assert.equal((await first).status, "success");
  });
});

test("current stats job records failure and sends a webhook alert", async () => {
  await temporaryJob(async (paths) => {
    const alerts = [];
    await assert.rejects(
      () => runCurrentStatsJob({
        ...paths,
        maxAttempts: 2,
        retryDelayMs: 0,
        delayImpl: async () => {},
        alertWebhook: "https://alerts.invalid/current-stats",
        fetchImpl: async (url, request) => {
          alerts.push({ url, request });
          return { ok: true, status: 200 };
        },
        task: async () => {
          throw new Error("upstream unavailable");
        }
      }),
      /failed after 2 attempts/
    );
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    assert.equal(manifest.lastFailure.status, "failed");
    assert.equal(manifest.lastFailure.attempts, 2);
    assert.equal(alerts.length, 1);
  });
});

test("daily schedule computes the next local execution time", () => {
  const now = new Date("2026-07-29T03:00:00");
  assert.equal(millisecondsUntilDailyRun("04:15", now), 75 * 60 * 1000);
  assert.throws(() => millisecondsUntilDailyRun("25:00", now), /HH:mm/);
});
