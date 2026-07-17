import { createHash } from "node:crypto";
import { assembleEvidencePack } from "../retrieval/evidence-assembler.js";
import {
  BASE_CONCLUSION_PROMPT_VERSION,
  getConclusionPromptRoute
} from "../llm/conclusion-prompt-registry.js";
import {
  CONCLUSION_VALIDATION_FEEDBACK_SCHEMA_VERSION,
  createConclusionValidationFeedback,
  validateConclusionOutput
} from "../llm/conclusion-validator.js";

const SUPPORTED_TYPES = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items",
  "unit_item_comparison",
  "unit_item_rankings",
  "unit_emblem_rankings",
  "comp_rankings",
  "comp_trends"
]);

export const DEFAULT_CONCLUSION_MAX_CORRECTIONS = 2;
export const DEFAULT_CONCLUSION_MAX_VALIDATION_ERRORS = 8;
export const DEFAULT_CONCLUSION_MAX_TRANSPORT_RETRIES = 1;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function evidenceIntent(evidence) {
  return evidence?.request?.requestedIntent ?? evidence?.request?.intent ?? null;
}

export function makeConclusionCacheKey(evidence, config = {}) {
  const intent = evidenceIntent(evidence);
  const route = getConclusionPromptRoute(intent);
  const digest = createHash("sha256").update(JSON.stringify(stableValue({
    evidence,
    evidenceVersion: evidence?.schemaVersion ?? null,
    basePromptVersion: config.basePromptVersion ?? BASE_CONCLUSION_PROMPT_VERSION,
    intentPromptVersion: config.intentPromptVersion ?? route?.version ?? null,
    providerPromptVersion: config.promptVersion ?? null,
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
    attempts: Math.max(0, Number(options.attempts ?? 0)),
    corrections: Math.max(0, Number(options.corrections ?? 0)),
    transportRetries: Math.max(0, Number(options.transportRetries ?? 0)),
    ...(options.cached ? { cached: true } : {}),
    ...(options.supportingEvidence?.length ? { supportingEvidence: options.supportingEvidence } : {}),
    ...(options.validationFeedback ? { validationFeedback: options.validationFeedback } : {})
  };
}

function visibleSupportingEvidence(evidence) {
  return (evidence?.semanticEvidence ?? [])
    .filter((record) => record?.visible !== false && record?.text)
    .map((record) => ({
      evidenceId: String(record.evidenceId),
      type: String(record.type ?? "static_description"),
      text: String(record.text),
      source: String(record.source ?? "semantic_index"),
      patch: record.patch ?? null,
      locale: record.locale ?? null
    }));
}

function isStale(result) {
  return Boolean(result?.cache?.query?.stale || result?.source?.cache === "stale");
}

function hasEvidence(result, type) {
  if (type === "comp_rankings") return Object.values(result?.rankings ?? {}).some((records) => records?.length);
  if (type === "comp_trends") return Boolean(result?.improving?.length);
  if (type === "unit_item_rankings" || type === "unit_emblem_rankings") return Boolean(result?.itemRankings?.length);
  if (type === "unit_item_comparison") return Boolean(result?.comparison?.entries?.length);
  return Boolean(result?.rankedBuilds?.length);
}

function unsafeReason(result) {
  const type = result?.type ?? result?.query?.intent;
  if (!SUPPORTED_TYPES.has(type)) return "intent_or_entity_error";
  if (result?.clarification?.needsClarification) return "intent_or_entity_error";
  if (isStale(result)) return "stale_or_missing_evidence";
  if (!hasEvidence(result, type)) return "stale_or_missing_evidence";
  if (/unavailable|clarification|conflict|missing/u.test(String(result?.localDecision?.type ?? ""))) return "intent_or_entity_error";
  return null;
}

async function cacheGet(cacheStore, key) {
  if (!cacheStore?.getQuery) return null;
  return cacheStore.getQuery(key);
}

async function cacheSet(cacheStore, key, value, ttlMs) {
  if (!cacheStore?.setQuery) return null;
  return cacheStore.setQuery(key, value, { ttlMs });
}

function providerInvoke(provider) {
  const invoke = typeof provider === "function" ? provider : provider?.generate?.bind(provider);
  if (!invoke) throw new Error("conclusion provider is unavailable");
  return invoke;
}

async function callProvider(provider, request, maxTransportRetries) {
  const invoke = providerInvoke(provider);
  let transportRetries = 0;
  while (true) {
    try {
      return { raw: await invoke(request), transportRetries };
    } catch (error) {
      if (!error?.recoverable || transportRetries >= maxTransportRetries) throw Object.assign(error, { transportRetries });
      transportRetries += 1;
    }
  }
}

function emit(config, event) {
  try {
    config?.onEvent?.(event);
  } catch {
    // Metrics must never affect the recommendation path.
  }
}

function boundedInteger(value, fallback, maximum = 10) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(maximum, number) : fallback;
}

function formatFeedback(message, category = "format_error") {
  return {
    schemaVersion: CONCLUSION_VALIDATION_FEEDBACK_SCHEMA_VERSION,
    valid: false,
    errors: [{
      category,
      path: "output",
      message,
      missingEvidenceIds: [],
      allowedValues: []
    }]
  };
}

function feedbackFingerprint(feedback) {
  return JSON.stringify((feedback?.errors ?? []).map((error) => ({
    category: error.category,
    path: error.path,
    message: error.message,
    missingEvidenceIds: error.missingEvidenceIds
  })));
}

function providerFailureReason(error) {
  return ["invalid_json", "truncated_output", "unregistered_intent"].includes(error?.code)
    ? "invalid_output"
    : "provider_unavailable";
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
  bypassCache = false,
  retrievalPlan = null,
  semanticEvidence = []
} = {}) {
  const startedAt = Date.now();
  const model = config.model ?? provider?.model ?? null;
  if (!requestEnabled) return envelope("disabled", { model });
  if (!config.enabled || !provider) {
    const value = envelope("disabled", { reason: "provider_unavailable", model });
    emit(config, { type: "conclusion_fallback", status: value.status, reason: value.reason, model });
    return value;
  }

  const unsafe = unsafeReason(result);
  if (unsafe) {
    const value = envelope("skipped", { reason: "unsafe_state", model, latencyMs: Date.now() - startedAt });
    emit(config, { type: "evidence_rejected", status: value.status, category: unsafe, latencyMs: value.latencyMs, model });
    return value;
  }

  let evidence;
  try {
    evidence = assembleEvidencePack({
      result,
      catalog,
      input,
      locale,
      previousQuery,
      semanticEvidence: semanticEvidence.length ? semanticEvidence : result?.semanticEvidence ?? [],
      plan: retrievalPlan ?? result?.retrievalPlan ?? null
    });
  } catch (error) {
    const value = envelope("skipped", { reason: "unsafe_state", model, latencyMs: Date.now() - startedAt });
    emit(config, { type: "evidence_rejected", status: value.status, category: error?.code ?? "stale_or_missing_evidence", details: error?.details, model });
    return value;
  }

  const intent = evidenceIntent(evidence);
  const promptRoute = getConclusionPromptRoute(intent);
  if (!promptRoute) {
    const value = envelope("skipped", { reason: "unregistered_intent", model, latencyMs: Date.now() - startedAt });
    emit(config, { type: "conclusion_fallback", status: value.status, reason: value.reason, intent, model });
    return value;
  }

  const cacheKey = makeConclusionCacheKey(evidence, config);
  const supportingEvidence = visibleSupportingEvidence(evidence);
  if (!bypassCache) {
    const cached = await cacheGet(cacheStore, cacheKey);
    if (cached?.value?.kind === "llm_conclusion" && cached.value.content) {
      const value = envelope("generated", {
        content: cached.value.content,
        model: cached.value.model ?? model,
        latencyMs: Date.now() - startedAt,
        cached: true,
        supportingEvidence
      });
      emit(config, { type: "conclusion_generated", status: value.status, cached: true, latencyMs: value.latencyMs, model: value.model });
      return value;
    }
  }

  const maxCorrections = boundedInteger(config.maxCorrections ?? process.env.TFT_AGENT_CONCLUSION_MAX_CORRECTIONS, DEFAULT_CONCLUSION_MAX_CORRECTIONS, 5);
  const maxValidationErrors = boundedInteger(config.maxValidationErrors ?? process.env.TFT_AGENT_CONCLUSION_MAX_VALIDATION_ERRORS, DEFAULT_CONCLUSION_MAX_VALIDATION_ERRORS, 50);
  const maxTransportRetries = boundedInteger(config.maxTransportRetries, DEFAULT_CONCLUSION_MAX_TRANSPORT_RETRIES, 3);
  let validationFeedback = null;
  let previousFeedbackFingerprint = null;
  let attempts = 0;
  let corrections = 0;
  let transportRetries = 0;
  let lastValidation = null;

  for (let version = 0; version <= maxCorrections; version += 1) {
    attempts += 1;
    if (version > 0) corrections += 1;
    let raw;
    try {
      const response = await callProvider(provider, {
        evidence,
        ...(validationFeedback ? { validationFeedback } : {})
      }, maxTransportRetries);
      raw = response.raw;
      transportRetries += response.transportRetries;
    } catch (error) {
      transportRetries += Number(error?.transportRetries ?? 0);
      if (["invalid_json", "truncated_output"].includes(error?.code) && version < maxCorrections) {
        validationFeedback = formatFeedback("输出必须是完整、严格且不带 Markdown 围栏的 JSON 对象。", "format_error");
      } else {
        const reason = providerFailureReason(error);
        const value = envelope("fallback", {
          reason,
          model,
          latencyMs: Date.now() - startedAt,
          attempts,
          corrections,
          transportRetries,
          validationFeedback
        });
        emit(config, { type: "conclusion_fallback", status: value.status, reason, attempts, corrections, transportRetries, model });
        return value;
      }
    }

    if (raw !== undefined) {
      lastValidation = validateConclusionOutput(raw, evidence, { catalog });
      if (lastValidation.valid && lastValidation.value?.status === "ok") {
        const content = {
          headline: lastValidation.value.headline,
          summary: lastValidation.value.summary,
          reasons: lastValidation.value.reasons,
          alternatives: lastValidation.value.alternatives,
          nextAction: lastValidation.value.nextAction,
          riskNotice: lastValidation.value.riskNotice
        };
        await cacheSet(cacheStore, cacheKey, {
          kind: "llm_conclusion",
          content,
          model,
          evidenceVersion: evidence.schemaVersion,
          basePromptVersion: config.basePromptVersion ?? BASE_CONCLUSION_PROMPT_VERSION,
          intentPromptVersion: promptRoute.version,
          providerPromptVersion: config.promptVersion ?? null
        }, config.cacheTtlMs);
        const value = envelope("generated", {
          content,
          model,
          latencyMs: Date.now() - startedAt,
          attempts,
          corrections,
          transportRetries,
          supportingEvidence
        });
        emit(config, { type: corrections ? "conclusion_corrected" : "conclusion_generated", status: value.status, attempts, corrections, transportRetries, model });
        return value;
      }
      validationFeedback = lastValidation.valid
        ? formatFeedback("status 必须为 ok；已有证据足以生成有边界的结论。", "format_error")
        : createConclusionValidationFeedback(lastValidation, evidence, { catalog, maxErrors: maxValidationErrors });
    }

    emit(config, {
      type: "conclusion_validation_failed",
      attempts,
      corrections,
      errors: validationFeedback?.errors ?? [],
      model
    });
    const fingerprint = feedbackFingerprint(validationFeedback);
    if (version >= maxCorrections || (previousFeedbackFingerprint && fingerprint === previousFeedbackFingerprint)) break;
    previousFeedbackFingerprint = fingerprint;
  }

  const value = envelope("fallback", {
    reason: "invalid_output",
    model,
    latencyMs: Date.now() - startedAt,
    attempts,
    corrections,
    transportRetries,
    validationFeedback
  });
  emit(config, {
    type: "conclusion_fallback",
    status: value.status,
    reason: value.reason,
    validationErrors: lastValidation?.issues?.slice(0, maxValidationErrors) ?? validationFeedback?.errors ?? [],
    attempts,
    corrections,
    transportRetries,
    model
  });
  return value;
}
