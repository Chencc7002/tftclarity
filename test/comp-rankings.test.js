import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MemoryCacheStore,
  buildCompRankings,
  createCompsPageSnapshot,
  createAssetResolver,
  createCatalog,
  normalizeAssetUrl,
  normalizeCompsPageDataResponse,
  normalizeCompsStatsResponse,
  parseQuery,
  recommendForInput,
  validateStructuredParserOutput
} from "../src/index.js";
import { ITEM_ALIAS_OVERRIDES } from "../src/data/item-alias-overrides.js";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

function query(overrides = {}) {
  return {
    metrics: ["top4_rate", "win_rate", "avg_placement", "popularity"],
    limit: 10,
    minSamples: 1,
    patch: "current",
    queue: "1100",
    rankFilter: ["CHALLENGER", "DIAMOND", "EMERALD", "GRANDMASTER", "MASTER", "PLATINUM"],
    specialMode: false,
    ...overrides
  };
}

function ids(values) {
  return values.map((comp) => comp.source.clusterId);
}

test("rule parser recognizes comp leaderboard questions without inventing a unit", () => {
  const strongest = parseQuery("当前版本最强阵容有哪些？");
  assert.equal(strongest.intent, "comp_rankings");
  assert.deepEqual(strongest.metrics, ["top4_rate", "win_rate"]);
  assert.equal(strongest.unit, undefined);
  assert.deepEqual(parseQuery("前四率最高的三个阵容").metrics, ["top4_rate"]);
  assert.equal(parseQuery("前四率最高的三个阵容").limit, 3);
  assert.deepEqual(parseQuery("登顶率最高的阵容").metrics, ["win_rate"]);
  assert.deepEqual(parseQuery("最热门的阵容").metrics, ["popularity"]);
  assert.deepEqual(parseQuery("平均名次最好的阵容").metrics, ["avg_placement"]);
});

test("page response adapters preserve cluster identity and compute the same public metrics", () => {
  const data = normalizeCompsPageDataResponse(fixture.compsData);
  const stats = normalizeCompsStatsResponse(fixture.compsStats);
  assert.equal(data.clusterId, "409");
  assert.equal(data.definitions.length, 6);
  assert.equal(data.definitions.find((row) => row.clusterId === "409090").situational, true);
  assert.equal(stats.clusterId, "409");
  assert.equal(stats.totalGames, 100000);
  const row = stats.rows.find((entry) => entry.clusterId === "409019");
  assert.equal(row.stats.games, 1000);
  assert.equal(row.stats.top4Rate, 0.8);
  assert.equal(row.stats.winRate, 0.2);
  assert.equal(row.stats.avgPlacement, 3.3);
  assert.equal(row.stats.pickRate, 0.01);
});

test("page stats adapter accepts MetaTFT's current space-delimited placement payload", () => {
  const response = structuredClone(fixture.compsStats);
  response.results = response.results.map((row) => ({
    ...row,
    places: Array.isArray(row.places) ? row.places.join(" ") : row.places
  }));
  const stats = normalizeCompsStatsResponse(response);
  const row = stats.rows.find((entry) => entry.clusterId === "409019");

  assert.equal(stats.totalGames, 100000);
  assert.equal(row.stats.games, 1000);
  assert.equal(row.stats.avgPlacement, 3.3);
  assert.equal(row.stats.pickRate, 0.01);
});

test("comp rankings preserve MetaTFT's per-comp three-day placement change and select its improving rows", () => {
  const response = structuredClone(fixture);
  response.compsData.results.data.comps = {
    "409002": { "Average Placement Change": -0.31 },
    "409003": { "Average Placement Change": -0.11 },
    "409019": { "Average Placement Change": -0.1 },
    "409092": { "Average Placement Change": 0.27 }
  };
  const normalized = normalizeCompsPageDataResponse(response.compsData);
  assert.equal(normalized.definitions.find((row) => row.clusterId === "409002").avgPlacementChange, -0.31);

  const result = buildCompRankings(response, { query: query({ minSamples: 1 }), catalog: createCatalog() });
  assert.deepEqual(ids(result.improving), ["409003", "409002"]);
  assert.equal(result.improving[0].trend.improving, true);
  assert.equal(result.improving.find((comp) => comp.source.clusterId === "409002").trend.avgPlacementChange, -0.31);
  assert.equal(result.improving.some((comp) => comp.source.clusterId === "409019"), false);
});

