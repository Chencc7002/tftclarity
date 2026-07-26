import { normalizeAlias } from "../../core/normalizer.js";

export const TFT_EXECUTION_QUERY_ADAPTER_VERSION = "tft-execution-query-adapter.v1";

const TOOL_INTENTS = Object.freeze({
  unit_builds: "unit_build_rankings",
  unit_details: "unit_details",
  item_details: "item_details",
  trait_details: "trait_details",
  comps_rankings: "comp_rankings",
  comps_trends: "comp_trends",
  comps_analysis: "comp_analysis",
  semantic_search: "unit_item_availability"
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function mappedConceptResidue(hint, mapping) {
  const fragment = normalizeAlias(hint?.inputFragment);
  const mention = normalizeAlias(mapping?.mention);
  if (!fragment || !mention) return false;
  const genericSuffixes = ["阵容", "体系"];
  const residue = genericSuffixes.reduce(
    (value, suffix) => value.endsWith(suffix) ? value.slice(0, -suffix.length) : value,
    fragment
  );
  return Boolean(residue && (mention.endsWith(residue) || residue.endsWith(mention)));
}

export function adaptTftExecutionPlanToParsed(parsed, plan, taskFrame, route) {
  const steps = array(plan?.steps);
  if (steps.length !== 1) return parsed;
  const intent = TOOL_INTENTS[steps[0].tool];
  if (!intent) return parsed;
  const mapping = plan.conceptMapping;
  const remainingHints = array(parsed?.parser?.unresolvedEntityHints)
    .filter((hint) => !mappedConceptResidue(hint, mapping));
  const policyDriven = plan.resultPolicy?.type !== "identity";
  const strategyArgument = plan.resultPolicy?.argument;
  const strategy = strategyArgument
    ? steps[0].arguments?.[strategyArgument]
    : undefined;
  const limit = taskFrame?.constraints?.limit;
  const preferenceConditions = {
    ...(parsed.preferenceConditions ?? {}),
    ...(strategy !== undefined ? { strategy } : {}),
    ...(Number.isInteger(limit) ? { count: limit } : {})
  };
  return {
    ...parsed,
    intent,
    preferenceRequested: policyDriven || Boolean(parsed.preferenceRequested),
    preferenceConditions: policyDriven
      ? preferenceConditions
      : parsed.preferenceConditions,
    parser: {
      ...(parsed.parser ?? {}),
      unresolvedEntityHints: remainingHints,
      semanticCorrection: {
        schemaVersion: TFT_EXECUTION_QUERY_ADAPTER_VERSION,
        route,
        executionPath: plan.route,
        conceptId: mapping?.conceptId ?? null,
        resultPolicy: plan.resultPolicy?.type ?? "identity",
        strategy: strategy ?? null,
        limit: Number.isInteger(limit) ? limit : null
      }
    }
  };
}
