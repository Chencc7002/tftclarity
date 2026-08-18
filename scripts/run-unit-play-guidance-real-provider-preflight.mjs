import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { runRealProviderPreflight } from "../src/experiments/unit-play-guidance-real-provider/preflight.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-real-provider", "config.v1.json");
const CORPUS_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "corpus.v1.json");
const FIXTURE_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-control", "tool-observations.v1.json");
const DEFAULT_MANIFEST_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-real-provider", "run-manifest.v1.json");
const DEFAULT_RESULT_PATH = path.join(ROOT, "eval", "skills", "unit-play-guidance-real-provider", "preflight-result.v1.json");
const DEFAULT_REPORT_PATH = path.join(ROOT, "docs", "unit-play-guidance-real-provider-preflight-report.md");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function git(args, fallback) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function status(value) {
  return value ? "PASS" : "FAIL";
}

function markdown(result, worktreeBeforeRunClean) {
  const gateRows = Object.entries(result.gates)
    .map(([gate, passed]) => `| ${gate} | ${status(passed)} |`)
    .join("\n");
  const provider = result.manifest.provider;
  const callSites = result.productionAudit.providerCallSites
    .map((site) => `- \`${site.file}:${site.line}\` — renderer option ${site.rendererOptionPresent ? "present" : "absent"}`)
    .join("\n") || "- none";
  return `# Unit Play Guidance PR1D Zero-call Preflight Report

Status: **${result.status.toUpperCase()}**

Mode: **dry-run / zero real-provider calls**

Real-provider canonical run: **NOT AUTHORIZED**

## Result

The bounded PR1D harness, guidance-renderer seam, deterministic routing/fallback checks, canonical 180-run plan, redacted manifest, and secret policy passed without issuing a real Provider HTTP request.

This report does not establish real-model compliance, stability, tokens, latency, value, or production suitability. It is only the evidence requested for Provider-call Authorization Review.

## Reproducibility

| Field | Value |
| --- | --- |
| Implementation commit SHA | \`${result.manifest.implementationCommitSha}\` |
| Worktree before runner wrote artifacts | ${worktreeBeforeRunClean ? "clean" : "dirty"} |
| Runtime | \`${result.runtimeVersion}\` |
| Experiment | \`${result.manifest.experimentId}\` |
| Planned pairs | ${result.plan.pairCount} |
| Planned complete Agent runs | ${result.plan.plannedAgentRuns} |
| Actual real Provider HTTP calls | ${result.plan.actualProviderHttpCalls} |
| Pair-order SHA-256 | \`${result.plan.orderSha256}\` |

## Redacted Provider manifest

| Field | Value |
| --- | --- |
| Provider/config | \`${result.manifest.provider.runtimeProviderConfig}\` / \`${provider.protocol}\` |
| Endpoint class | \`${provider.endpointClass}\` |
| Endpoint | \`${provider.endpoint}\` |
| Model | \`${provider.model}\` |
| Decision prompt | \`${provider.decisionPromptVersion}\` |
| Message layout | \`${provider.messageLayout}\` |
| Temperature / top_p | \`${provider.temperature}\` / \`${provider.topP}\` |
| Output tokens | ${provider.maxOutputTokens}; repair ${provider.repairMaxOutputTokens} |
| Timeout / attempts / transport retries | ${provider.timeoutMs} ms / ${provider.maxActionAttempts} / ${provider.transportRetries} |
| Thinking / response format | \`${provider.thinkingMode}\` / \`${provider.responseFormat}\` |
| Cache namespace / client response cache | \`${provider.cacheNamespace}\` / \`${provider.clientResponseCache}\` |
| API key configured | ${result.manifest.credential.configured} (boolean only; secret not persisted) |

## Frozen hashes

| Artifact | SHA-256 |
| --- | --- |
| Corpus | \`${result.hashes.corpus}\` |
| Tool observations | \`${result.hashes.fixtures}\` |
| A guidance | \`${result.hashes.baselineGuidance}\` |
| B content | \`${result.hashes.candidateContent}\` |
| B rendered context | \`${result.hashes.candidateRenderedContexts.join("`, `")}\` |
| Pre-seam default messages | \`${result.seam.defaultMessagesSha256}\` |

## Provider seam

- Default serialized messages byte-identical to the pre-seam pinned hash: ${status(result.seam.defaultMessagesByteIdentical)}.
- Candidate capture differs only at \`semanticGuidance\`: ${status(result.seam.onlyGuidanceDiffers)}.
- Local fake-transport capture requests: ${result.seam.localCaptureRequests}.
- Actual Provider HTTP calls: ${result.seam.actualProviderHttpCalls}.
- Production experiment imports: ${result.productionAudit.experimentImports.length}.
- Production renderer references outside the Provider implementation: ${result.productionAudit.productionRendererReferences.length}.

Production \`createReactDecisionProvider\` call sites:

${callSites}

## Deterministic checks

- Positive selection: ${result.deterministicChecks.routing.positiveEligible}/${result.deterministicChecks.routing.positiveTotal}.
- Negative false takeover: ${result.deterministicChecks.routing.negativeFalseTakeover}/20.
- Boundary forced takeover: ${result.deterministicChecks.routing.boundaryForcedTakeover}/10.
- Second TaskFrame parses: ${result.deterministicChecks.routing.secondTaskFrameParses}.
- Skill routing/completion model calls: ${result.deterministicChecks.routing.llmSkillRouterCalls + result.deterministicChecks.routing.addedRoutingOrCompletionModelCalls}.
- Fault fallback to pinned A: ${result.deterministicChecks.fallback.fallbackToPinnedA}/${result.deterministicChecks.fallback.total}; wrong destination ${result.deterministicChecks.fallback.wrongDestination}.
- Secret material persisted: ${result.secretAudit.secretMaterialPersisted}.

## Gates

| Gate | Result |
| --- | --- |
${gateRows}

## Decision

PR1D zero-call implementation preflight: **${result.status.toUpperCase()}**. Request architecture/product review for canonical Provider-call authorization. Until that authorization is explicit, the 180-run real-provider experiment remains blocked and production control/PR2 remain unauthorized.
`;
}

