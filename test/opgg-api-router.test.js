import test from "node:test";
import assert from "node:assert/strict";
import {
  initSchema,
  openDatabase,
  createPool,
  renamePool,
  registerPlayer
} from "../services/opgg/collector.mjs";
import {
  accessiblePool,
  authorizedPoolId,
  canAccessPlayer,
  createOpggApiRouter,
  isPersonalPool,
  personalPoolId,
  registerPersonalAccount,
  poolQueryOptions
} from "../services/opgg/api-router.mjs";

function responseCapture() {
  return {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = JSON.parse(body);
    }
  };
}

test("personal review pools are isolated by visitor scope", async () => {
  assert.equal(personalPoolId(null), "my-review");
  assert.equal(personalPoolId("scope-a"), "my-review-scope-a");
  assert.equal(isPersonalPool("my-review-scope-b"), true);
  assert.equal(authorizedPoolId("my-review", "scope-a"), "my-review-scope-a");
  assert.equal(authorizedPoolId("my-review-scope-a", "scope-a"), "my-review-scope-a");
  assert.equal(authorizedPoolId("my-review-scope-b", "scope-a"), null);

  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, { id: "my-review-scope-a", name: "A", region: "na" });
  createPool(database, { id: "my-review-scope-b", name: "B", region: "na" });
  createPool(database, { id: "default-na-pro", name: "Pros", region: "na" });
  registerPlayer(database, {
    id: "private-a",
    displayName: "Private A",
    gameName: "Private A",
    tagLine: "NA1",
    region: "na"
  }, "my-review-scope-a");
  registerPlayer(database, {
    id: "pro",
    displayName: "Pro",
    gameName: "Pro",
    tagLine: "NA1",
    region: "na"
  }, "default-na-pro");

  assert.equal(canAccessPlayer(database, "private-a", "scope-a"), true);
  assert.equal(canAccessPlayer(database, "private-a", "scope-b"), false);
  assert.equal(canAccessPlayer(database, "pro", "scope-b"), true);
  database.close();
});

test("custom pool metadata drives PBE aggregation and stays owner scoped", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, {
    id: "pbe-experts",
    name: "S18 PBE 观察池",
    region: "pbe",
    environment: "pbe",
    ownerType: "user",
    ownerId: "scope-a"
  });
  const pool = accessiblePool(database, "pbe-experts", "scope-a");
  assert.equal(pool.region, "pbe");
  assert.deepEqual(poolQueryOptions(pool, new URLSearchParams()), {
    poolId: "pbe-experts",
    region: "pbe",
    perPlayerLimit: 20
  });
  assert.equal(accessiblePool(database, "pbe-experts", "scope-b"), null);
  assert.equal(renamePool(database, "pbe-experts", "pbe高手").name, "pbe高手");
  database.close();
});

test("personal account registry persists PBE Riot IDs in the visitor pool", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const entry = registerPersonalAccount(database, {
    poolId: "my-review-scope-pbe",
    gameName: "chencc",
    tagLine: "aug",
    region: "pbe",
    now: "2026-08-14T00:00:00.000Z"
  });
  assert.equal(entry.id, "chencc-aug-pbe");
  assert.equal(entry.region, "pbe");
  assert.equal(canAccessPlayer(database, entry.id, "scope-pbe"), true);
  const linked = database.prepare(
    "SELECT player_id FROM pool_player WHERE pool_id = ?"
  ).all("my-review-scope-pbe");
  assert.deepEqual(linked.map((row) => row.player_id), ["chencc-aug-pbe"]);
  database.close();
});

