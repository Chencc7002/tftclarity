import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createReactDecisionProvider } from "../../react/react-decision-provider.js";
import { SkillRegistry, matchSkill, buildSkillContext } from "../../skills/index.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1_4 } from "../../skills/definitions/unit-play-guidance.js";

const pick = (value, keys) => Object.fromEntries(keys.flatMap((key) => value?.[key] === undefined ? [] : [[key, value[key]]]));
const compactSource = (source) => pick(source, ["provider", "sourceType", "sourceId", "endpoint", "detailsEndpoint",
  "definitionEndpoint", "updatedAt", "risk", "retrieval"]);

function projectUnitPlayToolValue(tool, value, targetUnitId) {
  if (!value || typeof value !== "object") return value;
  if (["entity_catalog_query"].includes(tool)) return {
    ...pick(value, ["type", "source", "updatedAt", "entityType", "requestedNames", "resolution", "scope"]),
    results: (value.results ?? []).map((entry) => pick(entry, ["apiName", "displayName", "name", "entityType"]))
  };
  if (["unit_details", "item_details"].includes(tool)) return {
    ...pick(value, ["schemaVersion", "type", "status", "entityType", "apiName", "displayName", "entityRef", "scope", "facts", "updatedAt", "warnings"]),
    source: compactSource(value.source)
  };
  if (tool === "item_details_batch") return {
    ...pick(value, ["schemaVersion", "type", "status", "scope", "selection", "mechanismStatus", "updatedAt", "warnings"]),
    items: (value.items ?? []).map((item) => ({
      ...pick(item, ["schemaVersion", "type", "status", "entityType", "apiName", "displayName", "entityRef", "scope", "facts", "updatedAt", "warnings", "claimId", "evidencePath"]),
      source: compactSource(item.source)
    }))
  };
  if (tool === "unit_builds") return {
    ...pick(value, ["type", "updatedAt", "warnings", "mechanismQueryPlan"]),
    unit: pick(value.unit, ["apiName", "name"]),
    cards: (value.cards ?? []).slice(0, 1).map((card) => ({
      ...pick(card, ["title", "winner", "stats", "lowSample"]),
      items: (card.items ?? []).map((item) => pick(item, ["apiName", "name", "locked"]))
    })),
    query: pick(value.query, ["unit", "unitName", "starLevel", "itemCount", "itemPolicy", "patch", "days", "rankFilter", "minSamples"]),
    source: compactSource(value.source),
    scope: value.scope
  };
  if (tool === "comps_rankings") return {
    ...pick(value, ["schemaVersion", "type", "resolution", "updatedAt", "warnings", "query"]),
    results: (value.results ?? []).map((row) => ({
      compositionRef: row.compositionRef,
      members: (row.members ?? []).map((member) => pick(member, ["apiName", "name", "relations", "roleEvidence"])),
      traits: (Array.isArray(row.traits) ? row.traits : []).map((trait) => pick(trait, ["apiName", "name", "count", "style", "minUnits"])),
      stats: pick(row.stats, ["games", "top4Rate", "winRate", "avgPlacement"]),
      source: compactSource(row.source),
      tacticalDetailQueryPlan: row.tacticalDetailQueryPlan
    })),
    source: compactSource(value.source)
  };
  if (tool === "composition_tactical_details") return {
    ...pick(value, ["type", "ok", "compId", "clusterId", "seasonContextId", "compositionRef", "warnings"]),
    formation: {
      ...pick(value.formation, ["status", "missingUnitApiNames", "reasons", "source"]),
      units: (value.formation?.units ?? []).filter((unit) => unit.apiName === targetUnitId).map((unit) => ({
        ...pick(unit, ["apiName", "name", "boardPosition", "combatProfile"])
      }))
    },
    source: compactSource(value.source)
  };
  return value;
}

function projectEvidence(entry, targetUnitId) {
  if (!entry || typeof entry !== "object") return entry;
  return {
    ...pick(entry, ["evidenceId", "toolCallId", "toolName", "type", "source", "updatedAt", "metadata", "fingerprint", "validatedAt"]),
    value: projectUnitPlayToolValue(entry.toolName, entry.value, targetUnitId)
  };
}

// Model-input-only projection for the isolated candidate. Full observations,
// Evidence, receipts, cards and validator inputs remain untouched in ReAct.
export function projectUnitPlayModelObservation(observation, targetUnitId) {
  if (observation?.type !== "tool_result") return structuredClone(observation);
  return {
    ...structuredClone(observation),
    value: projectUnitPlayToolValue(observation.tool, observation.value, targetUnitId),
    evidence: projectEvidence(observation.evidence, targetUnitId)
  };
}

function projectProviderMessage(message, targetUnitId) {
  if (message.role !== "user") return message;
  let payload;
  try { payload = JSON.parse(message.content); } catch { return message; }
  if (payload?.schemaVersion === "react-transcript-event.v1" && payload.type === "observation") {
    payload.value = projectUnitPlayModelObservation(payload.value, targetUnitId);
  } else if (payload?.state && payload?.toolCatalog) {
    payload.state.observations = (payload.state.observations ?? []).map((entry) => projectUnitPlayModelObservation(entry, targetUnitId));
    payload.state.evidence = (payload.state.evidence ?? []).map((entry) => projectEvidence(entry, targetUnitId));
  }
  return { ...message, content: JSON.stringify(payload) };
}

