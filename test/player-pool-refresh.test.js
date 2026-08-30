import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerMatchService } from "../services/metatft-player/service.mjs";
import { createMetaTftAdapter } from "../services/metatft-player/adapter.mjs";
import { createOpggApiRouter } from "../services/opgg/api-router.mjs";
import { createPlayerPoolApiRouter } from "../services/player-pools/api-router.mjs";
import { openDatabase, initSchema, createPool, registerPlayer, ingestExternalPlayerMatches, backfillPatchLabels } from "../services/opgg/collector.mjs";
import { aggregatePool } from "../services/opgg/aggregator.mjs";
import { poolSeason } from "../services/player-pools/season.mjs";
import { DEFAULT_SEASON_CONTEXT_ID } from "../src/season/season-context.js";

const player = { id: "pro-na", gameName: "Pro", tagLine: "NA1", displayName: "Pro", region: "na", active: true };
const match = (id = "NA1_NEW", patch = "16.14") => ({
  matchId: id, playedAt: "2026-08-30T00:00:00.000Z", set: "TFTSet17", patch,
  placement: 2, level: 8, queue: { id: 1100 },
  units: [{ characterId: "TFT17_Ahri", starLevel: 2, items: ["TFT_Item_RabadonsDeathcap", "TFT_Item_SpearOfShojin"] }],
  traits: [{ id: "TFT17_StarGuardian", style: 2, tierCurrent: 2, units: 4 }]
});
const capture = () => ({ writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } });

test("manual refresh triggers MetaTFT's upstream job before reloading profile, with bounded queue waits", async () => {
  const calls = [];
  let pending = false;
  const adapter = createMetaTftAdapter({ refreshPollDelayMs: 0, fetchImpl: async (url, options) => {
    calls.push({ path: url.pathname, method: options.method });
    const value = url.pathname.includes("refresh_by_riotid")
      ? { status: options.method === "POST" || pending ? "queued" : "completed" }
      : { matches: [] };
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  } });
  const context = { platform: "NA1", gameName: "Name With Space", tagLine: "NA1", expectedSet: "TFTSet17" };
  await adapter.fetchProfile(context, { forceRefresh: true });
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET"]);
  assert.match(calls[0].path, /refresh_by_riotid\/NA1\/Name%20With%20Space\/NA1$/);
  assert.match(calls[2].path, /lookup_by_riotid/);
  calls.length = 0;
  pending = true;
  await assert.rejects(adapter.fetchProfile(context, { forceRefresh: true }), (error) => error.code === "REFRESH_PENDING");
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.path.includes("refresh_by_riotid")), "pending jobs must never fall back to old profile as refreshed");
  calls.length = 0;
  await adapter.fetchProfile(context);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /lookup_by_riotid/);
});
async function setup() {
  const db = await openDatabase(":memory:");
  initSchema(db);
  createPool(db, { id: "default-na-pro", name: "NA 职业选手默认池", region: "na" });
  registerPlayer(db, player, "default-na-pro");
  return db;
}

test("explicit refresh bypasses profile cache, coalesces requests and retains rate limits", async () => {
  let fetched = 0;
  let limited = 0;
  let fail = false;
  const adapter = createMetaTftAdapter();
  adapter.fetchProfile = async () => {
    fetched += 1;
    if (fail) throw new Error("upstream offline");
    return { matches: [{ riot_match_id: `NA1_${fetched}`, tft_set: "TFTSet17", match_timestamp: fetched * 1000, summary: {} }] };
  };
  const service = createPlayerMatchService({ adapter, masterEnabled: true, naEnabled: true,
    limiter: { consume() { limited += 1; } } });
  const input = { gameName: "Pro", tagLine: "NA1", season: "set17-live" };
  assert.equal((await service.listMatches(input)).matches[0].matchId, "NA1_1");
  assert.equal((await service.listMatches(input)).provenance.cacheStatus, "hit");
  const refreshed = await Promise.all([1, 2].map(() => service.listMatches({ ...input, forceRefresh: true })));
  assert.equal(fetched, 2);
  assert.ok(refreshed.every((result) => result.matches[0].matchId === "NA1_2" && result.provenance.cacheStatus === "miss"));
  fail = true;
  await assert.rejects(service.listMatches({ ...input, forceRefresh: true }), /upstream offline/);
  assert.equal((await service.listMatches(input)).matches[0].matchId, "NA1_2");
  assert.equal(limited, 6);
});