test("daily comp trends reproduce MetaTFT's cold-start three-day improvement values", () => {
  const response = structuredClone(fixture);
  delete response.compsData.results.data.comps;
  const changes = {
    "409019": [4.51, 4.13],
    "409002": [4.47, 4.22],
    "409003": [4.49, 4.31]
  };
  for (const [clusterId, [baseline, latest]] of Object.entries(changes)) {
    response.compsData.results.data.cluster_details[clusterId].trends = [
      { day: "2026-07-13T00:00:00.000Z", count: 1000, avg: baseline },
      { day: "2026-07-14T00:00:00.000Z", count: 1100, avg: baseline - 0.03 },
      { day: "2026-07-15T00:00:00.000Z", count: 1200, avg: latest + 0.04 },
      { day: "2026-07-16T00:00:00.000Z", count: 1300, avg: latest }
    ];
  }

  const normalized = normalizeCompsPageDataResponse(response.compsData);
  const delta = (clusterId) => normalized.definitions
    .find((row) => row.clusterId === clusterId).avgPlacementChange;
  assert.equal(Number(delta("409019").toFixed(2)), -0.38);
  assert.equal(Number(delta("409002").toFixed(2)), -0.25);
  assert.equal(Number(delta("409003").toFixed(2)), -0.18);

  const result = buildCompRankings(response, { query: query({ minSamples: 1 }), catalog: createCatalog() });
  assert.deepEqual(ids(result.improving), ["409019", "409003", "409002"]);
  assert.ok(result.improving.every((comp) => comp.trend.source === "metatft"));
  assert.ok(result.improving.every((comp) => comp.trend.comparedAt === "2026-07-13T00:00:00.000Z"));

  const snapshot = createCompsPageSnapshot(response.compsData, response.compsStats);
  assert.equal(Number(snapshot.compsData.results.data.comps["409019"]["Average Placement Change"].toFixed(2)), -0.38);
  assert.equal(JSON.stringify(snapshot).includes("trends"), false);
});

test("daily comp trends match MetaTFT's incomplete-current-day fallback", () => {
  const response = structuredClone(fixture.compsData);
  delete response.results.data.comps;
  response.results.data.cluster_details["409019"].trends = [
    { day: "2026-07-13T00:00:00.000Z", count: 1000, avg: 4.5, patch: "17.7", b_patch_version: 0 },
    { day: "2026-07-14T00:00:00.000Z", count: 1100, avg: 4.4, patch: "17.7", b_patch_version: 0 },
    { day: "2026-07-15T00:00:00.000Z", count: 1000, avg: 4.2, patch: "17.7", b_patch_version: 0 },
    { day: "2026-07-16T00:00:00.000Z", count: 100, avg: 3.0, patch: "17.7", b_patch_version: 0 }
  ];

  const definition = normalizeCompsPageDataResponse(response).definitions
    .find((row) => row.clusterId === "409019");
  assert.equal(Number(definition.avgPlacementChange.toFixed(2)), -0.3);
});

test("cache snapshot keeps only fields required to reproduce the page leaderboard", () => {
  const snapshot = createCompsPageSnapshot(fixture.compsData, fixture.compsStats);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("build_items"), false);
  assert.equal(serialized.includes("trends"), false);
  const result = buildCompRankings(snapshot, { query: query(), catalog: createCatalog() });
  assert.deepEqual(ids(result.rankings.avgPlacement), fixture.expected.avgPlacement);
  assert.equal(result.rankings.popularity.find((comp) => comp.compId === "cluster:409002").coreBuilds.length, 1);
});

