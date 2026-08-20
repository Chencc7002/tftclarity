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

function jsonRequest(method, body) {
  return {
    method,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
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

test("NA account registration uses MetaTFT live history instead of OP.GG", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  let closed = 0;
  const router = createOpggApiRouter({
    database,
    playerMatchClient: {
      async callTool(name, input) {
        assert.equal(name, "list_matches");
        assert.deepEqual(
          { environment: input.environment, season: input.season, verificationMode: input.verificationMode },
          { environment: "live", season: "set17-live", verificationMode: "provider" }
        );
        return {
          returnedCount: 1,
          matches: [{
            matchId: "NA1_REGISTER",
            playedAt: "2026-08-20T00:00:00.000Z",
            placement: 3,
            level: 8,
            set: "TFTSet17",
            patch: "17.9",
            queue: { id: 1100 },
            lastRound: 32,
            traits: [],
            units: []
          }]
        };
      },
      async close() { closed += 1; }
    }
  });
  const response = responseCapture();
  await router(
    jsonRequest("POST", { gameName: "NaUser", tagLine: "1215", region: "na" }),
    response,
    new URL("http://localhost/api/opgg/players/register"),
    { scope: "scope-na" }
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.collect.provider, "metatft");
  assert.equal(response.body.collect.returnedCount, 1);
  assert.equal(closed, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM player_match_fact").get().n, 1);
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
  let playerMatchClosed = 0;
  let playerMatchCalls = 0;
  const observedRoutes = [];
  const router = createOpggApiRouter({
    database,
    playerMatchClient: {
      async callTool(name, input) {
        assert.equal(name, "list_matches");
        assert.equal(input.callerKey, "refresh-owner");
        playerMatchCalls += 1;
        observedRoutes.push({ gameName: input.gameName, environment: input.environment, season: input.season });
        const isPbe = input.environment === "pbe";
        return {
          returnedCount: 1,
          matches: [{
            matchId: `${isPbe ? "PBE1" : "NA1"}_REFRESH_${input.gameName}`,
            playedAt: "2026-08-20T00:00:00.000Z",
            placement: 2,
            level: 9,
            set: isPbe ? "TFTSet18" : "TFTSet17",
            patch: isPbe ? "18.2" : "17.9",
            queue: { id: 1100 },
            lastRound: 35,
            traits: [],
            units: []
          }]
        };
      },
      async close() { playerMatchClosed += 1; }
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
  assert.deepEqual(response.body.results.map((result) => result.provider), ["metatft", "metatft", "metatft"]);
  assert.equal(response.body.results.some((result) => result.displayName === "ForeignUser#aug"), false);
  assert.equal(playerMatchClosed, 1);
  assert.equal(playerMatchCalls, 3);
  assert.deepEqual(observedRoutes.toSorted((a, b) => a.gameName.localeCompare(b.gameName)), [
    { gameName: "NaUser", environment: "live", season: "set17-live" },
    { gameName: "PbeUser", environment: "pbe", season: "set18-pbe" },
    { gameName: "PoolUser", environment: "pbe", season: "set18-pbe" }
  ]);
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
  assert.equal(playerMatchClosed, 2);
  assert.equal(playerMatchCalls, 6);
  database.close();
});
