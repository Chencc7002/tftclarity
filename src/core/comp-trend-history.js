import {
  normalizeCompsPageDataResponse,
  normalizeCompsStatsResponse
} from "../data/comp-response-adapter.js";
import { inspectOfficialCompTrendGate } from "./official-comp-trend-gate.js";

export const COMP_TREND_WINDOW_MS = 72 * 60 * 60 * 1000;
export const COMP_TREND_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const COMP_TREND_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nowMs(options, cacheStore) {
  if (typeof options.now === "function") return Number(options.now());
  if (Number.isFinite(Number(options.now))) return Number(options.now);
  if (typeof cacheStore?.now === "function") return Number(cacheStore.now());
  return Date.now();
}

export function makeCompTrendHistoryKey(query = {}) {
  const scope = {
    seasonContextId: String(query.seasonContextId ?? "set17-live"),
    providerVersion: query.providerVersion ?? null,
    queue: String(query.queue ?? "1100"),
    days: Number(query.days ?? 3),
    rank: [...(query.rankFilter ?? query.rank ?? [])].map(String).sort(),
    dataVersion: query.dataVersion ?? null
  };
  return `comp_trend:${JSON.stringify(scope)}`;
}

function makeLegacyCompTrendHistoryKey(query = {}) {
  const scope = {
    seasonContextId: String(query.seasonContextId ?? "set17-live"),
    providerVersion: query.providerVersion ?? null,
    effectivePatch: String(query.effectivePatch ?? query.patch ?? "current"),
    queue: String(query.queue ?? "1100"),
    patch: String(query.patch ?? "current"),
    days: Number(query.days ?? 3),
    rank: [...(query.rankFilter ?? query.rank ?? [])].map(String).sort(),
    dataVersion: query.dataVersion ?? null
  };
  return `comp_trend:${JSON.stringify(scope)}`;
}

function responseParts(response) {
  return {
    data: response?.compsData ?? response?.data,
    stats: response?.compsStats ?? response?.stats
  };
}

function currentSnapshot(response, capturedAt, query = {}) {
  const parts = responseParts(response);
  const data = normalizeCompsPageDataResponse(parts.data);
  const stats = normalizeCompsStatsResponse(parts.stats);
  return {
    capturedAt,
    effectivePatch: query.effectivePatch ?? query.patch ?? null,
    clusterId: stats.clusterId || data.clusterId || null,
    rows: Object.fromEntries(stats.rows.map((row) => [row.clusterId, {
      avgPlacement: row.stats.avgPlacement,
      top4Rate: row.stats.top4Rate,
      winRate: row.stats.winRate,
      pickRate: row.stats.pickRate,
      games: row.stats.games
    }]))
  };
}

function officialTrendCount(response) {
  const definitions = normalizeCompsPageDataResponse(responseParts(response).data).definitions;
  return definitions.filter((definition) => Number.isFinite(definition.avgPlacementChange)
    && definition.trendSource !== "local_72h").length;
}

function ensureTrendRows(response) {
  const data = response?.compsData?.results?.data;
  if (!data) return null;
  if (!data.comps || typeof data.comps !== "object" || Array.isArray(data.comps)) data.comps = {};
  return data.comps;
}

function selectBaseline(snapshots, current, cutoffMs) {
  const sameCluster = snapshots.filter((snapshot) => snapshot.clusterId === current.clusterId);
  const previousPatch = current.effectivePatch
    ? sameCluster.filter((snapshot) => snapshot.effectivePatch
      && snapshot.effectivePatch !== current.effectivePatch)
    : [];
  const eligible = previousPatch.length
    ? previousPatch
    : sameCluster.filter((snapshot) => Date.parse(snapshot.capturedAt) <= cutoffMs);
  return eligible
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0] ?? null;
}

function delta(current, baseline) {
  const left = finite(current);
  const right = finite(baseline);
  return left === null || right === null ? null : left - right;
}

function buildComparisons(current, baseline) {
  if (!baseline) return {};
  const comparisons = {};
  for (const [clusterId, currentRow] of Object.entries(current.rows ?? {})) {
    const baselineRow = baseline.rows?.[clusterId];
    if (!baselineRow) continue;
    const metrics = {
      avgPlaceDelta: delta(currentRow.avgPlacement, baselineRow.avgPlacement),
      top4RateDelta: delta(currentRow.top4Rate, baselineRow.top4Rate),
      winRateDelta: delta(currentRow.winRate, baselineRow.winRate),
      pickRateDelta: delta(currentRow.pickRate, baselineRow.pickRate),
      sampleSizeDelta: delta(currentRow.games, baselineRow.games)
    };
    const available = Object.values(metrics).filter((value) => value !== null).length;
    comparisons[clusterId] = {
      currentPatch: current.effectivePatch ?? null,
      baselinePatch: baseline.effectivePatch ?? null,
      baselineCapturedAt: baseline.capturedAt,
      metrics,
      patchChanges: [],
      evidenceStatus: available === 5 ? "complete" : available > 0 ? "partial" : "unavailable"
    };
  }
  return comparisons;
}

