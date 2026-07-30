import { buildEvidenceBundle } from "../knowledge/evidence-bundle-builder.js";
import { COACH_ANSWER_SCHEMA_VERSION } from "./coach-provider.js";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function candidateLabel(candidate) {
  if (array(candidate?.items).length) return candidate.items.join(" + ");
  return String(candidate?.item ?? candidate?.name ?? "");
}

function deterministicWarnings(bundle, options = {}, additional = []) {
  return [...new Set([
    ...array(bundle?.warnings).map(String),
    ...array(additional).map(String),
    ...(options.reason ? [String(options.reason)] : [])
  ])];
}

function evidenceIds(bundle) {
  return new Set([
    ...array(bundle?.queryResult?.candidates).map((record) => record?.evidenceId),
    ...array(bundle?.knowledgeEvidence).map((record) => record?.evidenceId)
  ].filter(Boolean).map(String));
}

function validateReferences(records, allowed, errors, path) {
  for (const [index, record] of array(records).entries()) {
    if (!array(record?.evidenceIds).length) errors.push(`${path}[${index}].evidenceIds is required`);
    for (const id of array(record?.evidenceIds)) {
      if (!allowed.has(String(id))) errors.push(`${path}[${index}] references unknown evidenceId ${id}`);
    }
  }
}

function statisticalValues(bundle) {
  const values = new Set();
  for (const candidate of array(bundle?.queryResult?.candidates)) {
    for (const value of Object.values(candidate?.stats ?? {})) {
      const number = Number(value);
      if (!Number.isFinite(number)) continue;
      values.add(number);
      values.add(number * 100);
    }
  }
  return [...values];
}

function statisticalNumbersInText(value) {
  const text = String(value ?? "");
  const matches = [];
  for (const pattern of [
    /(-?\d+(?:\.\d+)?)\s*%/g,
    /(?:平均名次|前四率|胜率|登顶率|样本(?:数)?|场次|games?|samples?|top\s*4|win\s*rate|avg(?:erage)?\s*place(?:ment)?)\D{0,8}(-?\d+(?:\.\d+)?)/gi,
    /(-?\d+(?:\.\d+)?)\s*(?:场|局|个样本|games?|samples?)/gi
  ]) {
    for (const match of text.matchAll(pattern)) {
      const number = Number(match[1]);
      if (Number.isFinite(number)) matches.push(number);
    }
  }
  return matches;
}

function validateStatisticalNumbers(value, bundle, errors) {
  const mentioned = [
    value?.headline,
    value?.text,
    ...array(value?.reasons).map((record) => record?.text),
    ...array(value?.alternatives).map((record) => record?.text)
  ].flatMap(statisticalNumbersInText);
  if (!mentioned.length) return;
  const allowed = statisticalValues(bundle);
  for (const number of mentioned) {
    if (!allowed.some((candidate) => Math.abs(candidate - number) <= Math.max(0.005, Math.abs(candidate) * 0.001))) {
      errors.push(`answer contains an unsupported statistical number: ${number}`);
    }
  }
}

