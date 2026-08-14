import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  buildReviewDashboard,
  createPlayerMatchApiRouter,
  parsePlayerId
} from "../services/metatft-player/api-router.mjs";

function responseCapture() {
  const response = new EventEmitter();
  response.writeHead = (status, headers) => { response.status = status; response.headers = headers; };
  response.end = (body) => { response.body = JSON.parse(body); response.emit("finish"); };
  return response;
}

test("player API parses encoded Riot IDs", () => {
  assert.deepEqual(parsePlayerId("Flancy%23PBE2"), { gameName: "Flancy", tagLine: "PBE2" });
  assert.equal(parsePlayerId("Flancy"), null);
});

test("PBE player route requests 10-20 MCP summaries with explicit set18-pbe", async () => {
  const calls = [];
  const router = createPlayerMatchApiRouter({
    client: { async callTool(name, input) { calls.push({ name, input }); return { returnedCount: input.limit, matches: [] }; } }
  });
  const response = responseCapture();
  await router(
    { method: "GET" },
    response,
    new URL("http://localhost/api/player-matches/players/Flancy%23PBE2?limit=15"),
    { scope: "visitor-a" }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], {
    name: "list_matches",
    input: {
      gameName: "Flancy",
      tagLine: "PBE2",
      environment: "pbe",
      season: "set18-pbe",
      callerKey: "visitor-a",
      limit: 15
    }
  });
});

test("explicit PBE selection accepts arbitrary Riot tags without prefix routing", async () => {
  const calls = [];
  const router = createPlayerMatchApiRouter({
    client: { async callTool(name, input) { calls.push({ name, input }); return { returnedCount: 20, matches: [] }; } }
  });
  const response = responseCapture();
  await router(
    { method: "GET" },
    response,
    new URL("http://localhost/api/player-matches/players/chencc%23aug?environment=pbe&limit=20"),
    { scope: "visitor-a" }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], {
    name: "list_matches",
    input: {
      gameName: "chencc",
      tagLine: "aug",
      environment: "pbe",
      season: "set18-pbe",
      callerKey: "visitor-a",
      verificationMode: "provider",
      limit: 20
    }
  });
});

test("match route expands only the selected match", async () => {
  const calls = [];
  const router = createPlayerMatchApiRouter({
    client: { async callTool(name, input) { calls.push({ name, input }); return { match: { matchId: input.matchId } }; } }
  });
  const response = responseCapture();
  await router(
    { method: "GET" },
    response,
    new URL("http://localhost/api/player-matches/players/Flancy%23PBE2/matches/PBE1_123"),
    { scope: "visitor-a" }
  );
  assert.equal(calls[0].name, "get_match");
  assert.equal(calls[0].input.matchId, "PBE1_123");
});

test("PBE routes return localized match entities and image URLs", async () => {
  const rawMatch = {
    matchId: "PBE1_123",
    traits: [{ id: "DA_18_Greenfather" }],
    units: [{
      characterId: "DA_18_ElderDragon",
      starLevel: 2,
      items: ["DA_InfinityEdge"]
    }]
  };
  const router = createPlayerMatchApiRouter({
    client: {
      async callTool(name) {
        return name === "get_match"
          ? { match: rawMatch, provenance: { cacheStatus: "miss" } }
          : { matches: [rawMatch], provenance: { cacheStatus: "miss" } };
      }
    }
  });

  const listResponse = responseCapture();
  await router(
    { method: "GET" },
    listResponse,
    new URL("http://localhost/api/player-matches/players/Flancy%23PBE2?limit=20")
  );
  assert.equal(listResponse.body.matches[0].units[0].displayName, "远古巨龙");
  assert.equal(listResponse.body.matches[0].traits[0].displayName, "翠神");
  assert.equal(listResponse.body.matches[0].units[0].items[0].displayName, "无尽之刃");

  const detailResponse = responseCapture();
  await router(
    { method: "GET" },
    detailResponse,
    new URL("http://localhost/api/player-matches/players/Flancy%23PBE2/matches/PBE1_123")
  );
  assert.match(detailResponse.body.match.units[0].iconUrl, /^https:\/\//u);
});

test("PBE teaching keeps MetaTFT provenance and missing-field evidence", async () => {
  const router = createPlayerMatchApiRouter({
    client: {
      async callTool(name) {
        assert.equal(name, "list_matches");
        return {
          matches: [{
            matchId: "PBE1_1",
            playedAt: "2026-08-12T00:00:00.000Z",
            patch: "18.1",
            placement: 4,
            level: 8,
            lastRound: 32,
            traits: [{ id: "DA_Test" }],
            units: [{ characterId: "DA_Unit", starLevel: 2, items: ["DA_Item"] }],
            missingFields: ["augments"]
          }],
          warnings: [],
          provenance: { provider: "metatft", environment: "pbe", season: "set18-pbe" }
        };
      }
    }
  });
  const response = responseCapture();
  await router(
    { method: "GET" },
    response,
    new URL("http://localhost/api/player-matches/players/Flancy%23PBE2/teaching"),
    { scope: "visitor-a" }
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.provenance.provider, "metatft");
  assert.deepEqual(response.body.missingFields, ["augments"]);
  assert.equal(response.body.validated, true);
  assert.equal(response.body.dashboard.matches.length, 1);
  assert.equal(response.body.dashboard.stats.top4Rate, 1);
});

test("review dashboard aggregates repeated comps and keeps concise per-match points", () => {
  const makeMatch = (matchId, placement) => ({
    facts: {
      matchId,
      gameDatetime: "2026-08-14T00:00:00.000Z",
      placement,
      level: 8,
      lastRound: 35,
      traits: [{ name: "DA_18_Invoker_2", displayName: "神谕" }],
      units: [{
        characterId: "DA_18_Ahri",
        displayName: "阿狸",
        tier: 2,
        items: [{ apiName: "DA_Item" }, { apiName: "DA_Item2" }, { apiName: "DA_Item3" }]
      }]
    },
    conclusions: [{ conclusion: `该局进入前四（第${placement}名）。` }]
  });
  const dashboard = buildReviewDashboard({
    windowSize: 20,
    accumulatedMatches: 2,
    stats: { avgPlacement: 2, top4Rate: 1 },
    matches: [makeMatch("PBE1_1", 1), makeMatch("PBE1_2", 3)]
  });
  assert.equal(dashboard.comps.length, 1);
  assert.equal(dashboard.comps[0].name, "神谕 / 阿狸");
  assert.equal(dashboard.comps[0].games, 2);
  assert.equal(dashboard.comps[0].avgPlacement, 2);
  assert.equal(dashboard.comps[0].top4Rate, 1);
  assert.equal(dashboard.comps[0].winRate, 0.5);
  assert.equal(dashboard.matches[0].keyPoint, "该局进入前四（第1名）。");
});
