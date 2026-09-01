import test from "node:test";
import assert from "node:assert/strict";
import { createMetaTftAdapter, validatedMatchUrl, normalizeMatchSummary } from "../services/metatft-player/adapter.mjs";
import { PlayerMatchError } from "../services/metatft-player/errors.mjs";
import { resolveRoutingContext } from "../services/metatft-player/routing.mjs";
import {
  createMemoryCache,
  createPlayerMatchService
} from "../services/metatft-player/service.mjs";

const enabledOptions = {
  masterEnabled: true,
  pbeEnabled: true,
  naEnabled: true
};

test("normalization retains rarity and unknowns instead of inventing cost or activation", () => {
  const value = normalizeMatchSummary(match({ summary: {
    units: [{ character_id: "DA_18_Aphelios", rarity: 3, tier: 2 }, { character_id: "DA_18_Diana", tier: 2 }],
    traits: [{ name: "DA_18_Lunar", num_units: 2, style: 1, tier_current: 1 }, "DA_Riftbeast18_1"]
  } }), { platform: "PBE1", expectedSet: "TFTSet18" });
  assert.equal(value.units[0].rarity, 3);
  assert.equal(value.units[0].cost, null);
  assert.equal(value.units[1].rarity, null);
  assert.equal(value.traits[0].units, 2);
  assert.equal(value.traits[0].tierCurrent, 1);
  assert.equal(value.traits[1].units, undefined);
});

function match(overrides = {}) {
  return {
    riot_match_id: "PBE1_123",
    match_timestamp: 1_786_371_121_985,
    placement: 2,
    queue_id: 1090,
    rating_queue_id: 1100,
    tft_set: "TFTSet18",
    patch: "18.1",
    game_duration: 2200,
    match_data_url: "https://matches3.metatft.com/PBE1_123.json",
    summary: {
      level: 9,
      last_round: 36,
      units: [{ character_id: "DA_Test", tier: 2, itemNames: ["Item_A"] }],
      traits: ["DA_Trait_2"],
      augments: ["Augment_A"]
    },
    ...overrides
  };
}

test("routing accepts numeric PBE/NA tags and rejects ambiguous prefixes", () => {
  assert.equal(
    resolveRoutingContext(
      { gameName: "Flancy", tagLine: "#pbe2", season: "set18-pbe" },
      enabledOptions
    ).platform,
    "PBE1"
  );
  assert.equal(
    resolveRoutingContext(
      { gameName: "Player", tagLine: "NA12", season: "set17-live" },
      enabledOptions
    ).platform,
    "NA1"
  );
  assert.throws(
    () => resolveRoutingContext({ gameName: "x", tagLine: "PBEDEV" }, enabledOptions),
    (error) => error.code === "INVALID_TAG_FORMAT"
  );
  assert.throws(
    () => resolveRoutingContext({ gameName: "x", tagLine: "EUW1" }, enabledOptions),
    (error) => error.code === "UNSUPPORTED_TAG_PREFIX"
  );
});

test("routing rejects explicit environment mismatch before upstream access", () => {
  assert.throws(
    () =>
      resolveRoutingContext(
        {
          gameName: "Flancy",
          tagLine: "PBE2",
          environment: "live",
          season: "set17-live"
        },
        enabledOptions
      ),
    (error) => error.code === "ENVIRONMENT_MISMATCH"
  );
});

test("match URL validator blocks redirect and SSRF-shaped URLs", () => {
  assert.equal(
    validatedMatchUrl("https://matches3.metatft.com/PBE1_123.json", "PBE1_123").hostname,
    "matches3.metatft.com"
  );
  for (const url of [
    "http://matches3.metatft.com/PBE1_123.json",
    "https://evil.example/PBE1_123.json",
    "https://matches3.metatft.com/PBE1_999.json",
    "https://matches3.metatft.com/PBE1_123.json?next=https://evil.example"
  ]) {
    assert.throws(() => validatedMatchUrl(url, "PBE1_123"), PlayerMatchError);
  }
});

test("list matches isolates NA season and reports observed versus available count", async () => {
  const adapter = createMetaTftAdapter({ fetchImpl: async () => assert.fail("not used") });
  adapter.fetchProfile = async () => ({
    matches: [
      match({ riot_match_id: "NA1_10", tft_set: "TFTSet17", match_data_url: "https://matches1.metatft.com/NA1_10.json" }),
      match({ riot_match_id: "NA1_09", tft_set: "TFTSet16", match_data_url: "https://matches1.metatft.com/NA1_09.json" })
    ]
  });
  const service = createPlayerMatchService({ ...enabledOptions, adapter });
  const result = await service.listMatches({
    gameName: "Deis1k",
    tagLine: "NA1",
    environment: "live",
    season: "set17-live",
    limit: 20
  });
  assert.equal(result.observedUpstreamCount, 2);
  assert.equal(result.availableCount, 1);
  assert.equal(result.returnedCount, 1);
  assert.match(result.warnings[0], /filtered_1/);
  assert.equal(result.matches[0].matchId, "NA1_10");
});

