import { normalizeText } from "./normalizer.js";
import { associateOfficialPatchChanges } from "../data/official-patch-evidence.js";

export const COMP_ANALYSIS_PROTOCOL_VERSION = "comp-analysis-v1";
export const METATFT_HISTORY_CAPABILITY = Object.freeze({
  status: "snapshot_required",
  reason: "comps_stats does not echo the requested patch, so historical responses cannot be verified reliably",
  snapshotVersion: "comp-stat-snapshot-v2"
});

const TEMPORAL_PATTERN = /为什么突然|加强后|削弱后|这次更新|比上版本|以前|最近.{0,6}(?:变强|变弱)|没人玩了|热度.{0,4}(?:下降|降低)/u;
const ANALYSIS_PATTERN = /还能玩|能玩吗|为什么突然|加强后|削弱后|这次更新|比上版本|以前|最近.{0,6}(?:变强|变弱)|没人玩|值得.{0,4}(?:强行|硬玩|冲)|上分还是吃鸡|更适合.{0,6}(?:上分|吃鸡)|卷不卷|当前卷|适合当前环境|环境适应/u;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function iso(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(parsed) && parsed > 100000000000) return new Date(parsed).toISOString();
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : String(value);
}

function metric(value) {
  const normalized = finite(value);
  return { value: normalized, status: normalized === null ? "unavailable" : "available" };
}

