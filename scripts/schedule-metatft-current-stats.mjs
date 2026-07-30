import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import {
  millisecondsUntilDailyRun,
  runCurrentStatsJob
} from "../src/knowledge/current-stats-job-runner.js";

const execFileAsync = promisify(execFile);
const argumentsList = process.argv.slice(2);

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const entry = argumentsList.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function flag(name) {
  return argumentsList.includes(`--${name}`);
}

function parseGeneratorOutput(stdout) {
  const start = String(stdout ?? "").indexOf("{");
  if (start < 0) return { output: String(stdout ?? "").trim() };
  try {
    return JSON.parse(String(stdout).slice(start));
  } catch {
    return { output: String(stdout ?? "").trim() };
  }
}

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const generator = resolve(workspace, "scripts/generate-metatft-current-stats.mjs");
const stateDirectory = resolve(argument(
  "state-dir",
  process.env.CURRENT_STATS_STATE_DIR ?? ".cache/current-stats"
));
const jobOptions = {
  lockPath: resolve(stateDirectory, "job.lock"),
  manifestPath: resolve(stateDirectory, "manifest.json"),
  staleAfterMs: Number(argument("stale-after-ms", process.env.CURRENT_STATS_STALE_LOCK_MS ?? 7_200_000)),
  maxAttempts: Number(argument("max-attempts", process.env.CURRENT_STATS_MAX_ATTEMPTS ?? 3)),
  retryDelayMs: Number(argument("retry-delay-ms", process.env.CURRENT_STATS_RETRY_DELAY_MS ?? 5_000)),
  alertWebhook: argument("alert-webhook", process.env.CURRENT_STATS_ALERT_WEBHOOK ?? null),
  task: async () => {
    const generatorArguments = [];
    for (const name of [
      "season",
      "patch",
      "rank",
      "days",
      "region",
      "locale",
      "ttl-hours",
      "provider-patch",
      "queue",
      "comp-limit",
      "min-samples",
      "timeout-ms",
      "index"
    ]) {
      const value = argument(name);
      if (value !== null) generatorArguments.push(`--${name}=${value}`);
    }
    if (flag("no-embeddings")) generatorArguments.push("--no-embeddings");
    const { stdout } = await execFileAsync(process.execPath, [generator, ...generatorArguments], {
      cwd: workspace,
      env: process.env,
      timeout: Number(argument("job-timeout-ms", process.env.CURRENT_STATS_JOB_TIMEOUT_MS ?? 180_000)),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    return parseGeneratorOutput(stdout);
  }
};

async function runOnce() {
  const run = await runCurrentStatsJob(jobOptions);
  process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
  return run;
}

if (flag("daemon")) {
  const dailyAt = argument("at", process.env.CURRENT_STATS_DAILY_AT ?? "04:15");
  process.stdout.write(`current_stats scheduler active; dailyAt=${dailyAt}\n`);
  while (true) {
    const waitMs = millisecondsUntilDailyRun(dailyAt);
    process.stdout.write(`nextRunAt=${new Date(Date.now() + waitMs).toISOString()}\n`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
    try {
      await runOnce();
    } catch (error) {
      process.stderr.write(`${error?.message ?? error}\n`);
    }
  }
} else {
  await runOnce();
}