test("PBE rejects cross-season contamination", async () => {
  const adapter = createMetaTftAdapter({ fetchImpl: async () => assert.fail("not used") });
  adapter.fetchProfile = async () => ({
    matches: [match(), match({ riot_match_id: "PBE1_old", tft_set: "TFTSet17" })]
  });
  const service = createPlayerMatchService({ ...enabledOptions, adapter });
  await assert.rejects(
    service.listMatches({ gameName: "Flancy", tagLine: "PBE2", season: "set18-pbe" }),
    (error) => error.code === "ENVIRONMENT_MISMATCH"
  );
});

test("profile requests coalesce and cache keys isolate environment and season", async () => {
  let calls = 0;
  const adapter = {
    async fetchProfile() {
      calls += 1;
      return { matches: [match()] };
    },
    normalizeProfile(profile, context) {
      return {
        summaries: profile.matches.map((entry) => ({ matchId: entry.riot_match_id, set: context.expectedSet })),
        warnings: [],
        observedUpstreamCount: 1
      };
    }
  };
  const service = createPlayerMatchService({
    ...enabledOptions,
    adapter,
    cache: createMemoryCache()
  });
  const input = { gameName: "Flancy", tagLine: "PBE2", season: "set18-pbe" };
  const [a, b] = await Promise.all([service.listMatches(input), service.listMatches(input)]);
  assert.equal(calls, 1);
  assert.equal(a.returnedCount, 1);
  assert.equal(b.returnedCount, 1);
  await service.listMatches(input);
  assert.equal(calls, 1);
});

test("season validation and playedAt sorting happen before limit", async () => {
  const adapter = createMetaTftAdapter({ fetchImpl: async () => assert.fail("not used") });
  adapter.fetchProfile = async () => ({
    matches: [
      match({ riot_match_id: "NA1_old", tft_set: "TFTSet17", match_timestamp: 1000, match_data_url: "https://matches1.metatft.com/NA1_old.json" }),
      match({ riot_match_id: "NA1_wrong", tft_set: "TFTSet16", match_timestamp: 3000, match_data_url: "https://matches1.metatft.com/NA1_wrong.json" }),
      match({ riot_match_id: "NA1_new", tft_set: "TFTSet17", match_timestamp: 2000, match_data_url: "https://matches1.metatft.com/NA1_new.json" })
    ]
  });
  const service = createPlayerMatchService({ ...enabledOptions, adapter });
  const result = await service.listMatches({
    gameName: "Deis1k",
    tagLine: "NA1",
    season: "set17-live",
    limit: 10
  });
  assert.equal(result.availableCount, 2);
  assert.equal(result.returnedCount, 2);
  assert.equal(result.matches[0].matchId, "NA1_new");
  assert.equal(result.matches[1].matchId, "NA1_old");
});

test("limit is constrained to the product range of 10 to 20", async () => {
  const adapter = {
    async fetchProfile() { return { matches: [] }; },
    normalizeProfile() { return { summaries: [], warnings: [], observedUpstreamCount: 0 }; }
  };
  const service = createPlayerMatchService({ ...enabledOptions, adapter });
  const input = { gameName: "Flancy", tagLine: "PBE2", season: "set18-pbe" };
  await assert.rejects(service.listMatches({ ...input, limit: 9 }), (error) => error.code === "INVALID_LIMIT");
  await assert.rejects(service.listMatches({ ...input, limit: 21 }), (error) => error.code === "INVALID_LIMIT");
  const result = await service.listMatches({ ...input, limit: 10 });
  assert.equal(result.requestedLimit, 10);
  assert.equal(result.returnedCount, 0);
});

test("list_matches never expands details and get_match expands exactly one", async () => {
  let detailCalls = 0;
  const adapter = createMetaTftAdapter({ fetchImpl: async () => assert.fail("not used") });
  adapter.fetchProfile = async () => ({ matches: [match()] });
  adapter.fetchMatchDetail = async (_context, matchId) => {
    detailCalls += 1;
    return { matchId, units: [], traits: [], missingFields: [] };
  };
  const service = createPlayerMatchService({ ...enabledOptions, adapter });
  await service.listMatches({ gameName: "Flancy", tagLine: "PBE2", season: "set18-pbe" });
  assert.equal(detailCalls, 0);
  await service.getMatch({
    gameName: "Flancy",
    tagLine: "PBE2",
    season: "set18-pbe",
    matchId: "PBE1_123"
  });
  assert.equal(detailCalls, 1);
});

test("standardizes 404, 429, timeout, and schema change failures", async () => {
  for (const [response, code] of [
    [new Response("{}", { status: 404, headers: { "content-type": "application/json" } }), "PLAYER_OR_MATCH_NOT_FOUND"],
    [new Response("{}", { status: 429, headers: { "content-type": "application/json" } }), "RATE_LIMITED"],
    [new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }), "SOURCE_CHANGED"]
  ]) {
    const adapter = createMetaTftAdapter({ fetchImpl: async () => response });
    const context = resolveRoutingContext(
      { gameName: "Flancy", tagLine: "PBE2", season: "set18-pbe" },
      enabledOptions
    );
    await assert.rejects(adapter.fetchProfile(context), (error) => error.code === code);
  }
  const timeoutAdapter = createMetaTftAdapter({
    fetchImpl: async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    }
  });
  const context = resolveRoutingContext(
    { gameName: "Flancy", tagLine: "PBE2", season: "set18-pbe" },
    enabledOptions
  );
  await assert.rejects(
    timeoutAdapter.fetchProfile(context),
    (error) => error.code === "UPSTREAM_TIMEOUT" && error.retryable
  );
});
