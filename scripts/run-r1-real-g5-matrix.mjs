import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const argument = (name, fallback) => process.argv
  .find((value) => value.startsWith(`--${name}=`))
  ?.slice(name.length + 3) ?? fallback;
const baseUrl = new URL(argument("base-url", "http://127.0.0.1:17335/"));
const seasonContextId = argument("season", "set17-live");
const baselinePath = resolve(argument(
  "baseline",
  ".artifacts/r1-acceptance/r1-real-g4a-baseline-for-g5.json"
));
const outputPath = resolve(argument(
  "output",
  ".artifacts/r1-acceptance/r1-real-g5-matrix.json"
));
const attemptsPerCase = Math.max(1, Math.min(4, Number(argument("attempts-per-case", "3")) || 3));

async function json(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function itemApiName(item) {
  return String(typeof item === "string" ? item : item?.apiName ?? "");
}

function resultContains(result, apiName) {
  return (result?.buildOptions ?? []).some((option) => (
    (option?.items ?? []).some((item) => itemApiName(item) === apiName)
  ));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function comparableScope(value = {}) {
  const query = value.query ?? {};
  return {
    compositionId: String(query.compositionId ?? ""),
    entities: (query.entities ?? []).map((entity) => String(entity?.apiName ?? "")),
    seasonContextId: String(query.seasonContextId ?? ""),
    patch: String(query.patch ?? ""),
    queue: String(query.queue ?? ""),
    rank: (query.rank ?? []).map(String),
    days: Number(query.days ?? 0),
    minSamples: Number(query.minSamples ?? 0)
  };
}

function sameScope(left, right) {
  return left.compositionId === right.compositionId
    && sameArray(left.entities, right.entities)
    && left.seasonContextId === right.seasonContextId
    && left.patch === right.patch
    && left.queue === right.queue
    && sameArray(left.rank, right.rank)
    && left.days === right.days
    && left.minSamples === right.minSamples;
}

function selectConstraintCandidate(caseRecord) {
  const value = caseRecord.buildEvidence?.value ?? {};
  const resultByUnit = new Map((value.results ?? []).map((result) => [
    String(result.apiName ?? result.unit?.apiName ?? ""),
    result
  ]));
  const eligible = (value.itemContentionPlan?.contestedItems ?? []).flatMap((item) => {
    const apiName = String(item.itemRef?.apiName ?? "");
    const participants = item.participants ?? [];
    if (!apiName || participants.length < 2) return [];
    const retainsAlternatives = participants.every((participant) => {
      const unitApiName = String(participant.unitRef?.apiName ?? "");
      const optionCount = resultByUnit.get(unitApiName)?.buildOptions?.length ?? 0;
      return optionCount > Number(participant.supportingBuildCount ?? 0);
    });
    if (!retainsAlternatives) return [];
    const prevalence = Math.max(...participants.map((participant) => {
      const unitApiName = String(participant.unitRef?.apiName ?? "");
      const optionCount = resultByUnit.get(unitApiName)?.buildOptions?.length ?? 1;
      return Number(participant.supportingBuildCount ?? 0) / optionCount;
    }));
    return [{
      apiName,
      name: String(item.itemRef?.name ?? apiName),
      prevalence,
      participantCount: participants.length,
      supportingBuildCount: Number(item.supportingBuildCount ?? 0)
    }];
  });
  return eligible.sort((left, right) => (
    left.prevalence - right.prevalence
    || left.supportingBuildCount - right.supportingBuildCount
    || left.apiName.localeCompare(right.apiName)
  ))[0] ?? null;
}

async function runReact(caseId, selection, constraint) {
  const input = [
    `对“${selection.name}”做真实约束重查。`,
    "先解析该阵容，并严格使用 itemContentionQueryPlan 原样调用一次 unit_builds_batch 取得无约束基线。",
    `然后明确排除“${constraint.name}”（${constraint.apiName}），用完全相同的 compositionId、entities 顺序和 optionsPerUnit 再调用 unit_builds_batch；constraints.excludedItems 只能包含这个 API 名。`,
    "禁止手工删除旧结果。请比较两次新旧证据；约束后没有匹配构筑时，明确说明证据限制。"
  ].join("");
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
  const payload = lines.findLast((line) => line.type === "complete")?.payload ?? {};
  const buildEvidence = (payload.evidence ?? []).filter((entry) => entry.toolName === "unit_builds_batch");
  const compositionEvidence = (payload.evidence ?? []).findLast((entry) => entry.toolName === "comps_rankings") ?? null;
  const baselineEvidence = buildEvidence.find((entry) => {
    const constraints = entry.value?.query?.constraints ?? entry.value?.constraints ?? {};
    return !(constraints.lockedItems?.length || constraints.excludedItems?.length);
  }) ?? null;
  const constrainedEvidence = buildEvidence.findLast((entry) => (
    entry.value?.query?.constraints?.excludedItems?.includes(constraint.apiName)
  )) ?? null;
  const baselineValue = baselineEvidence?.value ?? {};
  const constrainedValue = constrainedEvidence?.value ?? {};
  const baselineScope = comparableScope(baselineValue);
  const constrainedScope = comparableScope(constrainedValue);
  const audits = (constrainedValue.results ?? []).map((result) => result.constraintAudit).filter(Boolean);
  const successfulAudits = (constrainedValue.results ?? [])
    .filter((result) => result.available === true && result.buildOptions?.length)
    .map((result) => result.constraintAudit)
    .filter(Boolean);
  const returnedOptions = (constrainedValue.results ?? []).flatMap((result) => result.buildOptions ?? []);
  const exactCandidatePlan = compositionEvidence?.value?.results?.[0]?.itemContentionQueryPlan ?? null;
  const expectedEntities = (exactCandidatePlan?.apiNames ?? []).map(String);
  const answer = String(payload.answer ?? "");
  const validation = {
    compositionResolved: compositionEvidence?.value?.resolution?.status === "resolved",
    exactDynamicCandidateScope: exactCandidatePlan?.status === "ready"
      && baselineScope.compositionId === String(selection.compId)
      && sameArray(baselineScope.entities, expectedEntities),
    baselinePresent: Boolean(baselineEvidence),
    baselineHasBuildOptions: (baselineValue.results ?? []).some((result) => result.buildOptions?.length),
    constrainedPresent: Boolean(constrainedEvidence),
    exactConstraintEcho: sameArray(
      constrainedValue.query?.constraints?.excludedItems ?? [],
      [constraint.apiName]
    ) && !(constrainedValue.query?.constraints?.lockedItems?.length),
    sameProductionScope: sameScope(baselineScope, constrainedScope),
    sameProvider: baselineValue.source?.provider === "MetaTFT"
      && constrainedValue.source?.provider === baselineValue.source?.provider,
    fingerprintsDiffer: Boolean(baselineValue.constraintQueryFingerprint)
      && Boolean(constrainedValue.constraintQueryFingerprint)
      && baselineValue.constraintQueryFingerprint !== constrainedValue.constraintQueryFingerprint,
    filterAppliedBeforeRanking: audits.length > 0 && audits.every((audit) => (
      audit.applicationMode === "deterministic_source_row_filter_before_ranking"
      && audit.appliedBeforeRanking === true
    )),
    sourceRowsAudited: successfulAudits.length > 0 && successfulAudits.every((audit) => (
      Number.isInteger(audit.sourceRowCount)
      && Number.isInteger(audit.eligibleBeforeConstraints)
      && Number.isInteger(audit.eligibleAfterConstraints)
      && audit.eligibleAfterConstraints <= audit.eligibleBeforeConstraints
    )),
    constraintChangedEvidence: audits.some((audit) => audit.changedEligibleRowSet === true),
    constrainedHasBuildOptions: returnedOptions.length > 0,
    excludedItemAbsent: returnedOptions.length > 0 && !returnedOptions.some((option) => (
      (option.items ?? []).some((item) => itemApiName(item) === constraint.apiName)
    )),
    answerNamesConstraint: answer.includes(constraint.name) || answer.includes(constraint.apiName),
    answerOriginTransparent: ["model", "system_evidence_fallback"].includes(payload.answerOrigin),
    noRejectedConstraintCall: !events.some((event) => (
      event.type === "decision_rejected"
      && event.data?.code === "invalid_unit_build_batch_constraints"
    ))
  };
  return {
    caseId,
    selection,
    constraintSelection: {
      ...constraint,
      algorithm: "lowest_participant_prevalence_with_retrieved_alternatives"
    },
    input,
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    answer: payload.answer ?? null,
    answerOrigin: payload.answerOrigin ?? null,
    toolSequence: events.filter((event) => event.type === "tool_started").map((event) => event.data?.tool),
    toolFailures: events.filter((event) => event.type === "tool_failed").map((event) => event.data),
    rejectedDecisions: events.filter((event) => event.type === "decision_rejected").map((event) => event.data),
    baselineEvidence,
    constrainedEvidence,
    compositionEvidence,
    warnings: payload.warnings ?? [],
    groundingAudit: payload.groundingAudit ?? null,
    latencyMs: Date.now() - startedAt,
    validation
  };
}

const runtime = await json("/api/runtime");
const provenance = runtime.runtime?.acceptanceProvenance ?? {};
if (
  provenance.decisionProviderMode !== "real_model"
  || provenance.toolHandlerMode !== "production"
  || provenance.fixtureMode !== false
) {
  throw new Error(`Real acceptance provenance failed: ${JSON.stringify(provenance)}`);
}
if (runtime.runtime?.routing?.reactChatEnabled !== true) {
  throw new Error("Frontend ReAct route is not enabled");
}
if (!runtime.runtime?.agent?.registeredTools?.includes("unit_builds_batch")) {
  throw new Error("Production unit_builds_batch is not registered");
}

const baselineReport = JSON.parse(await readFile(baselinePath, "utf8"));
if (baselineReport.provenance?.fixtureMode !== false || baselineReport.provenance?.toolHandlerMode !== "production") {
  throw new Error("Baseline artifact is not production evidence");
}
const dynamicCandidates = (baselineReport.cases ?? []).flatMap((caseRecord) => {
  if (!caseRecord.validation?.contentionAvailable) return [];
  const constraint = selectConstraintCandidate(caseRecord);
  return constraint ? [{ selection: caseRecord.selection, constraint }] : [];
});
if (dynamicCandidates.length < 2) {
  throw new Error("Need at least two dynamically selected production composition cases");
}

const cases = [];
for (const [index, candidate] of dynamicCandidates.entries()) {
  for (let attempt = 1; attempt <= attemptsPerCase; attempt += 1) {
    const record = await runReact(
      `G5-dynamic-${index + 1}-attempt-${attempt}`,
      candidate.selection,
      candidate.constraint
    );
    cases.push(record);
    const checksPassed = Object.values(record.validation).every((value) => value === true);
    const acceptedStatus = ["completed", "completed_with_warning"].includes(record.status);
    console.log(JSON.stringify({
      caseId: record.caseId,
      composition: record.selection,
      constraint: record.constraintSelection,
      status: record.status,
      toolSequence: record.toolSequence,
      passedChecks: Object.values(record.validation).filter(Boolean).length,
      totalChecks: Object.keys(record.validation).length,
      latencyMs: record.latencyMs
    }));
    if (checksPassed && acceptedStatus) break;
  }
}

const requiredChecks = Object.keys(cases[0]?.validation ?? {});
const validCases = cases.filter((record) => (
  ["completed", "completed_with_warning"].includes(record.status)
  && requiredChecks.every((key) => record.validation[key] === true)
));
const validCompositionCount = new Set(validCases.map((record) => record.selection.compId)).size;
const report = {
  schemaVersion: "r1-real-g5-matrix.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  seasonContextId,
  baselineArtifact: baselinePath,
  provenance,
  runtime: {
    groundingMode: runtime.runtime?.agent?.groundingMode ?? null,
    reactSafety: runtime.runtime?.agent?.reactSafety ?? null,
    requestTimeouts: runtime.runtime?.requests ?? null
  },
  dynamicSelection: {
    candidateCount: dynamicCandidates.length,
    attemptedCount: cases.length,
    attemptsPerCase,
    entityNamesHardcoded: false,
    compositionNamesHardcoded: false,
    itemNamesHardcoded: false,
    algorithm: "lowest participant prevalence among contested items where every participant retains a retrieved alternative"
  },
  summary: {
    validCaseCount: validCases.length,
    validCompositionCount,
    requiredValidCaseCount: 2,
    allRequiredChecks: requiredChecks,
    acceptancePassed: validCompositionCount >= 2
  },
  cases
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));
if (!report.summary.acceptancePassed) process.exitCode = 1;
