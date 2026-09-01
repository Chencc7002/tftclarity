import { createHash, randomUUID } from "node:crypto";

import { createLineupSignature } from "../core/comp-enrichment.js";
import { METATFT_DEFAULT_MIN_PLAYRATE, buildCompRankings } from "../core/comp-ranking-service.js";
import {
  normalizeCompsPageDataResponse,
  normalizeCompsStatsResponse
} from "../data/comp-response-adapter.js";

export const RANK_BUCKET_SCHEMA_VERSION = "tft-rank-buckets-v1";
export const CANONICAL_COMP_KEY_VERSION = "metatft-comp-canonical-v1";
export const LIVE_COHORTS = Object.freeze([
  {
    code: "BELOW_DIAMOND",
    rankFilter: ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD"]
  },
  {
    code: "DIAMOND_PLUS",
    rankFilter: ["DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
  },
  {
    code: "MASTER_PLUS",
    rankFilter: ["MASTER", "GRANDMASTER", "CHALLENGER"]
  }
]);
export const DEFAULT_SNAPSHOT_STREAMS = Object.freeze([
  ...LIVE_COHORTS.map((cohort) => ({
    ...cohort,
    environment: "LIVE",
    queue: "1100",
    region: "global",
    patch: null
  })),
  {
    code: "ALL_RANKS",
    rankFilter: null,
    environment: "PBE",
    queue: "PBE",
    region: "pbe",
    patch: null
  }
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sortedUnique(values) {
  return [...new Set(array(values).map(String).map((value) => value.trim()).filter(Boolean))].sort();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stablePayloadHash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function createCanonicalSnapshotCompKey(definition = {}) {
  const canonical = {
    version: CANONICAL_COMP_KEY_VERSION,
    units: sortedUnique(definition.units),
    traits: sortedUnique(definition.traits),
    threeStarUnits: sortedUnique(definition.threeStarUnits),
    fourStarUnits: sortedUnique(definition.fourStarUnits)
  };
  return {
    value: `sha256:${stablePayloadHash(canonical)}`,
    version: CANONICAL_COMP_KEY_VERSION
  };
}

function sourceTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function rankFilterFromResponse(response) {
  const value = response?.filter_adjustment?.rank_filter;
  if (Array.isArray(value)) return sortedUnique(value);
  return sortedUnique(String(value ?? "").split(","));
}

function sameValues(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function validateRankContract(stream, statsResponse) {
  const adjustment = statsResponse?.filter_adjustment ?? null;
  if (stream.environment === "PBE") {
    const actual = rankFilterFromResponse(statsResponse);
    if (actual.length) {
      throw fail("PBE_RANK_FILTER_PRESENT", "PBE response unexpectedly contains a rank filter", { actual });
    }
    return;
  }
  if (!adjustment) {
    throw fail("RANK_FILTER_UNCONFIRMED", `MetaTFT did not confirm ${stream.code} rank filter`);
  }
  if (adjustment.override_applied === true) {
    throw fail("RANK_FILTER_OVERRIDDEN", `MetaTFT overrode ${stream.code} rank filter`, { adjustment });
  }
  const actual = rankFilterFromResponse(statsResponse);
  if (!sameValues(actual, stream.rankFilter)) {
    throw fail("RANK_FILTER_MISMATCH", `MetaTFT returned a different rank filter for ${stream.code}`, {
      expected: sortedUnique(stream.rankFilter),
      actual
    });
  }
}

function validateMetric(name, value, predicate) {
  if (!Number.isFinite(value) || !predicate(value)) {
    throw fail("INVALID_FIELD", `${name} is outside its valid range`, { field: name, value });
  }
  return value;
}

function rawRowByCluster(statsResponse) {
  return new Map(array(statsResponse?.results ?? statsResponse?.data?.results)
    .map((row) => [String(row?.cluster ?? row?.DB_Cluster ?? ""), row])
    .filter(([clusterId]) => clusterId && clusterId !== "-1"));
}

export function normalizeSnapshotStream({
  compsData,
  compsStats,
  stream,
  capturedAt,
  capturedDate,
  snapshotBatchId,
  minPlayrate = METATFT_DEFAULT_MIN_PLAYRATE
}) {
  validateRankContract(stream, compsStats);
  const data = normalizeCompsPageDataResponse(compsData);
  const stats = normalizeCompsStatsResponse(compsStats);
  if (!data.clusterId || !stats.clusterId || data.clusterId !== stats.clusterId) {
    throw fail("CLUSTER_MISMATCH", "MetaTFT comps_data and comps_stats cluster ids do not match", {
      dataClusterId: data.clusterId || null,
      statsClusterId: stats.clusterId || null
    });
  }
  const tftSet = String(data.tftSet ?? compsStats?.tft_set ?? "").trim();
  if (!/^TFTSet\d+$/u.test(tftSet)) {
    throw fail("INVALID_SET", "MetaTFT did not return a valid TFT set", { tftSet });
  }
  if (stream.environment === "LIVE" && tftSet !== "TFTSet17") {
    throw fail("SET_MISMATCH", `LIVE expected TFTSet17 but received ${tftSet}`);
  }
  if (stream.environment === "PBE" && tftSet !== "TFTSet18") {
    throw fail("SET_MISMATCH", `PBE expected TFTSet18 but received ${tftSet}`);
  }

  const query = {
    intent: "comp_rankings",
    metrics: ["top4_rate", "win_rate", "avg_placement", "popularity"],
    limit: Number.MAX_SAFE_INTEGER,
    minSamples: 0,
    patch: stream.patch,
    queue: stream.queue,
    rankFilter: stream.rankFilter ?? [],
    days: 1,
    specialMode: false
  };
  const ranking = buildCompRankings({ compsData, compsStats }, { query, minPlayrate });
  if (!ranking.candidates.length) {
    throw fail("EMPTY_RESULT", `${stream.environment}/${stream.code} returned zero visible comps`);
  }
  const definitions = new Map(data.definitions.map((definition) => [definition.clusterId, definition]));
  const rawStats = rawRowByCluster(compsStats);
  const identities = ranking.candidates.map((comp) => {
    const clusterId = String(comp.source?.clusterId ?? "");
    const definition = definitions.get(clusterId);
    return { comp, clusterId, definition, lineupSignature: createLineupSignature(comp) };
  });
  const signatureCounts = new Map();
  for (const identity of identities) {
    signatureCounts.set(
      identity.lineupSignature.value,
      (signatureCounts.get(identity.lineupSignature.value) ?? 0) + 1
    );
  }
  const seen = new Set();
  const rows = identities.map(({ comp, clusterId, definition, lineupSignature }) => {
    if (!definition || !rawStats.has(clusterId)) {
      throw fail("SCHEMA_CHANGE_DETECTED", `Missing raw comp identity or stats for cluster ${clusterId}`);
    }
    const compKey = signatureCounts.get(lineupSignature.value) > 1
      ? createCanonicalSnapshotCompKey(definition)
      : { value: lineupSignature.value, version: lineupSignature.version };
    if (!compKey.value || seen.has(compKey.value)) {
      throw fail("DUPLICATE_COMP_KEY", `Duplicate canonical comp key in ${stream.environment}/${stream.code}`, {
        compKey: compKey.value,
        clusterId
      });
    }
    seen.add(compKey.value);
    const games = validateMetric("games", Number(comp.stats?.games), (value) => value >= 0);
    const avgPlacement = validateMetric("avg_placement", Number(comp.stats?.avgPlacement), (value) => value >= 1 && value <= 8);
    const top4Rate = validateMetric("top4_rate", Number(comp.stats?.top4Rate), (value) => value >= 0 && value <= 1);
    const winRate = validateMetric("win_rate", Number(comp.stats?.winRate), (value) => value >= 0 && value <= 1);
    const pickRate = validateMetric("pick_rate", Number(comp.stats?.pickRate), (value) => value >= 0 && value <= 1);
    const selectionRate = validateMetric("selection_rate", Number(comp.stats?.selectionRate), (value) => value >= 0 && value <= 8);
    const rawPayloadHash = stablePayloadHash({
      environment: stream.environment,
      cohort: stream.code,
      rankFilter: sortedUnique(stream.rankFilter),
      queue: stream.queue,
      clusterId: data.clusterId,
      definition: definition.raw,
      stats: rawStats.get(clusterId)
    });
    return {
      snapshotBatchId,
      capturedAt,
      capturedDate,
      environment: stream.environment,
      patch: stream.patch ?? null,
      tftSet,
      region: stream.region,
      cohort: stream.code,
      rankFilter: stream.rankFilter ? sortedUnique(stream.rankFilter).join(",") : null,
      rankBucketSchemaVersion: stream.environment === "LIVE" ? RANK_BUCKET_SCHEMA_VERSION : null,
      windowDays: 1,
      compKey: compKey.value,
      compKeyVersion: compKey.version,
      sourceClusterId: clusterId,
      compName: String(comp.name || definition.nameString || definition.nameTokens.join(" · ") || clusterId),
      games,
      avgPlacement,
      top4Rate,
      winRate,
      pickRate,
      selectionRate,
      source: "metatft",
      sourceUpdatedAt: sourceTimestamp(comp.source?.updatedAt ?? stats.updatedAt ?? data.updatedAt),
      rawPayloadHash,
      dataOrigin: "DIRECT",
      units: sortedUnique(definition.units),
      traits: sortedUnique(definition.traits)
    };
  });
  return {
    rows,
    diagnostics: {
      tftSet,
      clusterId: data.clusterId,
      sourceUpdatedAt: sourceTimestamp(stats.updatedAt ?? data.updatedAt),
      definitions: data.definitions.length,
      statsRows: stats.rows.length,
      invalidRows: stats.rejected.length,
      sampleSize: stats.totalGames,
      confirmedRankFilter: stream.rankFilter ? rankFilterFromResponse(compsStats) : null
    }
  };
}

export function validateLiveCrossCohort(streamResults) {
  const diamond = new Map(array(streamResults.get("LIVE:DIAMOND_PLUS")?.rows).map((row) => [row.compKey, row]));
  const master = array(streamResults.get("LIVE:MASTER_PLUS")?.rows);
  const violations = [];
  for (const row of master) {
    const parent = diamond.get(row.compKey);
    if (!parent) {
      violations.push({ code: "MASTER_COMP_MISSING_IN_DIAMOND_PLUS", compKey: row.compKey, compName: row.compName });
      continue;
    }
    if (row.games > parent.games) {
      violations.push({
        code: "COHORT_INCONSISTENCY",
        compKey: row.compKey,
        compName: row.compName,
        masterPlusGames: row.games,
        diamondPlusGames: parent.games
      });
    }
  }
  return { pass: violations.length === 0, violations };
}

function streamKey(stream) {
  return `${stream.environment}:${stream.code}`;
}

function errorReason(error) {
  return {
    code: String(error?.code ?? "SNAPSHOT_STREAM_FAILED"),
    message: String(error?.message ?? error),
    ...(error?.details ? { details: error.details } : {})
  };
}

export async function runDailyCompSnapshot(options = {}) {
  if (!options.store) throw new TypeError("Daily comp snapshot requires a database store");
  if (!options.compsClient) throw new TypeError("Daily comp snapshot requires a MetaTFT comps client");
  const capturedAt = new Date(options.capturedAt ?? Date.now()).toISOString();
  const capturedDate = capturedAt.slice(0, 10);
  const snapshotBatchId = options.snapshotBatchId ?? randomUUID();
  const streams = array(options.streams).length ? options.streams : DEFAULT_SNAPSHOT_STREAMS;
  const configuredStreams = streams.map((stream) => ({
    ...stream,
    patch: stream.environment === "LIVE" ? options.livePatch ?? stream.patch ?? null : stream.patch ?? null
  }));
  await options.store.initialize();
  await options.store.createBatch({ snapshotBatchId, capturedAt, capturedDate, status: "RUNNING" });

  const dataByEnvironment = new Map();
  const normalized = new Map();
  const reports = {};
  for (const stream of configuredStreams) {
    const key = streamKey(stream);
    const previousCount = await options.store.previousCount({
      environment: stream.environment,
      cohort: stream.code,
      capturedDate
    });
    try {
      let compsData = dataByEnvironment.get(stream.environment);
      if (!compsData) {
        compsData = await options.compsClient.getCompsData({ queue: stream.queue });
        dataByEnvironment.set(stream.environment, compsData);
      }
      const root = compsData?.results?.data ?? compsData?.data ?? compsData;
      const clusterId = root?.cluster_id ?? compsData?.cluster_id;
      if (!clusterId) throw fail("SCHEMA_CHANGE_DETECTED", "MetaTFT comps_data did not return cluster_id");
      const statsParams = {
        queue: stream.queue,
        patch: "current",
        days: 1,
        permit_filter_adjustment: "true",
        cluster_id: clusterId,
        ...(stream.rankFilter ? { rank: sortedUnique(stream.rankFilter).join(",") } : {})
      };
      const compsStats = await options.compsClient.getCompsStats(statsParams);
      const result = normalizeSnapshotStream({
        compsData,
        compsStats,
        stream,
        capturedAt,
        capturedDate,
        snapshotBatchId,
        minPlayrate: options.minPlayrate
      });
      const write = await options.store.insertRows(result.rows);
      const currentCount = result.rows.length;
      const warnings = [];
      const dropRatio = previousCount > 0 ? (previousCount - currentCount) / previousCount : 0;
      const minimumCount = Number(options.minimumCount ?? 20);
      const maximumDropRatio = Number(options.maximumDropRatio ?? 0.5);
      if (currentCount < minimumCount || dropRatio > maximumDropRatio) {
        warnings.push({ code: "COMP_COUNT_HIGH_RISK", previousCount, currentCount, dropRatio });
      }
      if (!stream.patch) warnings.push({ code: `${stream.environment}_PATCH_UNAVAILABLE` });
      if (result.diagnostics.invalidRows > 0) {
        warnings.push({ code: "INVALID_ROWS_REJECTED", count: result.diagnostics.invalidRows });
      }
      normalized.set(key, result);
      reports[key] = {
        environment: stream.environment,
        cohort: stream.code,
        status: warnings.length ? "PARTIAL" : "SUCCESS",
        fetched: currentCount,
        inserted: write.inserted,
        duplicates: write.duplicates,
        invalid: result.diagnostics.invalidRows,
        previousCount,
        currentCount,
        delta: previousCount === null ? null : currentCount - previousCount,
        patch: stream.patch ?? null,
        region: stream.region,
        rankFilter: stream.rankFilter ? sortedUnique(stream.rankFilter) : null,
        diagnostics: result.diagnostics,
        warnings,
        failures: []
      };
    } catch (error) {
      reports[key] = {
        environment: stream.environment,
        cohort: stream.code,
        status: "FAILED",
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        invalid: 0,
        previousCount,
        currentCount: 0,
        delta: previousCount === null ? null : -previousCount,
        patch: stream.patch ?? null,
        region: stream.region,
        rankFilter: stream.rankFilter ? sortedUnique(stream.rankFilter) : null,
        diagnostics: null,
        warnings: [],
        failures: [errorReason(error)]
      };
    }
  }

  const crossCohort = validateLiveCrossCohort(normalized);
  const entries = Object.values(reports);
  const succeeded = entries.filter((entry) => entry.status !== "FAILED").length;
  const allSuccess = entries.every((entry) => entry.status === "SUCCESS");
  const overallStatus = succeeded === 0
    ? "FAILED"
    : allSuccess && crossCohort.pass
      ? "SUCCESS"
      : "PARTIAL";
  const totals = entries.reduce((total, entry) => ({
    fetched: total.fetched + entry.fetched,
    inserted: total.inserted + entry.inserted,
    duplicates: total.duplicates + entry.duplicates,
    invalid: total.invalid + entry.invalid
  }), { fetched: 0, inserted: 0, duplicates: 0, invalid: 0 });
  const report = {
    schemaVersion: "metatft_daily_comp_snapshot_report.v1",
    title: "MetaTFT Daily Comp Snapshot",
    snapshotBatchId,
    capturedAt,
    capturedDate,
    windowDays: 1,
    overallStatus,
    streams: reports,
    validation: {
      patch: entries.every((entry) => entry.patch) ? "PASS" : "FAIL",
      fields: entries.some((entry) => entry.status !== "FAILED") ? "PASS" : "FAIL",
      compIdentity: entries.some((entry) => entry.status !== "FAILED") ? "PASS" : "FAIL",
      crossCohort: crossCohort.pass ? "PASS" : "FAIL",
      livePbeIsolation: "PASS",
      schemaChangeDetected: entries.some((entry) => entry.failures.some((failure) => failure.code === "SCHEMA_CHANGE_DETECTED"))
    },
    crossCohort,
    totals
  };
  await options.store.finishBatch({ snapshotBatchId, status: overallStatus, report });
  return report;
}
