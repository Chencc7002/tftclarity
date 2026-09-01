import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runForwardPreflight } from "../src/experiments/unit-play-guidance-forward/preflight.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const readJson = (relative) => readFile(path.join(ROOT, relative), "utf8").then(JSON.parse);
const [config, corpus, observations] = await Promise.all([
  readJson("eval/skills/unit-play-guidance-forward/config.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/corpus.v2.json"),
  readJson("eval/skills/unit-play-guidance-forward/tool-observations.v2.json")
]);
const result = await runForwardPreflight({ config, corpus, observations, root: ROOT });
const resultPath = path.join(ROOT, "eval/skills/unit-play-guidance-forward/preflight-result.v2.json");
const reportPath = path.join(ROOT, "docs/unit-play-guidance-forward-preflight-report-20260901.md");
const report = `# Unit Play Guidance v2 Forward Zero-call Preflight

Status: **${result.status.toUpperCase()}**

This is a forward-evaluation readiness check for Skill 1.5.7. Two earlier Warwick HTTP diagnostics are disclosed in the frozen corpus metadata, so this is not described as a pristine pre-candidate corpus. No formal paired output existed before this freeze.

## Frozen identity

| Field | Value |
| --- | --- |
| Experiment | \`${result.experimentId}\` |
| Corpus SHA-256 | \`${result.hashes.corpus}\` |
| Observation SHA-256 | \`${result.hashes.observations}\` |
| Candidate Skill SHA-256 | \`${result.hashes.candidateSkill}\` |
| Baseline guidance SHA-256 | \`${result.hashes.baselineGuidance}\` |
| Candidate rendered context SHA-256 | \`${result.hashes.candidateRenderedContext}\` |
| Default Provider messages SHA-256 | \`${result.hashes.defaultMessages}\` |

## Population and evidence

- 30 eligible prompts across 10 current Set 18 units, with 10 English cases.
- 20 negative and 10 boundary routing cases.
- Each unit has one three-item server plan, one matching official item batch, two distinct composition candidates, and two complete tactical formations.
- Cost distribution is ${Object.entries(result.observationsAudit.costDistribution).map(([cost, count]) => `${cost}-cost=${count}`).join(", ")}.

## Zero-call checks

- Planned pairs: ${result.plan.pairCount}; planned complete Agent runs: ${result.plan.plannedAgentRuns}.
- Actual Provider model calls: ${result.plan.actualProviderModelCalls}.
- Positive routing: ${result.routing.positiveSelected}/30; negative false takeover: ${result.routing.negativeFalseTakeover}; boundary forced takeover: ${result.routing.boundaryForcedTakeover}.
- The locally captured Provider payload differs only at the professional-guidance field.
- Model-observation projection is deterministic, leaves the source object unchanged, and reduces the representative frozen observation.
- Canonical replay is pinned to frozen Observation only and evaluates receipt freshness at \`frozenAt + 1 ms\`; live Tool retrieval is disabled.
- Production source has no import of the v2 experiment module.
- Production default remains Skill 1.3.0. Both arms pin cards-only positioning, exact composition queries, item batching, official item receipts, and projection as common runtime conditions.

## Boundary

${result.claimBoundary}. The canonical real-provider runner for this v2 population has not been authorized or executed. Browser DOM/layout review is also still outstanding because the user is connected remotely.
`;
await mkdir(path.dirname(resultPath), { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
await writeFile(reportPath, report, { flag: "wx" });
console.log(JSON.stringify({ status: result.status, resultPath, reportPath,
  plannedAgentRuns: result.plan.plannedAgentRuns, actualProviderModelCalls: result.plan.actualProviderModelCalls,
  gates: result.gates }, null, 2));
if (result.status !== "passed") process.exitCode = 1;
