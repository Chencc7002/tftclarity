import { applyCompPreferenceSearch } from "../../core/comp-preference-search.js";
import { ResultPolicyExecutor } from "../../agent/result-policy-executor.js";

export const TFT_COMP_PREFERENCE_RESULT_POLICY_ID = "tft.comp_preferences.v1";

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

export function createTftResultPolicyExecutor() {
  return new ResultPolicyExecutor({
    handlers: {
      [TFT_COMP_PREFERENCE_RESULT_POLICY_ID]: executeCompPreferencePolicy
    }
  });
}
