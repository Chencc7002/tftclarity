import { digitValue, normalizeText } from "./normalizer.js";

export const COMP_PREFERENCE_PROTOCOL_VERSION = "comp-preference-conditions-v1";
export const COMP_PREFERENCE_SEARCH_VERSION = "comp-preference-search-v1";

const STRATEGIES = new Set(["reroll", "fast8", "fast9"]);
const GOALS = new Set(["top4", "top1", "balanced"]);
const LEVELS = new Set(["low", "medium", "high"]);
const DEFAULT_COUNT = 3;
const MAX_COUNT = 10;

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function preferenceError(message, field = null) {
  const error = new TypeError(message);
  error.code = "invalid_comp_preference_conditions";
  error.statusCode = 400;
  error.field = field;
  return error;
}

function nullableEnum(value, allowed, field) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw preferenceError(`${field} 不支持：${value}`, field);
  }
  return normalized;
}

function nullableBoolean(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "boolean") throw preferenceError(`${field} 必须是 boolean 或 null`, field);
  return value;
}

function requestedCount(value, fallback = DEFAULT_COUNT) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_COUNT) {
    throw preferenceError(`count 必须是 1 到 ${MAX_COUNT} 的整数`, "count");
  }
  return number;
}

export function validateCompPreferenceConditions(value = {}, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw preferenceError("自然语言阵容条件必须是对象");
  }
  const allowedFields = new Set([
    "strategy", "reroll", "goal", "contested", "difficulty", "beginnerFriendly", "count"
  ]);
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) {
    throw preferenceError(`条件包含未定义字段：${unknownFields.join(", ")}`, unknownFields[0]);
  }
  const normalized = {
    strategy: nullableEnum(value.strategy, STRATEGIES, "strategy"),
    reroll: nullableBoolean(value.reroll, "reroll"),
    goal: nullableEnum(value.goal, GOALS, "goal"),
    contested: nullableEnum(value.contested, LEVELS, "contested"),
    difficulty: nullableEnum(value.difficulty, LEVELS, "difficulty"),
    beginnerFriendly: nullableBoolean(value.beginnerFriendly, "beginnerFriendly"),
    count: requestedCount(value.count, options.defaultCount ?? DEFAULT_COUNT)
  };
  if (normalized.strategy === "reroll" && normalized.reroll === false) {
    throw preferenceError("strategy=reroll 与 reroll=false 冲突", "reroll");
  }
  return normalized;
}

function parseCount(text) {
  const token = "(?:\\d+|十|一|二|两|三|四|五|六|七|八|九)";
  const match = text.match(new RegExp(`(?:推荐|给我|来|选|找)\\s*(${token})\\s*套`))
    ?? text.match(new RegExp(`(${token})\\s*套(?:阵容|体系)`))
    ?? text.match(new RegExp(`(?:推荐|给我|来|选|找)\\s*(${token})\\s*个(?:阵容)?`));
  if (!match) return null;
  const number = Number(match[1]) || digitValue(match[1]);
  return Number.isInteger(number) ? Math.min(MAX_COUNT, Math.max(1, number)) : null;
}