test("offline rankings match MetaTFT page filtering and ordering for every supported metric", () => {
  const result = buildCompRankings(fixture, {
    query: query(),
    catalog: createCatalog()
  });
  assert.deepEqual(ids(result.rankings.avgPlacement), fixture.expected.avgPlacement);
  assert.deepEqual(ids(result.rankings.top4Rate), fixture.expected.top4Rate);
  assert.deepEqual(ids(result.rankings.winRate), fixture.expected.winRate);
  assert.deepEqual(ids(result.rankings.popularity), fixture.expected.popularity);
  assert.deepEqual(
    [...new Set(Object.values(result.rankings).flat().map((comp) => comp.source.clusterId))].sort(),
    [...fixture.expected.visibleClusterIds].sort()
  );
  assert.ok(Object.values(result.rankings).flat().every((comp) => comp.compId.startsWith("cluster:")));
  assert.equal(Object.values(result.rankings).flat().some((comp) => comp.compId.startsWith("fingerprint:")), false);
  assert.equal(result.source.endpoint, "/tft-comps-api/comps_stats");
  assert.equal(result.source.definitionEndpoint, "/tft-comps-api/comps_data");
});

test("default page visibility hides situational, invalid-centroid, and definitionless rows", () => {
  const normal = buildCompRankings(fixture, { query: query(), catalog: createCatalog() });
  assert.ok(normal.diagnostics.rejected.some((row) => row.clusterId === "409090" && row.reason === "hidden_situational"));
  assert.ok(normal.diagnostics.rejected.some((row) => row.clusterId === "409091" && row.reason === "hidden_centroid"));
  assert.ok(normal.diagnostics.rejected.some((row) => row.clusterId === "409999" && row.reason === "missing_comp_definition"));

  const special = buildCompRankings(fixture, {
    query: query({ metrics: ["popularity"], specialMode: true }),
    catalog: createCatalog()
  });
  assert.equal(ids(special.rankings.popularity).includes("409090"), true);
  assert.equal(ids(special.rankings.popularity).includes("409091"), false);
});

test("an explicit sample threshold moves otherwise page-visible comps to references", () => {
  const result = buildCompRankings(fixture, {
    query: query({ metrics: ["popularity"], minSamples: 500 }),
    catalog: createCatalog()
  });
  assert.equal(ids(result.rankings.popularity).includes("409092"), false);
  assert.equal(result.references[0].source.clusterId, "409092");
  assert.equal(result.references[0].lowSample, true);
});

test("comp recommendation caches one paired page response and never calls Explorer rankings", async () => {
  let dataCalls = 0;
  let statsCalls = 0;
  let explorerCalls = 0;
  const cacheStore = new MemoryCacheStore();
  const options = {
    cacheStore,
    catalog: createCatalog(),
    preferences: { minSamples: 1 },
    compsClient: {
      async getCompsData(params) {
        dataCalls += 1;
        assert.deepEqual(params, { queue: "1100" });
        return fixture.compsData;
      },
      async getCompsStats(params) {
        statsCalls += 1;
        assert.equal(params.cluster_id, 409);
        assert.equal(params.permit_filter_adjustment, "true");
        assert.equal(params.rank, "CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM");
        return fixture.compsStats;
      }
    },
    metaTFTClient: {
      async getExactUnitsTraits2() { explorerCalls += 1; }
    }
  };
  const first = await recommendForInput("推荐当前版本热门阵容", options);
  const second = await recommendForInput("推荐当前版本热门阵容", options);
  assert.equal(first.type, "comp_rankings");
  assert.equal(second.cache.query.hit, true);
  assert.equal(dataCalls, 1);
  assert.equal(statsCalls, 1);
  assert.equal(explorerCalls, 0);
});

