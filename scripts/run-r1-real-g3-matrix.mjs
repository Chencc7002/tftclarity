import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = new URL(
  process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:17335/"
);
const seasonContextId = process.argv.find((value) => value.startsWith("--season="))
  ?.slice("--season=".length) ?? "set17-live";
const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? ".artifacts/r1-acceptance/r1-real-g3-matrix.json"
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
      conversationId: `g3-sample-${requestId}`,
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
  const candidates = [
    ...(payload.rankings?.top4Rate ?? []),
    ...(payload.rankings?.popularity ?? []),
    ...(payload.rankings?.winRate ?? [])
  ];
  const seen = new Set();
  return candidates.filter((composition) => {
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

async function react(caseId, input) {
  const startedAt = Date.now();
  const response = await fetch(new URL("/api/react-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({
      input,
      requestId: `${caseId}-${randomUUID()}`,
      conversationId: `${caseId}-${randomUUID()}`,
      seasonContextId
    })
  });
  const raw = await response.text();
  const lines = raw.trim().split(/\n+/u).filter(Boolean).map(JSON.parse);
  const events = lines.filter((line) => line.type === "event").map((line) => line.event);
  const complete = lines.findLast((line) => line.type === "complete");
  const payload = complete?.payload ?? {};
  const evaluationEvidence = (payload.evidence ?? []).find((entry) => (
    entry.toolName === "composition_replacement_evaluation"
  ));
  return {
    caseId,
    input,
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    answer: payload.answer ?? null,
    question: payload.question ?? null,
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
if (!runtime.runtime?.agent?.registeredTools?.includes("composition_replacement_evaluation")) {
  throw new Error("G3 production tool is not registered in the running service");
}

const compositions = await liveCompositions();
if (compositions.length < 2) throw new Error("Need at least two current live compositions for dynamic sampling");
const composition = compositions[0];
const memberApiNames = new Set(composition.units.map((unit) => unit.apiName));
const outsiders = compositions.flatMap((candidate) => candidate.units)
  .filter((unit) => unit?.apiName && !memberApiNames.has(unit.apiName));
const uniqueOutsiders = [...new Map(outsiders.map((unit) => [unit.apiName, unit])).values()];
if (uniqueOutsiders.length < 2) throw new Error("Need two dynamically sampled units outside the selected composition");
const target = composition.units[0];
const existingMember = composition.units[1];
const replacement = uniqueOutsiders[0];
const outsideTarget = uniqueOutsiders[1];

const cases = [];
cases.push(await react(
  "G3-valid-replacement",
  `把${composition.name}阵容里的${target.name}换成${replacement.name}，阵容结构会怎么变化？请不要判断强弱，只说明可验证的羁绊数量和档位变化，并区分事实与判断。`
));
console.log("G3 valid replacement completed");
cases.push(await react(
  "G3-target-not-member",
  `把${composition.name}阵容里的${outsideTarget.name}换成${replacement.name}，阵容结构会怎么变化？请先校验被替换棋子是否属于这个阵容。`
));
console.log("G3 target-not-member completed");
cases.push(await react(
  "G3-replacement-already-member",
  `把${composition.name}阵容里的${target.name}换成${existingMember.name}，阵容结构会怎么变化？请先校验替换后的棋子是否已经在阵容里。`
));
console.log("G3 replacement-already-member completed");

const valid = cases[0];
const forbiddenStrengthClaim = /(?:更强|最优|最佳替换|胜率更高|统计上更好|stronger|optimal|statistically better)/iu;
const summary = {
  validEvaluationExecuted: valid.toolSequence.includes("composition_replacement_evaluation"),
  validEvaluationStatus: valid.evaluation?.status ?? null,
  validMembershipChecked: valid.evaluation?.membershipValidation?.targetIsMember === true
    && valid.evaluation?.membershipValidation?.replacementAlreadyMember === false,
  deterministicTraitDeltasReturned: Array.isArray(valid.evaluation?.traitDeltas)
    && valid.evaluation.traitDeltas.length > 0,
  strengthNotEvaluated: valid.evaluation?.strengthConclusion === "not_evaluated",
  forbiddenStrengthClaimFound: forbiddenStrengthClaim.test(valid.answer ?? ""),
  targetNotMemberHandledSafely: cases[1].evaluation?.status === "invalid_target"
    || cases[1].rejectedDecisions.some((entry) => entry.code === "invalid_composition_replacement_evidence")
    || /(?:不属于|不是.*成员|无法替换|先确认)/u.test(cases[1].answer ?? cases[1].question ?? ""),
  replacementAlreadyMemberHandledSafely: cases[2].evaluation?.status === "invalid_replacement"
    || cases[2].rejectedDecisions.some((entry) => entry.code === "invalid_composition_replacement_evidence")
    || /(?:已经在|已有成员|不能重复|无法替换)/u.test(cases[2].answer ?? cases[2].question ?? "")
};

const report = {
  schemaVersion: "r1-real-g3-matrix.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  seasonContextId,
  provenance,
  groundingMode: runtime.runtime?.agent?.groundingMode ?? null,
  selection: {
    composition: { compId: composition.compId, name: composition.name },
    target,
    replacement,
    outsideTarget,
    existingMember,
    candidateCompositionCount: compositions.length
  },
  summary,
  cases
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, selection: report.selection, summary }, null, 2));

if (
  !summary.validEvaluationExecuted
  || summary.validEvaluationStatus !== "evaluated"
  || !summary.validMembershipChecked
  || !summary.deterministicTraitDeltasReturned
  || !summary.strengthNotEvaluated
  || summary.forbiddenStrengthClaimFound
  || !summary.targetNotMemberHandledSafely
  || !summary.replacementAlreadyMemberHandledSafely
) process.exitCode = 1;