// Diagnostic adapter only. No production module imports this file. It reuses
// the real request's one TaskFrame parse and replaces only professional guidance
// through the existing provider seam, without changing ReAct decisions/policy.
// Optional wire-format diagnostics are explicit and do not affect production.
export function createUnitPlayBrowserCandidate({ toolRegistry, parseTask, baselineProvider,
  providerOptions, skill = UNIT_PLAY_GUIDANCE_SKILL_V1_4, decisionMessages = "event",
  modelObservationProjection = false, onEvent = () => {} }) {
  if (!["event", "action"].includes(decisionMessages)) throw new TypeError("Unknown diagnostic decision message format");
  const storage = new AsyncLocalStorage();
  const registry = new SkillRegistry({ definitions: [skill], toolRegistry });
  const contentHash = createHash("sha256").update(JSON.stringify(skill)).digest("hex");
  const emit = (event) => { try { onEvent(event); } catch { /* observer only */ } };
  const candidate = async (request, context) => {
    const run = storage.getStore();
    if (!run?.taskFrame) return baselineProvider(request, context);
    if (!run.selection) run.selection = matchSkill(run.taskFrame, registry);
    const selected = run.selection.status === "selected";
    const advisory = request.state?.semanticAdvisory;
    const subject = run.taskFrame.subjects?.find((entity) => entity.expectedType === "champion");
    if (!selected || advisory?.goal !== "recommend_unit_play" || advisory.subject?.resolvedId !== subject?.resolvedId) {
      if (!run.reported) emit({ selected: false, reason: selected ? "advisory_mismatch" : "no_skill", contentHash });
      run.reported = true;
      return baselineProvider(request, context);
    }
    // Rebuild from the actual catalog each decision; instructions cannot add a
    // handler or bypass existing server-scoped schemas / mandatory follow-ups.
    const skillContext = buildSkillContext({ skill, selection: run.selection, taskFrame: run.taskFrame,
      runtimeAvailableTools: (request.toolCatalog ?? []).map((tool) => tool.name) });
    const rendered = JSON.stringify({ schemaVersion: "unit-play-browser-candidate.v1", contentHash, skillContext });
    const originalFetch = providerOptions.fetchImpl ?? globalThis.fetch;
    const provider = createReactDecisionProvider({ ...providerOptions,
      guidanceRenderer: () => rendered,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        // Opt-in input-format diagnostic: replay prior assistant actions in the
        // same shape the model must return. Observations/runtime state remain
        // unchanged; never repair or substitute a newly generated model action.
        if (decisionMessages === "action") body.messages = body.messages.map((message) => {
          if (message.role !== "assistant") return message;
          let event;
          try { event = JSON.parse(message.content); } catch { return message; }
          if (event?.schemaVersion !== "react-transcript-event.v1" || event.type !== "decision"
            || event.value?.schemaVersion !== "react-action.v1") return message;
          return { ...message, content: JSON.stringify(event.value) };
        });
        const inputBytesBeforeProjection = Buffer.byteLength(JSON.stringify(body.messages));
        if (modelObservationProjection === true) {
          body.messages = body.messages.map((message) => projectProviderMessage(message, subject.resolvedId));
        }
        const inputBytesAfterProjection = Buffer.byteLength(JSON.stringify(body.messages));
        const contexts = body.messages.map((message) => {
          try { return JSON.parse(message.content); } catch { return null; }
        });
        const runContexts = contexts.flatMap((value) => value?.schemaVersion === "react-run-context.v1" ? [value]
          : value?.state && value?.toolCatalog ? [value.state] : []);
        if (runContexts.length !== 1 || runContexts[0].semanticGuidance !== rendered) throw new Error("Candidate guidance was not injected exactly once");
        emit({ selected: true, skillId: skill.id, skillVersion: skill.version, contentHash,
          stage: "provider_request", guidanceBytes: Buffer.byteLength(rendered),
          decisionMessages, modelObservationProjection,
          inputBytesBeforeProjection, inputBytesAfterProjection,
          effectiveTools: skillContext.toolPolicy.effectiveTools, parseCount: run.parseCount });
        const response = await originalFetch(url, decisionMessages === "action" || modelObservationProjection === true
          ? { ...init, body: JSON.stringify(body) } : init);
        if (typeof response.clone === "function") {
          try {
            const result = await response.clone().json();
            const action = JSON.parse(result.choices?.[0]?.message?.content ?? "null");
            emit({ stage: "provider_action_shape", schemaVersion: action?.schemaVersion,
              actionType: action?.type, keys: Object.keys(action ?? {}).slice(0, 12),
              // Isolated diagnostic only: retain the original parsed action so
              // rejected prose can be audited without guessing from errors.
              action });
          } catch { /* Diagnostic shape only; the actual provider validates. */ }
        }
        return response;
      }
    });
    return provider(request, context);
  };
  candidate.providerKind = baselineProvider.providerKind;
  candidate.model = baselineProvider.model;
  return {
    skill, contentHash, decisionProvider: candidate,
    runRequest: (callback) => storage.run({ taskFrame: null, parseCount: 0 }, callback),
    parseTask: async (...args) => {
      const parsed = await parseTask(...args);
      const run = storage.getStore();
      if (run) {
        run.parseCount += 1;
        if (run.parseCount !== 1) throw new Error("Candidate request must reuse one TaskFrame parse");
        run.taskFrame = parsed.taskFrame;
      }
      return parsed;
    }
  };
}
