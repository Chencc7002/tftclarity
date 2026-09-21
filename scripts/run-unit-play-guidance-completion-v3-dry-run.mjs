import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { authorizeCompletionV3Run, runCompletionV3Experiment } from "../src/experiments/unit-play-guidance-completion-v3/canonical.js";
import { createForwardScriptedTransport } from "../src/experiments/unit-play-guidance-forward/scripted-transport.js";

const root = path.resolve(import.meta.dirname, "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const outputArg = process.argv.find((arg) => arg.startsWith("--output-dir="));
const outputDir = path.resolve(root, outputArg?.slice("--output-dir=".length)
  ?? ".cache/eval/unit-play-guidance-completion-v3/scripted");
try { await access(outputDir); throw new Error(`Refusing to overwrite ${outputDir}`); }
catch (error) { if (error?.code !== "ENOENT") throw error; }
const [config, corpus, observations, preflightResult] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-completion-v3/config.v3.json"),
  readJson("eval/skills/unit-play-guidance-forward/corpus.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/tool-observations.v2.json"),
  readJson("eval/skills/unit-play-guidance-completion-v3/preflight-result.v3.json")
]);
const transport = createForwardScriptedTransport();
const authorization = authorizeCompletionV3Run({ config, preflightResult, transportMode: "fake_test" });
const output = await runCompletionV3Experiment({ config, corpus, observations, preflightResult,
  authorization, fetchImpl: transport.fetchImpl });
const compact = { ...output.result, runs: output.result.runs.map((run) => ({ pairId: run.pairId,
  caseId: run.caseId, repetition: run.repetition, terminationReason: run.result.terminationReason,
  audit: run.audit, requests: run.telemetry.transportRequests, tokens: run.telemetry.actualTotalTokens })) };
await mkdir(outputDir, { recursive: true });
for (const [name, value] of [["result.v3.json", compact], ["review-packet.v3.json", output.review.packet],
  ["review-key.v3.json", output.review.key], ...output.review.labels.map((value, index) => [`reviewer-${index + 1}.v3.json`, value])]) {
  await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
console.log(JSON.stringify({ status: output.result.status, plannedAgentRuns: 90,
  completedAgentRuns: output.result.plan.completedAgentRuns, actualProviderModelCalls: 0,
  transportRequests: transport.snapshot().requests, aggregate: output.result.aggregate,
  reviewEntries: output.review.packet.entries.length, outputDir }, null, 2));
