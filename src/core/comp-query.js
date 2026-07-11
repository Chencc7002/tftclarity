import { DEFAULT_QUERY_OPTIONS } from "../data/static-data.js";
import { normalizeText } from "./normalizer.js";

export const COMP_METRICS = Object.freeze([
  "top4_rate",
  "win_rate",
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
  return /(?:这|当前)?版本.{0,8}(?:玩什么|什么好玩|容易上分)/.test(text);
}

export function parseCompMetrics(input) {
  const text = normalizeText(input);
  const metrics = [];
  if (/(前四|稳|上分|稳定)/.test(text)) metrics.push("top4_rate");
  if (/(登顶|吃鸡|第一)/.test(text)) metrics.push("win_rate");
  if (/(平均名次|均名)/.test(text)) metrics.push("avg_placement");
  if (/(热门|热度|最多人玩|选择率)/.test(text)) metrics.push("popularity");
  if (metrics.length === 0 && /(最强|阵容)/.test(text)) {
    metrics.push("top4_rate", "win_rate");
  }
  return unique(metrics);
}

function parseLimit(input) {
  const text = normalizeText(input);
  const match = text.match(/([1-9]|10|一|二|三|四|五|六|七|八|九|十)套/)
    ?? text.match(/前([1-9]|10|一|二|三|四|五|六|七|八|九|十)(?:个|名)/);
  const chinese = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const value = match ? Number(match[1]) || chinese[match[1]] : undefined;
  return Number.isInteger(value) ? Math.min(10, Math.max(1, value)) : undefined;
}

function parseMinSamples(input) {
  const match = normalizeText(input).match(/样本(?:>=|大于等于|不少于|至少)?(\d{1,6})/);
  return match ? Number(match[1]) : undefined;
}

export function buildCompRankingQuery(parsed = {}, options = {}) {
  const preferences = { ...DEFAULT_QUERY_OPTIONS, ...(options.preferences ?? {}) };
  const metrics = unique((parsed.metrics ?? []).filter((metric) => METRIC_SET.has(metric)));
  return {
    intent: "comp_rankings",
    metrics: metrics.length > 0 ? metrics : ["top4_rate", "win_rate"],
    limit: Math.min(10, Math.max(1, Number(parsed.limit ?? 3))),
    minSamples: Math.max(1, Number(parsed.minSamples ?? options.minSamples ?? preferences.minSamples ?? 500)),
    days: Number(parsed.days ?? preferences.days ?? 3),
    patch: String(parsed.patch ?? preferences.patch ?? "current"),
    queue: String(parsed.queue ?? preferences.queue ?? "1100"),
    rankFilter: [...(parsed.rankFilter ?? preferences.rankFilter ?? [])],
    specialMode: Boolean(parsed.specialMode),
    dataVersion: String(options.dataVersion ?? "exact-units-traits2-v1")
  };
}

export function parseCompRankingQuery(input, options = {}) {
  const text = normalizeText(input);
  return buildCompRankingQuery({
    ...options,
    metrics: parseCompMetrics(text),
    limit: parseLimit(text) ?? options.limit,
    minSamples: parseMinSamples(text) ?? options.minSamples,
    specialMode: /(专属强化|英雄强化|特殊玩法|赌狗|d牌|d卡|追三|reroll)/i.test(text)
      || Boolean(options.specialMode)
  }, options);
}
