import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function acquireLock(lockPath, options = {}) {
  await mkdir(dirname(lockPath), { recursive: true });
  const staleAfterMs = Math.max(60_000, Number(options.staleAfterMs ?? 2 * 60 * 60 * 1000));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      const lock = {
        schemaVersion: "current_stats_job_lock.v1",
        runId: options.runId,
        pid: process.pid,
        startedAt: options.startedAt
      };
      await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
      await handle.close();
      return { acquired: true, lock };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = await readJson(lockPath);
      const startedAt = Date.parse(current?.startedAt ?? "");
      if (
        attempt === 0
        && (!Number.isFinite(startedAt) || Date.now() - startedAt > staleAfterMs)
      ) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      return { acquired: false, lock: current };
    }
  }
  return { acquired: false, lock: await readJson(lockPath) };
}

async function releaseLock(lockPath, runId) {
  const current = await readJson(lockPath);
  if (current?.runId === runId) await unlink(lockPath).catch(() => {});
}

async function sendFailureAlert(webhookUrl, payload, fetchImpl = globalThis.fetch) {
  if (!webhookUrl || !fetchImpl) return { sent: false, reason: "not_configured" };
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    return {
      sent: Boolean(response?.ok),
      status: Number(response?.status ?? 0)
    };
  } catch (error) {
    return {
      sent: false,
      reason: error?.message ?? String(error)
    };
  }
}

function manifestWithRun(previous, run) {
  const history = [run, ...(Array.isArray(previous?.history) ? previous.history : [])].slice(0, 30);
  return {
    schemaVersion: "current_stats_job_manifest.v1",
    lastRun: run,
    lastSuccess: run.status === "success" ? run : previous?.lastSuccess ?? null,
    lastFailure: run.status === "failed" ? run : previous?.lastFailure ?? null,
    history
  };
}

export async function runCurrentStatsJob(options = {}) {
  if (typeof options.task !== "function") throw new TypeError("Current stats job requires a task function");
  if (!options.lockPath || !options.manifestPath) {
    throw new TypeError("Current stats job requires lockPath and manifestPath");
  }
  const runId = options.runId ?? randomUUID();
  const startedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const lock = await acquireLock(options.lockPath, {
    runId,
    startedAt,
    staleAfterMs: options.staleAfterMs
  });
  if (!lock.acquired) {
    return {
      schemaVersion: "current_stats_job_run.v1",
      runId,
      status: "skipped_locked",
      startedAt,
      lock: lock.lock ?? null
    };
  }

  const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 3));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 5_000));
  let attempts = 0;
  let result = null;
  let failure = null;
  try {
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        result = await options.task({ runId, attempt: attempts });
        failure = null;
        break;
      } catch (error) {
        failure = error;
        if (attempts < maxAttempts) {
          await (options.delayImpl ?? delay)(retryDelayMs * (2 ** (attempts - 1)));
        }
      }
    }
    const finishedAt = new Date(options.now?.() ?? Date.now()).toISOString();
    const run = {
      schemaVersion: "current_stats_job_run.v1",
      runId,
      status: failure ? "failed" : "success",
      startedAt,
      finishedAt,
      attempts,
      result: failure ? null : result,
      error: failure ? {
        name: failure?.name ?? "Error",
        message: failure?.message ?? String(failure)
      } : null
    };
    const previous = await readJson(options.manifestPath, {});
    await writeJsonAtomic(options.manifestPath, manifestWithRun(previous, run));
    if (failure) {
      run.alert = await sendFailureAlert(options.alertWebhook, {
        event: "current_stats_job_failed",
        run
      }, options.fetchImpl);
      throw Object.assign(new Error(`current_stats job failed after ${attempts} attempts: ${run.error.message}`), {
        cause: failure,
        run
      });
    }
    return run;
  } finally {
    await releaseLock(options.lockPath, runId);
  }
}

export function millisecondsUntilDailyRun(time, now = new Date()) {
  const match = String(time ?? "").match(/^([01]\d|2[0-3]):([0-5]\d)$/u);
  if (!match) throw new TypeError("Daily schedule time must use HH:mm");
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}
