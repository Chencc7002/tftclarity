import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { runUnitPlayGuidanceControlExperiment } from "../src/experiments/unit-play-guidance-control/harness.js";
import { sha256 } from "../src/experiments/unit-play-guidance-control/content.js";

const ROOT = process.cwd();
const CORPUS_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "corpus.v1.json");
const FIXTURE_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "tool-observations.v1.json");
const DEFAULT_REPORT_PATH = path.join(ROOT, "docs", "unit-play-guidance-control-experiment-report.md");

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function percent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function fixed(value) {
  return Number(value).toFixed(2);
}

async function productionImportAudit() {
  const findings = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (path.relative(ROOT, absolute).replaceAll("\\", "/") === "src/experiments") continue;
        await walk(absolute);
      } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/u.test(entry.name)) {
        const source = await fs.readFile(absolute, "utf8");
        if (/experiments[\\/]unit-play-guidance-control|unit-play-guidance-control[\\/]harness/iu.test(source)) {
          findings.push(path.relative(ROOT, absolute).replaceAll("\\", "/"));
        }
      }
    }
  }
  await walk(path.join(ROOT, "src"));
  return findings;
}

function facetRows(result, layer) {
  const metrics = layer === "answer" ? result.aggregate.answerCoverage : result.aggregate.evidenceCoverage;
  return Object.keys(metrics.A.perFacet).map((facet) => {
    const a = metrics.A.perFacet[facet];
    const b = metrics.BNative.perFacet[facet];
    const e2e = metrics.BEndToEnd.perFacet[facet];
    return `| ${facet} | ${a.covered}/${a.supported} | ${b.covered}/${b.supported} | ${e2e.covered}/${e2e.supported} |`;
  }).join("\n");
}

function safetyRows(result) {
  return Object.entries(result.aggregate.safety).map(([metric, values]) => (
    `| ${metric} | ${values.A} | ${values.BNative} | ${values.BEndToEnd} |`
  )).join("\n");
}

function caseRows(result) {
  return result.cases.map((entry) => {
    const a = entry.A;
    const b = entry.BNative;
    const supported = Object.values(b.answerFacets.supported).filter(Boolean).length;
    const aCovered = Object.entries(a.answerFacets.covered).filter(([facet, covered]) => covered && a.answerFacets.supported[facet]).length;
    const bCovered = Object.entries(b.answerFacets.covered).filter(([facet, covered]) => covered && b.answerFacets.supported[facet]).length;
    return `| ${entry.caseId} | ${a.telemetry.toolCalls} | ${b.telemetry.toolCalls} | ${aCovered}/${supported} | ${bCovered}/${supported} | ${entry.fallback.triggered ? entry.fallback.reason : "none"} |`;
  }).join("\n");
}

function faultRows(result) {
  return result.faultInjection.cases.map((entry) => (
    `| ${entry.fault} | ${entry.candidateNativeStatus} | ${entry.candidateNativeTerminationReason} | ${entry.fallbackDestination} | ${entry.fallbackGuidanceHash} | ${entry.succeeded ? "PASS" : "FAIL"} |`
  )).join("\n");
}

function gateRows(result) {
  return Object.entries(result.aggregate.gates).map(([gate, passed]) => `| ${gate} | ${passed ? "PASS" : "FAIL"} |`).join("\n");
}