test("a manual refresh cannot join an older lookup or have its cache overwritten by that lookup", async () => {
  let releaseOld;
  let startedOld;
  const oldStarted = new Promise((resolve) => { startedOld = resolve; });
  const adapter = createMetaTftAdapter();
  adapter.fetchProfile = async (_context, { forceRefresh }) => {
    if (!forceRefresh) { startedOld(); await new Promise((resolve) => { releaseOld = resolve; }); }
    return { matches: [{ riot_match_id: forceRefresh ? "NA1_FRESH" : "NA1_STALE", tft_set: "TFTSet17", summary: {} }] };
  };
  const service = createPlayerMatchService({ adapter, masterEnabled: true, naEnabled: true });
  const input = { gameName: "Pro", tagLine: "NA1", season: "set17-live" };
  const oldLookup = service.listMatches(input);
  await oldStarted;
  const fresh = await service.listMatches({ ...input, forceRefresh: true });
  assert.equal(fresh.provenance.refreshStatus, "completed");
  assert.equal(fresh.matches[0].matchId, "NA1_FRESH");
  releaseOld();
  await oldLookup;
  assert.equal((await service.listMatches(input)).matches[0].matchId, "NA1_FRESH");
});

test("external patch normalization is immediate, idempotent and preserves incomplete-refresh boards", async () => {
  const db = await setup();
  try {
    ingestExternalPlayerMatches(db, player, [match()], { poolId: "default-na-pro" });
    assert.equal(aggregatePool(db, { poolId: "default-na-pro" }).overview.currentPatch, "17.8");
    ingestExternalPlayerMatches(db, player, [{ ...match(), units: [], traits: [] }], { poolId: "default-na-pro" });
    assert.equal(backfillPatchLabels(db), 0);
    const result = aggregatePool(db, { poolId: "default-na-pro" });
    assert.equal(result.compTrends[0].representativeUnits[0].characterId, "TFT17_Ahri");
    assert.equal(result.compTrends[0].representativeMatch.matchId, "NA1_NEW");
    assert.equal(result.overview.latestMatchAt, match().playedAt);
    assert.equal(result.overview.patchBasis, "latest_observed_match");
    ingestExternalPlayerMatches(db, player, [match("NA1_TFT", "17.9")], { poolId: "default-na-pro" });
    assert.equal(db.prepare("SELECT patch_label FROM match_record WHERE match_id = 'NA1_TFT'").get().patch_label, "17.9");
  } finally { db.close(); }
});

test("default-pool refresh collects current members, exposes new matches and failures without erasing old data", async () => {
  const db = await setup();
  try {
    const old = { ...match("NA1_OLD", "16.13"), playedAt: "2026-07-01T00:00:00.000Z" };
    ingestExternalPlayerMatches(db, player, [old], { poolId: "default-na-pro" });
    registerPlayer(db, { ...player, id: "unavailable", gameName: "Unavailable" }, "default-na-pro");
    let mode = "new";
    const router = createOpggApiRouter({ database: db, playerMatchClient: {
      async callTool(name, input) {
        assert.equal(name, "list_matches");
        assert.equal(input.forceRefresh, true);
        assert.equal(input.callerKey, "owner");
        if (input.gameName === "Unavailable") throw new Error("profile unavailable");
        return { matches: mode === "empty" ? [] : [match()], provenance: { cacheStatus: mode === "cached" ? "hit" : "miss", refreshStatus: "completed" } };
      }
    } });
    const refresh = async () => {
      const response = capture();
      await router({ method: "POST" }, response, new URL("http://localhost/api/opgg/pools/default-na-pro/refresh"), { scope: "owner" });
      assert.equal(response.status, 200);
      return response.body;
    };
    const first = await refresh();
    assert.equal(first.refreshedCount, 1);
    assert.equal(first.failedCount, 1);
    assert.equal(first.newMatchCount, 1);
    assert.equal((await refresh()).newMatchCount, 0);
    const poll = db.prepare("SELECT last_successful_poll_at FROM tracked_player WHERE id = ?").get(player.id).last_successful_poll_at;
    mode = "cached";
    assert.equal((await refresh()).refreshedCount, 0);
    mode = "empty";
    assert.equal((await refresh()).refreshedCount, 0);
    assert.equal(db.prepare("SELECT last_successful_poll_at FROM tracked_player WHERE id = ?").get(player.id).last_successful_poll_at, poll);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_match_fact").get().n, 2);
    const trends = capture();
    await router({ method: "GET" }, trends, new URL("http://localhost/api/opgg/trends?pool=default-na-pro"), { scope: "owner" });
    assert.equal(trends.body.overview.currentPatch, "17.8");
    assert.ok(trends.body.compTrends[0].representativeUnits[0].displayName);
  } finally { db.close(); }
});

