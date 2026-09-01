import { execFileSync } from "node:child_process";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { COMPLETION_V5_AUTH_ENV, authorizeCompletionV5Run,
  runCompletionV5Experiment } from "../src/experiments/unit-play-guidance-completion-v5/canonical.js";

const root = path.resolve(import.meta.dirname, "..");
const readJson = async (relative) => JSON.parse(await readFile(path.resolve(root, relative), "utf8"));
const authArg = process.argv.find((arg) => arg.startsWith("--authorization-file="));
const outputArg = process.argv.find((arg) => arg.startsWith("--output-dir="));
if (!authArg) throw Object.assign(new Error("--authorization-file=<path> is required"), { code: "authorization_failed" });
const outputDir = path.resolve(root, outputArg?.slice("--output-dir=".length)
  ?? ".cache/eval/unit-play-guidance-completion-v5/formal");
const [config, corpus, observations, preflightResult, providerAuthorization] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-completion-v5/config.v5.json"),
  readJson("eval/skills/unit-play-guidance-forward/corpus.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/tool-observations.v2.json"),
  readJson("eval/skills/unit-play-guidance-completion-v5/preflight-result.v5.json"),
  readJson(authArg.slice("--authorization-file=".length))
]);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const implementationCommitSha = git("rev-parse", "HEAD");
const authorization = authorizeCompletionV5Run({ config, preflightResult, transportMode: "real_provider",
  cliAuthorized: process.argv.includes("--candidate-reliability-real-provider"),
  environmentAuthorization: process.env[COMPLETION_V5_AUTH_ENV], apiKey: process.env.OPENAI_API_KEY,
  worktreeClean: git("status", "--porcelain=v1") === "", implementationCommitSha, providerAuthorization });
try { await access(outputDir); throw new Error(`Refusing to overwrite ${outputDir}`); }
catch (error) { if (error?.code !== "ENOENT") throw error; }
await mkdir(outputDir, { recursive: true });
const checkpointPath = path.join(outputDir, "checkpoints.v5.jsonl");
const onCheckpoint = async ({ completedAgentRuns, run }) => appendFile(checkpointPath,
  `${JSON.stringify({ schemaVersion: "unit-play-guidance-completion-checkpoint.v5", completedAgentRuns,
    runId: run.pairId, caseId: run.caseId, repetition: run.repetition,
    terminationReason: run.result.terminationReason, audit: run.audit,
    telemetry: { transportRequests: run.telemetry.transportRequests,
      actualTotalTokens: run.telemetry.actualTotalTokens,
      decisionTrace: run.telemetry.providerLogs.map((entry) => ({ status: entry.status,
        actionType: entry.actionType, actionTool: entry.actionTool })) },
    terminationTrace: run.events.filter((event) => ["decision_rejected", "error", "answer"].includes(event.type))
      .slice(-16).map((event) => ({ type: event.type, code: event.data?.code ?? null,
        reasonCode: event.data?.reasonCode ?? null, systemFallback: event.data?.systemFallback ?? null })) })}\n`, "utf8");
const output = await runCompletionV5Experiment({ config, corpus, observations, preflightResult,
  authorization, fetchImpl: globalThis.fetch, onCheckpoint });
for (const [name, value] of [["result.v5.json", output.result], ["review-packet.v5.json", output.review.packet],
  ["review-key.v5.json", output.review.key], ...output.review.labels.map((value, index) => [`reviewer-${index + 1}.v5.json`, value])]) {
  await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
console.log(JSON.stringify({ status: output.result.status, implementationCommitSha,
  completedAgentRuns: output.result.plan.completedAgentRuns,
  actualProviderModelCalls: output.result.actualProviderModelCalls,
  aggregate: output.result.aggregate, outputDir }, null, 2));
if (output.result.status !== "awaiting_independent_review") process.exitCode = 1;
