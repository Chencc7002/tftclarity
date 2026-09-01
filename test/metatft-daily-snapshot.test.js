import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_COMP_KEY_VERSION,
  LIVE_COHORTS,
  createCanonicalSnapshotCompKey,
  normalizeSnapshotStream,
  stablePayloadHash,
  validateLiveCrossCohort
} from "../src/metatft-snapshot/daily-comp-snapshot.js";

function compsData() {
  return {
    updated: 1000,
    tft_set: "TFTSet17",
    queue_id: 1100,
    cluster_id: 10,
    results: { data: { cluster_id: 10, tft_set: "TFTSet17", cluster_details: {
      1: {
        Cluster: 1,
        centroid: [1],
        units_string: "TFT17_A,TFT17_B,TFT17_C",
        traits_string: "TFT17_Trait_2",
        name_string: "TFT17_A,TFT17_Trait_2",
        builds: [{ cluster: 1, unit: "TFT17_A", buildName: ["I1", "I2", "I3"], count: 20 }]
      }
    } } }
  };
}

function compsStats(rank = LIVE_COHORTS[1].rankFilter, games = 100) {
  return {
    updated: 2000,
    tft_set: "TFTSet17",
    cluster_id: 10,
    filter_adjustment: {
      override_applied: false,
      rank_filter: [...rank].sort().join(","),
      sample_size: games
    },
    results: [
      { cluster: "", places: [games] },
      { cluster: "1", places: [10, 15, 15, 10, 15, 15, 10, 10, games] }
    ]
  };
}

const base = {
  capturedAt: "2026-08-17T06:30:00.000Z",
  capturedDate: "2026-08-17",
  snapshotBatchId: "00000000-0000-4000-8000-000000000001"
};

test("snapshot normalization confirms rank, ratios, identity, and stable hash", () => {
  const stream = { ...LIVE_COHORTS[1], environment: "LIVE", queue: "1100", region: "global", patch: "17.9" };
  const result = normalizeSnapshotStream({ compsData: compsData(), compsStats: compsStats(), stream, ...base, minPlayrate: 0 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].games, 100);
  assert.equal(result.rows[0].top4Rate, 0.5);
  assert.equal(result.rows[0].winRate, 0.1);
  assert.equal(result.rows[0].avgPlacement, 4.4);
  assert.match(result.rows[0].compKey, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.rows[0].rawPayloadHash, /^[a-f0-9]{64}$/u);
});

test("rank filter mismatch is rejected instead of guessed", () => {
  const stream = { ...LIVE_COHORTS[1], environment: "LIVE", queue: "1100", region: "global", patch: "17.9" };
  assert.throws(() => normalizeSnapshotStream({
    compsData: compsData(), compsStats: compsStats(["MASTER"]), stream, ...base, minPlayrate: 0
  }), (error) => error.code === "RANK_FILTER_MISMATCH");
});

test("payload hash is independent of object key order", () => {
  assert.equal(stablePayloadHash({ a: 1, b: { c: 2 } }), stablePayloadHash({ b: { c: 2 }, a: 1 }));
});

test("canonical snapshot key distinguishes materially different full lineups", () => {
  const first = createCanonicalSnapshotCompKey({
    units: ["A", "B"], traits: ["Trait_2"], threeStarUnits: ["A"]
  });
  const second = createCanonicalSnapshotCompKey({
    units: ["A", "B", "C"], traits: ["Trait_3"], threeStarUnits: ["A"]
  });
  assert.equal(first.version, CANONICAL_COMP_KEY_VERSION);
  assert.notEqual(first.value, second.value);
});

test("cross cohort validation rejects Master+ games above Diamond+", () => {
  const shared = { compKey: "sha256:test", compName: "Test" };
  const streams = new Map([
    ["LIVE:DIAMOND_PLUS", { rows: [{ ...shared, games: 90 }] }],
    ["LIVE:MASTER_PLUS", { rows: [{ ...shared, games: 100 }] }]
  ]);
  const result = validateLiveCrossCohort(streams);
  assert.equal(result.pass, false);
  assert.equal(result.violations[0].code, "COHORT_INCONSISTENCY");
});

test("PBE stream accepts an absent rank filter and keeps patch null", () => {
  const data = compsData();
  data.tft_set = "TFTSet18";
  data.queue_id = "pbe";
  data.results.data.tft_set = "TFTSet18";
  const stats = compsStats();
  stats.tft_set = "TFTSet18";
  delete stats.filter_adjustment;
  const stream = { code: "ALL_RANKS", rankFilter: null, environment: "PBE", queue: "PBE", region: "pbe", patch: null };
  const result = normalizeSnapshotStream({ compsData: data, compsStats: stats, stream, ...base, minPlayrate: 0 });
  assert.equal(result.rows[0].environment, "PBE");
  assert.equal(result.rows[0].rankFilter, null);
  assert.equal(result.rows[0].patch, null);
});
