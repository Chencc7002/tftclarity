import { DEFAULT_QUERY_OPTIONS, createCatalog } from "../data/static-data.js";
import { normalizeCompsData } from "../data/metatft-response-adapter.js";

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(/[&,]\s*|\s*,\s*/).map((part) => part.trim()).filter(Boolean);
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rate(value) {
  const number = finite(value);
  if (number == null) return null;
  return number > 1 ? number / 100 : number;
}

function optionRecord(option = {}, catalog) {
  const clusterId = String(option.cluster ?? option.Cluster ?? option.cluster_id ?? option.clusterId ?? "");
  const units = asList(option.units_list ?? option.units ?? option.units_string);
  const traits = asList(option.traits_list ?? option.traits ?? option.traits_string);
  return {
    clusterId,
    name: option.comp_name ?? option.name_string ?? option.name ?? (clusterId ? `cluster ${clusterId}` : "未命名阵容"),
    units,
    unitNames: units.map((apiName) => catalog.unitByApiName.get(apiName)?.zhName ?? apiName),
    traits,
    traitNames: traits.map((filterId) => {
      const record = catalog.traitByFilterId.get(filterId) ?? catalog.traitByApiName.get(String(filterId).replace(/_[0-9]+$/, ""));
      return record?.displayName ?? record?.zhName ?? filterId;
    }),
    games: finite(option.count ?? option.games, 0),
    score: finite(option.score ?? option.adjusted_score, null),
    avg: finite(option.avg ?? option.average, null),
    top4Rate: rate(option.top4Rate ?? option.top4_rate ?? option.top_four_rate ?? option.top4 ?? option.top_four),
    winRate: rate(
      option.winRate
      ?? option.win_rate
      ?? option.firstRate
      ?? option.first_rate
      ?? option.top1Rate
      ?? option.top1_rate
    )
  };
}

function compareComps(sort, a, b) {
  if (sort === "top4_first" && a.top4Rate != null && b.top4Rate != null && a.top4Rate !== b.top4Rate) {
    return b.top4Rate - a.top4Rate;
  }
  if (sort === "win_first") {
    if (a.winRate != null && b.winRate != null && a.winRate !== b.winRate) return b.winRate - a.winRate;
    if (a.winRate != null || b.winRate != null) return a.winRate == null ? 1 : -1;
    if (b.games !== a.games) return b.games - a.games;
    if (a.avg != null && b.avg != null && a.avg !== b.avg) return a.avg - b.avg;
    return a.name.localeCompare(b.name, "zh-CN");
  }
  if (sort === "robust_first" && b.games !== a.games) return b.games - a.games;
  if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
  if (b.games !== a.games) return b.games - a.games;
  if (a.avg != null && b.avg != null && a.avg !== b.avg) return a.avg - b.avg;
  return a.name.localeCompare(b.name, "zh-CN");
}

function sourceOf(parsed, previousQuery, preferences, key) {
  if (parsed?.[key] !== undefined) return "current_input";
  if (["comp_rankings", "comp_trends"].includes(previousQuery?.intent) && previousQuery?.[key] !== undefined) return "conversation";
  return Object.hasOwn(preferences ?? {}, key) ? "preference" : "system_default";
}

function inheritedValue(parsed, previousQuery, preferences, key, fallback) {
  if (parsed?.[key] !== undefined) return parsed[key];
  if (["comp_rankings", "comp_trends"].includes(previousQuery?.intent) && previousQuery?.[key] !== undefined) return previousQuery[key];
  if (Object.hasOwn(preferences ?? {}, key)) return preferences[key];
  return fallback;
}

export function hasUnsupportedCompRankingEntities(parsed) {
  return Boolean(
    parsed?.unit
    || (parsed?.ownedItems ?? []).length
    || (parsed?.comparisonItems ?? []).length
    || parsed?.parser?.comparison?.requested
    || (parsed?.excludedItems ?? []).length
    || (parsed?.traitFilters ?? []).length
    || parsed?.parser?.genericEmblemRequested
    || (parsed?.parser?.unresolvedEntityHints ?? []).length
    || (parsed?.parser?.entityAmbiguities ?? []).length
  );
}

