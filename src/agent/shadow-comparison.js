export const SHADOW_COMPARISON_SCHEMA_VERSION = "agent-shadow-comparison.v1";
export const PUBLIC_RESULT_COMPARISON_VERSION = "public-business-result-comparison.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])])
  );
}

function differences(left = {}, right = {}) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.filter((key) => (
    JSON.stringify(stable(left[key])) !== JSON.stringify(stable(right[key]))
  )).map((key) => ({
    parameter: key,
    executionPlan: left[key] ?? null,
    legacyPlan: right[key] ?? null
  }));
}

function publicProjection(value = {}) {
  return {
    type: value?.type ?? null,
    cards: value?.cards ?? value?.results ?? [],
    rankings: value?.rankings ?? value?.ranking ?? null,
    comparison: value?.comparison ?? null,
    references: value?.references ?? [],
    evidence: value?.evidence ?? value?.answer?.evidence ?? null,
    source: value?.source ?? null,
    clarification: value?.clarification ?? null,
    answer: value?.answer ? {
      text: value.answer.text ?? value.answer.generatedConclusion?.text ?? null,
      status: value.answer.status ?? value.answer.generatedConclusion?.status ?? null,
      evidenceValidation: value.answer.evidenceValidation ?? null
    } : null,
    text: value?.text ?? null,
    warnings: value?.warnings ?? value?.query?.warnings ?? []
  };
}

export function comparePublicBusinessResults(executionResult, legacyResult) {
  const execution = stable(publicProjection(executionResult));
  const legacy = stable(publicProjection(legacyResult));
  const fields = Object.keys(execution);
  const fieldDifferences = fields.filter((field) => (
    JSON.stringify(execution[field]) !== JSON.stringify(legacy[field])
  ));
  return {
    schemaVersion: PUBLIC_RESULT_COMPARISON_VERSION,
    equivalent: fieldDifferences.length === 0,
    fieldDifferences,
    execution,
    legacy
  };
}

export function compareExecutionAndLegacyPlans(executionPlan, retrievalPlan, options = {}) {
  const next = array(executionPlan?.steps).map((step) => ({
    tool: step.tool,
    arguments: step.arguments ?? {}
  }));
  const legacy = array(retrievalPlan?.structuredQueries).map((query) => ({
    tool: query.operation,
    arguments: query.params ?? {}
  }));
  const length = Math.max(next.length, legacy.length);
  const parameterDifferences = [];
  for (let index = 0; index < length; index += 1) {
    const current = next[index] ?? {};
    const prior = legacy[index] ?? {};
    for (const difference of differences(current.arguments, prior.arguments)) {
      parameterDifferences.push({
        step: index,
        tool: current.tool ?? prior.tool ?? null,
        ...difference
      });
    }
  }
  const newResult = options.executionResult;
  const legacyResult = options.legacyResult;
  const resultCompared = newResult !== undefined && legacyResult !== undefined;
  const publicResultComparison = resultCompared
    ? comparePublicBusinessResults(newResult, legacyResult)
    : null;
  return {
    schemaVersion: SHADOW_COMPARISON_SCHEMA_VERSION,
    selectedPath: options.selectedPath ?? "unselected",
    fallbackReason: options.fallbackReason ?? null,
    executionPlanTools: next.map((entry) => entry.tool),
    legacyPlanTools: legacy.map((entry) => entry.tool),
    toolDifference: JSON.stringify(next.map((entry) => entry.tool))
      !== JSON.stringify(legacy.map((entry) => entry.tool)),
    parameterDifferences,
    parameterDifference: parameterDifferences.length > 0,
    resultDifference: resultCompared ? !publicResultComparison.equivalent : null,
    resultComparisonStatus: resultCompared ? "compared" : "not_sampled",
    publicResultComparison,
    stepCount: next.length,
    toolCallLimit: 3
  };
}