export function parseCompPreferenceConditions(input) {
  const text = normalizeText(input);
  const explicitCompTarget = /(?:阵容|体系|95|九五|速九|速八|赌狗|赌牌|reroll)/iu.test(text);
  const negativeReroll = /(?:不(?:想|要|玩|喜欢|考虑)?|别|拒绝|讨厌).{0,5}(?:赌狗|赌牌|低费赌|d牌|d卡|追三|reroll)|(?:赌狗|赌牌|低费赌|d牌|d卡|追三|reroll).{0,5}(?:不要|不玩|算了)/iu.test(text);
  let strategy = null;
  if (/(?:95|九五|速九|fast\s*9|上9|九人口)/iu.test(text)) strategy = "fast9";
  else if (!negativeReroll && /(?:赌狗|赌牌|低费赌|d牌|d卡|追三|reroll)/iu.test(text)) strategy = "reroll";
  else if (/(?:速八|fast\s*8|上8|八人口)/iu.test(text)) strategy = "fast8";

  let goal = null;
  const explicitTop4Metric = /(?:前四|吃分)(?:率|份额)|(?:率|份额).{0,3}(?:前四|吃分)/u.test(text);
  const explicitTop1Metric = /(?:吃鸡|登顶|第一)(?:率|份额)|(?:率|份额).{0,3}(?:吃鸡|登顶|第一)/u.test(text);
  const comparisonTop1Metric = !explicitCompTarget && (
    /(?:吃鸡|登顶).{0,4}(?:优先|上限高)|(?:哪个|哪件|谁).{0,8}(?:吃鸡|登顶)/u.test(text)
  );
  if (!explicitTop4Metric && /(?:稳定上分|稳(?:定)?吃分|前四|苟分|保分)/u.test(text)) goal = "top4";
  else if (!explicitTop1Metric && !comparisonTop1Metric && /(?:吃鸡|登顶|第一|上限高|高上限)/u.test(text)) goal = "top1";
  else if (/(?:均衡|平衡|综合|兼顾|都要)/u.test(text)) goal = "balanced";

  let contested = null;
  if (/(?:不想卷|不要卷|不卷|冷门|少同行|没人抢|避开热门)/u.test(text)) contested = "low";
  else if (/(?:适中热度|热度适中|同行适中)/u.test(text)) contested = "medium";
  else if (/(?:不怕卷|能卷|喜欢卷|接受高同行)|(?:想玩|要玩|偏好).{0,4}(?:热门|高热度|多人玩)/u.test(text)) contested = "high";

  let difficulty = null;
  if (/(?:简单一点|简单些|容易上手|低难度|不要太难|别太难|不难)/u.test(text)) difficulty = "low";
  else if (/(?:难度适中|中等难度)/u.test(text)) difficulty = "medium";
  else if (/(?:高难度|操作难|复杂一点|挑战性)/u.test(text)) difficulty = "high";

  let beginnerFriendly = null;
  if (/(?:适合新手|新手友好|萌新友好|新手能玩|新手推荐)/u.test(text)) beginnerFriendly = true;
  else if (/(?:不适合新手|老手向|高手向)/u.test(text)) beginnerFriendly = false;

  const count = parseCount(text);
  const requested = strategy !== null
    || negativeReroll
    || goal !== null
    || contested !== null
    || difficulty !== null
    || beginnerFriendly !== null
    || count !== null;
  return {
    requested,
    conditions: {
      strategy,
      reroll: negativeReroll ? false : strategy === "reroll" ? true : null,
      goal,
      contested,
      difficulty,
      beginnerFriendly,
      count: count ?? DEFAULT_COUNT
    }
  };
}

export function isCompPreferenceInput(input) {
  const text = normalizeText(input);
  if (/(?:装备|出装|三件套|怎么带|带什么装备)/u.test(text)) return false;
  return parseCompPreferenceConditions(text).requested;
}

function difficultyBand(value) {
  const rating = finite(value);
  if (rating === null) return null;
  if (rating <= 2) return "low";
  if (rating === 3) return "medium";
  return "high";
}

function contestEvidence(comp) {
  const selectionRate = finite(comp?.stats?.selectionRate,
    finite(comp?.stats?.pickRate) === null ? null : finite(comp.stats.pickRate) * 8);
  const tolerance = finite(comp?.profile?.contestTolerance);
  if (selectionRate === null || tolerance === null) return null;
  const adjustedRisk = clamp(selectionRate - (tolerance - 3) * 0.05);
  return {
    level: adjustedRisk <= 0.4 ? "low" : adjustedRisk <= 0.65 ? "medium" : "high",
    adjustedRisk,
    selectionRate,
    contestTolerance: tolerance
  };
}

function uniqueCandidates(result) {
  const source = Array.isArray(result?.candidates) && result.candidates.length
    ? result.candidates
    : [
      ...Object.values(result?.rankings ?? {}).flat(),
      ...(result?.references ?? [])
    ];
  const byId = new Map();
  for (const comp of source) {
    if (!comp?.compId || byId.has(comp.compId)) continue;
    byId.set(comp.compId, comp);
  }
  return [...byId.values()];
}

function mean(values, fallback) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length
    ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
    : fallback;
}

function scoringContext(comps, minSamples) {
  return {
    priorSamples: Math.max(200, Number(minSamples) || 0),
    top4Prior: mean(comps.map((comp) => finite(comp?.stats?.top4Rate)), 0.5),
    winPrior: mean(comps.map((comp) => finite(comp?.stats?.winRate)), 0.125),
    placementPrior: mean(comps.map((comp) => finite(comp?.stats?.avgPlacement)), 4.5)
  };
}

