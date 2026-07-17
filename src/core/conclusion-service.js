import { createHash } from "node:crypto";
import {
  CONCLUSION_EVIDENCE_SCHEMA_VERSION,
  buildConclusionEvidence
} from "../llm/conclusion-evidence.js";
import { validateConclusionOutput } from "../llm/conclusion-validator.js";

const SUPPORTED_TYPES = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items",
  "unit_item_comparison",
  "unit_item_rankings",
  "comp_rankings"
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function makeConclusionCacheKey(evidence, config = {}) {
  const digest = createHash("sha256").update(JSON.stringify(stableValue({
    evidence,
    evidenceVersion: CONCLUSION_EVIDENCE_SCHEMA_VERSION,
    promptVersion: config.promptVersion ?? "generate-conclusion.v1",
    model: config.model ?? null
  }))).digest("hex");
  return `llm_conclusion:${digest}`;
}

function envelope(status, options = {}) {
  return {
    status,
    content: options.content ?? null,
    reason: options.reason ?? null,
    model: options.model ?? null,
    latencyMs: Math.max(0, Number(options.latencyMs ?? 0)),
    ...(options.cached ? { cached: true } : {})
  };
}

function isStale(result) {
  return Boolean(result?.cache?.query?.stale || result?.source?.cache === "stale");
}

function hasEvidence(result, type) {
  if (type === "comp_rankings") {
    return Object.values(result?.rankings ?? {}).some((records) => records?.length);
  }
  if (type === "unit_item_rankings") return Boolean(result?.itemRankings?.length);
  if (type === "unit_item_comparison") return Boolean(result?.comparison?.entries?.length);
  return Boolean(result?.rankedBuilds?.length);
}

function unsafeState(result) {
  const type = result?.type ?? result?.query?.intent;
  if (!SUPPORTED_TYPES.has(type)) return true;
  if (result?.clarification?.needsClarification) return true;
  if (isStale(result)) return true;
  if (!hasEvidence(result, type)) return true;
  if (/unavailable|clarification|conflict|missing/u.test(String(result?.localDecision?.type ?? ""))) return true;
  return false;
}

async function cacheGet(cacheStore, key) {
  if (!cacheStore?.getQuery) return null;
  return cacheStore.getQuery(key);
}

async function cacheSet(cacheStore, key, value, ttlMs) {
  if (!cacheStore?.setQuery) return null;
  return cacheStore.setQuery(key, value, { ttlMs });
}

async function callProvider(provider, evidence, options = {}) {
  const invoke = typeof provider === "function" ? provider : provider?.generate?.bind(provider);
  if (!invoke) throw new Error("conclusion provider is unavailable");
  try {
    return await invoke({ evidence, ...options });
  } catch (error) {
    if (!error?.recoverable) throw error;
    return invoke({ evidence, ...options });
  }
}

function emit(config, event) {
  try {
    config?.onEvent?.(event);
  } catch {
    // Metrics must never affect the recommendation path.
  }
}

