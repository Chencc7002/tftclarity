import { DEFAULT_QUERY_OPTIONS } from "../data/static-data.js";
import { normalizeText } from "./normalizer.js";

export const COMP_METRICS = Object.freeze([
  "top4_rate",
  "win_rate",
  "win_share",
  "avg_placement",
  "popularity"
]);

const METRIC_SET = new Set(COMP_METRICS);

function unique(values) {
  return [...new Set(values)];
}

export function isCompRankingInput(input) {
  const text = normalizeText(input);
  if (/(装备|三件套|怎么带|带什么)/.test(text)) return false;
  if (/阵容/.test(text)) return true;
  if (/(?:版本|当前).{0,8}(?:趋势|上升|提升)/.test(text)) return true;
  return /(?:这|当前)?版本.{0,8}(?:玩什么|什么好玩|容易上分)/.test(text);
}

export function parseCompMetrics(input) {
  const text = normalizeText(input);
  const metrics = [];
  if (/(前四|稳|上分|稳定)/.test(text)) metrics.push("top4_rate");
  if (/(吃鸡份额|登顶份额|胜场份额)/.test(text)) metrics.push("win_share");
  if (/(登顶|吃鸡|第一)(?!份额)/.test(text)) metrics.push("win_rate");
  if (/(平均名次|均名)/.test(text)) metrics.push("avg_placement");
  if (/(热门|热度|最多人玩|选择率)/.test(text)) metrics.push("popularity");
  if (metrics.length === 0 && /(最强|阵容)/.test(text)) {
    metrics.push("top4_rate", "win_share");
  }
  return unique(metrics);
}

function parseLimit(input) {
  const text = normalizeText(input);
  const token = "(?:2[01]|1\\d|[1-9]|二十一|二十|十一|十二|十三|十四|十五|十六|十七|十八|十九|一|二|三|四|五|六|七|八|九|十)";
  const match = text.match(new RegExp(`(${token})套`))
    ?? text.match(new RegExp(`(${token})个(?:阵容)?`))
    ?? text.match(new RegExp(`前(${token})(?:个|名)`));
  const chinese = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17,
    十八: 18, 十九: 19, 二十: 20, 二十一: 21
  };
  const value = match ? Number(match[1]) || chinese[match[1]] : undefined;
  return Number.isInteger(value) ? Math.min(21, Math.max(1, value)) : undefined;
}

function parseMinSamples(input) {
  const normalized = normalizeText(input);
  if (/(?:移除|取消|关闭|不要|不设|不设置|去掉)(?:最低)?样本(?:下限|门槛|限制)|(?:无|没有)样本(?:下限|门槛|限制)|样本(?:不限|无下限)/.test(normalized)) {
    return 0;
  }
  const match = normalized.match(/样本(?:>=|大于等于|不少于|至少)?(\d{1,6})/);
  return match ? Number(match[1]) : undefined;
}

function parseDays(input) {
  const text = normalizeText(input);
  const match = text.match(/(?:近|最近)(\d{1,2}|一|二|三|两|七|十四|三十)天/);
  const chinese = { 一: 1, 二: 2, 两: 2, 三: 3, 七: 7, 十四: 14, 三十: 30 };
  const value = match ? Number(match[1]) || chinese[match[1]] : undefined;
  return Number.isInteger(value) ? value : undefined;
}

function parseRankFilter(input) {
  const text = normalizeText(input);
  const ranks = [
    ["黑铁", "IRON"], ["青铜", "BRONZE"], ["白银", "SILVER"], ["黄金", "GOLD"],
    ["铂金", "PLATINUM"], ["翡翠", "EMERALD"], ["钻石", "DIAMOND"], ["大师", "MASTER"],
    ["宗师", "GRANDMASTER"], ["王者", "CHALLENGER"]
  ];
  const order = ranks.map(([, apiName]) => apiName);
  const mentions = ranks.filter(([label]) => text.includes(label));
  if (!mentions.length) return undefined;
  const range = text.match(/(黑铁|青铜|白银|黄金|铂金|翡翠|钻石|大师|宗师|王者)(?:到|至|-)(黑铁|青铜|白银|黄金|铂金|翡翠|钻石|大师|宗师|王者)/);
  if (range) {
    const from = ranks.find(([label]) => label === range[1])?.[1];
    const to = ranks.find(([label]) => label === range[2])?.[1];
    const start = order.indexOf(from);
    const end = order.indexOf(to);
    return order.slice(Math.min(start, end), Math.max(start, end) + 1).reverse();
  }
  const [label, rank] = mentions[0];
  if (text.includes(`${label}以上`) || text.includes(`${label}及以上`)) {
    return order.slice(order.indexOf(rank)).reverse();
  }
  return text.includes(`只看${label}`) || text.includes(`仅看${label}`) ? [rank] : mentions.map(([, value]) => value);
}