function markdown({ result, commitSha, worktreeDirty, rawCorpusHash, rawFixtureHash, importFindings }) {
  const aCost = result.aggregate.cost.A;
  const bCost = result.aggregate.cost.BNative;
  const e2eCost = result.aggregate.cost.BEndToEnd;
  return `# Unit Play Guidance PR1C Control Experiment Report

Status: **${result.status.toUpperCase()}**
Mode: **paired isolated offline replay**
Production behavior: **unchanged; this report does not authorize rollout**

## Result qualification

This PR1C result establishes a narrower claim: **in a frozen ReAct/Tool/Evidence environment using the deterministic experiment decision provider, version-pinned candidate Skill guidance increased target facet coverage without increasing Tool calls**.

It does **not** establish real production-model instruction compliance, real-model output stability, actual provider token usage, actual provider latency, or production-control suitability. The 100 ms replay measurement is harness latency, and the token values are a shared deterministic estimator rather than provider billing telemetry. Those questions require a separately authorized real-provider offline acceptance phase.

## Reproducibility

| Field | Value |
| --- | --- |
| Base commit SHA | \`${commitSha}\` |
| Worktree | ${worktreeDirty ? "dirty (report includes uncommitted PR1C files)" : "clean"} |
| Runtime | \`${result.runtimeVersion}\` |
| ReAct implementation | \`${result.runtimeConfig.ReAct}\` |
| Provider | \`${result.runtimeConfig.provider}\` |
| Grounding | \`${result.runtimeConfig.groundingMode}\` |
| Corpus version | \`${result.corpus.version}\` |
| Corpus normalized SHA-256 | \`${result.corpus.hash}\` |
| Corpus file SHA-256 | \`${rawCorpusHash}\` |
| Fixture version | \`${result.fixtures.version}\` |
| Fixture normalized SHA-256 | \`${result.fixtures.hash}\` |
| Fixture file SHA-256 | \`${rawFixtureHash}\` |
| Baseline guidance | \`${result.content.baselineVersion}\` / \`${result.content.baselineHash}\` |
| Candidate content | \`${result.content.candidateVersion}\` / \`${result.content.candidateHash}\` |
| Candidate rendered context hashes | ${result.content.renderedCandidateContextHashes.map((value) => `\`${value}\``).join(", ")} |

The corpus was frozen for the reported run after harness bring-up and before this promotion-gate execution. Tool observations are local fixtures; identical Tool plus arguments replay byte-identical values in A and B. No live network data is part of the primary result.

## Boundary and routing

- Positive eligible: ${result.routing.positiveEligible}/${result.routing.positiveTotal}
- Negative false takeover: ${result.routing.negativeFalseTakeover}/${result.corpus.counts.negative}
- Boundary forced takeover: ${result.routing.boundaryForcedTakeover}/${result.corpus.counts.boundary}
- Second TaskFrame parses: ${result.routing.secondTaskFrameParses}
- LLM Skill Router calls: ${result.routing.llmSkillRouterCalls}
- Added routing/completion model calls: ${result.routing.addedRoutingOrCompletionModelCalls}
- Production imports of the experiment: ${importFindings.length}${importFindings.length ? ` (${importFindings.join(", ")})` : ""}

