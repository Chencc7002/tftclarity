import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = new URL(
  process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:17336/"
);
const seasonContextId = process.argv.find((value) => value.startsWith("--season="))
  ?.slice("--season=".length) ?? "set17-live";
const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? ".artifacts/r1-acceptance/r1-real-composition-add.json"
);

async function json(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function liveCompositions() {
  const requestId = randomUUID();
  const payload = await json("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: "推荐当前版本热门阵容",
      conversationId: `composition-add-sample-${requestId}`,
      seasonContextId,
      quickTask: {
        schemaVersion: "quick-task.v1",
        id: "comp-rankings",
        operation: "comp_rankings",
        requestId,
        arguments: {}
      }
    })
  });
  const seen = new Set();
  return [
    ...(payload.rankings?.top4Rate ?? []),
    ...(payload.rankings?.popularity ?? []),
    ...(payload.rankings?.winRate ?? [])
  ].filter((composition) => {
    if (
      !composition?.compId
      || !composition?.name
      || composition.units?.length < 2
      || seen.has(composition.compId)
    ) return false;
    seen.add(composition.compId);
    return true;
  });
}

async function react(input) {
  const startedAt = Date.now();
  const response = await fetch(new URL("/api/react-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({
      input,
      requestId: `composition-add-${randomUUID()}`,
      conversationId: `composition-add-${randomUUID()}`,
      seasonContextId
    })
  });
  const raw = await response.text();
  const lines = raw.trim().split(/\n+/u).filter(Boolean).map(JSON.parse);
  const events = lines.filter((line) => line.type === "event").map((line) => line.event);
  const complete = lines.findLast((line) => line.type === "complete");
  const payload = complete?.payload ?? {};
  const evaluationEvidence = (payload.evidence ?? []).find((entry) => (
    entry.toolName === "composition_change_evaluation"
  ));
  return {
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    answer: payload.answer ?? null,
    answerOrigin: payload.answerOrigin ?? null,
    toolSequence: events.filter((event) => event.type === "tool_started")
      .map((event) => event.data?.tool),
    rejectedDecisions: events.filter((event) => event.type === "decision_rejected")
      .map((event) => event.data),
    evaluation: evaluationEvidence?.value ?? null,
    evidence: payload.evidence ?? [],
    warnings: payload.warnings ?? [],
    groundingAudit: payload.groundingAudit ?? null,
    latencyMs: Date.now() - startedAt
  };
}

const runtime = await json("/api/runtime");
const provenance = runtime.runtime?.acceptanceProvenance ?? null;
if (
  provenance?.decisionProviderMode !== "real_model"
  || provenance?.toolHandlerMode !== "production"
  || provenance?.fixtureMode !== false
) {
  throw new Error(`Real acceptance provenance failed: ${JSON.stringify(provenance)}`);
}
if (!runtime.runtime?.agent?.registeredTools?.includes("composition_change_evaluation")) {
  throw new Error("composition_change_evaluation is not registered in the running service");
}

const compositions = await liveCompositions();
if (compositions.length < 2) throw new Error("Need at least two current compositions");
const composition = compositions[0];
const memberApiNames = new Set(composition.units.map((unit) => unit.apiName));
const incoming = compositions.slice(1).flatMap((candidate) => candidate.units)
  .find((unit) => unit?.apiName && unit?.name && !memberApiNames.has(unit.apiName));
if (!incoming) throw new Error("Need one dynamically sampled unit outside the selected composition");

const input = `给${composition.name}阵容额外加入${incoming.name}，自动计算加入前后的羁绊人数和档位变化。只使用真实阵容与官方棋子证据，不要判断阵容强弱。`;
const result = await react(input);
const evaluation = result.evaluation;
const memberBefore = evaluation?.memberChange?.before ?? [];
const memberAfter = evaluation?.memberChange?.after ?? [];
const forbiddenStrengthClaim = /(?:一定更强|明显更强|最佳加人|最优加人|胜率更高|stronger|optimal|statistically better)/iu;
const summary = {
  legalCompletion: ["completed", "completed_with_warning"].includes(result.status),
  changeToolExecuted: result.toolSequence.includes("composition_change_evaluation"),
  evaluationStatus: evaluation?.status ?? null,
  operationIsAdd: evaluation?.operation === "add",
  targetOmitted: evaluation?.target === null,
  incomingMatchesSelection: evaluation?.incoming?.apiName === incoming.apiName,
  memberCountIncreasedByOne: memberAfter.length === memberBefore.length + 1,
  incomingAppendedOnce: memberAfter.filter((apiName) => apiName === incoming.apiName).length === 1,
  deterministicTraitDeltasReturned: Array.isArray(evaluation?.traitDeltas)
    && evaluation.traitDeltas.length > 0,
  strengthNotEvaluated: evaluation?.strengthConclusion === "not_evaluated",
  forbiddenStrengthClaimFound: forbiddenStrengthClaim.test(result.answer ?? ""),
  unknownToolExecution: result.rejectedDecisions.some((entry) => (
    entry.code === "unknown_tool" || entry.errors?.some?.((error) => /not registered/u.test(error))
  ))
};
summary.acceptancePassed = summary.legalCompletion
  && summary.changeToolExecuted
  && summary.evaluationStatus === "evaluated"
  && summary.operationIsAdd
  && summary.targetOmitted
  && summary.incomingMatchesSelection
  && summary.memberCountIncreasedByOne
  && summary.incomingAppendedOnce
  && summary.deterministicTraitDeltasReturned
  && summary.strengthNotEvaluated
  && !summary.forbiddenStrengthClaimFound
  && !summary.unknownToolExecution;

const report = {
  schemaVersion: "r1-real-composition-add.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  seasonContextId,
  provenance,
  selection: {
    composition: { compId: composition.compId, name: composition.name },
    incoming,
    candidateCompositionCount: compositions.length
  },
  input,
  summary,
  result
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, selection: report.selection, summary }, null, 2));
if (!summary.acceptancePassed) process.exitCode = 1;