export function buildCompRankingQuery(parsed = {}, options = {}) {
  const preferences = { ...DEFAULT_QUERY_OPTIONS, ...(options.preferences ?? {}) };
  const metrics = unique((parsed.metrics ?? []).filter((metric) => METRIC_SET.has(metric)));
  const trendRequested = Boolean(parsed.trendRequested);
  const intent = parsed.intent === "comp_trends" ? "comp_trends" : "comp_rankings";
  const popularRequested = Boolean(parsed.popularRequested);
  const defaultLimit = intent === "comp_rankings" && popularRequested ? 21 : 5;
  return {
    intent,
    metrics: metrics.length > 0 ? metrics : ["top4_rate", "win_share"],
    limit: Math.min(21, Math.max(1, Number(parsed.limit ?? defaultLimit))),
    minSamples: Math.max(0, Number(parsed.minSamples ?? options.minSamples ?? preferences.minSamples ?? 500)),
    days: Number(parsed.days ?? (trendRequested ? 3 : preferences.days) ?? 3),
    patch: String(parsed.patch ?? preferences.patch ?? "current"),
    queue: String(parsed.queue ?? preferences.queue ?? "1100"),
    rankFilter: [...(parsed.rankFilter ?? preferences.rankFilter ?? [])],
    specialMode: Boolean(parsed.specialMode),
    popularRequested,
    trendRequested,
    dataVersion: String(options.dataVersion ?? "metatft-comps-page-v1")
  };
}

export function parseCompRankingQuery(input, options = {}) {
  const text = normalizeText(input);
  const trendRequested = /(?:阵容|版本|当前).{0,8}(?:趋势|上升|提升)|(?:趋势|上升|提升).{0,8}阵容/u.test(text);
  return buildCompRankingQuery({
    ...options,
    metrics: parseCompMetrics(text),
    limit: parseLimit(text) ?? options.limit,
    minSamples: parseMinSamples(text) ?? options.minSamples,
    days: parseDays(text) ?? options.days,
    rankFilter: parseRankFilter(text) ?? options.rankFilter,
    popularRequested: /热门阵容|阵容热门|热门/.test(text),
    trendRequested,
    specialMode: /(专属强化|英雄强化|特殊玩法|赌狗|d牌|d卡|追三|reroll)/i.test(text)
      || Boolean(options.specialMode)
  }, options);
}

export function isCompRankingFollowUp(parsed, previousQuery) {
  if (!["comp_rankings", "comp_trends"].includes(previousQuery?.intent)) return false;
  if (parsed?.unit
    || (parsed?.ownedItems ?? []).length > 0
    || (parsed?.excludedItems ?? []).length > 0
    || (parsed?.traitFilters ?? []).length > 0
    || parsed?.parser?.comparison?.requested
    || (parsed?.parser?.unresolvedEntityHints ?? []).length > 0
    || (parsed?.parser?.entityAmbiguities ?? []).length > 0) return false;
  if (/(?:装备|英雄|纹章|效果|合成|配方)/u.test(parsed?.rawInput ?? "")) return false;
  if (["comp_rankings", "comp_trends"].includes(parsed?.intent)) return true;
  return ["rankFilter", "days", "patch", "minSamples", "sort"].some((key) => parsed?.[key] !== undefined)
    || /(?:呢|再看|换成|改成|如果|那)/u.test(parsed?.rawInput ?? "");
}
