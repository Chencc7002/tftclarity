import { createHash } from "node:crypto";
import { assembleEvidencePack } from "../retrieval/evidence-assembler.js";
import {
  BASE_CONCLUSION_PROMPT_VERSION,
  getConclusionPromptRoute
} from "../llm/conclusion-prompt-registry.js";
import {
  CONCLUSION_SPEC_REGISTRY,
  CONCLUSION_VALIDATOR_VERSION,
  deriveConclusionQuestionType
} from "../llm/conclusion-spec-registry.js";
import { createQuestionContract } from "../llm/question-contract.js";
import { createIntentEnvelope } from "../retrieval/contracts.js";
import {
  CONCLUSION_VALIDATION_FEEDBACK_SCHEMA_VERSION,
  createConclusionValidationFeedback,
  findConclusionCitationCandidates,
  repairConclusionCitations,
  validateConclusionOutput
} from "../llm/conclusion-validator.js";

export const DEFAULT_CONCLUSION_MAX_CORRECTIONS = 3;
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
  const spec = evidence?.conclusionSpec;
  const route = spec ? CONCLUSION_SPEC_REGISTRY.get(spec.id)?.prompt : getConclusionPromptRoute(intent);
  const digest = createHash("sha256").update(JSON.stringify(stableValue({
    evidence,
    evidenceVersion: evidence?.schemaVersion ?? null,
    questionContractVersion: evidence?.questionContract?.schemaVersion ?? null,
    contractId: evidence?.questionContract?.contractId ?? null,
    specId: spec?.id ?? null,
    specVersion: spec?.version ?? null,
    basePromptVersion: config.basePromptVersion ?? BASE_CONCLUSION_PROMPT_VERSION,
    intentPromptVersion: config.intentPromptVersion ?? route?.version ?? null,
    providerPromptVersion: config.promptVersion ?? null,
    validatorVersion: config.validatorVersion ?? CONCLUSION_VALIDATOR_VERSION,
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
    ...(options.validationFeedback ? { validationFeedback: options.validationFeedback } : {}),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {})
  };
}

function contractDiagnostics(questionContract, spec) {
  return {
    questionContractVersion: questionContract.schemaVersion,
    contractId: questionContract.contractId,
    specId: spec.id,
    specVersion: spec.version,
    promptVersion: spec.prompt.version,
    validatorVersion: CONCLUSION_VALIDATOR_VERSION
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
  if (type === "comp_analysis") return Boolean(result?.analysis?.target && result?.analysis?.evidencePack?.length);
  if (type === "unit_item_rankings" || type === "unit_emblem_rankings") return Boolean(result?.itemRankings?.length);
  if (type === "unit_item_comparison") return Boolean(result?.comparison?.entries?.length);
  return Boolean(result?.rankedBuilds?.length);
}

function unsafeReason(result) {
  const type = result?.type ?? result?.query?.intent;
  if (!CONCLUSION_SPEC_REGISTRY.supportsIntent(type)) return "intent_or_entity_error";
  if (result?.clarification?.needsClarification) return "intent_or_entity_error";
  if (isStale(result)) return "stale_or_missing_evidence";
  if (!hasEvidence(result, type)) return "stale_or_missing_evidence";
  if (/unavailable|clarification|conflict|missing/u.test(String(result?.localDecision?.type ?? ""))) return "intent_or_entity_error";
  return null;
}

async function cacheGet(cacheStore, key, seasonContextId = "set17-live") {
  if (!cacheStore?.getQuery) return null;
  return cacheStore.getQuery(key, { seasonContextId });
}

async function cacheSet(cacheStore, key, value, ttlMs, seasonContextId = "set17-live") {
  if (!cacheStore?.setQuery) return null;
  return cacheStore.setQuery(key, value, { ttlMs, seasonContextId });
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

function invalidCandidateFingerprint(raw, feedback) {
  return JSON.stringify(stableValue({ raw, errors: feedback?.errors ?? [] }));
}

function isBetterInvalidCandidate(validation, bestValidation) {
  if (!bestValidation) return true;
  const score = (candidate) => {
    const issues = candidate?.issues ?? [];
    const severity = issues.reduce((total, issue) => total + ({
      missing_answer_dimension: 5,
      dimension_without_evidence: 5,
      unsupported_answer_dimension: 4,
      unsupported_causal_claim: 4,
      wrong_target: 3,
      unsupported_entity: 3,
      missing_coverage: 2,
      format_error: 2,
      unsupported_number: 1
    }[issue.category] ?? 2), 0);
    return [issues.length, severity];
  };
  const current = score(validation);
  const best = score(bestValidation);
  return current[0] < best[0] || (current[0] === best[0] && current[1] < best[1]);
}

function validationIssueText(raw, path) {
  const match = String(path).match(/^(reasons|alternatives)\[(\d+)\]\.text$/u);
  return match ? raw?.[match[1]]?.[Number(match[2])]?.text : "";
}

function conclusionCorrectionPolicy(validation, raw, evidence, catalog) {
  const hardCategories = new Set([
    "missing_answer_dimension",
    "unsupported_answer_dimension",
    "dimension_without_evidence",
    "missing_coverage",
    "unsupported_causal_claim",
    "analysis_boundary",
    "current_fact_used_as_history",
    "question_focus_mismatch"
  ]);
  let ambiguousCitation = false;
  for (const issue of validation?.issues ?? []) {
    if (hardCategories.has(issue.category)) return "reject";
    const citationError = ["unsupported_number", "unsupported_entity", "wrong_target"].includes(issue.category)
      && /(?:unsupported (?:number|percentage|sample count|average placement|trend improvement)|entity absent from evidence)/u.test(issue.message);
    if (!citationError) {
      if (issue.category === "wrong_target") return "reject";
      continue;
    }
    const candidates = findConclusionCitationCandidates(
      issue,
      validationIssueText(raw, issue.path),
      evidence,
      { catalog }
    );
    if (candidates.length === 0) return "reject";
    if (candidates.length > 1) ambiguousCitation = true;
  }
  return ambiguousCitation ? "retry_once" : "retry";
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
  seasonContextId = result?.query?.seasonContextId ?? "set17-live",
  requestEnabled = true,
  bypassCache = false,
  retrievalPlan = null,
  semanticEvidence = [],
  principalId = "anonymous",
  conversationId = "default"
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

  const resultType = result?.type ?? result?.query?.intent;
  const intentEnvelope = result?.intentEnvelope ?? createIntentEnvelope({
    input,
    parsed: result?.parsed,
    query: result?.query,
    validation: result?.validation ?? { valid: true },
    clarification: result?.clarification,
    catalog
  });
  const questionType = deriveConclusionQuestionType(result, intentEnvelope);
  let spec;
  try {
    spec = CONCLUSION_SPEC_REGISTRY.resolve({ intent: intentEnvelope.intent, questionType, resultType });
  } catch (error) {
    const value = envelope("skipped", { reason: error?.code ?? "unregistered_intent", model, latencyMs: Date.now() - startedAt });
    emit(config, { type: "conclusion_fallback", status: value.status, reason: value.reason, intent: intentEnvelope.intent, questionType, model });
    return value;
  }

  let questionContract;
  let evidence;
  try {
    questionContract = createQuestionContract({
      originalQuestion: input,
      intentEnvelope,
      query: result?.query,
      result,
      spec,
      seasonContextId,
      principalId,
      conversationId
    });
    if (questionContract.needsClarification) {
      const value = envelope("skipped", { reason: "intent_or_entity_error", model, latencyMs: Date.now() - startedAt });
      emit(config, { type: "contract_rejected", status: value.status, reason: value.reason, contractId: questionContract.contractId, model });
      return value;
    }
    evidence = assembleEvidencePack({
      result,
      catalog,
      input,
      locale,
      previousQuery,
      semanticEvidence: semanticEvidence.length ? semanticEvidence : result?.semanticEvidence ?? [],
      plan: retrievalPlan ?? result?.retrievalPlan ?? null,
      questionContract,
      spec
    });
  } catch (error) {
    const value = envelope("skipped", { reason: "unsafe_state", model, latencyMs: Date.now() - startedAt });
    emit(config, { type: "evidence_rejected", status: value.status, category: error?.code ?? "stale_or_missing_evidence", details: error?.details, model });
    return value;
  }

  const intent = evidenceIntent(evidence);
  const promptRoute = getConclusionPromptRoute(intent, questionType, resultType);
  if (!promptRoute) {
    const value = envelope("skipped", { reason: "unregistered_intent", model, latencyMs: Date.now() - startedAt });
    emit(config, { type: "conclusion_fallback", status: value.status, reason: value.reason, intent, model });
    return value;
  }

  const cacheKey = makeConclusionCacheKey(evidence, config);
  const diagnostics = contractDiagnostics(questionContract, spec);
  const supportingEvidence = visibleSupportingEvidence(evidence);
  if (!bypassCache) {
    const cached = await cacheGet(cacheStore, cacheKey, seasonContextId);
    if (cached?.value?.kind === "llm_conclusion" && cached.value.content) {
      const value = envelope("generated", {
        content: cached.value.content,
        model: cached.value.model ?? model,
        latencyMs: Date.now() - startedAt,
        cached: true,
        supportingEvidence,
        diagnostics
      });
      emit(config, { type: "conclusion_generated", status: value.status, cached: true, latencyMs: value.latencyMs, model: value.model });
      return value;
    }
  }

  const maxCorrections = boundedInteger(config.maxCorrections ?? process.env.TFT_AGENT_CONCLUSION_MAX_CORRECTIONS, DEFAULT_CONCLUSION_MAX_CORRECTIONS, 5);
  const maxValidationErrors = boundedInteger(config.maxValidationErrors ?? process.env.TFT_AGENT_CONCLUSION_MAX_VALIDATION_ERRORS, DEFAULT_CONCLUSION_MAX_VALIDATION_ERRORS, 50);
  const maxTransportRetries = boundedInteger(config.maxTransportRetries, DEFAULT_CONCLUSION_MAX_TRANSPORT_RETRIES, 3);
  let correctionLimit = maxCorrections;
  let validationFeedback = null;
  let previousOutput = null;
  const seenInvalidCandidates = new Set();
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
        ...(validationFeedback ? { validationFeedback } : {}),
        ...(previousOutput ? { previousOutput } : {})
      }, maxTransportRetries);
      raw = response.raw;
      transportRetries += response.transportRetries;
    } catch (error) {
      transportRetries += Number(error?.transportRetries ?? 0);
      if (["invalid_json", "truncated_output"].includes(error?.code) && version < maxCorrections) {
        if (!validationFeedback) {
          validationFeedback = formatFeedback("输出必须是完整、严格且不带 Markdown 围栏的 JSON 对象。", "format_error");
        }
      } else {
        const reason = providerFailureReason(error);
        const value = envelope("fallback", {
          reason,
          model,
          latencyMs: Date.now() - startedAt,
          attempts,
          corrections,
          transportRetries,
          validationFeedback,
          diagnostics
        });
        emit(config, { type: "conclusion_fallback", status: value.status, reason, attempts, corrections, transportRetries, model });
        return value;
      }
    }

    if (raw !== undefined) {
      const validationOptions = { catalog, spec, questionContract };
      let currentValidation = validateConclusionOutput(raw, evidence, validationOptions);
      if (!currentValidation.valid) {
        const repair = repairConclusionCitations(raw, evidence, {
          ...validationOptions,
          validation: currentValidation
        });
        if (repair.changed) {
          raw = repair.value;
          currentValidation = repair.validation;
          emit(config, {
            type: "conclusion_citations_repaired",
            attempts,
            corrections,
            repairs: repair.repairs,
            valid: currentValidation.valid,
            model
          });
        }
      }
      if (currentValidation.valid) {
        const content = {
          schemaVersion: currentValidation.value.schemaVersion,
          status: currentValidation.value.status,
          contractId: currentValidation.value.contractId,
          addressedDimensions: currentValidation.value.addressedDimensions,
          missingDimensions: currentValidation.value.missingDimensions,
          missingEvidence: currentValidation.value.missingEvidence,
          headline: currentValidation.value.headline,
          summary: currentValidation.value.summary,
          reasons: currentValidation.value.reasons,
          alternatives: currentValidation.value.alternatives,
          nextAction: currentValidation.value.nextAction,
          riskNotice: currentValidation.value.riskNotice
        };
        await cacheSet(cacheStore, cacheKey, {
          kind: "llm_conclusion",
          content,
          model,
          evidenceVersion: evidence.schemaVersion,
          questionContractVersion: questionContract.schemaVersion,
          contractId: questionContract.contractId,
          specId: spec.id,
          specVersion: spec.version,
          basePromptVersion: config.basePromptVersion ?? BASE_CONCLUSION_PROMPT_VERSION,
          intentPromptVersion: promptRoute.version,
          providerPromptVersion: config.promptVersion ?? null,
          validatorVersion: CONCLUSION_VALIDATOR_VERSION
        }, config.cacheTtlMs, seasonContextId);
        const value = envelope("generated", {
          content,
          model,
          latencyMs: Date.now() - startedAt,
          attempts,
          corrections,
          transportRetries,
          supportingEvidence,
          diagnostics
        });
        emit(config, { type: corrections ? "conclusion_corrected" : "conclusion_generated", status: value.status, attempts, corrections, transportRetries, model });
        return value;
      }
      const currentFeedback = createConclusionValidationFeedback(currentValidation, evidence, { catalog, maxErrors: maxValidationErrors });
      const fingerprint = invalidCandidateFingerprint(raw, currentFeedback);
      const repeatedCandidate = seenInvalidCandidates.has(fingerprint);
      seenInvalidCandidates.add(fingerprint);
      if (isBetterInvalidCandidate(currentValidation, lastValidation)) {
        lastValidation = currentValidation;
        validationFeedback = currentFeedback;
        previousOutput = raw;
      }
      if (repeatedCandidate) break;
    }

    const correctionPolicy = lastValidation
      ? conclusionCorrectionPolicy(lastValidation, previousOutput, evidence, catalog)
      : "retry";
    if (correctionPolicy === "retry_once") correctionLimit = Math.min(correctionLimit, 1);

    emit(config, {
      type: "conclusion_validation_failed",
      attempts,
      corrections,
      errors: validationFeedback?.errors ?? [],
      model
    });
    if (correctionPolicy === "reject" || version >= correctionLimit) break;
  }

  const value = envelope("fallback", {
    reason: "invalid_output",
    model,
    latencyMs: Date.now() - startedAt,
    attempts,
    corrections,
    transportRetries,
    validationFeedback,
    diagnostics
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