const [config, corpus, fixtures] = await Promise.all([
  fs.readFile(CONFIG_PATH, "utf8").then(JSON.parse),
  fs.readFile(CORPUS_PATH, "utf8").then(JSON.parse),
  fs.readFile(FIXTURE_PATH, "utf8").then(JSON.parse)
]);
const implementationCommitSha = git(["rev-parse", "HEAD"], "unavailable");
const worktreeBeforeRunClean = git(["status", "--porcelain"], "unknown") === "";
const result = await runRealProviderPreflight({
  config,
  corpus,
  fixtures,
  root: ROOT,
  apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  implementationCommitSha
});

const manifestPath = path.resolve(ROOT, argValue("manifest", DEFAULT_MANIFEST_PATH));
const resultPath = path.resolve(ROOT, argValue("result", DEFAULT_RESULT_PATH));
const reportPath = path.resolve(ROOT, argValue("report", DEFAULT_REPORT_PATH));
await Promise.all([
  fs.mkdir(path.dirname(manifestPath), { recursive: true }),
  fs.mkdir(path.dirname(resultPath), { recursive: true }),
  fs.mkdir(path.dirname(reportPath), { recursive: true })
]);
await Promise.all([
  fs.writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8"),
  fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
  fs.writeFile(reportPath, markdown(result, worktreeBeforeRunClean), "utf8")
]);

console.log(JSON.stringify({
  status: result.status,
  implementationCommitSha,
  worktreeBeforeRunClean,
  plannedAgentRuns: result.plan.plannedAgentRuns,
  actualProviderHttpCalls: result.plan.actualProviderHttpCalls,
  manifest: path.relative(ROOT, manifestPath).replaceAll("\\", "/"),
  result: path.relative(ROOT, resultPath).replaceAll("\\", "/"),
  report: path.relative(ROOT, reportPath).replaceAll("\\", "/"),
  gates: result.gates
}, null, 2));

if (result.status !== "passed") process.exitCode = 1;