function baseTrait(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function isCompAnalysisInput(input) {
  const text = normalizeText(input);
  if (/(装备|三件套|怎么带|带什么)/u.test(text)) return false;
  return ANALYSIS_PATTERN.test(text);
}

export function parseCompAnalysisRequest(input, hints = {}) {
  const text = normalizeText(input);
  let questionType = "meta_fit";
  if (/为什么突然.{0,8}(?:强|厉害)|加强后|最近.{0,6}变强/u.test(text)) questionType = "cause_up";
  else if (/为什么突然.{0,8}(?:弱|差)|削弱后|最近.{0,6}变弱/u.test(text)) questionType = "cause_down";
  else if (/没人玩|热度.{0,4}(?:下降|降低)/u.test(text)) questionType = "popularity_drop";
  else if (/值得.{0,4}(?:强行|硬玩|冲)/u.test(text)) questionType = "force";
  else if (/上分还是吃鸡|更适合.{0,6}(?:上分|吃鸡)/u.test(text)) questionType = "goal_fit";
  else if (/卷不卷|当前卷/u.test(text)) questionType = "contested";
  else if (/还能玩|能玩吗/u.test(text)) questionType = "viability";
  return {
    protocolVersion: COMP_ANALYSIS_PROTOCOL_VERSION,
    requested: isCompAnalysisInput(text),
    questionType,
    requiresHistoricalEvidence: TEMPORAL_PATTERN.test(text),
    input: String(input ?? "").slice(0, 500),
    targetHints: {
      units: unique((hints.units ?? []).map(String)),
      traits: unique((hints.traits ?? []).map(baseTrait)),
      profileKeys: unique((hints.profileKeys ?? []).map(String))
    }
  };
}

function compactToken(value) {
  return normalizeText(value).replace(/[\s·•_\-—，,。！？?：:（）()]/gu, "");
}

function targetScore(comp, request) {
  const input = compactToken(request.input);
  let score = 0;
  const reasons = [];
  const name = compactToken(comp.name);
  if (name.length >= 2 && input.includes(name)) {
    score += 12;
    reasons.push("display_name");
  }
  const compId = compactToken(comp.compId);
  if (compId && input.includes(compId)) {
    score += 20;
    reasons.push("comp_id");
  }
  const unitHints = new Set(request.targetHints?.units ?? []);
  const traitHints = new Set((request.targetHints?.traits ?? []).map(baseTrait));
  for (const unit of comp.units ?? []) {
    if (unitHints.has(unit.apiName)) {
      score += 8;
      reasons.push(`unit:${unit.apiName}`);
    } else {
      const label = compactToken(unit.name);
      if (label.length >= 2 && input.includes(label)) {
        score += 4;
        reasons.push(`unit_name:${unit.apiName}`);
      }
    }
  }
  for (const trait of comp.traits ?? []) {
    const apiName = baseTrait(trait.apiName ?? trait.filterId);
    if (traitHints.has(apiName)) {
      score += 9;
      reasons.push(`trait:${apiName}`);
    } else {
      const label = compactToken(trait.name);
      if (label.length >= 2 && input.includes(label)) {
        score += 5;
        reasons.push(`trait_name:${apiName}`);
      }
    }
  }
  if ((request.targetHints?.profileKeys ?? []).includes(comp.profileKey)) {
    score += 14;
    reasons.push(`profile:${comp.profileKey}`);
  }
  return { score, reasons: unique(reasons) };
}

export function resolveCompAnalysisTarget(candidates = [], request = {}) {
  const scored = candidates.map((comp) => ({ comp, ...targetScore(comp, request) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score
      || (finite(right.comp?.stats?.games) ?? 0) - (finite(left.comp?.stats?.games) ?? 0));
  if (!scored.length) return { status: "not_found", target: null, candidates: [] };
  const best = scored[0];
  const tied = scored.filter((entry) => entry.score === best.score);
  if (tied.length > 1 && best.score < 12) {
    return {
      status: "ambiguous",
      target: null,
      candidates: tied.slice(0, 5).map((entry) => ({
        compId: entry.comp.compId,
        name: entry.comp.name,
        score: entry.score,
        reasons: entry.reasons
      }))
    };
  }
  return { status: "resolved", target: best.comp, score: best.score, reasons: best.reasons, candidates: [] };
}

function currentFacts(comp, query, source) {
  return {
    avgPlace: metric(comp?.stats?.avgPlacement),
    top4Rate: metric(comp?.stats?.top4Rate),
    winRate: metric(comp?.stats?.winRate),
    pickRate: metric(comp?.stats?.pickRate),
    sampleSize: metric(comp?.stats?.games),
    effectivePatch: query.effectivePatch ?? comp?.patch ?? query.patch ?? null,
    sourceUpdatedAt: iso(comp?.source?.updatedAt ?? source?.updatedAt)
  };
}

function evidenceRecord(sourceType, sourceName, query, sourceUpdatedAt, confidence, data) {
  return {
    sourceType,
    sourceName,
    sourceUpdatedAt: iso(sourceUpdatedAt),
    effectivePatch: query.effectivePatch ?? query.patch ?? null,
    seasonContextId: query.seasonContextId ?? "set17-live",
    confidence,
    data
  };
}

function comparisonFor(result, comp) {
  return result?.trend?.comparisons?.[String(comp?.source?.clusterId ?? comp?.compId?.replace(/^cluster:/, ""))] ?? {
    currentPatch: result?.query?.effectivePatch ?? result?.query?.patch ?? null,
    baselinePatch: null,
    metrics: {
      avgPlaceDelta: null,
      top4RateDelta: null,
      winRateDelta: null,
      pickRateDelta: null,
      sampleSizeDelta: null
    },
    patchChanges: [],
    evidenceStatus: "unavailable"
  };
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "不可用";
}

function placement(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "不可用";
}

function buildAnswer(request, comp, facts, comparison, patchChanges) {
  const games = facts.sampleSize.value;
  const risks = [];
  if (games === null) risks.push("上游未提供样本量，不能判断统计可靠性。");
  else if (games < 500) risks.push(`当前只有 ${games} 场样本，结论仅作低样本参考。`);
  if (request.requiresHistoricalEvidence && comparison.evidenceStatus === "unavailable") {
    risks.push("没有可核验的历史版本数据，不能生成版本变化趋势或原因判断。");
  } else if (request.requiresHistoricalEvidence && comparison.evidenceStatus === "partial") {
    risks.push("历史证据不完整，只能描述可核验的指标变化。");
  }
  const evidence = [
    `平均名次 ${placement(facts.avgPlace.value)}`,
    `前四率 ${percent(facts.top4Rate.value)}`,
    `登顶率 ${percent(facts.winRate.value)}`,
    `选择率 ${percent(facts.pickRate.value)}`,
    `样本 ${games ?? "不可用"}`
  ];
  const reasons = [];
  if (comparison.evidenceStatus !== "unavailable") {
    const delta = comparison.metrics ?? {};
    if (Number.isFinite(delta.avgPlaceDelta)) reasons.push(`相对基线平均名次变化 ${delta.avgPlaceDelta > 0 ? "+" : ""}${delta.avgPlaceDelta.toFixed(2)}。`);
    if (Number.isFinite(delta.top4RateDelta)) reasons.push(`前四率变化 ${delta.top4RateDelta > 0 ? "+" : ""}${(delta.top4RateDelta * 100).toFixed(1)} 个百分点。`);
    if (Number.isFinite(delta.pickRateDelta)) reasons.push(`选择率变化 ${delta.pickRateDelta > 0 ? "+" : ""}${(delta.pickRateDelta * 100).toFixed(1)} 个百分点。`);
  }
  if (patchChanges.length) {
    reasons.push(...patchChanges.slice(0, 3).map((change) => `官方公告包含相关改动：${change.summary} 这只能作为可能原因，不能单独证明因果。`));
  }
  if (request.requiresHistoricalEvidence && reasons.length === 0) {
    reasons.push("目前只能确认当前数据，现有证据不足以可靠判断变化原因。");
  }

  let conclusion = `${comp.name}有可用的当前版本统计，但是否值得玩仍需结合样本和目标。`;
  if (request.questionType === "goal_fit") {
    conclusion = facts.top4Rate.value !== null && facts.winRate.value !== null
      ? `${comp.name}当前前四率为 ${percent(facts.top4Rate.value)}、登顶率为 ${percent(facts.winRate.value)}；系统只报告两项事实，不用未定义阈值替你贴“上分/吃鸡阵容”标签。`
      : `${comp.name}缺少判断上分与吃鸡取向所需的完整指标。`;
  } else if (request.questionType === "contested") {
    conclusion = facts.pickRate.value === null
      ? `${comp.name}的选择率不可用，暂时无法判断当前卷不卷。`
      : `${comp.name}当前选择率为 ${percent(facts.pickRate.value)}；这是热度证据，不等同于每局必有同行。`;
  } else if (["cause_up", "cause_down", "popularity_drop"].includes(request.questionType)) {
    conclusion = reasons.length && comparison.evidenceStatus !== "unavailable"
      ? `${comp.name}存在可核验的变化证据，但原因只能表述为“可能相关”。`
      : "目前只能确认当前数据，现有证据不足以可靠判断原因。";
  } else if (request.questionType === "force") {
    conclusion = games !== null && games >= 500
      ? `${comp.name}有足够当前样本可供决策，但“强行冲”还需要结合来牌、装备与同行，统计本身不支持无条件硬玩。`
      : `${comp.name}当前样本不足以支持“强行冲”的稳定结论。`;
  }
  return { conclusion, reasons, evidence, risks };
}

export function analyzeCompRankingResult(result, request = {}) {
  const query = result.query ?? {};
  const resolution = resolveCompAnalysisTarget(result.candidates ?? [], request);
  if (resolution.status !== "resolved") {
    const conclusion = resolution.status === "ambiguous"
      ? "命中了多个阵容，请补充核心英雄或主要羁绊。"
      : "没有在当前 MetaTFT 可见阵容中找到目标，请补充阵容名称、核心英雄或主要羁绊。";
    return {
      ...result,
      type: "comp_analysis",
      rankings: {},
      references: [],
      rising: [],
      falling: [],
      improving: [],
      text: conclusion,
      analysis: {
        protocolVersion: COMP_ANALYSIS_PROTOCOL_VERSION,
        status: resolution.status === "ambiguous" ? "ambiguous_target" : "target_not_found",
        questionType: request.questionType,
        requiresHistoricalEvidence: Boolean(request.requiresHistoricalEvidence),
        target: null,
        candidates: resolution.candidates,
        evidencePack: [],
        answer: { conclusion, reasons: [], evidence: [], risks: [] }
      }
    };
  }

  const comp = resolution.target;
  const facts = currentFacts(comp, query, result.source);
  const comparison = comparisonFor(result, comp);
  const patchChanges = associateOfficialPatchChanges(comp, query.effectivePatch);
  comparison.patchChanges = patchChanges.map((change) => ({
    id: change.id,
    direction: change.direction,
    summary: change.summary,
    patch: change.patch
  }));
  const evidencePack = [
    evidenceRecord("metatft_fact", "MetaTFT /comps_stats", query, facts.sourceUpdatedAt, 1, {
      compId: comp.compId,
      name: comp.name,
      metrics: facts
    })
  ];
  if (comparison.evidenceStatus !== "unavailable") {
    evidencePack.push(evidenceRecord("historical_fact", "TFTClarity versioned comp snapshot", query, comparison.baselineCapturedAt, 0.9, comparison));
  }
  for (const change of patchChanges) {
    evidencePack.push(evidenceRecord("official_patch", change.sourceName, query, change.publishedAt, 1, {
      id: change.id,
      direction: change.direction,
      summary: change.summary,
      sourceUrl: change.sourceUrl
    }));
  }
  if (comp.strategyDerivation) {
    const strategyOverridden = comp.strategyDerivation.source === "tftclarity_verified_binding_override";
    evidencePack.push(evidenceRecord(
      strategyOverridden ? "manual_comp_profile" : "automatic_derivation",
      strategyOverridden ? "TFTClarity verified strategy binding" : "TFTClarity CompEnrichment",
      query,
      strategyOverridden ? comp.profileBinding?.lastVerifiedAt : facts.sourceUpdatedAt,
      comp.strategyDerivation.confidence ?? 0.5,
      comp.strategyDerivation
    ));
  }
  if (comp.profile) {
    evidencePack.push(evidenceRecord("manual_comp_profile", "TFTClarity manual Comp Profile", query, comp.profileBinding?.lastVerifiedAt, 1, {
      profileKey: comp.profileKey,
      profile: comp.profile
    }));
  }
  const answer = buildAnswer(request, comp, facts, comparison, patchChanges);
  const evidenceStatus = request.requiresHistoricalEvidence
    ? comparison.evidenceStatus
    : facts.sampleSize.status === "available" ? "complete" : "partial";
  return {
    ...result,
    type: "comp_analysis",
    rankings: { analysis: [comp] },
    references: [],
    rising: [],
    falling: [],
    improving: [],
    text: answer.conclusion,
    analysis: {
      protocolVersion: COMP_ANALYSIS_PROTOCOL_VERSION,
      status: evidenceStatus === "unavailable" ? "insufficient_historical_evidence" : "ok",
      questionType: request.questionType,
      requiresHistoricalEvidence: Boolean(request.requiresHistoricalEvidence),
      target: { compId: comp.compId, name: comp.name, matchScore: resolution.score, matchReasons: resolution.reasons },
      currentFacts: facts,
      comparison,
      patchChanges: comparison.patchChanges,
      evidenceStatus,
      evidencePack,
      historyCapability: METATFT_HISTORY_CAPABILITY,
      answer
    }
  };
}