The two arms reuse \`ReactLoop\` with the same tool definitions, budgets, grounding mode, deterministic provider implementation and frozen observations. WorkingState, EvidenceLedger, duplicate-call guard, termination state, telemetry and run IDs are created independently. A sentinel mutation injected into A was absent from B. Conversation persistence writes were zero.

## Gates

| Gate | Result |
| --- | --- |
${gateRows(result)}

## Answer facet coverage

| Facet | A | B-native | B-end-to-end |
| --- | ---: | ---: | ---: |
${facetRows(result, "answer")}

- Required answer coverage: A ${percent(result.aggregate.answerCoverage.A.requiredCoverage)}, B-native ${percent(result.aggregate.answerCoverage.BNative.requiredCoverage)}, B-end-to-end ${percent(result.aggregate.answerCoverage.BEndToEnd.requiredCoverage)}.
- Total supported-facet answer coverage: A ${percent(result.aggregate.answerCoverage.A.totalCoverage)}, B-native ${percent(result.aggregate.answerCoverage.BNative.totalCoverage)}, B-end-to-end ${percent(result.aggregate.answerCoverage.BEndToEnd.totalCoverage)}.
- B-native total gain: ${percent(result.aggregate.answerCoverage.valueGain)}; missing-required-facet relative reduction: ${percent(result.aggregate.answerCoverage.relativeMissingReduction)}.

Positioning is \`required_if_supported\`: unsupported fixture cases are excluded from its coverage denominator and must carry a qualification instead of a fabricated recommendation.

## Evidence facet coverage

| Facet | A | B-native | B-end-to-end |
| --- | ---: | ---: | ---: |
${facetRows(result, "evidence")}

## Cost

| Metric | A | B-native | B-end-to-end | Gate |
| --- | ---: | ---: | ---: | --- |
| Mean Tool calls | ${fixed(aCost.meanToolCalls)} | ${fixed(bCost.meanToolCalls)} | ${fixed(e2eCost.meanToolCalls)} | B <= A + 0.5 |
| p95 Tool calls | ${fixed(aCost.p95ToolCalls)} | ${fixed(bCost.p95ToolCalls)} | ${fixed(e2eCost.p95ToolCalls)} | B <= A + 1 |
| Mean frozen replay latency (ms) | ${fixed(aCost.meanReplayLatencyMs)} | ${fixed(bCost.meanReplayLatencyMs)} | ${fixed(e2eCost.meanReplayLatencyMs)} | B <= A x 1.20 |
| Mean estimated input+output tokens | ${fixed(aCost.meanTokens)} | ${fixed(bCost.meanTokens)} | ${fixed(e2eCost.meanTokens)} | B <= A x 1.20 |

- Extra Tool calls per newly covered required facet: ${fixed(result.aggregate.efficiency.extraToolCallsPerNewRequiredFacet)}
- Tokens per covered supported facet: ${fixed(result.aggregate.efficiency.tokensPerCoveredFacet)}

Latency is deterministic frozen-replay end-to-end latency, not live provider wall time. Token counts are the same deterministic character-based estimator in both arms.

## Safety

| Metric | A | B-native | B-end-to-end |
| --- | ---: | ---: | ---: |
${safetyRows(result)}

## Fault injection and fallback

| Fault | B-native status | B-native termination | Destination | Fallback guidance hash | Result |
| --- | --- | --- | --- | --- | --- |
${faultRows(result)}

Fallback success: ${result.faultInjection.fallbackToPinnedA}/${result.faultInjection.total}; wrong destination: ${result.faultInjection.wrongDestination}. Normal unforced fallback: ${result.aggregate.gates.unforcedFallback ? "0" : "non-zero"}.

## Per-case compact results

| Case | A tools | B tools | A supported answer facets | B-native supported answer facets | Fallback |
| --- | ---: | ---: | ---: | ---: | --- |
${caseRows(result)}

Negative and boundary per-case routing outcomes are recorded in the machine result produced by the same runner. This report contains metrics and outputs only; it contains no hidden reasoning or chain-of-thought.

## Decision

PR1C deterministic isolated/offline control experiment: **${result.status.toUpperCase()}**. Offline Control Harness and deterministic Skill-value replay passed; real-model Skill control behavior remains **NOT YET TESTED**. This is evidence for product review only. It does not enable Skill control, alter the production request handler, replace semantic guidance, or authorize PR2/production rollout.
`;
}

const [rawCorpus, rawFixtures] = await Promise.all([
  fs.readFile(CORPUS_PATH, "utf8"),
  fs.readFile(FIXTURE_PATH, "utf8")
]);
const corpus = JSON.parse(rawCorpus);
const fixtures = JSON.parse(rawFixtures);
const result = await runUnitPlayGuidanceControlExperiment({ corpus, fixtures, includeCaseDetails: true });
const importFindings = await productionImportAudit();
if (importFindings.length) result.status = "failed";
const commitSha = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
})();
const worktreeDirty = (() => {
  try {
    return Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim());
  } catch {
    return null;
  }
})();

const reportPath = path.resolve(ROOT, argValue("report", DEFAULT_REPORT_PATH));
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, markdown({
  result,
  commitSha,
  worktreeDirty,
  rawCorpusHash: sha256(rawCorpus),
  rawFixtureHash: sha256(rawFixtures),
  importFindings
}), "utf8");

const jsonPath = argValue("json");
if (jsonPath) {
  const absoluteJsonPath = path.resolve(ROOT, jsonPath);
  await fs.mkdir(path.dirname(absoluteJsonPath), { recursive: true });
  await fs.writeFile(absoluteJsonPath, `${JSON.stringify({ commitSha, worktreeDirty, importFindings, result }, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  status: result.status,
  report: path.relative(ROOT, reportPath).replaceAll("\\", "/"),
  corpus: result.corpus,
  fixtures: result.fixtures,
  content: result.content,
  routing: result.routing,
  gates: result.aggregate.gates,
  faultInjection: {
    total: result.faultInjection.total,
    fallbackToPinnedA: result.faultInjection.fallbackToPinnedA,
    wrongDestination: result.faultInjection.wrongDestination
  },
  productionImportFindings: importFindings
}, null, 2));

if (result.status !== "passed") process.exitCode = 1;
