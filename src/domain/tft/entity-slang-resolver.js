import { normalizeAlias } from "../../core/normalizer.js";
import { queryEntityCatalog } from "./entity-catalog-query.js";
import { normalizeEntityNameResolutionMode } from "./entity-name-candidates.js";

export const ENTITY_SLANG_VERSION = "entity-slang-proposal.v1";
const TYPES = new Set(["unit", "item", "trait"]);

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validateEntitySlangProposal(value, request) {
  if (!exactKeys(value, ["schemaVersion", "resolutions"]) || value.schemaVersion !== ENTITY_SLANG_VERSION
    || !Array.isArray(value.resolutions) || value.resolutions.length !== request.mentions.length) return false;
  const allowed = new Set(request.catalog.map(row => row.apiName));
  return value.resolutions.every((row, i) => exactKeys(row, ["mention", "candidateIds", "reason"])
    && row.mention === request.mentions[i] && Array.isArray(row.candidateIds) && row.candidateIds.length <= 3
    && new Set(row.candidateIds).size === row.candidateIds.length
    && row.candidateIds.every(id => typeof id === "string" && allowed.has(id))
    && ["known_nickname", "contextual_description", "ambiguous", "unknown"].includes(row.reason)
    && (row.reason === "unknown" ? row.candidateIds.length === 0 : row.candidateIds.length > 0));
}

function emit(observer, value) {
  try { Promise.resolve(observer?.(value)).catch(() => {}); } catch { /* Observability does not own execution. */ }
}

export function createEntitySlangTelemetry(observer) {
  const counts = { calls: 0, proposals: 0, unknown: 0, failures: 0, skipped: 0, durationMs: 0 };
  return {
    snapshot: () => ({ ...counts }),
    record(event) {
      counts.calls += event.llmCallsAdded ?? 0;
      if (event.status === "completed") { counts.proposals += event.proposals; counts.unknown += event.unknown; }
      if (event.status === "failed") counts.failures += 1;
      if (event.status === "skipped") counts.skipped += 1;
      counts.durationMs += event.durationMs ?? 0;
      emit(observer, event);
    }
  };
}

