import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_POOLS_PER_OWNER,
  MAX_PLAYERS_PER_POOL,
  MIN_PLAYERS_PER_POOL,
  poolStats,
  compareStats,
  createUniqueShareCode
} from "../services/player-pools/api-router.mjs";
import {
  openDatabase,
  initSchema,
  createPool,
  ingestExternalPlayerMatches,
  setPoolShareCode,
  getPoolByShareCode,
  getPoolPlayers,
  registerPlayer,
  removePlayerFromPool
} from "../services/opgg/collector.mjs";

function match(id, placement, trait = "TFT18_Test") {
  return {
    matchId: `PBE1_${id}`,
    playedAt: `2026-08-12T00:${String(id).padStart(2, "0")}:00.000Z`,
    placement,
    level: 8,
    set: "TFTSet18",
    patch: "18.1",
    queue: { id: 1100 },
    lastRound: 30,
    traits: [{ id: trait, units: 6, style: 1, tierCurrent: 1 }],
    units: [{ characterId: "TFT18_Unit", starLevel: 2, items: ["ItemA"] }]
  };
}

function addPlayer(database, poolId, name, count = 10, offset = 0) {
  const entry = {
    id: `${name.toLowerCase()}-pbe-pbe`,
    displayName: `${name}#pbe`,
    gameName: name,
    tagLine: "pbe",
    region: "pbe",
    active: true
  };
  ingestExternalPlayerMatches(database, entry, Array.from({ length: count }, (_, index) => (
    match(offset + index, (index % 8) + 1)
  )), { poolId });
}

test("player pool product limits are frozen to two pools and one to fifteen members", () => {
  assert.equal(MAX_POOLS_PER_OWNER, 2);
  assert.equal(MIN_PLAYERS_PER_POOL, 1);
  assert.equal(MAX_PLAYERS_PER_POOL, 15);
});

test("pool share codes are compact, unambiguous and resolve to the source pool", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, {
    id: "share-source",
    name: "pbe高手",
    region: "pbe",
    environment: "pbe",
    ownerType: "user",
    ownerId: "owner-a"
  });
  const code = createUniqueShareCode(database);
  assert.match(code, /^[23456789A-HJ-NP-Z]{8}$/u);
  setPoolShareCode(database, "share-source", code);
  assert.equal(getPoolByShareCode(database, code.toLowerCase()).id, "share-source");
  database.close();
});

test("a pool-code import copies membership without sharing edit state", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, { id: "source", name: "pbe高手", region: "pbe", ownerType: "user", ownerId: "owner-a" });
  createPool(database, { id: "copy", name: "pbe高手 副本", region: "pbe", ownerType: "user", ownerId: "owner-b" });
  registerPlayer(database, {
    id: "shared-player-pbe-pbe",
    displayName: "Shared Player#PBE",
    gameName: "Shared Player",
    tagLine: "PBE",
    region: "pbe",
    active: true
  }, "source");
  for (const player of getPoolPlayers(database, "source", { activeOnly: false })) {
    registerPlayer(database, player, "copy", new Date().toISOString(), "share_code_import");
  }
  assert.equal(getPoolPlayers(database, "copy").length, 1);
  removePlayerFromPool(database, "copy", "shared-player-pbe-pbe", new Date().toISOString());
  assert.equal(getPoolPlayers(database, "copy", { activeOnly: false }).length, 0);
  assert.equal(getPoolPlayers(database, "source", { activeOnly: false }).length, 1);
  database.close();
});

test("pool stats expose match-weighted and player-balanced composition usage", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, {
    id: "pool-a",
    name: "CN",
    region: "pbe",
    environment: "pbe",
    season: "set18-pbe",
    provider: "metatft",
    ownerType: "user",
    ownerId: "owner"
  });
  addPlayer(database, "pool-a", "A", 10, 0);
  addPlayer(database, "pool-a", "B", 10, 20);
  const stats = poolStats(database, {
    id: "pool-a",
    name: "CN",
    region: "pbe",
    environment: "pbe",
    season: "set18-pbe",
    provider: "metatft",
    memberCount: 2
  });
  assert.equal(stats.coverage.matchCount, 20);
  assert.equal(stats.coverage.sampleTier, "low_sample");
  assert.equal(stats.compTrends[0].playerMatchShare, 1);
  assert.equal(stats.compTrends[0].playerBalancedUsageRate, 1);
  database.close();
});

test("pool names never affect compatibility and low samples block difference claims", () => {
  const value = (name, matchCount, season = "set18-pbe", patch = "18.1") => ({
    pool: { id: name, name },
    scope: { season, patch },
    coverage: { matchCount, activePlayerCount: 2 },
    compTrends: []
  });
  const result = compareStats(value("CN", 20), value("NA", 20));
  assert.equal(result.compatibility, "FULL");
  assert.equal(result.comparable, false);
  assert.ok(result.reasons.includes("SAMPLE_GATE_NOT_MET"));
  assert.match(result.statementPolicy, /禁止生成优劣/u);
});

test("different seasons remain descriptive even when user chooses the pool pair", () => {
  const left = {
    pool: { id: "a", name: "任意名称 A" },
    scope: { season: "set18-pbe", patch: "18.1" },
    coverage: { matchCount: 40, activePlayerCount: 4 },
    compTrends: []
  };
  const right = {
    pool: { id: "b", name: "任意名称 B" },
    scope: { season: "set17-live", patch: "17.9" },
    coverage: { matchCount: 40, activePlayerCount: 4 },
    compTrends: []
  };
  const result = compareStats(left, right);
  assert.equal(result.compatibility, "DESCRIPTIVE_ONLY");
  assert.equal(result.comparable, false);
  assert.ok(result.reasons.includes("DIFFERENT_SEASON"));
});

test("pool comparison uses the union of comps and exposes performance deltas", () => {
  const comp = (compSignature, share, avgPlacement, top4Rate, winRate) => ({
    compSignature,
    playerMatchShare: share,
    playerBalancedUsageRate: share,
    observedAvgPlacement: avgPlacement,
    observedTop4Rate: top4Rate,
    observedWinRate: winRate,
    performanceComparable: true,
    playerMatchCount: 20
  });
  const stats = (id, compTrends, performance) => ({
    pool: { id, name: id },
    scope: { season: "set18-pbe", patch: "18.1" },
    coverage: { matchCount: 60, activePlayerCount: 4 },
    performance,
    compTrends
  });
  const result = compareStats(
    stats("left", [comp("shared", .4, 3.5, .7, .2), comp("left-only", .2, 4.2, .5, .1)], { avgPlacement: 3.8, top4Rate: .6, winRate: .15 }),
    stats("right", [comp("shared", .25, 4, .55, .1), comp("right-only", .3, 3.7, .65, .18)], { avgPlacement: 4.1, top4Rate: .55, winRate: .12 })
  );
  assert.deepEqual(result.compDifferences.map((row) => row.compSignature), ["shared", "right-only", "left-only"]);
  const shared = result.compDifferences[0];
  assert.equal(shared.usageDeltaPp, 15);
  assert.equal(shared.avgPlacementDelta, -0.5);
  assert.equal(shared.top4DeltaPp, 15);
  assert.equal(shared.winDeltaPp, 10);
  assert.equal(shared.performanceComparable, true);
  assert.equal(result.summaryDifferences.top4DeltaPp, 5);
  assert.equal(result.compDifferences[1].left, null);
});
