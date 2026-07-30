import {
  CURRENT_STATS_SCHEMA_VERSION,
  assertCurrentStatsKnowledgeDocument
} from "./knowledge-document-schema.js";
import {
  CURRENT_STATS_SEMANTIC_PROJECTION_VERSION,
  renderCurrentStatsSemanticProjection,
  resolveCurrentStatsSemanticConfig,
  semanticAveragePlacement,
  semanticPercentage
} from "./current-stats-semantic-projection.js";

const METATFT_SOURCE_URL = "https://www.metatft.com";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(values) {
  return [...new Set(array(values).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function idSegment(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]+/giu, "-")
    .replace(/^-+|-+$/gu, "") || "all";
}

function placementStats(value) {
  const places = array(value).slice(0, 8).map(Number);
  if (places.length !== 8 || places.some((entry) => !Number.isFinite(entry) || entry < 0)) return null;
  const games = places.reduce((sum, entry) => sum + entry, 0);
  if (!(games > 0)) return null;
  const top4 = places.slice(0, 4).reduce((sum, entry) => sum + entry, 0);
  const placementSum = places.reduce((sum, entry, index) => sum + entry * (index + 1), 0);
  return {
    games,
    avgPlacement: placementSum / games,
    top4Rate: top4 / games,
    winRate: places[0] / games,
    placementCount: places
  };
}

function aggregatePlacements(rows) {
  const placements = Array.from({ length: 8 }, () => 0);
  for (const row of rows) {
    array(row.placement_count ?? row.placementCount).slice(0, 8).forEach((value, index) => {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) placements[index] += number;
    });
  }
  return placementStats(placements);
}

function rankValue(value) {
  return compact(Array.isArray(value) ? value : String(value ?? "").split(","))
    .map((entry) => entry.toUpperCase())
    .sort()
    .join(",");
}

export function createCurrentStatsScope(value = {}) {
  const generatedAt = new Date(value.generatedAt ?? Date.now()).toISOString();
  const expiresAt = new Date(value.expiresAt ?? Date.parse(generatedAt) + 48 * 60 * 60 * 1000).toISOString();
  const days = Number(value.days ?? String(value.timeWindow ?? "").replace(/d$/iu, ""));
  const scope = {
    season: String(value.season ?? "").trim(),
    patch: String(value.patch ?? "").trim(),
    rank: rankValue(value.rank ?? value.rankFilter),
    timeWindow: String(value.timeWindow ?? (Number.isFinite(days) ? `${days}d` : "")).trim().toLowerCase(),
    region: String(value.region ?? "").trim().toLowerCase(),
    locale: String(value.locale ?? "zh-CN").trim(),
    generatedAt,
    expiresAt
  };
  for (const key of ["season", "patch", "rank", "timeWindow", "region"]) {
    if (!scope[key]) throw new TypeError(`Current stats scope requires ${key}`);
  }
  if (Date.parse(scope.expiresAt) <= Date.parse(scope.generatedAt)) {
    throw new RangeError("Current stats scope expiresAt must be after generatedAt");
  }
  return scope;
}

export function currentStatsScopeKey(scope) {
  return [
    scope.season,
    scope.patch,
    scope.rank,
    scope.timeWindow,
    scope.region
  ].map(idSegment).join(":");
}

function baseMetadata(scope, overrides = {}) {
  return {
    source: "metatft",
    sourceId: overrides.sourceId ?? null,
    sourceTitle: overrides.sourceTitle ?? "MetaTFT Current Statistics",
    season: scope.season,
    patch: scope.patch,
    rank: scope.rank,
    timeWindow: scope.timeWindow,
    region: scope.region,
    locale: scope.locale,
    topics: compact(overrides.topics),
    claimType: "statistics",
    conditions: [],
    sourceUrl: overrides.sourceUrl ?? METATFT_SOURCE_URL,
    generatedAt: scope.generatedAt,
    expiresAt: scope.expiresAt,
    trendSource: overrides.trendSource ?? null,
    comparedAt: overrides.comparedAt ?? null,
    rawData: overrides.rawData ?? null,
    semanticProjection: overrides.semanticProjection ?? null,
    semanticProjectionConfig: overrides.semanticProjectionConfig ?? null,
    namespace: "current_stats"
  };
}

function semanticScope(scope) {
  return {
    season: scope.season,
    patch: scope.patch,
    rank: scope.rank,
    timeWindow: scope.timeWindow,
    region: scope.region
  };
}

function semanticBase(documentType, scope) {
  return {
    schemaVersion: CURRENT_STATS_SEMANTIC_PROJECTION_VERSION,
    documentType,
    scope: semanticScope(scope)
  };
}

function plainData(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function sampleClassification(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value === true) return "low_sample";
  }
  return null;
}