function scoreComp(comp, goal, context) {
  const games = Math.max(0, finite(comp?.stats?.games, 0));
  const top4Rate = finite(comp?.stats?.top4Rate);
  const winRate = finite(comp?.stats?.winRate);
  const avgPlacement = finite(comp?.stats?.avgPlacement);
  const required = goal === "top4"
    ? [top4Rate]
    : goal === "top1"
      ? [winRate]
      : [top4Rate, winRate, avgPlacement];
  if (required.some((value) => value === null)) return null;
  const reliability = games / Math.max(1, games + context.priorSamples);
  const adjustedTop4 = reliability * (top4Rate ?? context.top4Prior) + (1 - reliability) * context.top4Prior;
  const adjustedWin = reliability * (winRate ?? context.winPrior) + (1 - reliability) * context.winPrior;
  const adjustedPlacement = reliability * (avgPlacement ?? context.placementPrior)
    + (1 - reliability) * context.placementPrior;
  const placementQuality = clamp((8 - adjustedPlacement) / 7);
  const score = goal === "top4"
    ? adjustedTop4
    : goal === "top1"
      ? adjustedWin
      : adjustedTop4 * 0.5 + adjustedWin * 0.2 + placementQuality * 0.3;
  return {
    goal,
    score,
    reliability,
    priorSamples: context.priorSamples,
    adjusted: {
      top4Rate: adjustedTop4,
      winRate: adjustedWin,
      avgPlacement: adjustedPlacement
    }
  };
}