test("a cold-start comp trend query immediately exposes MetaTFT's official top three", async () => {
  const compsData = structuredClone(fixture.compsData);
  compsData.results.data.comps = {
    "409002": { "Average Placement Change": -0.31 },
    "409003": { "Average Placement Change": -0.22 },
    "409019": { "Average Placement Change": -0.14 },
    "409092": { "Average Placement Change": -0.09 }
  };
  const cacheStore = new MemoryCacheStore();
  const result = await recommendForInput("当前版本阵容趋势", {
    cacheStore,
    catalog: createCatalog(),
    preferences: { minSamples: 1 },
    compsClient: {
      async getCompsData() {
        return compsData;
      },
      async getCompsStats() {
        return fixture.compsStats;
      }
    }
  });

  assert.equal(result.type, "comp_rankings");
  assert.equal(result.cache.query.hit, false);
  assert.equal(result.trend.status, "upstream");
  assert.deepEqual(ids(result.improving), ["409019", "409003", "409002"]);
  assert.deepEqual(
    Object.fromEntries(result.improving.map((comp) => [comp.source.clusterId, comp.trend.avgPlacementChange])),
    { "409019": -0.14, "409003": -0.22, "409002": -0.31 }
  );
  assert.ok(result.improving.every((comp) => comp.trend.source === "metatft"));
});

test("an explicit version-trend question uses MetaTFT's three-day page window", async () => {
  let requestedDays = null;
  const result = await recommendForInput("当前版本阵容趋势", {
    cacheStore: new MemoryCacheStore(),
    catalog: createCatalog(),
    preferences: { minSamples: 1, days: 1 },
    compsClient: {
      async getCompsData() { return fixture.compsData; },
      async getCompsStats(params) {
        requestedDays = params.days;
        return fixture.compsStats;
      }
    }
  });

  assert.equal(result.query.trendRequested, true);
  assert.equal(result.query.days, 3);
  assert.equal(requestedDays, 3);
});

test("a rank-only follow-up inherits comp_rankings intent without leaking other intents", async () => {
  const cacheStore = new MemoryCacheStore();
  const options = {
    cacheStore,
    sessionKey: "comp-follow-up",
    catalog: createCatalog(),
    preferences: { minSamples: 1 },
    compsClient: {
      async getCompsData() { return fixture.compsData; },
      async getCompsStats() { return fixture.compsStats; }
    }
  };
  const first = await recommendForInput("推荐当前版本热门阵容", options);
  const second = await recommendForInput("大师以上呢？", options);
  assert.equal(first.type, "comp_rankings");
  assert.deepEqual(first.query.metrics, ["popularity"]);
  assert.equal(second.type, "comp_rankings");
  assert.deepEqual(second.query.metrics, ["popularity"]);
  assert.deepEqual(second.query.rankFilter, ["CHALLENGER", "GRANDMASTER", "MASTER"]);
  assert.equal(second.cache.session.inherited, true);
  assert.ok(second.cache.session.inheritedKeys.includes("metrics"));

  const isolated = await recommendForInput("大师以上呢？", {
    ...options,
    sessionKey: "new-conversation",
    response: []
  });
  assert.notEqual(isolated.type, "comp_rankings");
});

test("a cluster rollout race refetches definitions and stats once", async () => {
  let dataCalls = 0;
  let statsCalls = 0;
  const result = await recommendForInput("最热门的阵容", {
    catalog: createCatalog(),
    preferences: { minSamples: 1 },
    compsClient: {
      async getCompsData() {
        dataCalls += 1;
        return fixture.compsData;
      },
      async getCompsStats() {
        statsCalls += 1;
        return statsCalls === 1 ? { ...fixture.compsStats, cluster_id: 408 } : fixture.compsStats;
      }
    }
  });
  assert.equal(result.source.clusterId, "409");
  assert.equal(dataCalls, 2);
  assert.equal(statsCalls, 2);
});

test("a persistent cluster mismatch is rejected instead of combining versions", async () => {
  await assert.rejects(() => recommendForInput("最热门的阵容", {
    catalog: createCatalog(),
    preferences: { minSamples: 1 },
    compsClient: {
      async getCompsData() { return fixture.compsData; },
      async getCompsStats() { return { ...fixture.compsStats, cluster_id: 408 }; }
    }
  }), /cluster mismatch after retry/);
});

