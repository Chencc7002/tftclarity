import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  authorizeForwardCanonicalRun,
  runForwardCanonicalExperiment
} from "../src/experiments/unit-play-guidance-forward/canonical.js";
import { createForwardScriptedTransport } from "../src/experiments/unit-play-guidance-forward/scripted-transport.js";

const root = path.resolve(import.meta.dirname, "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const outputDir = path.resolve(root, process.argv.find((arg) => arg.startsWith("--output-dir="))
  ?.slice("--output-dir=".length) ?? ".cache/eval/unit-play-guidance-forward/canonical-scripted-v2");
const config = await readJson("eval/skills/unit-play-guidance-forward/config.v2.json");
const corpus = await readJson("eval/skills/unit-play-guidance-forward/corpus.v2.json");
const observations = await readJson("eval/skills/unit-play-guidance-forward/tool-observations.v2.json");
const preflightResult = await readJson("eval/skills/unit-play-guidance-forward/preflight-result.v2.json");

try {
  await access(outputDir);
  throw new Error(`Refusing to overwrite scripted canonical output: ${outputDir}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const transport = createForwardScriptedTransport();
const authorization = authorizeForwardCanonicalRun({ config, preflightResult, transportMode: "fake_test" });
const { result, blinded, labels } = await runForwardCanonicalExperiment({
  config,
  corpus,
  observations,
  preflightResult,
  authorization,
  fetchImpl: transport.fetchImpl,
  blindSeed: config.frozen.candidateSkillSha256
});
const compactRuns = result.runs.map((run) => ({ pairId: run.pairId, caseId: run.caseId,
  repetition: run.repetition, arm: run.arm, terminationReason: run.result.terminationReason,
  answerOrigin: run.result.answerOrigin, toolCalls: run.telemetry.toolCalls,
  toolSequence: run.telemetry.frozenAccesses.map((entry) => entry.tool),
  valueHashes: run.telemetry.frozenAccesses.map((entry) => entry.valueSha256),
  transportRequests: run.telemetry.transportRequests,
  maxConcurrentTransportRequests: run.telemetry.maxConcurrentTransportRequests }));
const compactResult = { ...result, runs: compactRuns, transportSnapshot: transport.snapshot(),
  outputClassification: "scripted fake transport; never use as formal paired efficacy evidence" };
await mkdir(outputDir, { recursive: true });
const outputs = [
  ["result.v2.json", compactResult],
  ["blinded-packet.v2.json", blinded.packet],
  ["blind-key.v2.json", blinded.key],
  ["reviewer-1-labels.v2.json", labels[0]],
  ["reviewer-2-labels.v2.json", labels[1]]
];
for (const [name, value] of outputs) {
  await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
console.log(JSON.stringify({ outputDir, plannedAgentRuns: result.plan.plannedAgentRuns,
  completedAgentRuns: result.plan.completedAgentRuns, actualProviderModelCalls: result.actualProviderModelCalls,
  transportRequests: transport.snapshot().requests, maxConcurrentTransportRequests: transport.snapshot().maxActive,
  blindedEntries: blinded.packet.entries.length, reviewerLabelCounts: labels.map((entry) => entry.labels.length) }, null, 2));
