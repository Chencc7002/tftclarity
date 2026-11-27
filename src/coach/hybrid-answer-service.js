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
    /(?:平均名次|前四率|胜率|登顶率|样本(?:数)?|场次|games?|samples?|top\s*4|win\s*rate|avg(?:erage)?\s*place(?:ment)?)\D{0,8}(-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?)/gi,
    /(-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?)\s*(?:场|局|个样本|games?|samples?)/gi
  ]) {
    for (const match of text.matchAll(pattern)) {
      const number = Number(String(match[1]).replaceAll(",", ""));
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

function hasMetric(value) {
  return (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
}

function formatCandidateMetrics(candidate) {
  const s = candidate?.stats ?? {};
  const parts = [];
  if (hasMetric(s.avgPlacement)) parts.push(`平均名次 ${Number(s.avgPlacement).toFixed(2)}`);
  if (hasMetric(s.top4Rate)) parts.push(`前四率 ${(Number(s.top4Rate) * 100).toFixed(1)}%`);
  if (hasMetric(s.winRate)) parts.push(`登顶率 ${(Number(s.winRate) * 100).toFixed(1)}%`);
  if (hasMetric(s.games)) parts.push(`样本 ${Number(s.games)}`);
  const lowSample = array(candidate?.riskFlags).includes("low_sample");
  const summary = parts.join("，");
  if (!summary) return lowSample ? "低样本参考" : "";
  return lowSample ? `${summary}（低样本参考）` : summary;
}

function formatCandidateBullet(candidate, prefix = "") {
  const label = candidateLabel(candidate);
  const metrics = formatCandidateMetrics(candidate);
  return `- ${prefix}${label}${metrics ? `：${metrics}` : ""}`;
}

function formatVideoLine(video) {
  if (!video) return null;
  const videoClaim = String(video.claim ?? "").trim();
  if (!videoClaim) return null;
  const conditionSeparator = /[。！？.!?]$/.test(videoClaim) ? "" : "。";
  const conditions = array(video.conditions).length
    ? `${conditionSeparator}适用条件：${video.conditions.join("、")}`
    : "";
  return `- 攻略补充（${video.author ?? "创作者"}）：${videoClaim}${conditions}`;
}

function renderCompTrends({ bundle, candidates, options }) {
  const first = candidates[0];
  const trendCandidates = candidates.slice(0, 5);
  const trendLines = trendCandidates.map((candidate) => {
    const change = Number(candidate.stats?.avgPlacementChange);
    const metrics = formatCandidateMetrics(candidate);
    const changePart = hasMetric(candidate.stats?.avgPlacementChange)
      ? `平均名次变化 ${change > 0 ? `+${change.toFixed(2)}` : change.toFixed(2)}`
      : "";
    const detail = [changePart, metrics].filter(Boolean).join("，");
    return `- ${candidateLabel(candidate)}${detail ? `：${detail}` : ""}`;
  });
  const citations = trendCandidates.map((candidate) => String(candidate.evidenceId));
  return {
    schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
    status: "ok",
    headline: "近期上升阵容前列",
    text: ["近期上升明显的阵容：", ...trendLines].join("\n"),
    currentRecommendation: {
      evidenceId: String(first.evidenceId),
      label: candidateLabel(first)
    },
    reasons: [{
      evidenceIds: citations,
      text: "按本轮统计的近期平均名次变化排序。"
    }],
    alternatives: [],
    citations,
    warnings: deterministicWarnings(bundle, options)
  };
}

function renderCompRankings({ bundle, candidates, knowledge, options }) {
  const first = candidates[0];
  const recommendation = candidateLabel(first);
  const top = candidates.slice(0, 3);
  const video = knowledge.find((record) => record.sourceType === "youtube");
  const videoLine = formatVideoLine(video);
  const lines = [
    "当前热门阵容前列：",
    ...top.map((candidate) => formatCandidateBullet(candidate)),
    ...(videoLine ? [videoLine] : [])
  ];
  const citations = [
    ...top.map((candidate) => String(candidate.evidenceId)),
    ...(video ? [String(video.evidenceId)] : [])
  ];
  return {
    schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
    status: "ok",
    headline: `当前热门阵容首选：${recommendation}`,
    text: lines.join("\n"),
    currentRecommendation: {
      evidenceId: String(first.evidenceId),
      label: recommendation
    },
    reasons: [{
      evidenceIds: top.map((candidate) => String(candidate.evidenceId)),
      text: "按本轮实时统计的平均名次、前四率与样本量排序。"
    }],
    alternatives: video ? [{
      evidenceIds: [String(video.evidenceId)],
      text: `${video.author ?? "创作者"}的攻略仅作为条件性建议，不覆盖当前统计排序。`,
      conditions: array(video.conditions)
    }] : [],
    citations,
    warnings: deterministicWarnings(bundle, options)
  };
}

function renderItemCarriers({ bundle, candidates, knowledge, options }) {
  const first = candidates[0];
  const recommendation = candidateLabel(first);
  const top = candidates.slice(0, 3);
  const video = knowledge.find((record) => record.sourceType === "youtube");
  const videoLine = formatVideoLine(video);
  const lines = [
    "适配携带英雄前列：",
    ...top.map((candidate) => formatCandidateBullet(candidate)),
    ...(videoLine ? [videoLine] : [])
  ];
  return {
    schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
    status: "ok",
    headline: `首选携带英雄：${recommendation}`,
    text: lines.join("\n"),
    currentRecommendation: {
      evidenceId: String(first.evidenceId),
      label: recommendation
    },
    reasons: [{
      evidenceIds: top.map((candidate) => String(candidate.evidenceId)),
      text: "按本轮携带样本与平均名次表现排序。"
    }],
    alternatives: video ? [{
      evidenceIds: [String(video.evidenceId)],
      text: `${video.author ?? "创作者"}的攻略仅作为条件性建议。`,
      conditions: array(video.conditions)
    }] : [],
    citations: [
      ...top.map((candidate) => String(candidate.evidenceId)),
      ...(video ? [String(video.evidenceId)] : [])
    ],
    warnings: deterministicWarnings(bundle, options)
  };
}

function renderStructuredRecommendation({ bundle, candidates, knowledge, options }) {
  const first = candidates[0];
  const recommendation = candidateLabel(first);
  const top = candidates.slice(0, 3);
  const video = knowledge.find((record) => record.sourceType === "youtube");
  const videoLine = formatVideoLine(video);
  const firstMetrics = formatCandidateMetrics(first);
  const lines = [
    `当前首选：${recommendation}${firstMetrics ? `（${firstMetrics}）` : ""}`,
    ...top.slice(1).map((candidate) => formatCandidateBullet(candidate, "备选：")),
    ...(videoLine ? [videoLine] : [])
  ];
  return {
    schemaVersion: COACH_ANSWER_SCHEMA_VERSION,
    status: "ok",
    headline: `当前统计首选：${recommendation}`,
    text: lines.join("\n"),
    currentRecommendation: {
      evidenceId: String(first.evidenceId),
      label: recommendation
    },
    reasons: [{
      evidenceIds: top.map((candidate) => String(candidate.evidenceId)),
      text: "主结论与备选排序来自本轮统计表现。"
    }],
    alternatives: video ? [{
      evidenceIds: [String(video.evidenceId)],
      text: `${video.author ?? "创作者"}的攻略仅作为条件性建议，不覆盖当前统计首选。`,
      conditions: array(video.conditions)
    }] : [],
    citations: [
      ...top.map((candidate) => String(candidate.evidenceId)),
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
    text: "当前统计查询已完成，但当前查询范围内没有满足样本门槛和筛选条件的候选，不会用历史摘要或视频观点替代这一结果。",
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
  item_carrier_rankings: renderItemCarriers,
  comp_rankings: renderCompRankings,
  comp_analysis: renderCompRankings,
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
