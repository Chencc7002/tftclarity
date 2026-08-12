import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPlayerMatchApiRouter, parsePlayerId } from "../services/metatft-player/api-router.mjs";

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
});