test("refresh updates personal accounts and every owned Pool member without crossing owners", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  const poolId = personalPoolId("refresh-owner");
  const pbeAccount = registerPersonalAccount(database, { poolId, gameName: "PbeUser", tagLine: "aug", region: "pbe" });
  registerPersonalAccount(database, { poolId, gameName: "NaUser", tagLine: "NA1", region: "na" });
  createPool(database, {
    id: "refresh-owner-pool",
    name: "Owner Pool",
    region: "pbe",
    environment: "pbe",
    ownerType: "user",
    ownerId: "refresh-owner"
  });
  createPool(database, {
    id: "other-owner-pool",
    name: "Other Pool",
    region: "pbe",
    environment: "pbe",
    ownerType: "user",
    ownerId: "other-owner"
  });
  registerPlayer(database, pbeAccount, "refresh-owner-pool");
  registerPlayer(database, {
    id: "pool-user-aug-pbe",
    displayName: "PoolUser#aug",
    gameName: "PoolUser",
    tagLine: "aug",
    region: "pbe",
    active: true
  }, "refresh-owner-pool");
  registerPlayer(database, {
    id: "foreign-user-aug-pbe",
    displayName: "ForeignUser#aug",
    gameName: "ForeignUser",
    tagLine: "aug",
    region: "pbe",
    active: true
  }, "other-owner-pool");
  const puuid = "a".repeat(78);
  let opggInitialized = 0;
  let opggTerminated = 0;
  let pbeClosed = 0;
  let pbeCalls = 0;
  const opggMatch = {
    metadata: { matchId: "NA1_REFRESH", participants: [] },
    info: { matchId: "NA1_REFRESH", gameDatetime: 1_776_000_000_000, queueId: 1100, tftSetNumber: 17, gameVersion: "17.9" },
    summary: { placement: 3, level: 8, lastRound: 32, playersEliminated: 2, traits: [], units: [] }
  };
  const router = createOpggApiRouter({
    database,
    opggClientFactory: () => ({
      async initialize() { opggInitialized += 1; },
      async terminate() { opggTerminated += 1; },
      async callTool(name, input) {
        if (name === "lol_get_summoner_profile") {
          return { result: { content: [{ type: "text", text: `LolGetSummonerProfile(Data(Summoner("${puuid}","${input.game_name}","${input.tag_line}")))` }] } };
        }
        if (name === "tft_get_play_style") {
          return { result: { content: [{ type: "text", text: JSON.stringify({ items: { data: [opggMatch] }, play_style_comments: [], action: [] }) }] } };
        }
        throw new Error(`unexpected tool ${name}`);
      }
    }),
    playerMatchClient: {
      async callTool(name, input) {
        assert.equal(name, "list_matches");
        assert.equal(input.callerKey, "refresh-owner");
        pbeCalls += 1;
        return {
          returnedCount: 1,
          matches: [{
            matchId: `PBE1_REFRESH_${input.gameName}`,
            playedAt: "2026-08-20T00:00:00.000Z",
            placement: 2,
            level: 9,
            set: "TFTSet18",
            patch: "18.2",
            queue: { id: 1100 },
            lastRound: 35,
            traits: [],
            units: []
          }]
        };
      },
      async close() { pbeClosed += 1; }
    }
  });
  const listing = responseCapture();
  await router(
    { method: "GET" },
    listing,
    new URL("http://localhost/api/opgg/my-review"),
    { scope: "refresh-owner" }
  );
  assert.equal(listing.body.refreshableAccountCount, 3);
  assert.equal(listing.body.poolAccountCount, 2);
  const response = responseCapture();
  await router(
    { method: "POST" },
    response,
    new URL("http://localhost/api/opgg/my-review/refresh"),
    { scope: "refresh-owner" }
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.requestedCount, 3);
  assert.equal(response.body.refreshedCount, 3);
  assert.equal(response.body.failedCount, 0);
  assert.equal(response.body.poolCount, 1);
  assert.equal(response.body.personalAccountCount, 2);
  assert.equal(response.body.poolAccountCount, 2);
  assert.deepEqual(response.body.results.map((result) => result.provider).sort(), ["metatft", "metatft", "opgg"]);
  assert.equal(response.body.results.some((result) => result.displayName === "ForeignUser#aug"), false);
  assert.equal(opggInitialized, 1);
  assert.equal(opggTerminated, 1);
  assert.equal(pbeClosed, 1);
  assert.equal(pbeCalls, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM player_match_fact").get().n, 3);
  const repeated = responseCapture();
  await router(
    { method: "POST" },
    repeated,
    new URL("http://localhost/api/opgg/my-review/refresh"),
    { scope: "refresh-owner" }
  );
  assert.equal(repeated.body.refreshedCount, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM player_match_fact").get().n, 3);
  assert.equal(opggInitialized, 2);
  assert.equal(opggTerminated, 2);
  assert.equal(pbeClosed, 2);
  assert.equal(pbeCalls, 4);
  database.close();
});
