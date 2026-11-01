import { classifyDomain, hasExplicitTftDomain } from "../domain/tft/domain-gate.js";
import { TASK_FRAME_ACTIONS } from "./task-frame.js";

export const JEV_DIMENSIONS_SCHEMA = "jev-intent-dimensions.v2";
const DEPENDENT = new Set(["continue", "modify", "return_to_previous", "reply_to_clarification"]);
const ENTITY_TYPES = new Set(["unit", "item", "trait", "composition", "augment"]);
const OPERATIONS = Object.freeze({
  unit_builds: "recommend", unit_build_rankings: "recommend", unit_builds_batch: "recommend", item_carriers: "recommend",
  item_carrier_rankings: "recommend", emblem_carriers: "recommend",
  comps_rankings: "rank", emblem_rankings: "rank", item_rankings: "rank",
  item_compare: "compare", item_comparison: "compare", comps_analysis: "analyze",
  comps_trends: "analyze", unit_details: "explain", item_details: "explain", trait_details: "explain"
});
const safeId = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/u.test(value) ? value : null;
const entities = values => (Array.isArray(values) ? values : []).filter(x => ENTITY_TYPES.has(x?.entityType) && safeId(x.apiName))
  .slice(0, 6).map(x => ({ entityType: x.entityType, apiName: x.apiName }));

// Called only with the server-loaded Bridge view and the already available catalog.
// Body.taskAnchor/body.bridgeContext and assistant prose are never authoritative.
export function buildJevDimensionContext(request, { bridgeContext = null, catalog = null } = {}) {
  const current = classifyDomain(request.input, { conversation: [], defaultDomain: "out_of_domain" });
  const explicitOutside = current.source === "explicit_out_of_domain_pattern";
  const explicitTft = hasExplicitTftDomain(request.input);
  const text = String(request.input ?? "").normalize("NFKC").toLowerCase();
  const currentEntities = [];
  if (!explicitOutside) for (const [key, entityType] of [["units", "unit"], ["items", "item"], ["traits", "trait"]]) {
    for (const entity of catalog?.[key] ?? []) {
      if (!safeId(entity.apiName)) continue;
      const names = [entity.zhName, entity.enName, entity.name, ...(entity.aliases ?? [])];
      if (names.some(name => typeof name === "string" && name.length >= 2 && text.includes(name.normalize("NFKC").toLowerCase()))) {
        currentEntities.push({ entityType, apiName: entity.apiName });
      }
    }
  }
  const view = bridgeContext?.view;
  const canRead = !request.startNewTask && !explicitOutside && !bridgeContext?.warning
    && view?.schemaVersion === "conversation-bridge-context.v1" && DEPENDENT.has(bridgeContext.relation);
  const record = canRead ? view.records?.find(x => x.status === "completed") : null;
  const previousAction = OPERATIONS[record?.operation] ?? null;
  const refs = entities(record?.entityRefs);
  const confirmation = canRead ? view.pendingClarification?.confirmationContext : null;
  const pending = confirmation?.type === "entity_candidate" && ENTITY_TYPES.has(confirmation.entityType)
    ? { type: "entity_candidate", entityType: confirmation.entityType,
      candidates: entities((confirmation.candidates ?? []).map(x => ({ ...x, entityType: confirmation.entityType }))) }
    : null;
  const inherited = Boolean(canRead && (previousAction || refs.length || pending));
  return {
    domain: explicitOutside ? "out_of_domain" : explicitTft || currentEntities.length || inherited ? "tft" : "unknown",
    domainSource: explicitOutside || explicitTft ? "current_input" : currentEntities.length ? "current_catalog" : inherited ? "conversation_bridge" : "unresolved",
    relation: canRead ? bridgeContext.relation : "none",
    previousAction, currentEntities: entities(currentEntities), previousEntities: refs,
    pendingClarification: pending,
    // Multiple returned candidates are context, never an automatically resolved pronoun.
    entityResolution: currentEntities.length ? "explicit_current" : refs.length === 1 && !pending ? "single_antecedent" : "unresolved"
  };
}

export function projectJevDimensionInput(request, context) {
  const turns = request.startNewTask ? [] : (request.messages ?? []).filter(x => x.role === "user" && typeof x.content === "string");
  if (turns.at(-1)?.content === request.input) turns.pop();
  const summary = { untrustedPreviousUserTurns: turns.slice(-3).map(x => x.content.slice(0, 700)),
    serverIntentContext: context, factsAvailable: false };
  // Keep valid JSON under the adapter limit, including escaped control characters.
  while (JSON.stringify(summary).length > 6000 && summary.untrustedPreviousUserTurns.length) summary.untrustedPreviousUserTurns.shift();
  return { input: request.input, conversationSummary: JSON.stringify(summary), intentPolicy: "dimensions" };
}

const confidence = answer => Math.min(answer?.confidence ?? 0, answer?.probabilities?.[answer?.choice] ?? 0);

export function projectJevDimensions(result, context, { minConfidence = 0.7 } = {}) {
  if (!Number.isFinite(minConfidence) || minConfidence < 0.5 || minConfidence > 1) throw new TypeError("Invalid Jev dimensions confidence");
  const none = disposition => ({ disposition, advisory: null, accepted: { action: false, domain: false, context: false } });
  if (result?.status !== "observed") return none("unavailable");
  if (context.domain === "out_of_domain") return none("explicit_out_of_domain");
  const { action, domain, context: relation } = result.answers;
  const scores = { action: confidence(action), domain: confidence(domain), context: confidence(relation) };
  const resolvedDomain = context.domain === "tft" ? "tft"
    : domain.choice === "tft" && scores.domain >= minConfidence ? "tft" : null;
  if (!resolvedDomain) return none("domain_unresolved");
  const accepted = { action: TASK_FRAME_ACTIONS.includes(action.choice) && action.choice !== "unknown" && scores.action >= minConfidence,
    domain: true, context: ["self_contained", "contextual", "missing"].includes(relation.choice) && scores.context >= minConfidence };
  const uncertainties = [];
  if (!accepted.action) uncertainties.push("action_uncertain");
  if (!accepted.context) uncertainties.push("context_uncertain");
  if (accepted.context && relation.choice === "missing") uncertainties.push("context_missing");
  if (context.domain === "tft" && domain.choice !== "tft") uncertainties.push("domain_disagreement");
  if (context.entityResolution === "unresolved" && (context.relation !== "none" || relation.choice !== "self_contained")) uncertainties.push("entity_unresolved");
  return { disposition: accepted.action ? "action_hint_eligible" : "context_hint_only", accepted,
    advisory: { schemaVersion: JEV_DIMENSIONS_SCHEMA, authority: "intent_hint_only",
      action: accepted.action ? action.choice : null, domain: resolvedDomain,
      context: accepted.context ? relation.choice : null,
      domainSource: context.domain === "tft" ? context.domainSource : "jev",
      confidence: scores, uncertainties,
      // These IDs express antecedents, never execution arguments or current facts.
      entityContext: { current: context.currentEntities, previous: context.previousEntities,
        resolution: context.entityResolution, pendingClarification: context.pendingClarification }
    } };
}

// Logs contain decisions/counts only; IDs and source text remain request-local.
export function dimensionTelemetry(policy) {
  return { disposition: policy.disposition, accepted: policy.accepted,
    action: policy.advisory?.action ?? null, domainSource: policy.advisory?.domainSource ?? null,
    context: policy.advisory?.context ?? null, uncertainties: policy.advisory?.uncertainties ?? [] };
}