export function isCompRankingFollowUp(parsed, previousQuery) {
  if (hasUnsupportedCompRankingEntities(parsed)) return false;
  if (["comp_rankings", "comp_trends"].includes(parsed?.intent)) return true;
  if (!["comp_rankings", "comp_trends"].includes(previousQuery?.intent)) return false;
  if (/(?:装备|英雄|纹章|效果|合成|配方)/u.test(parsed?.rawInput ?? "")) return false;
  return ["rankFilter", "days", "patch", "minSamples", "sort"].some((key) => parsed?.[key] !== undefined)
    || /(?:呢|再看|换成|改成|如果|那)/u.test(parsed?.rawInput ?? "");
}

export function buildCompRankings(parsed, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const preferences = options.explicitPreferences ?? options.preferences ?? {};
  const previousQuery = ["comp_rankings", "comp_trends"].includes(options.previousQuery?.intent) ? options.previousQuery : null;
  const query = {
    intent: parsed?.intent === "comp_trends" ? "comp_trends" : "comp_rankings",
    rankFilter: inheritedValue(parsed, previousQuery, preferences, "rankFilter", DEFAULT_QUERY_OPTIONS.rankFilter),
    days: inheritedValue(parsed, previousQuery, preferences, "days", DEFAULT_QUERY_OPTIONS.days),
    patch: inheritedValue(parsed, previousQuery, preferences, "patch", DEFAULT_QUERY_OPTIONS.patch),
    queue: inheritedValue(parsed, previousQuery, preferences, "queue", DEFAULT_QUERY_OPTIONS.queue),
    minSamples: inheritedValue(parsed, previousQuery, preferences, "minSamples", DEFAULT_QUERY_OPTIONS.minSamples),
    sort: inheritedValue(parsed, previousQuery, preferences, "sort", DEFAULT_QUERY_OPTIONS.sort),
    limit: previousQuery?.limit ?? options.limit ?? 5
  };
  query.constraintSources = Object.fromEntries(
    ["rankFilter", "days", "patch", "queue", "minSamples", "sort"]
      .map((key) => [key, sourceOf(parsed, previousQuery, preferences, key)])
  );

  const normalized = normalizeCompsData(options.compsData ?? {});
  const byCluster = new Map();
  for (const option of normalized.compOptions) {
    const record = optionRecord(option, catalog);
    if (!record.clusterId || record.games < query.minSamples) continue;
    const existing = byCluster.get(record.clusterId);
    if (!existing || compareComps(query.sort, record, existing) < 0) byCluster.set(record.clusterId, record);
  }
  const rankedComps = [...byCluster.values()]
    .sort((a, b) => compareComps(query.sort, a, b));
  const comps = rankedComps.slice(0, query.limit);
  const inheritedKeys = previousQuery
    ? Object.entries(query.constraintSources).filter(([, source]) => source === "conversation").map(([key]) => key)
    : [];
  const warnings = [
    "MetaTFT /comps 当前不支持按段位或天数筛选；这些条件会保留在会话中，但本榜单仍使用 /comps 的当前版本口径。"
  ];
  if (query.sort === "win_first" && !rankedComps.some((comp) => comp.winRate != null)) {
    warnings.push("当前 /comps 响应未提供吃鸡率，无法按吃鸡率排序；结果仅按样本量稳定展示，不作吃鸡优先结论。");
  }
  const summary = comps.length
    ? `当前版本热门阵容首选：${comps[0].name}。`
    : "当前条件下没有达到样本门槛的阵容。";

  return {
    ok: true,
    type: query.intent,
    text: `${summary}\n${warnings.join("\n")}`,
    answer: { summary, warnings },
    query: {
      ...query,
      warnings,
      sessionContext: {
        inherited: inheritedKeys.length > 0,
        inheritedKeys
      }
    },
    comps,
    source: {
      provider: "MetaTFT",
      endpoint: "tft-comps-api/comp_options",
      rankFiltered: false,
      daysFiltered: false,
      winRateAvailable: rankedComps.some((comp) => comp.winRate != null)
    }
  };
}