function reasonsFor(comp, conditions) {
  const reasons = [];
  if (conditions.strategy && comp?.strategy !== conditions.strategy) reasons.push("strategy_mismatch");
  if (conditions.reroll !== null) {
    const isReroll = comp?.strategy === "reroll";
    if (isReroll !== conditions.reroll) reasons.push("reroll_mismatch");
  }
  if (conditions.difficulty) {
    if (!comp?.profile || finite(comp.profile.difficulty) === null) reasons.push("missing_profile");
    else if (difficultyBand(comp.profile.difficulty) !== conditions.difficulty) reasons.push("difficulty_mismatch");
  }
  if (conditions.beginnerFriendly !== null) {
    if (!comp?.profile || typeof comp.profile.beginnerFriendly !== "boolean") reasons.push("missing_profile");
    else if (comp.profile.beginnerFriendly !== conditions.beginnerFriendly) reasons.push("beginner_mismatch");
  }
  if (conditions.contested) {
    const contest = contestEvidence(comp);
    if (!contest) reasons.push(comp?.profile ? "missing_contest_evidence" : "missing_profile");
    else if (contest.level !== conditions.contested) reasons.push("contested_mismatch");
  }
  return [...new Set(reasons)];
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function warningSummary(counts, lowSampleCount, returnedCount) {
  const warnings = [];
  if (counts.missing_profile) {
    warnings.push(`${counts.missing_profile} 套阵容缺少已验证的人工 Profile，无法确认难度、新手或同行条件，已排除。`);
  }
  if (counts.missing_contest_evidence) {
    warnings.push(`${counts.missing_contest_evidence} 套阵容缺少选择率或同行容忍度，无法确认卷度，已排除。`);
  }
  if (counts.missing_goal_metrics) {
    warnings.push(`${counts.missing_goal_metrics} 套阵容缺少目标排序所需指标，未参与排名。`);
  }
  if (!returnedCount && lowSampleCount) {
    warnings.push(`有 ${lowSampleCount} 套阵容满足玩法条件，但均低于样本门槛，只作为低样本证据展示。`);
  }
  if (!returnedCount && !lowSampleCount) {
    warnings.push("当前数据中没有同时满足全部结构化条件且证据完整的阵容。请放宽一个条件后重试。");
  }
  return warnings;
}

export function applyCompPreferenceSearch(result, options = {}) {
  const conditions = validateCompPreferenceConditions(
    options.conditions ?? result?.query?.preferenceConditions ?? {}
  );
  const minSamples = Math.max(0, Number(options.minSamples ?? result?.query?.minSamples ?? 0));
  const goal = conditions.goal ?? "balanced";
  const candidates = uniqueCandidates(result);
  const excluded = {};
  const conditionMatches = [];
  for (const comp of candidates) {
    const reasons = reasonsFor(comp, conditions);
    if (reasons.length) {
      reasons.forEach((reason) => increment(excluded, reason));
      continue;
    }
    conditionMatches.push(comp);
  }
  const eligible = conditionMatches.filter((comp) => finite(comp?.stats?.games, 0) >= minSamples);
  const lowSampleCandidates = conditionMatches.filter((comp) => finite(comp?.stats?.games, 0) < minSamples);
  const context = scoringContext(eligible, minSamples);
  const scored = [];
  for (const comp of eligible) {
    const ranking = scoreComp(comp, goal, context);
    if (!ranking) {
      increment(excluded, "missing_goal_metrics");
      continue;
    }
    scored.push({
      ...comp,
      preferenceMatch: {
        protocolVersion: COMP_PREFERENCE_PROTOCOL_VERSION,
        conditions,
        ranking,
        contest: conditions.contested ? contestEvidence(comp) : null,
        difficulty: comp?.profile ? difficultyBand(comp.profile.difficulty) : null
      }
    });
  }
  const lowSampleMatches = lowSampleCandidates.filter((comp) => {
    if (scoreComp(comp, goal, context)) return true;
    increment(excluded, "missing_goal_metrics");
    return false;
  });
  scored.sort((left, right) => right.preferenceMatch.ranking.score - left.preferenceMatch.ranking.score
    || finite(right?.stats?.games, 0) - finite(left?.stats?.games, 0)
    || finite(left?.pageOrder, Number.MAX_SAFE_INTEGER) - finite(right?.pageOrder, Number.MAX_SAFE_INTEGER));
  const recommendations = scored.slice(0, conditions.count);
  const lowSampleReferences = lowSampleMatches
    .sort((left, right) => finite(right?.stats?.games, 0) - finite(left?.stats?.games, 0))
    .slice(0, conditions.count)
    .map((comp) => ({ ...comp, lowSample: true }));
  const warnings = warningSummary(excluded, lowSampleMatches.length, recommendations.length);
  const profileDependent = Boolean(conditions.difficulty || conditions.contested || conditions.beginnerFriendly !== null);
  const status = recommendations.length
    ? "ok"
    : lowSampleMatches.length
      ? "low_sample_only"
      : profileDependent && excluded.missing_profile
        ? "insufficient_profile"
        : (excluded.missing_contest_evidence || excluded.missing_goal_metrics)
          ? "insufficient_evidence"
          : "zero_results";
  const rankingKey = goal === "top1" ? "winRate" : goal === "top4" ? "top4Rate" : "avgPlacement";
  const rankings = Object.fromEntries(Object.keys(result?.rankings ?? {
    top4Rate: [], winRate: [], winShare: [], avgPlacement: [], popularity: []
  }).map((key) => [key, key === rankingKey ? recommendations : []]));
  if (!Object.hasOwn(rankings, rankingKey)) rankings[rankingKey] = recommendations;
  const text = recommendations.length
    ? `确定性代码按结构化条件筛选并排序，返回 ${recommendations.length}/${conditions.count} 套阵容。`
    : status === "low_sample_only"
      ? "符合玩法条件的阵容均未达到样本门槛，未生成正式推荐。"
      : "没有证据完整且同时满足全部结构化条件的阵容，未生成推荐。";
  return {
    ...result,
    rankings,
    references: lowSampleReferences,
    warnings: [...new Set([...(result?.warnings ?? []), ...warnings])],
    text,
    preferenceSearch: {
      protocolVersion: COMP_PREFERENCE_PROTOCOL_VERSION,
      searchVersion: COMP_PREFERENCE_SEARCH_VERSION,
      conditions,
      status,
      requestedCount: conditions.count,
      returnedCount: recommendations.length,
      evaluatedCandidates: candidates.length,
      conditionMatches: conditionMatches.length,
      lowSampleMatches: lowSampleMatches.length,
      excluded,
      ranking: {
        goal,
        reliabilityPriorSamples: context.priorSamples,
        performedBy: "deterministic_code"
      },
      methodology: "LLM/解析器只输出条件；候选过滤、样本门槛、可靠性收缩、排序、零结果和数量截断均由确定性代码完成。"
    }
  };
}