test("expired paired page data is clearly labeled when the live refresh fails", async () => {
  let now = 1000;
  let fail = false;
  const cacheStore = new MemoryCacheStore({ now: () => now });
  const options = {
    cacheStore,
    queryTtlMs: 100,
    catalog: createCatalog(),
    preferences: { minSamples: 1 },
    compsClient: {
      async getCompsData() {
        if (fail) throw new Error("offline probe");
        return fixture.compsData;
      },
      async getCompsStats() { return fixture.compsStats; }
    }
  };
  const first = await recommendForInput("最热门的阵容", options);
  now += 200;
  fail = true;
  const stale = await recommendForInput("最热门的阵容", options);
  assert.equal(stale.cache.query.hit, true);
  assert.equal(stale.cache.query.stale, true);
  assert.match(stale.warnings[0], /过期阵容榜缓存/);
  assert.equal(stale.source.updatedAt, first.source.updatedAt);
});

test("empty page responses produce an explicit empty leaderboard", async () => {
  const result = await recommendForInput("最热门的阵容", {
    catalog: createCatalog(),
    compResponse: {
      compsData: { results: { data: { cluster_id: 409, cluster_details: {} } } },
      compsStats: { cluster_id: 409, results: [{ cluster: "", places: [0] }] }
    }
  });
  assert.deepEqual(result.rankings.popularity, []);
  assert.deepEqual(result.references, []);
});

test("standard comp wording stays out of the optional LLM hot path", async () => {
  let parserCalls = 0;
  const result = await recommendForInput("推荐当前版本热门阵容", {
    catalog: createCatalog(),
    compResponse: fixture,
    preferences: { minSamples: 1 },
    structuredParser: async () => {
      parserCalls += 1;
      throw new Error("standard comp queries must not call the LLM");
    },
    useStructuredParser: "auto"
  });
  assert.equal(result.type, "comp_rankings");
  assert.equal(parserCalls, 0);
});

test("structured parser schema accepts only controlled comp metrics", () => {
  const valid = validateStructuredParserOutput({
    intent: "comp_rankings",
    entities: { unit_mentions: [], item_mentions: [], trait_mentions: [] },
    constraints: {
      star_level: [], item_count: null, item_policy: null, owned_items: [], excluded_items: [],
      min_samples: 500, sort: null, rank_filter: [], days: 3, patch: "current", queue: "1100",
      metrics: ["top4_rate", "win_rate"], limit: 3
    },
    needs_clarification: false,
    clarification_question: null
  });
  assert.equal(valid.valid, true, valid.errors.join("; "));

  const invalid = validateStructuredParserOutput({
    intent: "comp_rankings",
    entities: {},
    constraints: { metrics: ["secret_score"], limit: 3, generated_comp: "A" },
    needs_clarification: false,
    clarification_question: null
  });
  assert.equal(invalid.valid, false);
});

test("core build decoration preserves hero ownership and localized item labels", async () => {
  const result = await recommendForInput("最热门的阵容", {
    catalog: createCatalog({ items: ITEM_ALIAS_OVERRIDES }),
    compResponse: fixture,
    preferences: { minSamples: 1 }
  });
  const comp = result.rankings.popularity.find((entry) => entry.compId === "cluster:409002");
  const nunu = comp.units.find((unit) => unit.apiName === "TFT17_Nunu");
  assert.equal(nunu.core, true);
  assert.equal(nunu.items.length, 3);
  assert.ok(nunu.items.every((item) => item.name && item.iconUrl));
  assert.equal(nunu.items[0].apiName, "TFT_Item_WarmogsArmor");
});

test("asset resolver continues to reject non-allowlisted URLs", () => {
  const resolver = createAssetResolver();
  assert.ok(resolver.resolveUnit("TFT17_Xayah").iconUrl);
  assert.ok(resolver.resolveItem("TFT_Item_GuinsoosRageblade").iconUrl);
  assert.equal(normalizeAssetUrl("https://evil.example/icon.png"), null);
});
