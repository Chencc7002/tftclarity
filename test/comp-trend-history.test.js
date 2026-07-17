import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileCacheStore, MemoryCacheStore } from "../src/data/cache-store.js";
import { buildCompRankings } from "../src/core/comp-ranking-service.js";
import {
  COMP_TREND_WINDOW_MS,
  enrichCompResponseWithTrendHistory,
  makeCompTrendHistoryKey
} from "../src/core/comp-trend-history.js";

function responseWithPlaces(places, options = {}) {
  const clusterId = options.clusterId ?? "cluster-version-1";
  const compId = options.compId ?? "101";
  return {
    compsData: {
      updated: "2026-07-16T00:00:00.000Z",
      queue_id: "1100",
      results: {
        data: {
          cluster_id: clusterId,
          cluster_details: {
            [compId]: {
              Cluster: compId,
              centroid: [1],
              units_string: "TFT17_TestUnit",
              traits_string: "TFT17_TestTrait_2",
              name: ["TFT17_TestUnit"],
              builds: []
            }
          },
          comps: options.officialChange === undefined ? {} : {
            [compId]: { "Average Placement Change": options.officialChange }
          }
        }
      }
    },
    compsStats: {
      cluster_id: clusterId,
      updated: "2026-07-16T00:00:00.000Z",
      results: [
        { cluster: "", places: [1000] },
        { cluster: compId, places }
      ]
    }
  };
}

const query = {
  queue: "1100",
  patch: "current",
  days: 3,
  rankFilter: ["CHALLENGER", "MASTER"],
  minSamples: 0,
  metrics: ["avg_placement"],
  limit: 3
};

test("comp trends warm up on the first snapshot and compute same-scope 72-hour changes", async () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const cacheStore = new MemoryCacheStore({ now: () => now });
  const first = await enrichCompResponseWithTrendHistory(
    responseWithPlaces([10, 10, 10, 10, 10, 10, 10, 10]),
    { query, cacheStore }
  );

  assert.equal(first.trend.status, "warming");
  assert.equal(first.trend.readyAt, "2026-07-19T00:00:00.000Z");
  assert.deepEqual(first.compsData.results.data.comps, {});

  now += COMP_TREND_WINDOW_MS;
  const second = await enrichCompResponseWithTrendHistory(
    responseWithPlaces([20, 20, 20, 20, 5, 5, 5, 5]),
    { query, cacheStore }
  );
  const change = second.compsData.results.data.comps["101"];

  assert.equal(second.trend.status, "local");
  assert.equal(second.trend.localCount, 1);
  assert.equal(change["Trend Source"], "local_72h");
  assert.ok(change["Average Placement Change"] < -1);

  const rankings = buildCompRankings(second, { query });
  assert.equal(rankings.improving.length, 1);
  assert.equal(rankings.improving[0].trend.source, "local_72h");
});

test("an insufficient raw official trend set does not block local 72-hour history", async () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const cacheStore = new MemoryCacheStore({ now: () => now });
  await enrichCompResponseWithTrendHistory(
    responseWithPlaces([10, 10, 10, 10, 10, 10, 10, 10]),
    { query, cacheStore }
  );

  now += COMP_TREND_WINDOW_MS;
  const response = await enrichCompResponseWithTrendHistory(
    responseWithPlaces([20, 20, 20, 20, 5, 5, 5, 5], { officialChange: -0.22 }),
    { query, cacheStore }
  );

  assert.equal(response.trend.status, "local");
  assert.equal(response.trend.officialCount, 0);
  assert.equal(response.trend.officialGate.status, "insufficient");
  assert.equal(response.trend.officialGate.eligibleCount, 1);
  assert.equal(response.trend.localCount, 1);
  assert.equal(response.compsData.results.data.comps["101"]["Trend Source"], "local_72h");
  assert.ok(response.compsData.results.data.comps["101"]["Average Placement Change"] < -1);
  assert.equal(buildCompRankings(response, { query }).improving[0].trend.source, "local_72h");
});

test("trend baselines survive query-history clearing and are isolated by comp cluster", async () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const cacheStore = new MemoryCacheStore({ now: () => now });
  await enrichCompResponseWithTrendHistory(
    responseWithPlaces([10, 10, 10, 10, 10, 10, 10, 10]),
    { query, cacheStore }
  );
  const key = makeCompTrendHistoryKey(query);

  cacheStore.clearQueryHistory();
  assert.equal(cacheStore.getCompTrendHistory(key).value.snapshots.length, 1);

  now += COMP_TREND_WINDOW_MS;
  const changedCluster = await enrichCompResponseWithTrendHistory(
    responseWithPlaces([20, 20, 20, 20, 5, 5, 5, 5], { clusterId: "cluster-version-2" }),
    { query, cacheStore }
  );
  assert.equal(changedCluster.trend.status, "warming");
  assert.deepEqual(changedCluster.compsData.results.data.comps, {});
});

test("JSON cache persists comp trend history across service restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tft-agent-trends-"));
  const filePath = join(directory, "cache.json");
  const now = Date.parse("2026-07-16T00:00:00.000Z");
  try {
    const firstStore = new JsonFileCacheStore({ filePath, now: () => now });
    await enrichCompResponseWithTrendHistory(
      responseWithPlaces([10, 10, 10, 10, 10, 10, 10, 10]),
      { query, cacheStore: firstStore }
    );

    const restartedStore = new JsonFileCacheStore({
      filePath,
      now: () => now + COMP_TREND_WINDOW_MS
    });
    const response = await enrichCompResponseWithTrendHistory(
      responseWithPlaces([20, 20, 20, 20, 5, 5, 5, 5]),
      { query, cacheStore: restartedStore }
    );
    assert.equal(response.trend.status, "local");
    assert.equal(response.trend.localCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
