import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = new URL(
  process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:17335/"
);
const seasonContextId = process.argv.find((value) => value.startsWith("--season="))
  ?.slice("--season=".length) ?? "set17-live";
const maxAttemptValue = Number(
  process.argv.find((value) => value.startsWith("--max-attempts="))
    ?.slice("--max-attempts=".length) ?? 8
);
const maxAttempts = Number.isFinite(maxAttemptValue)
  ? Math.max(3, Math.min(12, Math.floor(maxAttemptValue)))
  : 8;
const outputPath = resolve(
  process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
    ?? ".artifacts/r1-acceptance/r1-real-g4a-matrix.json"
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
      conversationId: `g4a-sample-${requestId}`,
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

function evidenceByTool(payload, toolName) {
  return (payload.evidence ?? []).findLast((entry) => entry.toolName === toolName) ?? null;
}

function buildContainsItem(result, apiName) {
  return (result.buildOptions ?? []).some((option) => (
    (option.items ?? []).some((item) => (
      String(typeof item === "string" ? item : item?.apiName) === String(apiName)
    ))
  ));
}

function priorityAudit(answer) {
  const text = String(answer ?? "");
  const claim = /(?:(?:必须|应该|应当|优先|一定要).{0,12}(?:给|分配给)|(?:best|must|should|always).{0,16}(?:holder|give|assign|priority))/iu.test(text);
  const limitation = /(?:证据不足|无法判断|不能判断|不判断|未评估|没有优先级证据|insufficient|cannot determine|not evaluated)/iu.test(text);
  return { claim, limitation, unsupported: claim && !limitation };
}

function coverageAudit(answer, plan) {
  if (plan?.coverageStatus !== "partial") {
    return { required: false, failedUnitsNamed: true, wholeCompositionLimited: true };
  }
  const text = String(answer ?? "");
  const failedNames = (plan.failedUnits ?? [])
    .map((entry) => entry.unit?.name ?? entry.unit?.apiName)
    .filter(Boolean);
  return {
    required: true,
    failedUnitsNamed: failedNames.every((name) => text.includes(name)),
    wholeCompositionLimited: /(?:无法判断(?:整个|全).{0,8}阵容|不能绝对断言|可能还存在|尚未覆盖|cannot determine.{0,20}(?:whole|entire)|may be additional)/iu.test(text)
  };
}

function validateCase(record) {
  const compResult = record.compositionEvidence?.value?.results?.[0] ?? null;
  const candidatePlan = compResult?.itemContentionQueryPlan ?? null;
  const buildValue = record.buildEvidence?.value ?? null;
  const contentionPlan = buildValue?.itemContentionPlan ?? null;
  const buildResults = buildValue?.results ?? [];
  const itemValue = record.itemEvidence?.value ?? null;
  const selectedCandidates = new Set(candidatePlan?.apiNames ?? []);
  const detectorItems = contentionPlan?.apiNames ?? [];
  const returnedItems = (itemValue?.items ?? []).map((item) => item.apiName).filter(Boolean);
  const intersectionsValid = (contentionPlan?.contestedItems ?? []).every((item) => (
    item.participantCount >= 2
    && (item.participants ?? []).length >= 2
    && (item.participants ?? []).every((participant) => {
      const participantApiName = participant.unitRef?.apiName;
      const result = buildResults.find((candidate) => candidate.apiName === participantApiName);
      return selectedCandidates.has(participantApiName)
        && result?.available === true
        && buildContainsItem(result, item.itemRef?.apiName);
    })
  ));
  const itemBatchExact = detectorItems.length > 0
    && detectorItems.length === returnedItems.length
    && detectorItems.every((apiName, index) => apiName === returnedItems[index]);
  const priority = priorityAudit(record.answer);
  const coverage = coverageAudit(record.answer, contentionPlan);
  const contestedNames = (contentionPlan?.contestedItems ?? [])
    .map((item) => item.itemRef?.name ?? item.itemRef?.apiName)
    .filter(Boolean);
  return {
    compositionResolved: record.compositionEvidence?.value?.resolution?.status === "resolved",
    candidatePlanReady: candidatePlan?.status === "ready" && selectedCandidates.size >= 2,
    exactCandidateCoverage: candidatePlan?.compositionId === contentionPlan?.compositionId
      && [...selectedCandidates].every((apiName) => buildResults.some((result) => result.apiName === apiName)),
    contentionAvailable: contentionPlan?.status === "available",
    coverageStatus: contentionPlan?.coverageStatus ?? null,
    intersectionsValid,
    itemDetailsCalled: record.toolSequence.includes("item_details_batch"),
    itemBatchExact,
    currentItemMechanicsAvailable: itemValue?.mechanismStatus === "available"
      && (itemValue?.items ?? []).every((item) => item.status === "found" && item.facts?.effect),
    contestedItemNamedInAnswer: contestedNames.length > 0
      && contestedNames.some((name) => String(record.answer ?? "").includes(name)),
    unsupportedPriorityClaim: priority.unsupported,
    partialCoverageDisclosed: !coverage.required
      || (coverage.failedUnitsNamed && coverage.wholeCompositionLimited)
  };
}

async function react(caseId, composition) {
  const input = `在${composition.name}阵容里，哪些有真实构筑数据的棋子会竞争同一件装备？只报告实际交集和官方装备机制，不判断装备必须优先给谁。`;
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
  const record = {
    caseId,
    selection: { compId: composition.compId, name: composition.name },
    input,
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    answer: payload.answer ?? null,
    toolSequence: events.filter((event) => event.type === "tool_started")
      .map((event) => event.data?.tool),
    rejectedDecisions: events.filter((event) => event.type === "decision_rejected")
      .map((event) => event.data),
    compositionEvidence: evidenceByTool(payload, "comps_rankings"),
    buildEvidence: evidenceByTool(payload, "unit_builds_batch"),
    itemEvidence: evidenceByTool(payload, "item_details_batch"),
    warnings: payload.warnings ?? [],
    groundingAudit: payload.groundingAudit ?? null,
    latencyMs: Date.now() - startedAt
  };
  record.validation = validateCase(record);
  return record;
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
if (runtime.runtime?.routing?.reactChatEnabled !== true) {
  throw new Error("Frontend ReAct route is not enabled in the running service");
}
for (const requiredTool of ["comps_rankings", "unit_builds_batch", "item_details_batch"]) {
  if (!runtime.runtime?.agent?.registeredTools?.includes(requiredTool)) {
    throw new Error(`G4-A production tool is not registered: ${requiredTool}`);
  }
}

const compositions = await liveCompositions();
if (compositions.length < 3) throw new Error("Need at least three live compositions for dynamic G4-A sampling");
const cases = [];
let positiveCount = 0;
for (const [index, composition] of compositions.slice(0, maxAttempts).entries()) {
  const record = await react(`G4A-dynamic-${index + 1}`, composition);
  cases.push(record);
  if (record.validation.contentionAvailable) positiveCount += 1;
  console.log(JSON.stringify({
    caseId: record.caseId,
    composition: record.selection,
    status: record.status,
    contentionStatus: record.buildEvidence?.value?.itemContentionPlan?.status ?? null,
    coverageStatus: record.validation.coverageStatus,
    positiveCount,
    latencyMs: record.latencyMs
  }));
  if (cases.length >= 3 && positiveCount >= 2) break;
}

const positiveCases = cases.filter((entry) => entry.validation.contentionAvailable);
const positiveCasesValid = positiveCases.filter((entry) => (
  entry.validation.compositionResolved
  && entry.validation.candidatePlanReady
  && entry.validation.exactCandidateCoverage
  && entry.validation.intersectionsValid
  && entry.validation.itemDetailsCalled
  && entry.validation.itemBatchExact
  && entry.validation.currentItemMechanicsAvailable
  && entry.validation.contestedItemNamedInAnswer
  && !entry.validation.unsupportedPriorityClaim
  && entry.validation.partialCoverageDisclosed
));
const report = {
  schemaVersion: "r1-real-g4a-matrix.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  seasonContextId,
  provenance,
  runtime: {
    groundingMode: runtime.runtime?.agent?.groundingMode ?? null,
    reactChatEnabled: runtime.runtime?.routing?.reactChatEnabled ?? null,
    requestTimeouts: runtime.runtime?.requests ?? null
  },
  dynamicSelection: {
    candidateCompositionCount: compositions.length,
    attemptedCompositionCount: cases.length,
    maxAttempts,
    noNamedEntityOrItemPreselection: true
  },
  summary: {
    positiveCaseCount: positiveCases.length,
    validPositiveCaseCount: positiveCasesValid.length,
    requiredPositiveCaseCount: 2,
    atLeastThreeDynamicCases: cases.length >= 3,
    acceptancePassed: cases.length >= 3 && positiveCasesValid.length >= 2
  },
  cases
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));
if (!report.summary.acceptancePassed) process.exitCode = 1;
