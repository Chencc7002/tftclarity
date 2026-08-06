import { applyCompPreferenceSearch } from "../../core/comp-preference-search.js";
import { ResultPolicyExecutor } from "../../agent/result-policy-executor.js";

export const TFT_COMP_PREFERENCE_RESULT_POLICY_ID = "tft.comp_preferences.v1";
export const TFT_UNIT_BUILDS_PER_ENTITY_RESULT_POLICY_ID = "tft.unit_builds.per_entity.v1";
export const TFT_UNIT_BUILDS_COMPARISON_RESULT_POLICY_ID = "tft.unit_builds.comparison.v1";

export function compileTftSemanticResultPolicy(plan, taskFrame = {}) {
  const candidate = structuredClone(plan);
  if (candidate?.steps?.at?.(-1)?.tool !== "unit_builds_batch") return candidate;
  const comparison = taskFrame.action === "compare"
    || taskFrame.goal === "compare_entity_build_performance"
    || (taskFrame.expectedOutput ?? []).includes("comparison");
  candidate.resultPolicy = {
    type: "registered",
    policyId: comparison
      ? TFT_UNIT_BUILDS_COMPARISON_RESULT_POLICY_ID
      : TFT_UNIT_BUILDS_PER_ENTITY_RESULT_POLICY_ID,
    payload: comparison
      ? { mode: "rank_candidate_build_performance" }
      : { mode: "per_entity_recommendations", preserveCandidateOrder: true }
  };
  return candidate;
}

export function compileTftResultPolicy(plan, query = {}) {
  const candidate = structuredClone(plan);
  if (
    candidate?.steps?.length !== 1
    || candidate.steps[0].tool !== "comps_rankings"
    || query.preferenceRequested !== true
  ) {
    return candidate;
  }
  candidate.resultPolicy = {
    type: "registered",
    policyId: TFT_COMP_PREFERENCE_RESULT_POLICY_ID,
    payload: {
      conditions: structuredClone(query.preferenceConditions ?? {}),
      minSamples: Math.max(0, Number(query.minSamples ?? 0))
    }
  };
  return candidate;
}

function executeCompPreferencePolicy(input, payload) {
  const value = applyCompPreferenceSearch(input, {
    conditions: payload.conditions,
    minSamples: payload.minSamples
  });
  return {
    value,
    inputCount: input?.candidates?.length ?? 0,
    matchedCount: value?.preferenceSearch?.conditionMatchCount ?? null,
    outputCount: value?.preferenceSearch?.returnedCount ?? 0
  };
}

function availableFirstComparison(left, right) {
  return Number(right?.available) - Number(left?.available)
    || Number(right?.top4Rate ?? -1) - Number(left?.top4Rate ?? -1)
    || Number(left?.avgPlacement ?? 99) - Number(right?.avgPlacement ?? 99)
    || Number(right?.games ?? 0) - Number(left?.games ?? 0);
}

function executeUnitBuildsPerEntityPolicy(input) {
  const value = structuredClone(input);
  const results = Array.isArray(value?.results) ? value.results : [];
  const available = results.filter((entry) => entry?.available !== false);
  const unavailable = results.filter((entry) => entry?.available === false);
  value.resultMode = "per_entity_recommendations";
  value.text = available.length
    ? `已整理${available.map((entry) => entry.name).join("、")}各自的主流出装。${unavailable.length ? ` ${unavailable.map((entry) => entry.name).join("、")}的统计暂时不可用。` : ""}`
    : "候选棋子的出装统计暂时不可用，请稍后刷新。";
  return {
    value,
    inputCount: results.length,
    matchedCount: available.length,
    outputCount: results.length
  };
}

function executeUnitBuildsComparisonPolicy(input) {
  const value = structuredClone(input);
  const results = Array.isArray(value?.results)
    ? value.results.map((entry, index) => ({ entry, index }))
      .sort((left, right) => availableFirstComparison(left.entry, right.entry) || left.index - right.index)
      .map(({ entry }) => entry)
    : [];
  const available = results.filter((entry) => entry?.available !== false);
  const unavailable = results.filter((entry) => entry?.available === false);
  value.results = results;
  value.resultMode = "rank_candidate_build_performance";
  value.text = available.length
    ? `${available[0].name}的主流出装在候选中表现最好。${unavailable.length ? ` ${unavailable.map((entry) => entry.name).join("、")}的统计暂时不可用。` : ""}`
    : "候选棋子的出装统计暂时不可用，请稍后刷新。";
  return {
    value,
    inputCount: results.length,
    matchedCount: available.length,
    outputCount: results.length
  };
}

export function createTftResultPolicyExecutor() {
  return new ResultPolicyExecutor({
    handlers: {
      [TFT_COMP_PREFERENCE_RESULT_POLICY_ID]: executeCompPreferencePolicy,
      [TFT_UNIT_BUILDS_PER_ENTITY_RESULT_POLICY_ID]: executeUnitBuildsPerEntityPolicy,
      [TFT_UNIT_BUILDS_COMPARISON_RESULT_POLICY_ID]: executeUnitBuildsComparisonPolicy
    }
  });
}