function unitIdentity(value) {
  return {
    id: String(value?.apiName ?? value?.unitApiName ?? value?.unit ?? "").trim(),
    name: String(value?.name ?? value?.apiName ?? value?.unitApiName ?? value?.unit ?? "").trim()
  };
}

function itemIdentity(value) {
  if (typeof value === "string") return { id: value, name: value };
  return {
    id: String(value?.apiName ?? value?.id ?? value?.name ?? "").trim(),
    name: String(value?.name ?? value?.displayName ?? value?.apiName ?? value?.id ?? "").trim()
  };
}

function traitIdentity(value) {
  return {
    id: String(value?.filterId ?? value?.apiName ?? value?.name ?? "").trim(),
    name: String(value?.name ?? value?.filterId ?? value?.apiName ?? "").trim()
  };
}

function document(value) {
  return assertCurrentStatsKnowledgeDocument(value);
}

export function buildUnitStatsDocuments(unitsResponse, options = {}) {
  const scope = createCurrentStatsScope(options.scope);
  const semanticConfig = resolveCurrentStatsSemanticConfig(options.semanticConfig);
  const root = unitsResponse?.data ?? unitsResponse?.results?.data ?? unitsResponse;
  const groups = new Map();
  for (const row of array(root)) {
    const raw = String(row?.units_unique ?? row?.unit ?? "").trim();
    const match = raw.match(/^(.+)-(\d+)$/u);
    if (!match || !placementStats(row?.placement_count ?? row?.placementCount)) continue;
    const [, unitApiName, starText] = match;
    if (!/^TFT\d+_/u.test(unitApiName) || /PVE|Enemy|Minion|Summon|FakeUnit|Core/iu.test(unitApiName)) continue;
    if (!groups.has(unitApiName)) groups.set(unitApiName, []);
    groups.get(unitApiName).push({
      ...row,
      unitApiName,
      starLevel: Number(starText),
      stats: placementStats(row?.placement_count ?? row?.placementCount)
    });
  }
  const nameFor = options.unitName ?? ((apiName) => apiName.replace(/^TFT\d+_/u, ""));
  const scopeKey = currentStatsScopeKey(scope);
  return [...groups.entries()]
    .map(([unitApiName, rows]) => {
      const overall = aggregatePlacements(rows);
      if (!overall) return null;
      const name = String(nameFor(unitApiName) ?? unitApiName);
      const sortedRows = [...rows]
        .sort((left, right) => left.starLevel - right.starLevel)
      const classification = sampleClassification(
        ...sortedRows.map((row) => row.sampleReliability ?? row.sampleStatus ?? row.riskLevel),
        ...sortedRows.map((row) => row.lowSample)
      );
      const semanticProjection = {
        ...semanticBase("unit_stats", scope),
        entity: { id: unitApiName, name },
        metrics: {
          avgPlacement: semanticAveragePlacement(overall.avgPlacement, semanticConfig),
          top4Rate: semanticPercentage(overall.top4Rate, semanticConfig),
          winRate: semanticPercentage(overall.winRate, semanticConfig)
        },
        sampleClassification: classification,
        stars: sortedRows.map((row) => ({
          starLevel: row.starLevel,
          metrics: {
            avgPlacement: semanticAveragePlacement(row.stats.avgPlacement, semanticConfig),
            top4Rate: semanticPercentage(row.stats.top4Rate, semanticConfig),
            winRate: semanticPercentage(row.stats.winRate, semanticConfig)
          },
          sampleClassification: sampleClassification(
            row.sampleReliability,
            row.sampleStatus,
            row.riskLevel,
            row.lowSample
          )
        }))
      };
      return document({
        schemaVersion: "knowledge_document.v1",
        id: `metatft:${scopeKey}:unit_stats:${idSegment(unitApiName)}`,
        documentType: "unit_stats",
        title: `${name} · MetaTFT 当前统计`,
        text: renderCurrentStatsSemanticProjection(semanticProjection),
        metadata: baseMetadata(scope, {
          sourceId: unitApiName,
          sourceTitle: "MetaTFT Unit Statistics",
          topics: [name, unitApiName, "英雄统计", "前四率", "平均名次"],
          rawData: {
            unitApiName,
            name,
            overall: plainData(overall),
            stars: sortedRows.map((row) => ({
              starLevel: row.starLevel,
              stats: plainData(row.stats),
              source: plainData(row)
            }))
          },
          semanticProjection,
          semanticProjectionConfig: semanticConfig
        })
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildCompStatsDocuments(compRankingResult, options = {}) {
  const scope = createCurrentStatsScope(options.scope);
  const semanticConfig = resolveCurrentStatsSemanticConfig(options.semanticConfig);
  const scopeKey = currentStatsScopeKey(scope);
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Number(options.limit))
    : Number.POSITIVE_INFINITY;
  return array(compRankingResult?.candidates)
    .filter((comp) => comp?.compId && Number.isFinite(Number(comp?.stats?.games)))
    .sort((left, right) => Number(right.stats.games) - Number(left.stats.games))
    .slice(0, limit)
    .map((comp) => {
      const units = array(comp.units).map(unitIdentity).filter((unit) => unit.id || unit.name).slice(0, 10);
      const traits = array(comp.traits).map(traitIdentity).filter((trait) => trait.id || trait.name).slice(0, 8);
      const unitNames = compact(units.map((unit) => unit.name));
      const traitNames = compact(traits.map((trait) => trait.name));
      const name = String(comp.name ?? comp.compId);
      const classification = sampleClassification(
        comp.sampleReliability,
        comp.sampleStatus,
        comp.riskLevel,
        comp.lowSample
      );
      const coreBuilds = array(comp.coreBuilds).map((build) => ({
        unitId: String(build?.unitApiName ?? build?.unit ?? "").trim(),
        unitName: String(
          units.find((unit) => unit.id === String(build?.unitApiName ?? build?.unit ?? "").trim())?.name
          ?? build?.unitName
          ?? build?.unitApiName
          ?? build?.unit
          ?? ""
        ).trim(),
        items: array(build?.items).map(itemIdentity).filter((item) => item.id || item.name)
      })).filter((build) => build.unitId || build.unitName || build.items.length);
      const semanticProjection = {
        ...semanticBase("comp_stats", scope),
        entity: { id: String(comp.compId), name },
        metrics: {
          avgPlacement: semanticAveragePlacement(comp.stats.avgPlacement, semanticConfig),
          top4Rate: semanticPercentage(comp.stats.top4Rate, semanticConfig),
          winRate: semanticPercentage(comp.stats.winRate, semanticConfig),
          selectionRate: semanticPercentage(comp.stats.selectionRate, semanticConfig)
        },
        units,
        traits,
        coreBuilds,
        sampleClassification: classification,
        contestRisk: comp.contested ? "high" : null,
        trendDirection: String(comp?.trend?.direction ?? "").trim() || null
      };
      return document({
        schemaVersion: "knowledge_document.v1",
        id: `metatft:${scopeKey}:comp_stats:${idSegment(comp.compId)}`,
        documentType: "comp_stats",
        title: `${name} · MetaTFT 阵容统计`,
        text: renderCurrentStatsSemanticProjection(semanticProjection),
        metadata: baseMetadata(scope, {
          sourceId: comp.compId,
          sourceTitle: "MetaTFT Comp Statistics",
          topics: [name, comp.compId, ...unitNames, ...traitNames, "阵容统计"],
          rawData: plainData(comp),
          semanticProjection,
          semanticProjectionConfig: semanticConfig
        })
      });
    });
}

export function buildTrendSnapshotDocument(compRankingResult, options = {}) {
  const scope = createCurrentStatsScope(options.scope);
  const semanticConfig = resolveCurrentStatsSemanticConfig(options.semanticConfig);
  const scopeKey = currentStatsScopeKey(scope);
  const summarize = (values, direction) => array(values).slice(0, 8).map((comp, index) => ({
    entityId: String(comp?.compId ?? comp?.name ?? `unknown-${index + 1}`),
    name: String(comp?.name ?? comp?.compId ?? "未知阵容"),
    rank: index + 1,
    avgPlacementChange: semanticAveragePlacement(comp?.trend?.avgPlacementChange, semanticConfig),
    direction
  }));
  const rising = summarize(compRankingResult?.rising ?? compRankingResult?.improving, "rising");
  const falling = summarize(compRankingResult?.falling, "falling");
  const trendSource = compRankingResult?.trend?.source ?? "metatft";
  const comparedAtValue = compRankingResult?.trend?.officialGate?.comparedAt
    ?? compRankingResult?.source?.updatedAt
    ?? null;
  const comparedAtDate = comparedAtValue === null
    ? null
    : new Date(typeof comparedAtValue === "number" ? comparedAtValue : String(comparedAtValue));
  const comparedAt = comparedAtDate && Number.isFinite(comparedAtDate.getTime())
    ? comparedAtDate.toISOString()
    : null;
  const semanticProjection = {
    ...semanticBase("trend_snapshot", scope),
    rising,
    falling
  };
  return document({
    schemaVersion: "knowledge_document.v1",
    id: `metatft:${scopeKey}:trend_snapshot:overview`,
    documentType: "trend_snapshot",
    title: "MetaTFT 当前阵容趋势快照",
    text: renderCurrentStatsSemanticProjection(semanticProjection),
    metadata: baseMetadata(scope, {
      sourceId: `trend:${scopeKey}`,
      sourceTitle: "MetaTFT Comp Trend Snapshot",
      topics: [
        "阵容趋势",
        "上升阵容",
        "变弱阵容",
        ...rising.map((value) => value.name),
        ...falling.map((value) => value.name)
      ],
      sourceUrl: METATFT_SOURCE_URL,
      trendSource,
      comparedAt,
      rawData: {
        rising: plainData(compRankingResult?.rising ?? compRankingResult?.improving ?? []),
        falling: plainData(compRankingResult?.falling ?? []),
        trend: plainData(compRankingResult?.trend ?? null),
        source: plainData(compRankingResult?.source ?? null)
      },
      semanticProjection,
      semanticProjectionConfig: semanticConfig
    })
  });
}

export function buildMetaSnapshotDocument(value = {}, options = {}) {
  const scope = createCurrentStatsScope(options.scope);
  const semanticConfig = resolveCurrentStatsSemanticConfig(options.semanticConfig);
  const scopeKey = currentStatsScopeKey(scope);
  const totalRoot = value.totalResponse?.data
    ?? value.totalResponse?.results?.data
    ?? value.totalResponse;
  const totalStats = placementStats(array(totalRoot)?.[0]?.placement_count);
  const sampleSize = finite(value.totalResponse?.filter_adjustment?.sample_size)
    ?? totalStats?.games
    ?? finite(value.compRankingResult?.source?.sampleSize);
  const rankings = value.compRankingResult?.rankings ?? {};
  const topCompsSource = [
    rankings.top4Rate,
    rankings.avgPlacement,
    rankings.winRate,
    value.compRankingResult?.candidates
  ].find((entries) => array(entries).some((comp) => comp?.compId)) ?? [];
  const topComps = array(topCompsSource).filter((comp) => comp?.compId).slice(0, 5);
  const semanticProjection = {
    ...semanticBase("meta_snapshot", scope),
    documentCounts: {
      units: Number(value.unitDocumentCount ?? 0),
      comps: Number(value.compDocumentCount ?? 0)
    },
    sampleClassification: sampleClassification(
      value.sampleReliability,
      value.sampleStatus,
      value.riskLevel,
      value.lowSample,
      value.totalResponse?.sampleReliability,
      value.totalResponse?.sampleStatus,
      value.totalResponse?.riskLevel,
      value.totalResponse?.lowSample
    ),
    topComps: topComps.map((comp, index) => ({
      entityId: String(comp.compId),
      name: String(comp.name ?? comp.compId),
      rank: index + 1,
      top4Rate: semanticPercentage(comp?.stats?.top4Rate, semanticConfig),
      units: array(comp.units).map(unitIdentity).filter((unit) => unit.id || unit.name).slice(0, 10)
    }))
  };
  return document({
    schemaVersion: "knowledge_document.v1",
    id: `metatft:${scopeKey}:meta_snapshot:overview`,
    documentType: "meta_snapshot",
    title: "MetaTFT 当前环境概览",
    text: renderCurrentStatsSemanticProjection(semanticProjection),
    metadata: baseMetadata(scope, {
      sourceId: `overview:${scopeKey}`,
      sourceTitle: "MetaTFT Meta Overview",
      topics: ["MetaTFT", "环境概览", "热门阵容", "版本统计"],
      rawData: {
        sampleSize,
        totalStats: plainData(totalStats),
        totalResponse: plainData(value.totalResponse),
        topComps: plainData(topComps),
        unitDocumentCount: Number(value.unitDocumentCount ?? 0),
        compDocumentCount: Number(value.compDocumentCount ?? 0),
        source: plainData(value.compRankingResult?.source ?? null)
      },
      semanticProjection,
      semanticProjectionConfig: semanticConfig
    })
  });
}

export function generateCurrentStatsDocuments(value = {}, options = {}) {
  const scope = createCurrentStatsScope(options.scope);
  const semanticConfig = resolveCurrentStatsSemanticConfig(options.semanticConfig);
  const unitDocuments = buildUnitStatsDocuments(value.unitsResponse, {
    scope,
    unitName: options.unitName,
    semanticConfig
  });
  const compDocuments = buildCompStatsDocuments(value.compRankingResult, {
    scope,
    limit: options.compLimit,
    semanticConfig
  });
  const metaDocument = buildMetaSnapshotDocument({
    totalResponse: value.totalResponse,
    compRankingResult: value.compRankingResult,
    unitDocumentCount: unitDocuments.length,
    compDocumentCount: compDocuments.length
  }, { scope, semanticConfig });
  const trendDocument = buildTrendSnapshotDocument(value.compRankingResult, {
    scope,
    semanticConfig
  });
  return {
    schemaVersion: CURRENT_STATS_SCHEMA_VERSION,
    scope,
    documents: [metaDocument, trendDocument, ...unitDocuments, ...compDocuments],
    countsByType: {
      meta_snapshot: 1,
      trend_snapshot: 1,
      unit_stats: unitDocuments.length,
      comp_stats: compDocuments.length
    }
  };
}