test("pool refresh cannot touch another owner's private pool", async () => {
  const db = await setup();
  try {
    createPool(db, { id: "private", name: "Private", region: "na", ownerType: "user", ownerId: "other" });
    const router = createOpggApiRouter({ database: db, playerMatchClientFactory: () => assert.fail("must not fetch") });
    const response = capture();
    await router({ method: "POST" }, response, new URL("http://localhost/api/opgg/pools/private/refresh"), { scope: "owner" });
    assert.equal(response.status, 404);
  } finally { db.close(); }
});

test("refresh follows the active live season and preserves pinned historical/PBE scopes", async () => {
  const db = await setup();
  try {
    assert.equal(poolSeason(), DEFAULT_SEASON_CONTEXT_ID);
    assert.equal(poolSeason({}, { region: "pbe" }), "set18-pbe");
    createPool(db, { id: "historical", name: "S17", region: "na", season: "set17-live", ownerType: "user", ownerId: "owner" });
    registerPlayer(db, player, "historical");
    const observed = [];
    const router = createOpggApiRouter({ database: db, playerMatchClient: {
      async callTool(_name, input) {
        observed.push(input.season);
        const isCurrent = input.season === "set18-live";
        return { matches: [{ ...match(isCurrent ? "NA1_S18" : "NA1_S17", isCurrent ? "18.1" : "17.8"), set: isCurrent ? "TFTSet18" : "TFTSet17" }], provenance: { refreshStatus: "completed", cacheStatus: "miss" } };
      }
    } });
    for (const id of ["default-na-pro", "historical"]) {
      const response = capture();
      await router({ method: "POST" }, response, new URL(`http://localhost/api/opgg/pools/${id}/refresh`), { scope: "owner" });
      assert.equal(response.body.refreshedCount, 1);
    }
    assert.deepEqual(observed, ["set18-live", "set17-live"]);
    const response = capture();
    const pools = createPlayerPoolApiRouter({ database: db, matchClient: {} });
    await pools({ method: "GET" }, response, new URL("http://localhost/api/player-pools/historical/stats"), { scope: "owner" });
    assert.equal(response.body.scope.patch, "17.8");
    assert.equal(response.body.coverage.matchCount, 1);
    assert.ok(response.body.coverage.patchDistribution.every((row) => row.patch === "17.8"));
  } finally { db.close(); }
});

test("new live pools verify current-season MetaTFT evidence and reject PBE seed import", async () => {
  const db = await setup();
  try {
    const router = createPlayerPoolApiRouter({ database: db, matchClient: {
      async callTool(_name, input) {
        assert.equal(input.environment, "live");
        assert.equal(input.season, "set18-live");
        return { returnedCount: 1, matches: [{ ...match("NA1_LIVE18", "18.1"), set: "TFTSet18" }] };
      }
    } });
    const response = capture();
    await router({ method: "POST", async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ name: "Current", environment: "live", gameName: "Pro", tagLine: "NA1" })); } }, response, new URL("http://localhost/api/player-pools"), { scope: "owner" });
    assert.equal(response.status, 201);
    assert.equal(response.body.pool.season, "set18-live");
    const denied = capture();
    await router({ method: "POST" }, denied, new URL(`http://localhost/api/player-pools/${response.body.pool.id}/import-seed`), { scope: "owner" });
    assert.equal(denied.status, 400);
    assert.equal(denied.body.error, "PBE_SEED_REQUIRES_PBE_POOL");
  } finally { db.close(); }
});

test("custom pool stats repair legacy raw patch labels without requiring OP.GG router initialization", async () => {
  const db = await setup();
  try {
    createPool(db, { id: "custom", name: "My NA", region: "na", environment: "live", season: "set17-live", ownerType: "user", ownerId: "owner" });
    ingestExternalPlayerMatches(db, player, [match()], { poolId: "custom" });
    db.prepare("UPDATE match_record SET patch_label = '16.14'").run();
    const router = createPlayerPoolApiRouter({ database: db, matchClient: {} });
    const response = capture();
    await router({ method: "GET" }, response, new URL("http://localhost/api/player-pools/custom/stats"), { scope: "owner" });
    assert.equal(response.status, 200);
    assert.equal(response.body.scope.patch, "17.8");
    assert.equal(response.body.compTrends[0].representativeMatch.matchId, "NA1_NEW");
  } finally { db.close(); }
});