async function boundedCall(provider, request, signal, timeoutMs) {
  const controller = new AbortController();
  let timer;
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(Object.assign(new Error("Slang request aborted"), { code: "aborted" })); };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("Slang request timed out"), { code: "timeout" }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([cancelled, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return provider(request, { signal: controller.signal });
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

// Construct once per ReAct request. Shared across that request's tool calls only.
export function createEntitySlangResolver(options = {}) {
  const mode = normalizeEntityNameResolutionMode(options.mode);
  const configuredTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(3000, configuredTimeout) : 2500;
  let used = false;
  return async function resolveSlang({ result, catalog, details, input, question, messages = [], seasonContextId, signal }) {
    if (mode === "off" || !TYPES.has(input.entityType)) return result;
    const missing = result.resolution?.requests?.filter(row => row.status === "not_found") ?? [];
    if (!missing.length) return result;
    const baseEvent = { schemaVersion: "entity-slang-observation.v1", mode, entityType: input.entityType, seasonContextId,
      mentionCount: missing.length, llmCallsAdded: 0 };
    const skip = reasonCode => { emit(options.onObservation, { ...baseEvent, status: "skipped", reasonCode }); return result; };
    if (signal?.aborted) return skip("aborted");
    if (used) return skip("request_budget_exhausted");
    if (typeof options.provider !== "function") return skip("provider_unavailable");
    const currentQuestion = String(question ?? "").slice(0, 800);
    const recentUserMessages = messages.filter(message => message?.role === "user").slice(-2)
      .map(message => String(message.content ?? "").slice(0, 400));
    const mentions = [...new Set(missing.map(row => row.inputName))];
    const originalUserText = normalizeAlias([currentQuestion, ...recentUserMessages].join("\n"));
    if (mentions.length > 5 || mentions.some(name => typeof name !== "string" || name.length < 2 || name.length > 32
      || /[_\d]/u.test(name) || !normalizeAlias(name) || !originalUserText.includes(normalizeAlias(name)))) return skip("unanchored_or_ineligible_mention");
    const { names: _names, apiNames: _apiNames, ...filters } = input.filters ?? {};
    // A bounded menu from the existing registered tool's current catalog, preserving explicit filters.
    const menuResult = queryEntityCatalog({ catalog, details, input: { entityType: input.entityType,
      filters: { ...filters, current: true }, limit: 200 }, updatedAt: result.updatedAt });
    if (!menuResult.results.length || menuResult.results.length >= 200) return skip("catalog_empty_or_over_budget");
    const records = catalog[input.entityType === "unit" ? "units" : input.entityType === "item" ? "items" : "traits"] ?? [];
    const canonicalNames = new Map(records.map(row => [input.entityType === "trait" ? String(row.apiName).replace(/_\d+$/, "") : row.apiName,
      row.zhName ?? row.displayName ?? row.name]));
    const menu = [...new Map(menuResult.results.map(row => [row.apiName, row])).values()].map(row => ({ apiName: row.apiName, name: String(row.name ?? row.apiName).slice(0, 80),
      canonicalName: String(canonicalNames.get(row.apiName) ?? row.name ?? row.apiName).slice(0, 80),
      ...(input.entityType === "unit" ? { cost: row.cost, traits: (row.traitNames ?? []).slice(0, 5) } : {}),
      ...(input.entityType === "item" ? { category: row.category } : {}) }));
    const request = { schemaVersion: ENTITY_SLANG_VERSION, entityType: input.entityType, seasonContextId,
      mentions, currentQuestion, recentUserMessages, catalog: menu };
    if (JSON.stringify(request).length > 24000) return skip("prompt_over_budget");
    used = true;
    const started = performance.now();
    try {
      const proposal = await boundedCall(options.provider, structuredClone(request), signal, timeoutMs);
      if (signal?.aborted) throw Object.assign(new Error("Slang request aborted"), { code: "aborted" });
      if (!validateEntitySlangProposal(proposal, request)) throw new TypeError("Invalid entity slang proposal");
      const byName = new Map(proposal.resolutions.map(row => [row.mention, row]));
      const byId = new Map(menu.map(row => [row.apiName, row]));
      const proposedCount = proposal.resolutions.filter(row => row.candidateIds.length).length;
      emit(options.onObservation, { ...baseEvent, status: "completed", llmCallsAdded: 1,
        proposals: proposedCount, unknown: mentions.length - proposedCount, durationMs: performance.now() - started });
      if (mode !== "suggest" || !proposedCount) return result;
      const requests = result.resolution.requests.map(row => {
        const proposed = byName.get(row.inputName);
        if (row.status !== "not_found" || !proposed?.candidateIds.length) return row;
        return { ...row, status: "ambiguous", requiresConfirmation: true,
          candidates: proposed.candidateIds.map(apiName => ({ apiName, name: byId.get(apiName).name,
            matchedAlias: row.inputName, matchType: "llm_slang_candidate" })) };
      });
      const candidateIds = new Set(requests.flatMap(row => row.candidates.map(candidate => candidate.apiName)));
      // Include only catalog facts, never a model-authored fact or explanation.
      const { results } = queryEntityCatalog({ catalog, details, updatedAt: result.updatedAt,
        input: { ...input, filters: { ...filters, apiNames: [...candidateIds] } } });
      return { ...result, resolution: { mode: "slang_candidates", requests }, results, total: results.length };
    } catch (error) {
      emit(options.onObservation, { ...baseEvent, status: "failed", llmCallsAdded: 1,
        reasonCode: error.code === "timeout" ? "timeout" : error.code === "aborted" ? "aborted"
          : error instanceof TypeError ? "invalid_proposal" : "provider_failed", durationMs: performance.now() - started });
      return result;
    }
  };
}