export async function generateEvidenceBackedConclusion({
  result,
  catalog,
  input = "",
  previousQuery = null,
  locale = "zh-CN",
  config = {},
  provider = null,
  cacheStore = null,
  requestEnabled = true,
  bypassCache = false
} = {}) {
  const startedAt = Date.now();
  const model = config.model ?? provider?.model ?? null;
  if (!requestEnabled) return envelope("disabled", { model });
  if (!config.enabled || !provider) {
    const value = envelope("disabled", { reason: "provider_unavailable", model });
    emit(config, { status: value.status, reason: value.reason, latencyMs: value.latencyMs, model });
    return value;
  }
  if (unsafeState(result)) {
    const value = envelope("skipped", { reason: "unsafe_state", model, latencyMs: Date.now() - startedAt });
    emit(config, { status: value.status, reason: value.reason, latencyMs: value.latencyMs, model });
    return value;
  }

  let evidence;
  try {
    evidence = buildConclusionEvidence({ result, catalog, input, locale, previousQuery });
  } catch {
    const value = envelope("skipped", { reason: "unsafe_state", model, latencyMs: Date.now() - startedAt });
    emit(config, { status: value.status, reason: value.reason, latencyMs: value.latencyMs, model });
    return value;
  }

  const cacheKey = makeConclusionCacheKey(evidence, config);
  if (!bypassCache) {
    const cached = await cacheGet(cacheStore, cacheKey);
    if (cached?.value?.kind === "llm_conclusion" && cached.value.content) {
      const value = envelope("generated", {
        content: cached.value.content,
        model: cached.value.model ?? model,
        latencyMs: Date.now() - startedAt,
        cached: true
      });
      emit(config, { status: value.status, cached: true, latencyMs: value.latencyMs, model: value.model });
      return value;
    }
  }

  let raw;
  let correctiveAttemptUsed = false;
  try {
    raw = await callProvider(provider, evidence);
  } catch (error) {
    if (["invalid_json", "truncated_output"].includes(error?.code)) {
      correctiveAttemptUsed = true;
      try {
        raw = await callProvider(provider, evidence, {
          validationFeedback: ["输出必须是完整、严格且不带 Markdown 围栏的 JSON 对象。"]
        });
      } catch {
        const value = envelope("fallback", { reason: "invalid_output", model, latencyMs: Date.now() - startedAt });
        emit(config, { status: value.status, reason: value.reason, latencyMs: value.latencyMs, model, attempts: 2 });
        return value;
      }
    } else {
      const value = envelope("fallback", { reason: "provider_unavailable", model, latencyMs: Date.now() - startedAt });
      emit(config, { status: value.status, reason: value.reason, latencyMs: value.latencyMs, model });
      return value;
    }
  }

  let validation = validateConclusionOutput(raw, evidence, { catalog });
  if ((!validation.valid || validation.value?.status !== "ok") && !correctiveAttemptUsed) {
    correctiveAttemptUsed = true;
    const validationFeedback = validation.valid
      ? ["status 必须为 ok；已有证据足以生成有边界的结论。"]
      : validation.errors.slice(0, 8);
    try {
      raw = await callProvider(provider, evidence, { validationFeedback });
      validation = validateConclusionOutput(raw, evidence, { catalog });
    } catch (error) {
      const reason = ["invalid_json", "truncated_output"].includes(error?.code)
        ? "invalid_output"
        : "provider_unavailable";
      const value = envelope("fallback", { reason, model, latencyMs: Date.now() - startedAt });
      emit(config, { status: value.status, reason: value.reason, latencyMs: value.latencyMs, model, attempts: 2 });
      return value;
    }
  }
  if (!validation.valid || validation.value?.status !== "ok") {
    const value = envelope("fallback", {
      reason: "invalid_output",
      model,
      latencyMs: Date.now() - startedAt
    });
    emit(config, {
      status: value.status,
      reason: value.reason,
      validationErrors: validation.errors.slice(0, 8),
      latencyMs: value.latencyMs,
      model,
      attempts: correctiveAttemptUsed ? 2 : 1
    });
    return value;
  }

  const content = {
    headline: validation.value.headline,
    summary: validation.value.summary,
    reasons: validation.value.reasons,
    alternatives: validation.value.alternatives,
    nextAction: validation.value.nextAction,
    riskNotice: validation.value.riskNotice
  };
  await cacheSet(cacheStore, cacheKey, {
    kind: "llm_conclusion",
    content,
    model,
    promptVersion: config.promptVersion ?? "generate-conclusion.v1"
  }, config.cacheTtlMs);
  const value = envelope("generated", { content, model, latencyMs: Date.now() - startedAt });
  emit(config, { status: value.status, latencyMs: value.latencyMs, model, attempts: correctiveAttemptUsed ? 2 : 1 });
  return value;
}
