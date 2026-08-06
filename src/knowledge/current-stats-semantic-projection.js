export const CURRENT_STATS_SEMANTIC_PROJECTION_VERSION = "current_stats_semantic_projection.v1";

export const DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG = Object.freeze({
  avgPlacementDecimals: 2,
  ratePercentageDecimals: 1,
  rankingChangeThreshold: 2,
  criticalRankBoundaries: Object.freeze([])
});

function integer(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function boundaries(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return [...new Set(entries
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .map((entry) => integer(entry, "criticalRankBoundaries entry", 1, 10000)))]
    .sort((left, right) => left - right);
}

export function resolveCurrentStatsSemanticConfig(options = {}, env = process.env) {
  return Object.freeze({
    avgPlacementDecimals: integer(
      options.avgPlacementDecimals
        ?? env.CURRENT_STATS_AVG_PLACEMENT_DECIMALS
        ?? DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG.avgPlacementDecimals,
      "avgPlacementDecimals",
      0,
      6
    ),
    ratePercentageDecimals: integer(
      options.ratePercentageDecimals
        ?? env.CURRENT_STATS_RATE_PERCENTAGE_DECIMALS
        ?? DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG.ratePercentageDecimals,
      "ratePercentageDecimals",
      0,
      6
    ),
    rankingChangeThreshold: integer(
      options.rankingChangeThreshold
        ?? env.CURRENT_STATS_RANK_CHANGE_THRESHOLD
        ?? DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG.rankingChangeThreshold,
      "rankingChangeThreshold",
      1,
      10000
    ),
    criticalRankBoundaries: Object.freeze(boundaries(
      options.criticalRankBoundaries
        ?? env.CURRENT_STATS_CRITICAL_RANK_BOUNDARIES
        ?? DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG.criticalRankBoundaries
    ))
  });
}

export function semanticAveragePlacement(value, config = DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(config.avgPlacementDecimals) : null;
}

export function semanticPercentage(value, config = DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `${(number * 100).toFixed(config.ratePercentageDecimals)}%`
    : null;
}

function crossedCriticalBoundary(previousRank, nextRank, configuredBoundaries) {
  return configuredBoundaries.some((boundary) => (
    (previousRank <= boundary && nextRank > boundary)
    || (previousRank > boundary && nextRank <= boundary)
  ));
}

function rankedList(value) {
  return Array.isArray(value)
    && value.every((entry) => (
      entry
      && typeof entry === "object"
      && !Array.isArray(entry)
      && String(entry.entityId ?? "").trim()
      && Number.isInteger(Number(entry.rank))
    ));
}

function stabilizeNode(next, previous, config) {
  if (Array.isArray(next)) {
    if (!rankedList(next) || !rankedList(previous)) return next;
    const previousById = new Map(previous.map((entry) => [String(entry.entityId), entry]));
    const sameEntities = next.length === previous.length
      && next.every((entry) => previousById.has(String(entry.entityId)));
    const hasSignificantMove = !sameEntities || next.some((entry) => {
      const prior = previousById.get(String(entry.entityId));
      if (!prior) return true;
      const nextRank = Number(entry.rank);
      const previousRank = Number(prior.rank);
      const significant = Math.abs(nextRank - previousRank) >= config.rankingChangeThreshold;
      const critical = crossedCriticalBoundary(
        previousRank,
        nextRank,
        config.criticalRankBoundaries
      );
      return significant || critical;
    });
    if (hasSignificantMove) return next;
    return next.map((entry) => {
      const prior = previousById.get(String(entry.entityId));
      return { ...entry, rank: Number(prior.rank) };
    }).sort((left, right) => (
      Number(left.rank) - Number(right.rank)
      || String(left.entityId).localeCompare(String(right.entityId))
    ));
  }
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;
  const output = {};
  for (const [key, value] of Object.entries(next)) {
    output[key] = stabilizeNode(value, previous?.[key], config);
  }
  return output;
}

export function stabilizeCurrentStatsSemanticProjection(
  next,
  previous,
  options = {}
) {
  const config = resolveCurrentStatsSemanticConfig(options);
  if (
    !previous
    || previous.schemaVersion !== CURRENT_STATS_SEMANTIC_PROJECTION_VERSION
    || next?.schemaVersion !== CURRENT_STATS_SEMANTIC_PROJECTION_VERSION
    || previous.documentType !== next.documentType
  ) {
    return next;
  }
  return stabilizeNode(next, previous, config);
}

function scopeDescription(scope = {}) {
  return `赛季 ${scope.season}、补丁 ${scope.patch}、段位 ${scope.rank}、时间窗口 ${scope.timeWindow}、区域 ${scope.region}`;
}

function metric(value) {
  return value ?? "暂无";
}

function classificationText(value) {
  return value ? `样本可靠性/风险等级为 ${value}。` : "";
}

function renderUnit(projection) {
  const stars = projection.stars.map((star) => (
    `${star.starLevel} 星平均 ${metric(star.metrics.avgPlacement)}、前四 ${metric(star.metrics.top4Rate)}、登顶 ${metric(star.metrics.winRate)}`
  )).join("；");
  return [
    `MetaTFT 英雄统计，范围为${scopeDescription(projection.scope)}。`,
    `${projection.entity.name}（${projection.entity.id}）平均名次 ${metric(projection.metrics.avgPlacement)}，前四率 ${metric(projection.metrics.top4Rate)}，登顶率 ${metric(projection.metrics.winRate)}。`,
    classificationText(projection.sampleClassification),
    stars ? `星级拆分：${stars}。` : "",
    "这些指标是指定范围内的统计快照，不代表脱离该范围后的表现。"
  ].filter(Boolean).join("");
}

function renderCoreBuilds(builds) {
  return builds.map((build) => (
    `${build.unitName ?? build.unitId}：${build.items.map((item) => item.name ?? item.id).join("、")}`
  )).join("；");
}

function renderComp(projection) {
  const coreBuilds = renderCoreBuilds(projection.coreBuilds);
  return [
    `MetaTFT 阵容统计，范围为${scopeDescription(projection.scope)}。`,
    `${projection.entity.name} 的平均名次 ${metric(projection.metrics.avgPlacement)}，前四率 ${metric(projection.metrics.top4Rate)}，登顶率 ${metric(projection.metrics.winRate)}，选择率 ${metric(projection.metrics.selectionRate)}。`,
    projection.units.length ? `主要棋子包括：${projection.units.map((unit) => unit.name).join("、")}。` : "",
    projection.traits.length ? `主要羁绊包括：${projection.traits.map((trait) => trait.name).join("、")}。` : "",
    coreBuilds ? `核心装备组合：${coreBuilds}。` : "",
    classificationText(projection.sampleClassification),
    projection.contestRisk === "high" ? "该阵容在当前范围内存在较高同行竞争风险。" : "",
    projection.trendDirection ? `当前趋势方向为 ${projection.trendDirection}。` : "",
    "该结论仅适用于文档标记的补丁、段位、时间窗口和区域。"
  ].filter(Boolean).join("");
}

function renderTrendList(values, direction) {
  return values.map((entry) => (
    `第 ${entry.rank} 位 ${entry.name}（平均名次变化 ${metric(entry.avgPlacementChange)}，${direction}）`
  )).join("；");
}

function renderTrend(projection) {
  return [
    `MetaTFT 阵容趋势快照，范围为${scopeDescription(projection.scope)}。`,
    projection.rising.length
      ? `近期上升阵容：${renderTrendList(projection.rising, "正在上升")}。`
      : "当前上游数据没有可验证的上升阵容。",
    projection.falling.length
      ? `近期变弱阵容：${renderTrendList(projection.falling, "正在变弱")}。`
      : "当前上游数据没有可验证的变弱阵容。",
    "平均名次变化为负表示表现改善，为正表示表现走弱；趋势结论只适用于文档标记的数据范围。",
    "精确实时排名和固定条件查询仍以本轮 MetaTFT 结构化 QueryResult 为第一权威。"
  ].join("");
}

function renderMeta(projection) {
  const topSummary = projection.topComps.length
    ? projection.topComps.map((comp) => (
        `第 ${comp.rank} 位 ${comp.name}（前四 ${metric(comp.top4Rate)}${comp.units?.length ? `，主要棋子 ${comp.units.map((unit) => unit.name).join("、")}` : ""}）`
      )).join("；")
    : "当前没有可用的阵容榜统计";
  return [
    `MetaTFT 当前环境统计概览，范围为${scopeDescription(projection.scope)}。`,
    `本快照包含 ${projection.documentCounts.units} 个英雄统计文档和 ${projection.documentCounts.comps} 个阵容统计文档。`,
    `当前代表性阵容包括：${topSummary}。`,
    classificationText(projection.sampleClassification),
    "该概览用于环境摘要和宽泛上下文；精确装备或固定条件查询仍应以本轮实时结构化 QueryResult 为第一权威。"
  ].filter(Boolean).join("");
}

export function renderCurrentStatsSemanticProjection(projection) {
  if (!projection || projection.schemaVersion !== CURRENT_STATS_SEMANTIC_PROJECTION_VERSION) {
    throw new TypeError("Invalid current_stats semanticProjection");
  }
  if (projection.documentType === "unit_stats") return renderUnit(projection);
  if (projection.documentType === "comp_stats") return renderComp(projection);
  if (projection.documentType === "trend_snapshot") return renderTrend(projection);
  if (projection.documentType === "meta_snapshot") return renderMeta(projection);
  throw new TypeError(`Unsupported current_stats semantic projection type: ${projection.documentType}`);
}
