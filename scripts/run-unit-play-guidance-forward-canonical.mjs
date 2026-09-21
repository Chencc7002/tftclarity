import { execFileSync } from "node:child_process";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  FORWARD_CANONICAL_AUTH_ENV,
  authorizeForwardCanonicalRun,
  runForwardCanonicalExperiment
} from "../src/experiments/unit-play-guidance-forward/canonical.js";

const root = path.resolve(import.meta.dirname, "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const canonicalFlag = process.argv.includes("--canonical-real-provider");
const outputDirArg = process.argv.find((arg) => arg.startsWith("--output-dir="));
const authorizationFileArg = process.argv.find((arg) => arg.startsWith("--authorization-file="));
const outputDir = path.resolve(root, outputDirArg?.slice("--output-dir=".length)
  ?? ".cache/eval/unit-play-guidance-forward/formal-provider-v2");
if (!authorizationFileArg?.slice("--authorization-file=".length)) {
  throw Object.assign(new Error("--authorization-file=<path> is required"), { code: "authorization_failed" });
}
const authorizationFile = path.resolve(root, authorizationFileArg.slice("--authorization-file=".length));
const [config, corpus, observations, preflightResult] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-forward/config.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/corpus.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/tool-observations.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/preflight-result.v2.json")
]);
const providerAuthorization = JSON.parse(await readFile(authorizationFile, "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const implementationCommitSha = git("rev-parse", "HEAD");
const worktreeClean = git("status", "--porcelain=v1") === "";
const apiKey = process.env.OPENAI_API_KEY;
const authorization = authorizeForwardCanonicalRun({
  config,
  preflightResult,
  transportMode: "real_provider",
  cliAuthorized: canonicalFlag,
  environmentAuthorization: process.env[FORWARD_CANONICAL_AUTH_ENV],
  apiKey,
  endpoint: config.provider.endpoint,
  worktreeClean,
  implementationCommitSha,
  providerAuthorization
});

try {
  await access(outputDir);
  throw new Error(`Refusing to overwrite formal Provider output: ${outputDir}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(outputDir, { recursive: true });
const checkpointPath = path.join(outputDir, "checkpoints.v2.jsonl");
const appendCheckpoint = async (checkpoint) => {
  const run = checkpoint.run;
  const bounded = { schemaVersion: "unit-play-guidance-forward-checkpoint.v2", type: checkpoint.type,
    completedAgentRuns: checkpoint.completedAgentRuns, pairId: checkpoint.pairId, arm: checkpoint.arm,
    caseId: run?.caseId ?? null, terminationReason: run?.result?.terminationReason ?? null,
    audit: run?.audit ?? null, telemetry: run ? { toolCalls: run.telemetry.toolCalls,
      frozenAccesses: run.telemetry.frozenAccesses, transportRequests: run.telemetry.transportRequests,
      actualTotalTokens: run.telemetry.actualTotalTokens,
      decisionTrace: run.telemetry.providerLogs.map((entry) => ({ status: entry.status,
        actionType: entry.actionType, actionTool: entry.actionTool })) } : null,
    terminationTrace: run ? run.events.filter((event) => ["decision_rejected", "error", "answer"].includes(event.type))
      .slice(-16).map((event) => ({ type: event.type, code: event.data?.code ?? null,
        reasonCode: event.data?.reasonCode ?? null, narrativeAccepted: event.data?.narrativeAccepted ?? null,
        systemFallback: event.data?.systemFallback ?? null })) : null };
  await appendFile(checkpointPath, `${JSON.stringify(bounded)}\n`, "utf8");
};

try {
  const { result, blinded, labels } = await runForwardCanonicalExperiment({
    config,
    corpus,
    observations,
    preflightResult,
    authorization,
    apiKey,
    fetchImpl: globalThis.fetch,
    blindSeed: implementationCommitSha,
    onCheckpoint: appendCheckpoint
  });
  const outputs = [
    ["result.v2.json", result],
    ["blinded-packet.v2.json", blinded.packet],
    ["blind-key.v2.json", blinded.key],
    ...labels.map((labelsForReviewer, index) => [`reviewer-${index + 1}-labels.v2.json`, labelsForReviewer])
  ];
  for (const [name, value] of outputs) {
    await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  }
  console.log(JSON.stringify({ status: result.status, implementationCommitSha,
    completedAgentRuns: result.plan.completedAgentRuns, actualProviderModelCalls: result.actualProviderModelCalls,
    validPairedRepetitions: result.aggregate.validPairedRepetitions,
    casesWithAtLeastTwoValidPairs: result.aggregate.casesWithAtLeastTwoValidPairs,
    blindedEntries: blinded.packet.entries.length, independentReviewPackets: labels.length, outputDir }, null, 2));
  if (result.status !== "awaiting_independent_review") process.exitCode = 1;
} catch (error) {
  const failure = { schemaVersion: "unit-play-guidance-forward-formal-failure.v2",
    implementationCommitSha, code: String(error?.code ?? "runtime_failure"),
    message: String(error?.message ?? error).slice(0, 500) };
  await writeFile(path.join(outputDir, "failure.v2.json"), `${JSON.stringify(failure, null, 2)}\n`, { flag: "wx" });
  throw error;
}
