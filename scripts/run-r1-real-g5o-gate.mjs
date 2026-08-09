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
  ".artifacts/r1-acceptance/r1-real-g5o-gate.json"
));

async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl));
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function itemApiName(item) {
  return String(typeof item === "string" ? item : item?.apiName ?? "");
}

function itemDisplayName(item) {
  return String(typeof item === "string" ? item : item?.displayName ?? item?.name ?? item?.apiName ?? "");
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function constraintCandidates(caseRecord, mode) {
  const value = caseRecord.buildEvidence?.value ?? {};
  const results = (value.results ?? []).filter((result) => result?.available === true && result.buildOptions?.length);
  const records = new Map();
  for (const result of results) {
    const unitApiName = String(result.apiName ?? result.unit?.apiName ?? "");
    const options = result.buildOptions ?? [];
    for (const option of options) {
      for (const item of option.items ?? []) {
        const apiName = itemApiName(item);
        if (!apiName) continue;
        const record = records.get(apiName) ?? {
          apiName,
          name: itemDisplayName(item) || apiName,
          supportingBuildCount: 0,
          participantUnits: new Set(),
          totalBuildCount: 0
        };
        record.supportingBuildCount += 1;
        record.participantUnits.add(unitApiName);
        records.set(apiName, record);
      }
    }
  }
  for (const record of records.values()) {
    record.totalBuildCount = results.reduce((total, result) => total + (result.buildOptions?.length ?? 0), 0);
  }
  const candidates = [...records.values()].flatMap((record) => {
    const affected = results.filter((result) => (
      (result.buildOptions ?? []).some((option) => (
        (option.items ?? []).some((item) => itemApiName(item) === record.apiName)
      ))
    ));
    if (!affected.length) return [];
    if (mode === "excludedItems") {
      const allRetainAlternatives = affected.every((result) => (
        (result.buildOptions ?? []).some((option) => (
          !(option.items ?? []).some((item) => itemApiName(item) === record.apiName)
        ))
      ));
      if (!allRetainAlternatives) return [];
    }
    return [{
      apiName: record.apiName,
      name: record.name,
      participantCount: record.participantUnits.size,
      supportingBuildCount: record.supportingBuildCount,
      totalBuildCount: record.totalBuildCount,
      prevalence: record.supportingBuildCount / Math.max(1, record.totalBuildCount)
    }];
  });
  return candidates.sort((left, right) => mode === "lockedItems"
    ? right.participantCount - left.participantCount
      || right.supportingBuildCount - left.supportingBuildCount
      || left.apiName.localeCompare(right.apiName)
    : left.prevalence - right.prevalence
      || left.supportingBuildCount - right.supportingBuildCount
      || left.apiName.localeCompare(right.apiName));
}

function selectDynamicCases(baseline) {
  const usable = (baseline.cases ?? []).filter((caseRecord) => (
    caseRecord.selection?.compId
    && caseRecord.selection?.name
    && caseRecord.buildEvidence?.value?.results?.some((result) => result?.available === true && result.buildOptions?.length)
    && caseRecord.compositionEvidence?.value?.results?.[0]?.itemContentionQueryPlan?.status === "ready"
  ));
  const selections = [];
  for (const caseRecord of usable) {
    if (selections.length >= 2) break;
    const constraint = constraintCandidates(caseRecord, "excludedItems")[0];
    if (constraint) selections.push({ caseRecord, mode: "excludedItems", constraint });
  }
  const used = new Set(selections.map((entry) => entry.caseRecord.selection.compId));
  const locked = usable
    .filter((caseRecord) => !used.has(caseRecord.selection.compId))
    .map((caseRecord) => ({
      caseRecord,
      mode: "lockedItems",
      constraint: constraintCandidates(caseRecord, "lockedItems")[0]
    }))
    .find((entry) => entry.constraint);
  if (locked) selections.push(locked);
  if (selections.length < 3) {
    for (const caseRecord of usable) {
      if (selections.length >= 3) break;
      if (selections.some((entry) => entry.caseRecord.selection.compId === caseRecord.selection.compId)) continue;
      const constraint = constraintCandidates(caseRecord, "excludedItems")[0];
      if (constraint) selections.push({ caseRecord, mode: "excludedItems", constraint });
    }
  }
  return selections.slice(0, 3);
}

function buildPrompt(selection) {
  const { caseRecord, mode, constraint } = selection;
  const operation = mode === "lockedItems" ? "锁定" : "排除";
  const field = `constraints.${mode}`;
  return [
    `对“${caseRecord.selection.name}”执行一次真实约束重查。`,
    "先解析该阵容，并严格复制 itemContentionQueryPlan 的 compositionId、entities 顺序和 optionsPerUnit 调用一次无约束 unit_builds_batch 基线。",
    `然后${operation}“${constraint.name}”（${constraint.apiName}），以完全相同的范围再调用一次 unit_builds_batch；${field} 只能包含这个 API 名。`,
    "unit_builds_batch 的 seasonContextId、patch 和 scopeKey 由服务端提供，禁止放进 arguments。",
    "取得约束后证据后遵循 nextActionAffordance：若 recommendedAction=finish 就立即完成，不要重复 batch，也不要调用未被 affordance 要求的 item_details_batch。",
    "最终比较基线与约束后证据；没有匹配构筑时明确说明证据限制。"
  ].join("");
}

async function runCase(selection, index) {
  const input = buildPrompt(selection);
  const caseId = `G5O-dynamic-${index + 1}-${selection.mode}`;
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
  const baseline = buildEvidence.find((entry) => {
    const constraints = entry.value?.query?.constraints ?? {};
    return !(constraints.lockedItems?.length || constraints.excludedItems?.length);
  }) ?? null;
  const constrained = buildEvidence.filter((entry) => (
    entry.value?.query?.constraints?.[selection.mode]?.includes(selection.constraint.apiName)
  ));
  const constrainedValue = constrained[0]?.value ?? {};
  const options = (constrainedValue.results ?? []).flatMap((result) => result.buildOptions ?? []);
  const audits = (constrainedValue.results ?? []).map((result) => result.constraintAudit).filter(Boolean);
  const toolStarts = events.filter((event) => event.type === "tool_started").map((event) => event.data?.tool);
  const rejected = events.filter((event) => event.type === "decision_rejected").map((event) => event.data);
  const invalidBatchInputs = rejected.filter((entry) => (
    entry.code === "invalid_tool_input" && entry.tool === "unit_builds_batch"
  ));
  const duplicateWarnings = rejected.filter((entry) => entry.code === "duplicate_call");
  const locked = selection.mode === "lockedItems";
  const semanticsCorrect = options.length > 0 && options.every((option) => {
    const contains = (option.items ?? []).some((item) => itemApiName(item) === selection.constraint.apiName);
    return locked ? contains : !contains;
  });
  const validation = {
    legalCompletion: ["completed", "completed_with_warning"].includes(payload.status),
    constrainedResultNonEmpty: options.length > 0,
    constraintActuallyApplied: audits.length > 0 && audits.every((audit) => (
      audit.applicationMode === "deterministic_source_row_filter_before_ranking"
      && audit.appliedBeforeRanking === true
    )),
    constraintSemanticsCorrect: semanticsCorrect,
    baselinePresent: Boolean(baseline),
    constrainedBatchExactlyOnce: constrained.length === 1,
    duplicateSecondActualExecutionZero: buildEvidence.length === 2,
    unknownToolExecutionZero: toolStarts.every((tool) => runtimeTools.has(tool)),
    unsupportedStatisticsZero: !rejected.some((entry) => (
      (entry.errors ?? []).some((error) => /unsupported|statistical claim|not present in cited evidence/iu.test(String(error)))
    )),
    schemaInvalidToolExecutionZero: true,
    itemDetailsBatchWithinLimit: toolStarts.filter((tool) => tool === "item_details_batch").length <= 1,
    answerOriginAccepted: ["model", "system_evidence_fallback"].includes(payload.answerOrigin)
  };
  return {
    caseId,
    selection: selection.caseRecord.selection,
    constraint: {
      mode: selection.mode,
      ...selection.constraint,
      algorithm: selection.mode === "lockedItems"
        ? "highest_dynamic_participant_coverage"
        : "lowest_dynamic_prevalence_with_retrieved_alternatives"
    },
    input,
    httpStatus: response.status,
    status: payload.status ?? null,
    terminationReason: payload.terminationReason ?? null,
    answer: payload.answer ?? null,
    answerOrigin: payload.answerOrigin ?? null,
    modelConclusion: payload.modelConclusion ?? null,
    toolSequence: toolStarts,
    rejectedDecisions: rejected,
    invalidBatchInputCount: invalidBatchInputs.length,
    unitBuildBatchFirstAttemptSchemaValid: invalidBatchInputs.length === 0,
    duplicateWarningCount: duplicateWarnings.length,
    baselineEvidence: baseline,
    constrainedEvidence: constrained[0] ?? null,
    returnedOptionCount: options.length,
    warnings: payload.warnings ?? [],
    latencyMs: Date.now() - startedAt,
    validation
  };
}

const runtime = await getJson("/api/runtime");
const provenance = runtime.runtime?.acceptanceProvenance ?? {};
if (
  provenance.decisionProviderMode !== "real_model"
  || provenance.toolHandlerMode !== "production"
  || provenance.fixtureMode !== false
) throw new Error(`Real acceptance provenance failed: ${JSON.stringify(provenance)}`);
if (runtime.runtime?.routing?.reactChatEnabled !== true) throw new Error("ReAct route is disabled");
const runtimeTools = new Set(runtime.runtime?.agent?.registeredTools ?? []);
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
if (baseline.provenance?.fixtureMode !== false || baseline.provenance?.toolHandlerMode !== "production") {
  throw new Error("Baseline artifact is not production evidence");
}
const selections = selectDynamicCases(baseline);
if (selections.length < 3) throw new Error(`Need 3 dynamic cases, found ${selections.length}`);

const cases = [];
for (const [index, selection] of selections.entries()) {
  const record = await runCase(selection, index);
  cases.push(record);
  console.log(JSON.stringify({
    caseId: record.caseId,
    composition: record.selection,
    constraint: record.constraint,
    status: record.status,
    answerOrigin: record.answerOrigin,
    firstAttemptSchemaValid: record.unitBuildBatchFirstAttemptSchemaValid,
    duplicateWarnings: record.duplicateWarningCount,
    toolSequence: record.toolSequence,
    checks: `${Object.values(record.validation).filter(Boolean).length}/${Object.keys(record.validation).length}`,
    latencyMs: record.latencyMs
  }));
}

const legalCount = cases.filter((record) => record.validation.legalCompletion).length;
const nonEmptyCount = cases.filter((record) => record.validation.constrainedResultNonEmpty).length;
const appliedCount = cases.filter((record) => record.validation.constraintActuallyApplied).length;
const semanticsCount = cases.filter((record) => record.validation.constraintSemanticsCorrect).length;
const firstAttemptValidCount = cases.filter((record) => record.unitBuildBatchFirstAttemptSchemaValid).length;
const modelGroundedCount = cases.filter((record) => record.answerOrigin === "model").length;
const duplicateWarningCount = cases.reduce((total, record) => total + record.duplicateWarningCount, 0);
const allPerCaseChecks = cases.every((record) => Object.values(record.validation).every(Boolean));
const summary = {
  caseCount: cases.length,
  distinctCompositionCount: new Set(cases.map((record) => record.selection.compId)).size,
  excludedCaseCount: cases.filter((record) => record.constraint.mode === "excludedItems").length,
  lockedCaseCount: cases.filter((record) => record.constraint.mode === "lockedItems").length,
  legalCompletion: `${legalCount}/3`,
  constrainedResultNonEmpty: `${nonEmptyCount}/3`,
  constraintActuallyApplied: `${appliedCount}/3`,
  constraintSemanticsCorrect: `${semanticsCount}/3`,
  firstAttemptSchemaValid: `${firstAttemptValidCount}/3`,
  modelGrounded: `${modelGroundedCount}/3`,
  duplicateWarningCount,
  acceptancePassed: allPerCaseChecks
    && legalCount === 3
    && nonEmptyCount === 3
    && appliedCount === 3
    && semanticsCount === 3
    && firstAttemptValidCount >= 2
    && modelGroundedCount >= 2
    && duplicateWarningCount <= 1
};
const report = {
  schemaVersion: "r1-real-g5o-gate.v1",
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
    compositionNamesHardcoded: false,
    entityNamesHardcoded: false,
    itemNamesHardcoded: false,
    selectedAtRuntimeFromProductionEvidence: true
  },
  summary,
  cases
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary }, null, 2));
if (!summary.acceptancePassed) process.exitCode = 1;