export async function enrichCompResponseWithTrendHistory(response, options = {}) {
  const cacheStore = options.cacheStore;
  const cloned = clone(response);
  const currentTime = nowMs(options, cacheStore);
  const capturedAt = new Date(currentTime).toISOString();
  const key = makeCompTrendHistoryKey(options.query);
  const storeOptions = {
    seasonContextId: options.query?.seasonContextId ?? options.seasonContextId ?? "set17-live"
  };
  const canPersist = typeof cacheStore?.getCompTrendHistory === "function"
    && typeof cacheStore?.setCompTrendHistory === "function";
  const officialGate = cloned.officialTrendGate
    ?? inspectOfficialCompTrendGate(responseParts(cloned).data);
  cloned.officialTrendGate = officialGate;
  const officialCount = officialTrendCount(cloned);

  if (!canPersist) {
    cloned.trend = {
      status: officialCount > 0 ? "upstream" : "unavailable",
      source: officialCount > 0 ? "metatft" : null,
      windowHours: 72,
      threshold: 0.1,
      officialCount,
      localCount: 0,
      officialGate
    };
    return cloned;
  }

  let stored = await cacheStore.getCompTrendHistory(key, storeOptions);
  if (!stored?.value) {
    const legacyKey = makeLegacyCompTrendHistoryKey(options.query);
    if (legacyKey !== key) stored = await cacheStore.getCompTrendHistory(legacyKey, storeOptions);
  }
  const history = stored?.value && typeof stored.value === "object"
    ? stored.value
    : { version: 1, snapshots: [] };
  const current = currentSnapshot(cloned, capturedAt, options.query);
  const retained = (Array.isArray(history.snapshots) ? history.snapshots : [])
    .filter((snapshot) => Number.isFinite(Date.parse(snapshot.capturedAt))
      && Date.parse(snapshot.capturedAt) >= currentTime - COMP_TREND_RETENTION_MS);
  const baseline = selectBaseline(retained, current, currentTime - COMP_TREND_WINDOW_MS);
  const comparisons = buildComparisons(current, baseline);
  const trendRows = ensureTrendRows(cloned);
  let localCount = 0;

  if (baseline && trendRows) {
    for (const [clusterId, currentRow] of Object.entries(current.rows)) {
      const previousRow = baseline.rows?.[clusterId];
      const currentAvg = finite(currentRow?.avgPlacement);
      const previousAvg = finite(previousRow?.avgPlacement);
      const existing = trendRows[clusterId];
      const existingChange = finite(existing?.["Average Placement Change"]
        ?? existing?.average_placement_change
        ?? existing?.placement_change);
      if (existingChange !== null || currentAvg === null || previousAvg === null) continue;
      trendRows[clusterId] = {
        ...(existing && typeof existing === "object" ? existing : {}),
        "Average Placement Change": currentAvg - previousAvg,
        "Trend Source": "local_72h",
        "Compared At": baseline.capturedAt
      };
      localCount += 1;
    }
  }

  const last = retained.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt)).at(-1);
  const shouldRecord = options.recordSnapshot !== false
    && current.clusterId
    && (!last
      || last.clusterId !== current.clusterId
      || currentTime - Date.parse(last.capturedAt) >= COMP_TREND_SNAPSHOT_INTERVAL_MS);
  const snapshots = shouldRecord ? [...retained, current] : retained;
  await cacheStore.setCompTrendHistory(key, {
    version: 2,
    scopeKey: key,
    snapshots
  }, storeOptions);

  const first = snapshots
    .filter((snapshot) => snapshot.clusterId === current.clusterId)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))[0] ?? null;
  const status = officialCount > 0
    ? localCount > 0 ? "mixed" : "upstream"
    : localCount > 0 ? "local" : "warming";
  cloned.trend = {
    status,
    source: status === "upstream" ? "metatft" : status === "local" ? "local_72h" : status,
    windowHours: 72,
    threshold: 0.1,
    officialCount,
    localCount,
    comparedAt: baseline?.capturedAt ?? null,
    firstObservedAt: first?.capturedAt ?? null,
    readyAt: first ? new Date(Date.parse(first.capturedAt) + COMP_TREND_WINDOW_MS).toISOString() : null,
    comparisons,
    officialGate
  };
  return cloned;
}