export function validateCoachAnswer(value, bundle) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Coach answer must be an object"], value: null };
  }
  if (value.schemaVersion !== COACH_ANSWER_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${COACH_ANSWER_SCHEMA_VERSION}`);
  }
  if (!["ok", "insufficient_evidence"].includes(value.status)) errors.push("status is invalid");
  if (typeof value.headline !== "string" || !value.headline.trim()) errors.push("headline is required");
  if (typeof value.text !== "string" || !value.text.trim()) errors.push("text is required");
  for (const key of ["reasons", "alternatives", "citations", "warnings"]) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }
  const allowed = evidenceIds(bundle);
  validateReferences(value.reasons, allowed, errors, "reasons");
  validateReferences(value.alternatives, allowed, errors, "alternatives");
  for (const id of array(value.citations)) {
    if (!allowed.has(String(id))) errors.push(`citations references unknown evidenceId ${id}`);
  }
  if (allowed.size && !array(value.citations).length) errors.push("citations must reference supporting evidence");
  const candidates = array(bundle?.queryResult?.candidates);
  if (candidates.length) {
    const expected = String(candidates[0].evidenceId);
    if (String(value.currentRecommendation?.evidenceId ?? "") !== expected) {
      errors.push(`currentRecommendation.evidenceId must be ${expected}`);
    }
    if (value.currentRecommendation?.label !== candidateLabel(candidates[0])) {
      errors.push("currentRecommendation.label must match the first structured candidate");
    }
    if (!array(value.citations).map(String).includes(expected)) {
      errors.push(`citations must include the current recommendation evidenceId ${expected}`);
    }
  } else if (value.currentRecommendation !== null) {
    errors.push("currentRecommendation must be null without structured candidates");
  }
  validateStatisticalNumbers(value, bundle, errors);
  return { valid: errors.length === 0, errors, value: errors.length ? null : value };
}

function renderCompTrends({ bundle, candidates, options }) {
  const first = candidates[0];
  const trendCandidates = candidates.slice(0, 5);
    const trendLabels = trendCandidates.map((candidate) => {
      const change = Number(candidate.stats?.avgPlacementChange);
      return Number.isFinite(change)
        ? `${candidateLabel(candidate)}（平均名次变化 ${change.toFixed(2)}）`
        : candidateLabel(candidate);
    });
    const citations = trendCandidates.map((candidate) => String(candidate.evidenceId));
    return {
      schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
      status: "ok",
      headline: "MetaTFT 近期上升阵容",
      text: `根据本轮 MetaTFT 结构化趋势结果，近期上升阵容依次为：${trendLabels.join("；")}。趋势排序以本轮结构化 QueryResult 为准。`,
      currentRecommendation: {
        evidenceId: String(first.evidenceId),
        label: candidateLabel(first)
      },
      reasons: [{
        evidenceIds: citations,
        text: "上升名单和顺序来自本轮 MetaTFT 结构化趋势结果。"
      }],
      alternatives: [],
      citations,
      warnings: deterministicWarnings(bundle, options)
    };
}

function renderStructuredRecommendation({ bundle, candidates, knowledge, options }) {
  const first = candidates[0];
  const recommendation = candidateLabel(first);
  const video = knowledge.find((record) => record.sourceType === "youtube");
    const videoClaim = String(video?.claim ?? "").trim();
    const conditionSeparator = /[。！？.!?]$/.test(videoClaim) ? "" : "。";
    const explanation = video
      ? `检索到 ${video.author ?? "该作者"} 的视频观点：${videoClaim}${array(video.conditions).length ? `${conditionSeparator}适用条件：${video.conditions.join("、")}` : ""}`
      : "当前没有检索到足够相关的视频攻略，以下结论主要基于当前统计；机制解释需要更多知识证据。";
    return {
      schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
      status: "ok",
      headline: `当前统计首选：${recommendation}`,
      text: `当前推荐以 MetaTFT 结构化结果的第一名“${recommendation}”为准。${explanation}`,
      currentRecommendation: {
        evidenceId: String(first.evidenceId),
        label: recommendation
      },
      reasons: [{
        evidenceIds: [String(first.evidenceId)],
        text: "当前最好与排序由右侧 MetaTFT 统计候选决定。"
      }],
      alternatives: video ? [{
        evidenceIds: [String(video.evidenceId)],
        text: `${video.author ?? "该作者"}的攻略仅作为条件性建议，不覆盖当前统计首选。`,
        conditions: array(video.conditions)
      }] : [],
      citations: [
        String(first.evidenceId),
        ...(video ? [String(video.evidenceId)] : [])
      ],
      warnings: deterministicWarnings(bundle, options)
    };
}

function renderStructuredEmpty({ bundle, options }) {
  return {
    schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
    status: "insufficient_evidence",
    headline: "当前结构化统计无合格候选",
    text: "本轮 MetaTFT 结构化 QueryResult 已返回，但当前查询范围内没有满足样本门槛和筛选条件的候选。不会用 current_stats 摘要或视频观点替代这一结果。",
    currentRecommendation: null,
    reasons: [],
    alternatives: [],
    citations: [],
    warnings: deterministicWarnings(bundle, options, ["structured_query_no_eligible_candidates"])
  };
}

function renderKnowledge({ bundle, knowledge, options }) {
  const firstKnowledge = knowledge[0];
    return {
      schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
      status: "ok",
      headline: firstKnowledge.sourceType === "youtube" ? "攻略建议" : "知识说明",
      text: `${firstKnowledge.author ? `${firstKnowledge.author}：` : ""}${firstKnowledge.claim}`,
      currentRecommendation: null,
      reasons: [{
        evidenceIds: [String(firstKnowledge.evidenceId)],
        text: firstKnowledge.claim
      }],
      alternatives: [],
      citations: [String(firstKnowledge.evidenceId)],
      warnings: [
        "当前没有可用的结构化统计，因此不声明当前最好。",
        ...deterministicWarnings(bundle, options)
      ]
    };
}

function renderInsufficient({ bundle, options }) {
  return {
    schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
    status: "insufficient_evidence",
    headline: "当前证据不足",
    text: "没有检索到可核验的当前统计或攻略知识，暂时不能给出可靠结论。",
    currentRecommendation: null,
    reasons: [],
    alternatives: [],
    citations: [],
    warnings: deterministicWarnings(bundle, options, ["no_relevant_evidence"])
  };
}

export const DETERMINISTIC_ANSWER_RENDERERS = Object.freeze({
  comp_trends: renderCompTrends,
  unit_build_rankings: renderStructuredRecommendation,
  unit_build_completion: renderStructuredRecommendation,
  unit_best_3_items: renderStructuredRecommendation,
  unit_item_rankings: renderStructuredRecommendation,
  unit_item_comparison: renderStructuredRecommendation,
  unit_item_availability: renderStructuredRecommendation,
  unit_emblem_rankings: renderStructuredRecommendation,
  item_carrier_rankings: renderStructuredRecommendation,
  comp_rankings: renderStructuredRecommendation,
  comp_analysis: renderStructuredRecommendation,
  structured_default: renderStructuredRecommendation,
  structured_empty: renderStructuredEmpty,
  knowledge_default: renderKnowledge,
  insufficient_evidence: renderInsufficient
});

function deterministicRendererKey(bundle, candidates, knowledge) {
  const taskType = String(bundle.queryResult?.resultType ?? bundle.query?.intent ?? "");
  if (candidates.length && DETERMINISTIC_ANSWER_RENDERERS[taskType]) return taskType;
  if (candidates.length) return "structured_default";
  if (
    taskType
    && String(bundle.queryResult?.source ?? "").toLowerCase() === "metatft"
  ) return "structured_empty";
  if (knowledge.length) return "knowledge_default";
  return "insufficient_evidence";
}

export function deterministicAnswer(bundle, options = {}) {
  const candidates = array(bundle.queryResult?.candidates);
  const knowledge = array(bundle.knowledgeEvidence);
  const rendererKey = deterministicRendererKey(bundle, candidates, knowledge);
  return DETERMINISTIC_ANSWER_RENDERERS[rendererKey]({
    bundle,
    candidates,
    knowledge,
    options
  });
}

function envelope(status, answer, options = {}) {
  return {
    status,
    content: answer,
    text: answer.text,
    citations: answer.citations,
    warnings: answer.warnings,
    model: options.model ?? null,
    latencyMs: Math.max(0, Number(options.latencyMs ?? 0)),
    evidenceBundle: options.evidenceBundle,
    ...(options.error ? { error: String(options.error) } : {})
  };
}

export class HybridAnswerService {
  constructor(options = {}) {
    this.provider = options.provider ?? null;
  }

  async answer(value = {}) {
    const startedAt = Date.now();
    const bundle = buildEvidenceBundle({
      mode: value.mode,
      query: value.query,
      structuredResult: value.structuredResult,
      structuredEvidence: value.structuredEvidence,
      knowledgeEvidence: value.knowledgeEvidence,
      warnings: value.warnings
    });
    if (!this.provider) {
      return envelope("fallback", deterministicAnswer(bundle, {
        reason: "coach_provider_unavailable"
      }), {
        evidenceBundle: bundle,
        latencyMs: Date.now() - startedAt
      });
    }
    try {
      const raw = await this.provider({
        question: value.question,
        evidenceBundle: bundle
      });
      const validation = validateCoachAnswer(raw, bundle);
      if (!validation.valid) {
        return envelope("fallback", deterministicAnswer(bundle, {
          reason: "coach_answer_validation_failed"
        }), {
          evidenceBundle: bundle,
          model: this.provider.model,
          latencyMs: Date.now() - startedAt,
          error: validation.errors.join("; ")
        });
      }
      return envelope("generated", validation.value, {
        evidenceBundle: bundle,
        model: this.provider.model,
        latencyMs: Date.now() - startedAt
      });
    } catch (error) {
      return envelope("fallback", deterministicAnswer(bundle, {
        reason: error?.name === "AbortError" ? "coach_provider_timeout" : "coach_provider_failed"
      }), {
        evidenceBundle: bundle,
        model: this.provider.model,
        latencyMs: Date.now() - startedAt,
        error: error?.message ?? error
      });
    }
  }
}

export function createHybridAnswerService(options = {}) {
  return new HybridAnswerService(options);
}
