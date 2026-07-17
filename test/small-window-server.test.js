import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MemoryCacheStore,
  SESSION_LAST_QUERY_KEY,
  SQLiteCacheStore,
  createCatalog,
  recommendForInput
} from "../src/index.js";
import {
  createSmallWindowRuntimeAsync,
  createSmallWindowRuntime,
  handleCacheClearRequest,
  handleEntityAliasBatchReviewRequest,
  handleEntityAliasExportRequest,
  handleEntityAliasReviewRequest,
  handleEntityAliasesRequest,
  handleEntityMemoryClearRequest,
  handleFeedbackRequest,
  handlePreferencesRequest,
  handlePreferencesResetRequest,
  handleRecommendRequest,
  handleRuntimeStatusRequest,
  invalidateRuntimeCatalog,
  loadRuntimeCatalog,
  loadSmallWindowPreferences,
  normalizeSmallWindowPreferences,
  normalizeSmallWindowCacheStoreType,
  prewarmSmallWindowCatalog,
  resolveSmallWindowCacheOptions,
  resolveSmallWindowRequestTimeouts,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

const fixtureRows = [
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_LastWhisper|TFT_Item_Deathblade",
    placement_count: [60, 55, 50, 50, 40, 30, 20, 10]
  }
];

const compPageFixture = JSON.parse(await readFile(
  new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

async function flushMicrotasksUntil(predicate, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return true;
    await Promise.resolve();
  }
  return predicate();
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createCountingCatalogClients(calls, options = {}) {
  const invoke = async (name, fallback) => {
    calls[name] = (calls[name] ?? 0) + 1;
    const attempt = calls[name];
    await options.beforeResponse?.(name, attempt);
    const configured = options.responses?.[name];
    return typeof configured === "function"
      ? configured(attempt)
      : configured ?? fallback;
  };

  return {
    metaTFTClient: {
      getItems: () => invoke("items", { data: [{ items: "TFT_Item_GuinsoosRageblade" }] }),
      getUnitsUnique: () => invoke("units", { data: [{ units_unique: "TFT17_Xayah-1" }] }),
      getTraits: () => invoke("traits", { data: [{ traits: "TFT17_Stargazer_1" }] })
    },
    compsClient: {
      getLatestClusterInfo: () => invoke("latest", []),
      getCompOptions: () => invoke("options", [{
        cluster: "counting-default",
        units_list: "TFT17_Xayah&TFT17_Aatrox",
        traits_list: "TFT17_Stargazer_1&TFT17_RangedTrait_1",
        count: 200,
        score: 70,
        avg: 4.1
      }]),
      getCompBuilds: () => invoke("builds", [])
    }
  };
}

class FakeSQLiteStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }

  run(...params) {
    return this.database.run(this.sql, params);
  }

  get(...params) {
    return this.database.get(this.sql, params);
  }
}

class FakeSQLiteDatabase {
  constructor() {
    this.schema = "";
    this.userPreferences = new Map();
  }

  exec(sql) {
    this.schema += sql;
  }

  prepare(sql) {
    return new FakeSQLiteStatement(this, sql);
  }

  run(sql, params) {
    if (/INSERT INTO user_preferences/i.test(sql)) {
      const [key, value_json, updated_at] = params;
      this.userPreferences.set(key, {
        key,
        value_json,
        updated_at
      });
      return { changes: 1 };
    }

    if (/DELETE FROM user_preferences WHERE key = \?/i.test(sql)) {
      const deleted = this.userPreferences.delete(params[0]);
      return { changes: deleted ? 1 : 0 };
    }

    if (/DELETE FROM \w+ WHERE expires_at IS NOT NULL/i.test(sql) || /DELETE FROM \w+$/i.test(sql)) {
      return { changes: 0 };
    }

    throw new Error(`FakeSQLiteDatabase does not support SQL: ${sql}`);
  }

  get(sql, params) {
    if (/FROM user_preferences WHERE key = \?/i.test(sql)) {
      return this.userPreferences.get(params[0]) ?? null;
    }
    throw new Error(`FakeSQLiteDatabase does not support SQL: ${sql}`);
  }
}

test("normalizes small-window preference payloads", () => {
  assert.deepEqual(normalizeSmallWindowPreferences({
    minSamples: "500",
    itemPolicy: "include_artifact",
    sort: "win_first",
    days: "7",
    structuredParserMode: "always",
    rankFilter: ["PLATINUM", "diamond", "NOPE"],
    ignored: true
  }), {
    minSamples: 500,
    itemPolicy: "include_artifact",
    sort: "win_first",
    days: 7,
    structuredParserMode: "always",
    rankFilter: ["PLATINUM", "DIAMOND"]
  });
  assert.equal(normalizeSmallWindowPreferences({ minSamples: 0 }).minSamples, 0);
});

test("normalizes and resolves small-window cache store options", () => {
  assert.equal(normalizeSmallWindowCacheStoreType("json_file"), "json");
  assert.equal(normalizeSmallWindowCacheStoreType("sqlite3"), "sqlite");
  assert.deepEqual(resolveSmallWindowCacheOptions({}, {
    TFT_AGENT_CACHE_STORE: "sqlite",
    TFT_AGENT_CACHE_PATH: "C:\\tmp\\tft-agent.sqlite"
  }), {
    type: "sqlite",
    cachePath: "C:\\tmp\\tft-agent.sqlite"
  });
  assert.throws(() => normalizeSmallWindowCacheStoreType("memory"), /Unsupported/);
});

test("resolves bounded small-window request timeouts from options and environment", () => {
  assert.deepEqual(resolveSmallWindowRequestTimeouts({}, {}), {
    explorerTimeoutMs: 2200,
    catalogTimeoutMs: 2200,
    compsTimeoutMs: 2200,
    compRankingsTimeoutMs: 8000
  });
  assert.deepEqual(resolveSmallWindowRequestTimeouts({
    explorerTimeoutMs: 1800
  }, {
    TFT_AGENT_EXPLORER_TIMEOUT_MS: "3000",
    TFT_AGENT_CATALOG_TIMEOUT_MS: "2400",
    TFT_AGENT_COMPS_TIMEOUT_MS: "2600",
    TFT_AGENT_COMP_RANKINGS_TIMEOUT_MS: "9000"
  }), {
    explorerTimeoutMs: 1800,
    catalogTimeoutMs: 2400,
    compsTimeoutMs: 2600,
    compRankingsTimeoutMs: 9000
  });
});

test("small-window runtime can use an injected SQLite cache store", async () => {
  const database = new FakeSQLiteDatabase();
  const runtime = await createSmallWindowRuntimeAsync({
    cacheStoreType: "sqlite",
    sqliteDatabase: database,
    catalog: createCatalog(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  }, {});

  assert.equal(runtime.cacheStore instanceof SQLiteCacheStore, true);
  assert.match(database.schema, /CREATE TABLE IF NOT EXISTS user_preferences/);

  await handlePreferencesRequest({
    preferences: {
      minSamples: 500,
      rankFilter: ["MASTER"]
    }
  }, runtime);
  const loaded = await loadSmallWindowPreferences(runtime);

  assert.equal(loaded.minSamples, 500);
  assert.deepEqual(loaded.rankFilter, ["MASTER"]);
});

test("sync small-window runtime requires an injected database for SQLite", () => {
  assert.throws(() => createSmallWindowRuntime({
    cacheStoreType: "sqlite",
    catalog: createCatalog(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  }), /requires sqliteDatabase/);
});

test("small-window runtime status exposes safe cache and LLM metadata", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    cacheStoreInfo: {
      type: "json",
      cachePath: ".cache/small-window-cache.json",
      persistent: true
    },
    structuredParserConfig: {
      enabled: true,
      provider: "chat",
      mode: "auto",
      endpoint: "https://llm.local/v1/chat/completions",
      apiKey: "secret",
      model: "test-model",
      timeoutMs: 1500
    },
    catalog: createCatalog(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  const status = await handleRuntimeStatusRequest(runtime);

  assert.equal(status.ok, true);
  assert.deepEqual(status.runtime.cache, {
    type: "json",
    persistent: true,
    pathConfigured: true,
    cachePath: ".cache/small-window-cache.json"
  });
  assert.deepEqual(status.runtime.structuredParser, {
    enabled: true,
    provider: "chat",
    mode: "auto",
    endpointConfigured: true,
    apiKeyConfigured: true,
    model: "test-model",
    timeoutMs: 1500
  });
  assert.deepEqual(status.runtime.requests, {
    explorerTimeoutMs: 2200,
    catalogTimeoutMs: 2200,
    compsTimeoutMs: 2200,
    compRankingsTimeoutMs: 8000
  });
  assert.equal("endpoint" in status.runtime.structuredParser, false);
  assert.equal("apiKey" in status.runtime.structuredParser, false);
});

test("handleRecommendRequest serializes result cards for the small window", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: fixtureRows
    })
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "xayah",
    preferences: {
      minSamples: 100
    }
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.cards[0].title, "推荐");
  assert.deepEqual(payload.unit, {
    apiName: "TFT17_Xayah",
    name: "霞",
    iconUrl: payload.query.unitIconUrl
  });
  assert.deepEqual(payload.cards[0].items.map((item) => item.name), ["羊刀", "无尽", "巨杀"]);
  assert.equal(payload.query.unitName, "霞");
  assert.match(payload.query.unitIconUrl, /^https:\/\/cdn\.metatft\.com\/file\/metatft\/champions\//);
  assert.ok(payload.cards[0].items.every((item) => item.iconUrl?.startsWith("https://ddragon.leagueoflegends.com/")));
  assert.equal(payload.query.minSamples, 100);
  assert.equal(payload.meta.rankedBuilds, 2);
  assert.deepEqual(payload.commonCore.map((item) => item.name), ["羊刀"]);
  assert.equal(payload.cards[1].difference.removed.length > 0, true);
  assert.deepEqual(payload.lockedItems, []);

  const owned = await handleRecommendRequest({
    input: "霞已经有羊刀，剩下两件怎么带？",
    preferences: {
      minSamples: 100
    }
  }, runtime);

  assert.equal(owned.statusCode, 200);
  assert.equal(owned.payload.cards[0].title, "推荐补齐");
  assert.equal(owned.payload.cards[0].items.find((item) => item.locked)?.name, "羊刀");

  const localized = await handleRecommendRequest({
    input: "２星 xia，３guanxing，已經有yangdao，剩下兩件怎麼帶？",
    preferences: {
      minSamples: 100
    }
  }, runtime);

  assert.equal(localized.statusCode, 200);
  assert.equal(localized.payload.query.unitName, "霞");
  assert.equal(localized.payload.cards[0].title, "推荐补齐");
  assert.equal(localized.payload.cards[0].items.find((item) => item.locked)?.name, "羊刀");
});

test("handleRecommendRequest returns official item encyclopedia details before recommendation logic", async () => {
  const catalog = createCatalog({
    items: [{
      apiName: "TFT_Item_UnstableConcoction",
      zhName: "正义之手",
      shortName: "正义",
      preferredDisplayName: "正义",
      aliases: ["正义", "正义之手", "合剂"],
      category: "ordinary_completed",
      current: true,
      obtainable: true
    }]
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: new Map([["TFT_Item_UnstableConcoction", {
      apiName: "TFT_Item_UnstableConcoction",
      name: "正义之手",
      effect: "获得伤害增幅和全能吸血",
      recipe: [{ apiName: "TFT_Item_TearOfTheGoddess", name: "女神之泪", iconUrl: null }],
      iconUrl: null,
      craftable: true,
      sourceUrl: "https://example.test/equip.js"
    }]]),
    recommendForInputImpl: () => {
      throw new Error("item encyclopedia must not call recommendation logic");
    }
  });

  const { statusCode, payload } = await handleRecommendRequest({ input: "合剂是什么装备？" }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.type, "item_details");
  assert.equal(payload.item.name, "正义");
  assert.equal(payload.item.officialName, "正义之手");
  assert.equal(payload.item.effect, "获得伤害增幅和全能吸血");
  assert.equal(payload.item.recipe[0].name, "女神之泪");
});

test("handleRecommendRequest returns unit stats, ability, and three stable item recommendations", async () => {
  const items = [
    ["TFT_Item_A", "装备甲"],
    ["TFT_Item_B", "装备乙"],
    ["TFT_Item_C", "装备丙"],
    ["TFT_Item_D", "装备丁"]
  ].map(([apiName, zhName]) => ({ apiName, zhName, aliases: [zhName], category: "ordinary_completed", current: true, obtainable: true }));
  const catalog = createCatalog({
    units: [{ apiName: "TFT17_MasterYi", zhName: "剑圣", aliases: ["剑圣", "易"] }],
    traits: [],
    items
  });
  const officialEntityDetails = {
    units: new Map([["TFT17_MasterYi", {
      apiName: "TFT17_MasterYi",
      name: "易",
      cost: 4,
      role: "物理战士",
      traitNames: ["灵能特工", "狂战士"],
      stats: { health: 1100, mana: 60, startingMana: 20, attackDamage: 60, armor: 65, magicResist: 65, attackSpeed: 0.85, attackRange: 1, critChance: 25 },
      ability: { name: "灵能打击", type: "主动", description: "造成伤害。", iconUrl: null },
      source: { version: "16.14", season: "2026.S17" }
    }]]),
    traits: new Map(),
    meta: { version: "16.14", season: "2026.S17" }
  };
  const ranking = (apiName, games, top4Rate, avgPlacement) => ({
    apiName,
    stats: { games, top4Rate, winRate: 0.1, avgPlacement },
    coverage: 0.2,
    coverageDenominatorGames: 1000,
    buildCount: 10,
    commonPairings: [],
    copyCounts: []
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialEntityDetails,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: async () => ({ itemRankings: [
      ranking("TFT_Item_A", 800, 0.60, 3.8),
      ranking("TFT_Item_B", 700, 0.58, 3.9),
      ranking("TFT_Item_C", 500, 0.57, 4.0),
      ranking("TFT_Item_D", 20, 0.75, 3.2)
    ] })
  });

  const { statusCode, payload } = await handleRecommendRequest({ input: "剑圣的属性和技能是什么？" }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.type, "unit_details");
  assert.equal(payload.unit.name, "剑圣");
  assert.equal(payload.unit.stats.health, 1100);
  assert.equal(payload.unit.ability.name, "灵能打击");
  assert.equal(payload.recommendedItems.length, 3);
  assert.deepEqual(payload.recommendedItems.map((item) => item.name), ["装备甲", "装备乙", "装备丙"]);
  assert.match(payload.answer.methodology, /登场频率/);
});

test("handleRecommendRequest returns official trait effects and tiers", async () => {
  const catalog = createCatalog({
    units: [],
    traits: [{ apiName: "TFT17_ASTrait", filterId: "TFT17_ASTrait_2", zhName: "挑战者", displayName: "挑战者", aliases: ["挑战者"] }],
    items: []
  });
  const runtime = createSmallWindowRuntime({
    catalog,
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialEntityDetails: {
      units: new Map(),
      traits: new Map([["TFT17_ASTrait", {
        apiName: "TFT17_ASTrait",
        name: "挑战者",
        type: "job",
        description: "你的队伍获得攻击速度。",
        levels: [{ units: 2, effect: "15% 攻击速度" }],
        iconUrl: null,
        source: { version: "16.14" }
      }]]),
      meta: { version: "16.14" }
    },
    recommendForInputImpl: () => { throw new Error("trait details must not call recommendation logic"); }
  });

  const { statusCode, payload } = await handleRecommendRequest({ input: "挑战者羁绊有什么效果？" }, runtime);
  assert.equal(statusCode, 200);
  assert.equal(payload.type, "trait_details");
  assert.equal(payload.trait.name, "挑战者");
  assert.deepEqual(payload.trait.levels, [{ units: 2, effect: "15% 攻击速度" }]);
});

test("official entity catalogs resolve encyclopedia aliases when the MetaTFT catalog is unavailable", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog({ units: [], traits: [], items: [] }),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialEntityDetails: {
      units: new Map([["TFT17_MasterYi", {
        apiName: "TFT17_MasterYi",
        name: "易",
        stats: { health: 1100 },
        ability: { name: "灵能打击", description: "造成伤害。" },
        traitNames: []
      }]]),
      traits: new Map([["TFT17_ASTrait", {
        apiName: "TFT17_ASTrait",
        name: "挑战者",
        type: "job",
        description: "获得攻击速度。",
        levels: [{ units: 2, effect: "15% 攻击速度" }]
      }]]),
      meta: { version: "16.14" }
    },
    recommendForInputImpl: async () => ({ itemRankings: [] })
  });

  const unit = await handleRecommendRequest({ input: "剑圣的属性和技能是什么？" }, runtime);
  const trait = await handleRecommendRequest({ input: "挑战者羁绊有什么效果？" }, runtime);
  assert.equal(unit.payload.type, "unit_details");
  assert.equal(unit.payload.unit.apiName, "TFT17_MasterYi");
  assert.equal(trait.payload.type, "trait_details");
  assert.equal(trait.payload.trait.apiName, "TFT17_ASTrait");
});

test("unknown item detail wording clarifies before recommendation logic", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: new Map(),
    recommendForInputImpl: () => {
      throw new Error("unknown item details must not enter recommendation logic");
    }
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "量子神剑有什么效果？"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.type, "clarification");
  assert.equal(payload.clarification.reason, "unknown_item_details");
  assert.match(payload.text, /量子神剑/);
});

test("broad comp-ranking wording with 装备效果 is not intercepted as unknown item details", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: new Map(),
    recommendForInputImpl: () => {
      throw new Error("recommendation route reached");
    }
  });

  await assert.rejects(
    handleRecommendRequest({ input: "当前版本什么阵容装备效果强？" }, runtime),
    /recommendation route reached/
  );
});

test("handleRecommendRequest returns the conversational item-ranking schema", async () => {
  const itemRows = [...fixtureRows, {
    unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
    placement_count: [100, 80, 60, 40, 20, 10, 5, 5]
  }];
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: itemRows
    })
  });

  const { payload } = await handleRecommendRequest({
    conversationId: "schema-conversation",
    input: "霞哪个单件装备表现最好？",
    preferences: { minSamples: 10 }
  }, runtime);
  const kraken = payload.itemRankings.find((item) => item.apiName === "TFT_Item_RunaansHurricane");

  assert.equal(payload.conversationId, "schema-conversation");
  assert.equal(typeof payload.messageId, "string");
  assert.equal(payload.type, "unit_item_rankings");
  assert.equal(payload.answer.methodology.includes("重复件只计一次"), true);
  assert.equal(payload.query.constraints.unit.source, "current_input");
  assert.equal(payload.query.constraintSources.days.source, "preference");
  assert.equal(payload.source.endpoint, "/tft-explorer-api/unit_builds/TFT17_Xayah");
  assert.equal(kraken.name, "海妖之怒");
  assert.equal(kraken.copyCounts.some((copy) => copy.copyCount === 2), true);

  const { payload: emptySpecialPayload } = await handleRecommendRequest({
    conversationId: "empty-special-category",
    input: "霞的光明装备哪个最好？",
    preferences: { minSamples: 100 }
  }, runtime);
  assert.equal(emptySpecialPayload.query.minSamples, 0);
  assert.match(emptySpecialPayload.answer.summary, /没有光明装备的单件携带样本/);
});

test("handleRecommendRequest serializes comp rankings without leaking raw rows", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {
      getCompsData: async () => compPageFixture.compsData,
      getCompsStats: async () => compPageFixture.compsStats
    },
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "最热门的阵容",
    preferences: { minSamples: 100 }
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.type, "comp_rankings");
  assert.equal(payload.trend.officialGate.sourcePath, "results.data.comps");
  assert.equal(Array.isArray(payload.trend.officialGate.leaders), true);
  assert.equal(payload.rankings.popularity.length, 4);
  assert.equal(payload.rankings.popularity[0].stats.games, 2000);
  assert.equal(typeof payload.rankings.popularity[0].stats.winShare, "number");
  assert.ok(payload.rankings.popularity[0].traits.some((trait) => trait.tier === 2));
  assert.deepEqual(payload.references, []);
  assert.equal("raw" in payload.rankings.popularity[0], false);
  assert.equal(JSON.stringify(payload).includes("placement_count"), false);

  const lowSample = await handleRecommendRequest({
    input: "最热门的阵容",
    preferences: { minSamples: 100000 }
  }, runtime);
  assert.equal(lowSample.payload.rankings.popularity.length, 0);
  assert.equal(lowSample.payload.references.length, 4);
  assert.ok(lowSample.payload.references.every((comp) => comp.lowSample));
});

test("handleRecommendRequest serializes item comparison cards and aggregate stats", async () => {
  let detailFetches = 0;
  const comparisonRows = [
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [100, 90, 80, 70, 40, 30, 20, 10]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
      placement_count: [70, 60, 50, 40, 40, 30, 20, 10]
    }
  ];
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    fetchOfficialItemDetails: async () => {
      detailFetches += 1;
      return new Map([
        ["TFT_Item_GuinsoosRageblade", { iconUrl: "https://example.test/guinsoo.png" }],
        ["TFT_Item_InfinityEdge", { iconUrl: "https://example.test/ie.png" }]
      ]);
    },
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: comparisonRows
    })
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "2星霞3观星，羊刀和无尽哪个更好？"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.type, "unit_item_comparison");
  assert.equal(payload.query.intent, "unit_item_comparison");
  assert.equal(payload.comparison.winner, "TFT_Item_GuinsoosRageblade");
  assert.equal(payload.comparison.winnerName, "羊刀");
  assert.equal(payload.comparison.entries[0].stats.games, 440);
  assert.equal(detailFetches, 1);
  assert.match(payload.comparison.entries[0].iconUrl, /^https:\/\/example\.test\//);
  assert.deepEqual(payload.lockedItems, []);
  assert.equal(payload.results.length, 2);
  assert.equal(payload.overlap.games, 0);
  assert.equal(payload.decision.primaryMetric, "top4Rate");
  assert.equal(payload.source.endpoint, "tft-explorer-api/unit_builds");
  assert.deepEqual(payload.query.constraintSources.comparison_items, ["current_input"]);
  assert.equal(payload.cards[0].title, "样本领先：羊刀");
  assert.equal(payload.cards[0].winner, true);
  assert.equal(payload.cards[0].items.find((item) => item.compared)?.name, "羊刀");
  assert.equal(payload.cards[0].items.some((item) => item.locked), false);
  assert.equal(payload.cards[1].title, "对比：无尽");
  assert.equal(payload.cards[1].winner, false);
});

test("handleRecommendRequest keeps three-candidate comparison order stable", async () => {
  const rows = [
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_Deathblade|TFT_Item_LastWhisper",
      placement_count: [90, 80, 70, 60, 30, 25, 20, 15]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_Deathblade|TFT_Item_LastWhisper",
      placement_count: [50, 50, 50, 50, 50, 50, 50, 50]
    },
    {
      unit_builds: "TFT17_Xayah&TFT_Item_GiantSlayer|TFT_Item_Deathblade|TFT_Item_LastWhisper",
      placement_count: [20, 25, 30, 35, 60, 60, 55, 55]
    }
  ];
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    officialItemDetails: new Map(),
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: rows
    })
  });

  const { payload } = await handleRecommendRequest({
    input: "霞比较羊刀、无尽和巨杀哪个好？"
  }, runtime);

  assert.equal(payload.type, "unit_item_comparison");
  assert.equal(payload.results.length, 3);
  assert.deepEqual(payload.results.map((entry) => entry.apiName), [
    "TFT_Item_GuinsoosRageblade",
    "TFT_Item_InfinityEdge",
    "TFT_Item_GiantSlayer"
  ]);
});

test("handleRecommendRequest marks low-sample cards explicitly", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: [{
        unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
        placement_count: [5, 4, 3, 2, 1, 1, 1, 1]
      }]
    })
  });

  const { payload } = await handleRecommendRequest({
    input: "2星霞，3观星，携带哪三件普通装备最好？",
    preferences: {
      minSamples: 10
    }
  }, runtime);

  assert.equal(payload.cards.length, 1);
  assert.equal(payload.cards[0].stats.games, 18);
  assert.equal(payload.cards[0].lowSample, true);
  assert.equal(payload.cards[0].title, "低样本参考");
  assert.equal(payload.cards[0].winner, false);
  assert.match(payload.text, /仅供参考，不作稳定推荐/);
});

test("handleRecommendRequest serializes explicit item exclusions", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: [
        {
          unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
          placement_count: [100, 90, 80, 70, 40, 30, 20, 10]
        },
        {
          unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
          placement_count: [90, 80, 70, 60, 40, 30, 20, 10]
        }
      ]
    })
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "霞不要羊刀，其他三件普通装备怎么带？"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.deepEqual(payload.query.ownedItems, []);
  assert.deepEqual(payload.query.excludedItems, ["TFT_Item_GuinsoosRageblade"]);
  assert.deepEqual(payload.query.excludedItemNames, ["羊刀"]);
  assert.equal(payload.cards.some((card) => card.items.some((item) => item.apiName === "TFT_Item_GuinsoosRageblade")), false);
  assert.match(payload.text, /已排除：羊刀/);
});

test.skip("obsolete: handleRecommendRequest serializes readable default context source details", async () => {
  const defaultContext = {
    found: true,
    clusterId: "cluster-xayah",
    compName: "观星霞",
    units: ["TFT17_Xayah"],
    traits: ["TFT17_Stargazer_1"],
    traitFilters: ["TFT17_Stargazer_1"],
    sourceEndpoint: "tft-comps-api/comp_options",
    count: 321,
    score: 8.5,
    avg: 3.42,
    top4Rate: 0.612,
    compBuilds: [
      {
        unit: "TFT17_Xayah",
        items: ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_GiantSlayer"],
        count: 123,
        score: 0.7,
        avg: 3.33,
        placeChange: -0.4,
        unitNumItemsCount: 777,
        sourceEndpoint: "tft-comps-api/comp_builds"
      }
    ],
    candidates: [
      {
        clusterId: "cluster-xayah",
        compName: "观星霞",
        units: ["TFT17_Xayah"],
        traits: ["TFT17_Stargazer_1"],
        count: 321,
        score: 8.5,
        avg: 3.42,
        top4Rate: 0.612
      },
      {
        clusterId: "cluster-sniper",
        compName: "狙神霞",
        units: ["TFT17_Xayah"],
        traits: ["TFT17_Sniper_1"],
        count: 240,
        score: 7.8,
        avg: 3.8,
        top4Rate: 0.58
      }
    ],
    alternatives: [
      {
        clusterId: "cluster-sniper",
        compName: "狙神霞",
        units: ["TFT17_Xayah"],
        traits: ["TFT17_Sniper_1"],
        count: 240,
        score: 7.8,
        avg: 3.8,
        top4Rate: 0.58
      }
    ],
    warning: "默认阵容存在不同羁绊候选：观星霞 / 狙神霞；已按样本优先选择 观星霞。",
    ambiguity: {
      reason: "different_trait_candidates",
      selected: "观星霞",
      alternatives: ["狙神霞"],
      warning: "默认阵容存在不同羁绊候选：观星霞 / 狙神霞；已按样本优先选择 观星霞。"
    },
    sourceDescription: "MetaTFT /comps，按含该英雄阵容的样本数、score 和平均名次选择"
  };
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      defaultContext,
      response: fixtureRows
    })
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "xayah"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.query.defaultContextSummary.label, "观星霞");
  assert.equal(payload.query.defaultContextSummary.clusterId, "cluster-xayah");
  assert.equal(payload.query.defaultContextSummary.count, 321);
  assert.equal(payload.query.defaultContextSummary.avg, 3.42);
  assert.equal(payload.query.defaultContextSummary.top4, 61.2);
  assert.equal(payload.query.defaultContextSummary.top4Rate, 0.612);
  assert.deepEqual(payload.query.defaultContextSummary.traitNames, ["3观星"]);
  assert.deepEqual(payload.query.defaultContextSummary.compBuilds[0].items.map((item) => item.name), ["羊刀", "无尽", "巨杀"]);
  assert.equal(payload.query.defaultContextSummary.compBuilds[0].count, 123);
  assert.equal(payload.query.defaultContextSummary.candidates[1].label, "狙神霞");
  assert.deepEqual(payload.query.defaultContextSummary.alternatives[0].traitFilters, ["TFT17_Sniper_1"]);
  assert.equal(payload.query.defaultContextSummary.ambiguity.reason, "different_trait_candidates");
  assert.match(payload.query.warnings.join("；"), /默认阵容存在不同羁绊候选/);
  assert.match(payload.query.defaultContextSummary.sourceDescription, /MetaTFT \/comps/);
  assert.match(payload.text, /默认阵容来源：MetaTFT \/comps/);
  assert.match(payload.text, /阵容装备参考：羊刀 \+ 无尽 \+ 巨杀/);
});

test("handleRecommendRequest serializes clarification prompts", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: fixtureRows
    })
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "guinsoo"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.cards.length, 0);
  assert.equal(payload.clarification.needsClarification, true);
  assert.equal(payload.clarification.reason, "missing_unit_with_item");
});

test("handleRecommendRequest serializes local entity candidates for clarification", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: fixtureRows
    })
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "xayha best items"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.cards.length, 0);
  assert.equal(payload.clarification.needsClarification, true);
  assert.equal(payload.clarification.reason, "missing_unit");
  assert.equal(payload.clarification.entityCandidates[0].apiName, "TFT17_Xayah");
  assert.equal(payload.clarification.entityCandidates[0].inputFragment, "xayha");
});

test("small-window runtime builds dynamic unit and trait catalog from comps data", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        return { data: [{ items: "TFT_Item_GuinsoosRageblade" }] };
      },
      async getUnitsUnique() {
        return {
          data: [
            { units_unique: "TFT17_Aatrox-1" },
            { units_unique: "TFT17_Xayah-2" }
          ]
        };
      },
      async getTraits() {
        return {
          data: [
            { traits: "TFT17_RangedTrait_1" },
            { traits: "TFT17_Stargazer_1" }
          ]
        };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        return [];
      },
      async getCompOptions() {
        return [
          {
            cluster: "dynamic",
            units_list: "TFT17_Aatrox&TFT17_Xayah",
            traits_list: "TFT17_Stargazer_1&TFT17_RangedTrait_1",
            count: 200,
            score: 70,
            avg: 4.1
          }
        ];
      },
      async getCompBuilds() {
        return {
          results: {
            dynamic: {
              builds: [
                {
                  cluster: "dynamic",
                  unit: "TFT17_Xayah",
                  buildName: ["TFT_Item_GuinsoosRageblade"],
                  count: 10,
                  avg: 4,
                  score: 0.1
                }
              ]
            }
          }
        };
      }
    }
  });

  const { catalog, warning, compsData } = await loadRuntimeCatalog(runtime, {});

  assert.equal(warning, null);
  assert.ok(compsData);
  assert.ok(compsData.compBuilds);
  assert.equal(catalog.unitByApiName.has("TFT17_Aatrox"), true);
  assert.equal(catalog.traitByFilterId.has("TFT17_RangedTrait_1"), true);
  const persistedItems = runtime.cacheStore.getItemCatalog("current").value.items;
  assert.equal(persistedItems.length, catalog.items.length);
  assert.equal(persistedItems.some((item) => item.apiName === "TFT_Item_GuinsoosRageblade"), true);
  assert.equal((await loadRuntimeCatalog(runtime, {})).itemCatalogMemory.source, "remote");
  const persistedDomain = runtime.cacheStore.getDomainCatalog("current").value;
  assert.equal(persistedDomain.units.some((unit) => unit.apiName === "TFT17_Aatrox"), true);
  assert.equal(persistedDomain.traits.some((trait) => trait.filterId === "TFT17_RangedTrait_1"), true);
  assert.equal((await loadRuntimeCatalog(runtime, {})).domainCatalogMemory.unitSource, "remote");
});

test("small-window runtime lets current official identity supersede a stale persisted label", async () => {
  const cacheStore = new MemoryCacheStore();
  cacheStore.setItemCatalog("current", [
    {
      apiName: "TFT_Item_PersistedTest",
      zhName: "持久化测试装备",
      aliases: ["测试装备"],
      category: "ordinary_completed",
      current: true,
      obtainable: true
    },
    {
      apiName: "TFT_Item_RunaansHurricane",
      zhName: "卢安娜的飓风",
      aliases: ["分裂弓"],
      category: "ordinary_completed",
      current: true,
      obtainable: true
    }
  ]);
  cacheStore.setDomainCatalog("current", {
    units: [{
      apiName: "TFT17_PersistedUnit",
      zhName: "持久化英雄",
      aliases: ["持久化英雄"],
      current: true,
      patch: "current",
      source: "metatft_explorer"
    }],
    traits: [{
      filterId: "TFT17_PersistedTrait_1",
      apiName: "TFT17_PersistedTrait",
      zhName: "持久化羁绊",
      displayName: "持久化羁绊",
      aliases: ["持久化羁绊"],
      current: true,
      patch: "current",
      source: "metatft_explorer"
    }]
  });
  const runtime = createSmallWindowRuntime({
    cacheStore,
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        throw new Error("items unavailable");
      },
      async getUnitsUnique() {
        return { data: [] };
      },
      async getTraits() {
        return { data: [] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        return [];
      },
      async getCompOptions() {
        return [];
      },
      async getCompBuilds() {
        return [];
      }
    }
  });

  const entry = await loadRuntimeCatalog(runtime, {});

  assert.equal(entry.itemCatalogMemory.source, "persistent");
  assert.equal(entry.domainCatalogMemory.unitSource, "persistent");
  assert.equal(entry.domainCatalogMemory.traitSource, "persistent");
  assert.equal(entry.catalog.itemByApiName.has("TFT_Item_PersistedTest"), true);
  assert.equal(entry.catalog.unitByApiName.has("TFT17_PersistedUnit"), true);
  assert.equal(entry.catalog.traitByFilterId.has("TFT17_PersistedTrait_1"), true);
  assert.equal(entry.catalog.itemByApiName.get("TFT_Item_RunaansHurricane").category, "ordinary_completed");
  assert.equal(entry.catalog.itemByApiName.get("TFT_Item_RunaansHurricane").current, true);
  assert.equal(entry.catalog.itemByApiName.get("TFT_Item_RunaansHurricane").zhName, "海妖之怒");
  assert.match(entry.warning, /已使用 .* 的持久化装备目录/);
  assert.match(entry.warning, /持久化英雄目录/);
  assert.match(entry.warning, /持久化羁绊目录/);
});

test("small-window runtime keeps the official emblem catalog when the live item endpoint is unavailable", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        throw new Error("items timeout");
      },
      async getUnitsUnique() {
        return { data: [] };
      },
      async getTraits() {
        return { data: [] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        return [];
      },
      async getCompOptions() {
        return [];
      },
      async getCompBuilds() {
        return [];
      }
    }
  });

  const entry = await loadRuntimeCatalog(runtime, {});
  const emblem = entry.catalog.itemByApiName.get("TFT17_Item_HPTankEmblemItem");

  assert.equal(entry.itemCatalogMemory.source, "official_snapshot");
  assert.equal(entry.itemCatalogMemory.items >= 170, true);
  assert.equal(emblem.zhName, "斗士纹章");
  assert.equal(emblem.category, "emblem");
  assert.equal(emblem.current, true);
  assert.match(entry.warning, /本地官方目录快照/);
});

test("concurrent cold catalog loads share one request batch", async () => {
  const gate = deferred();
  const calls = {};
  const clients = createCountingCatalogClients(calls, {
    beforeResponse: async () => gate.promise
  });
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    ...clients
  });

  const first = loadRuntimeCatalog(runtime, {});
  const second = loadRuntimeCatalog(runtime, {});
  assert.equal(await flushMicrotasksUntil(() => calls.items === 1), true);

  assert.deepEqual(calls, {
    items: 1,
    units: 1,
    traits: 1,
    latest: 1,
    options: 1,
    builds: 1
  });
  assert.equal(runtime.catalogLoadPromises.size, 1);

  gate.resolve();
  const [firstEntry, secondEntry] = await Promise.all([first, second]);

  assert.equal(firstEntry, secondEntry);
  assert.equal(runtime.catalogCache.get("current:1100"), firstEntry);
  assert.equal(runtime.catalogLoadPromises.size, 0);
});

test("invalidated slow catalog loads cannot overwrite a newer generation", async () => {
  const firstItemsGate = deferred();
  const calls = {};
  const clients = createCountingCatalogClients(calls, {
    beforeResponse: async (name, attempt) => {
      if (name === "items" && attempt === 1) await firstItemsGate.promise;
    },
    responses: {
      items: (attempt) => ({
        data: [{
          items: attempt === 1 ? "TFT_Item_GuinsoosRageblade" : "TFT_Item_Deathblade",
          marker: attempt
        }]
      })
    }
  });
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    ...clients
  });

  const staleLoad = loadRuntimeCatalog(runtime, {});
  await Promise.resolve();
  invalidateRuntimeCatalog(runtime, "current:1100");
  const freshEntry = await loadRuntimeCatalog(runtime, {});
  firstItemsGate.resolve();
  const staleEntry = await staleLoad;

  assert.equal(calls.items, 2);
  assert.equal(
    freshEntry.catalog.itemByApiName.get("TFT_Item_Deathblade").raw.marker,
    2
  );
  assert.equal(
    staleEntry.catalog.itemByApiName.get("TFT_Item_GuinsoosRageblade").raw.marker,
    1
  );
  assert.equal(runtime.catalogCache.get("current:1100"), freshEntry);
});

test("catalog load failures clear in-flight state and allow retry", async () => {
  let aliasReads = 0;
  const clients = createCountingCatalogClients({});
  const runtime = createSmallWindowRuntime({
    cacheStore: {
      async listEntityAliases() {
        aliasReads += 1;
        if (aliasReads === 1) throw new Error("alias store unavailable");
        return [];
      }
    },
    fetchItems: true,
    ...clients
  });

  await assert.rejects(loadRuntimeCatalog(runtime, {}), /alias store unavailable/);
  assert.equal(runtime.catalogLoadPromises.size, 0);
  assert.equal(runtime.catalogCache.has("current:1100"), false);

  const recovered = await loadRuntimeCatalog(runtime, {});
  assert.ok(recovered.catalog);
  assert.equal(aliasReads, 2);
  assert.equal(runtime.catalogCache.get("current:1100"), recovered);
});

test("small-window startup prewarms the dynamic catalog without delaying listen", async () => {
  const calls = {};
  const clients = createCountingCatalogClients(calls);
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    ...clients
  });
  const started = await startSmallWindowServer({
    host: "127.0.0.1",
    port: 0,
    runtime
  });

  try {
    const prewarm = await started.catalogPrewarm;
    assert.deepEqual(prewarm, {
      ok: true,
      skipped: false,
      key: "current:1100",
      warning: null
    });
    assert.equal(runtime.catalogCache.has("current:1100"), true);
    await loadRuntimeCatalog(runtime, {});
    assert.deepEqual(calls, {
      items: 1,
      units: 1,
      traits: 1,
      latest: 1,
      options: 1,
      builds: 1
    });
  } finally {
    await closeServer(started.server);
  }
});

test("catalog prewarm skips fixed catalogs", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  assert.deepEqual(await prewarmSmallWindowCatalog(runtime), {
    ok: true,
    skipped: true
  });
});

test("small-window runtime keeps comp_options default context when optional comps endpoints fail", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        return { data: [] };
      },
      async getUnitsUnique() {
        return { data: [] };
      },
      async getTraits() {
        return { data: [] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        throw new Error("latest_cluster_info timed out");
      },
      async getCompOptions() {
        return [
          {
            cluster: "comp-options-only",
            units_list: "TFT17_Xayah&TFT17_Aatrox",
            traits_list: "TFT17_Stargazer_1",
            count: 240,
            score: 81,
            avg: 4.05
          }
        ];
      },
      async getCompBuilds() {
        throw new Error("comp_builds timed out");
      }
    }
  });

  const { catalog, warning, compsData } = await loadRuntimeCatalog(runtime, {});

  assert.equal(warning, null);
  assert.deepEqual(compsData.latestClusterInfo, []);
  assert.equal(compsData.compOptions[0].cluster, "comp-options-only");
  assert.deepEqual(compsData.compBuilds, []);
  assert.equal(catalog.unitByApiName.has("TFT17_Xayah"), true);
  assert.equal(catalog.traitByFilterId.has("TFT17_Stargazer_1"), true);
});

test("small-window runtime passes a completed empty comps snapshot after comp_options fails", async () => {
  const calls = {
    latest: 0,
    options: 0,
    builds: 0
  };
  let capturedOptions = null;
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        return { data: [] };
      },
      async getUnitsUnique() {
        return { data: [] };
      },
      async getTraits() {
        return { data: [] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        calls.latest += 1;
        throw new Error("latest_cluster_info unavailable");
      },
      async getCompOptions() {
        calls.options += 1;
        throw new Error("comp_options unavailable");
      },
      async getCompBuilds() {
        calls.builds += 1;
        throw new Error("comp_builds unavailable");
      }
    },
    recommendForInputImpl: async (input, options) => {
      capturedOptions = options;
      return {
        query: {
          unit: "TFT17_Xayah",
          starLevel: [2],
          itemCount: 3,
          traitFilters: [],
          ownedItems: [],
          warnings: []
        },
        rankedBuilds: [],
        rows: [],
        filteredBuilds: [],
        cache: {},
        text: input
      };
    }
  });

  await handleRecommendRequest({ input: "xayah" }, runtime);

  assert.deepEqual(calls, {
    latest: 1,
    options: 1,
    builds: 1
  });
  assert.deepEqual(capturedOptions.compsData, {
    latestClusterInfo: [],
    compOptions: [],
    compBuilds: []
  });
});

test("small-window runtime bounds core Explorer, catalog, and comps timeouts", () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: false
  });

  assert.equal(runtime.metaTFTClient.timeoutMs, 2200);
  assert.equal(runtime.catalogMetaTFTClient.timeoutMs, 2200);
  assert.equal(runtime.compsClient.timeoutMs, 2200);
  assert.equal(runtime.compsClient.rankingsTimeoutMs, 8000);
});

test("async small-window runtime applies environment timeout overrides", async () => {
  const runtime = await createSmallWindowRuntimeAsync({
    cacheStore: new MemoryCacheStore(),
    fetchItems: false
  }, {
    TFT_AGENT_EXPLORER_TIMEOUT_MS: "1900",
    TFT_AGENT_CATALOG_TIMEOUT_MS: "2100",
    TFT_AGENT_COMPS_TIMEOUT_MS: "2300",
    TFT_AGENT_COMP_RANKINGS_TIMEOUT_MS: "9100"
  });

  assert.equal(runtime.metaTFTClient.timeoutMs, 1900);
  assert.equal(runtime.catalogMetaTFTClient.timeoutMs, 2100);
  assert.equal(runtime.compsClient.timeoutMs, 2300);
  assert.equal(runtime.compsClient.rankingsTimeoutMs, 9100);
});

test("small-window runtime keeps Explorer domain catalog when comps context fails", async () => {
  const compsCalls = {
    latest: 0,
    options: 0
  };
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        return { data: [] };
      },
      async getUnitsUnique() {
        return {
          data: [
            { units_unique: "TFT17_Aatrox-1" },
            { units_unique: "TFT17_Xayah-2" }
          ]
        };
      },
      async getTraits() {
        return {
          data: [
            { traits: "TFT17_RangedTrait_1" },
            { traits: "TFT17_Stargazer_1" }
          ]
        };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        compsCalls.latest += 1;
        throw new Error("comps timeout");
      },
      async getCompOptions() {
        compsCalls.options += 1;
        throw new Error("comp_options timeout");
      }
    }
  });

  const { catalog, warning, compsData } = await loadRuntimeCatalog(runtime, {});

  assert.match(warning, /阵容目录辅助端点刷新失败/);
  assert.deepEqual(compsCalls, {
    latest: 1,
    options: 1
  });
  assert.deepEqual(compsData, {
    latestClusterInfo: [],
    compOptions: [],
    compBuilds: []
  });
  assert.equal(catalog.unitByApiName.has("TFT17_Aatrox"), true);
  assert.equal(catalog.traitByFilterId.has("TFT17_RangedTrait_1"), true);
});

test("small-window runtime builds domain catalog from latest cluster when comp options fails", async () => {
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        return { data: [] };
      },
      async getUnitsUnique() {
        return { data: [] };
      },
      async getTraits() {
        return { data: [] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        return [{
          cluster: "latest-only",
          units_list: "TFT17_Aatrox&TFT17_Xayah",
          traits_list: "TFT17_RangedTrait_1",
          count: 320,
          score: 86,
          avg: 3.92
        }];
      },
      async getCompOptions() {
        throw new Error("comp_options invalid JSON");
      }
    }
  });

  const entry = await loadRuntimeCatalog(runtime, {});
  const persisted = runtime.cacheStore.getDomainCatalog("current").value;

  assert.equal(entry.domainCatalogMemory.unitSource, "remote");
  assert.equal(entry.domainCatalogMemory.traitSource, "remote");
  assert.equal(entry.catalog.unitByApiName.has("TFT17_Aatrox"), true);
  assert.equal(entry.catalog.traitByFilterId.has("TFT17_RangedTrait_1"), true);
  assert.equal(persisted.units.some((unit) => unit.apiName === "TFT17_Aatrox"), true);
  assert.equal(persisted.traits.some((trait) => trait.filterId === "TFT17_RangedTrait_1"), true);
  assert.match(entry.warning, /comp_options invalid JSON/);
});

test("small-window runtime fills missing trait tiers from persistent data and reapplies current aliases", async () => {
  const cacheStore = new MemoryCacheStore();
  cacheStore.setDomainCatalog("current", {
    units: [{
      apiName: "TFT17_MasterYi",
      zhName: "易",
      aliases: ["易", "剑圣"],
      current: true,
      patch: "current",
      source: "metatft_explorer"
    }],
    traits: [1, 2, 3].map((tier) => ({
      filterId: `TFT17_HPTank_${tier}`,
      apiName: "TFT17_HPTank",
      zhName: "生命坦克",
      displayName: "生命坦克",
      aliases: ["生命坦克"],
      current: true,
      patch: "current",
      source: "metatft_explorer"
    }))
  });
  const runtime = createSmallWindowRuntime({
    cacheStore,
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        return { data: [] };
      },
      async getUnitsUnique() {
        throw new Error("units timeout");
      },
      async getTraits() {
        throw new Error("traits timeout");
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        return [{
          cluster: "latest-partial",
          units_list: "TFT17_MasterYi",
          traits_list: "TFT17_HPTank_1",
          count: 320,
          score: 86,
          avg: 3.92
        }];
      },
      async getCompOptions() {
        throw new Error("comp_options invalid JSON");
      }
    }
  });

  const entry = await loadRuntimeCatalog(runtime, {});

  assert.equal(entry.domainCatalogMemory.traitSource, "remote");
  assert.equal(entry.catalog.traitByFilterId.get("TFT17_HPTank_1").displayName, "2斗士");
  assert.equal(entry.catalog.traitByFilterId.get("TFT17_HPTank_2").displayName, "4斗士");
  assert.equal(entry.catalog.traitByFilterId.get("TFT17_HPTank_3").displayName, "6斗士");
  assert.equal(entry.catalog.traitByFilterId.get("TFT17_HPTank_2").aliases.includes("4斗士"), true);
  assert.match(entry.warning, /traits timeout/);
  assert.match(entry.warning, /comp_options invalid JSON/);
});

test("small-window preferences persist in the cache store", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  const saved = await handlePreferencesRequest({
    preferences: {
      minSamples: 500,
      itemPolicy: "include_artifact",
      sort: "win_first",
      days: 7,
      rankFilter: ["MASTER", "DIAMOND"]
    }
  }, runtime);
  const loaded = await loadSmallWindowPreferences(runtime);

  assert.equal(saved.ok, true);
  assert.equal(saved.preferences.minSamples, 500);
  assert.equal(loaded.minSamples, 500);
  assert.equal(loaded.itemPolicy, "include_artifact");
  assert.equal(loaded.sort, "win_first");
  assert.equal(loaded.days, 7);
  assert.deepEqual(loaded.rankFilter, ["MASTER", "DIAMOND"]);
});

test("small-window preferences can be reset to defaults", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  await handlePreferencesRequest({
    preferences: {
      minSamples: 500,
      rankFilter: ["GOLD"]
    }
  }, runtime);
  const reset = await handlePreferencesResetRequest(runtime);
  const loaded = await loadSmallWindowPreferences(runtime);

  assert.equal(reset.ok, true);
  assert.equal(reset.preferences.minSamples, 100);
  assert.deepEqual(loaded.rankFilter, ["CHALLENGER", "DIAMOND", "EMERALD", "GRANDMASTER", "MASTER", "PLATINUM"]);
});

test("small-window cache clear removes query history without resetting preferences", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  cacheStore.setQuery("query:history", {
    response: {
      ok: true
    }
  });
  cacheStore.setDefaultContext("default_context:history", {
    unit: "TFT17_Xayah",
    clusterId: "cached"
  });
  cacheStore.setSessionState(SESSION_LAST_QUERY_KEY, {
    query: {
      unit: "TFT17_Xayah"
    }
  });
  runtime.catalogCache.set("current:1100", {
    catalog: createCatalog()
  });
  await handlePreferencesRequest({
    preferences: {
      minSamples: 500,
      rankFilter: ["MASTER"]
    }
  }, runtime);

  const result = await handleCacheClearRequest(runtime);
  const preferences = await loadSmallWindowPreferences(runtime);

  assert.equal(result.ok, true);
  assert.deepEqual(result.cleared, {
    queryCache: 1,
    defaultContextCache: 1,
    sessionState: 1,
    catalogCache: 1
  });
  assert.equal(cacheStore.getQuery("query:history"), null);
  assert.equal(cacheStore.getDefaultContext("default_context:history"), null);
  assert.equal(cacheStore.getSessionState(SESSION_LAST_QUERY_KEY), null);
  assert.equal(preferences.minSamples, 500);
  assert.deepEqual(preferences.rankFilter, ["MASTER"]);
});

test("small-window feedback request stores correction events and disabled alias candidates", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  const result = await handleFeedbackRequest({
    feedbackType: "entity_correction",
    payload: {
      input: "羽毛女",
      correction: "TFT17_Xayah"
    },
    aliasCandidate: {
      alias: "羽毛女",
      entityType: "unit",
      apiName: "TFT17_Xayah",
      confidence: 0.55
    }
  }, runtime);

  assert.equal(result.ok, true);
  assert.equal(result.feedback.feedbackType, "entity_correction");
  assert.equal(result.aliasCandidate.alias, "羽毛女");
  assert.equal(result.aliasCandidate.enabled, false);
  assert.equal(cacheStore.listFeedbackEvents({ feedbackType: "entity_correction" })[0].payload.correction, "TFT17_Xayah");
  assert.equal(cacheStore.findEntityAliases("羽毛女").length, 0);
  assert.equal(cacheStore.listEntityAliases({ enabled: false })[0].apiName, "TFT17_Xayah");
  await assert.rejects(() => handleFeedbackRequest({
    feedbackType: "auto_promote_alias"
  }, runtime), /Unsupported feedback type/);
});

test("recommendation feedback is normalized, idempotent, and does not change preferences", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: fixtureRows
    })
  });
  await handlePreferencesRequest({
    preferences: {
      minSamples: 500,
      sort: "top4_first"
    }
  }, runtime);
  const before = await handleRecommendRequest({ input: "2星霞3观星三件套" }, runtime);

  const first = await handleFeedbackRequest({
    feedbackType: "good_recommendation",
    payload: {
      feedbackId: "result-1:0",
      input: "2星霞3观星三件套",
      cardIndex: 0,
      query: {
        unit: "TFT17_Xayah",
        starLevel: [2],
        traitFilters: ["TFT17_Stargazer_1"],
        itemPolicy: "ordinary_only",
        ownedItems: [],
        minSamples: 500,
        sort: "top4_first",
        patch: "current",
        days: 3,
        rankFilter: ["MASTER"]
      },
      recommendation: {
        title: "推荐",
        items: ["TFT_Item_GuinsoosRageblade", "TFT_Item_InfinityEdge", "TFT_Item_GiantSlayer"],
        top4: 70.6,
        win: 23.5,
        avg: 3.8,
        games: 510,
        lowSample: false,
        winner: true
      },
      cache: {
        hit: true,
        stale: false
      },
      rawResponse: "must not be persisted"
    }
  }, runtime);
  const duplicate = await handleFeedbackRequest({
    feedbackType: "bad_recommendation",
    payload: {
      feedbackId: "result-1:0",
      input: "2星霞3观星三件套"
    }
  }, runtime);
  const after = await handleRecommendRequest({ input: "2星霞3观星三件套" }, runtime);
  const events = cacheStore.listFeedbackEvents();

  assert.equal(first.feedback.feedbackType, "good_recommendation");
  assert.equal(first.feedback.payload.sentiment, "good");
  assert.equal("rawResponse" in first.feedback.payload, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.feedback.id, first.feedback.id);
  assert.equal(events.length, 1);
  assert.equal((await loadSmallWindowPreferences(runtime)).minSamples, 500);
  assert.deepEqual(after.payload.cards, before.payload.cards);
  await assert.rejects(() => handleFeedbackRequest({
    feedbackType: "bad_recommendation",
    payload: { input: "missing id" }
  }, runtime), /requires feedbackId and input/);
});

test("recommendation feedback remains idempotent beyond 500 events and under concurrent writes", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });
  const old = cacheStore.addFeedbackEvent("good_recommendation", {
    feedbackId: "old-result:0",
    input: "old query"
  });
  for (let index = 0; index < 501; index += 1) {
    cacheStore.addFeedbackEvent("general", {
      feedbackId: `newer-${index}`
    });
  }
  const countBefore = cacheStore.listFeedbackEvents({ limit: 1000 }).length;
  const duplicate = await handleFeedbackRequest({
    feedbackType: "bad_recommendation",
    payload: {
      feedbackId: "old-result:0",
      input: "old query"
    }
  }, runtime);

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.feedback.id, old.id);
  assert.equal(cacheStore.listFeedbackEvents({ limit: 1000 }).length, countBefore);

  const concurrentBody = {
    feedbackType: "good_recommendation",
    payload: {
      feedbackId: "concurrent-result:0",
      input: "霞三件套"
    }
  };
  const concurrent = await Promise.all([
    handleFeedbackRequest(concurrentBody, runtime),
    handleFeedbackRequest(concurrentBody, runtime)
  ]);
  assert.equal(concurrent.filter((result) => result.duplicate === true).length, 1);
  assert.equal(cacheStore.listFeedbackEvents({ limit: 1000 })
    .filter((event) => event.payload?.feedbackId === "concurrent-result:0").length, 1);
});

test("small-window can clear candidate entity memory without removing enabled aliases", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });
  cacheStore.addEntityAlias({
    alias: "候选霞",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    enabled: false
  });
  cacheStore.addEntityAlias({
    alias: "保留霞",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    enabled: true
  });
  cacheStore.addFeedbackEvent("entity_correction", {
    input: "候选霞"
  });

  const result = await handleEntityMemoryClearRequest(runtime);

  assert.deepEqual(result, {
    ok: true,
    cleared: {
      candidateAliases: 1,
      feedbackEvents: 1
    }
  });
  assert.equal(cacheStore.listEntityAliases({ enabled: false }).length, 0);
  assert.equal(cacheStore.findEntityAliases("保留霞")[0].apiName, "TFT17_Xayah");
  assert.equal(cacheStore.listFeedbackEvents().length, 0);
});

test("reviewed entity aliases can be enabled and used by the small-window catalog", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => recommendForInput(input, {
      ...options,
      response: fixtureRows
    })
  });
  const feedback = await handleFeedbackRequest({
    feedbackType: "entity_correction",
    payload: {
      input: "羽毛女",
      correction: "TFT17_Xayah"
    },
    aliasCandidate: {
      alias: "羽毛女",
      entityType: "unit",
      apiName: "TFT17_Xayah",
      confidence: 0.7
    }
  }, runtime);

  const before = await handleRecommendRequest({
    input: "羽毛女有羊刀怎么带"
  }, runtime);
  const pending = await handleEntityAliasesRequest(runtime, {
    enabled: false
  });
  const reviewed = await handleEntityAliasReviewRequest({
    id: feedback.aliasCandidate.id,
    enabled: true
  }, runtime);
  const after = await handleRecommendRequest({
    input: "羽毛女有羊刀怎么带"
  }, runtime);

  assert.equal(before.payload.clarification.needsClarification, true);
  assert.equal(pending.aliases[0].alias, "羽毛女");
  assert.equal(reviewed.alias.enabled, true);
  assert.equal(after.payload.ok, true);
  assert.equal(after.payload.query.unit, "TFT17_Xayah");
  assert.deepEqual(after.payload.lockedItems.map((item) => item.apiName), ["TFT_Item_GuinsoosRageblade"]);
  assert.equal(after.payload.meta.aliasMemory.applied, 1);
});

test("small-window can batch review selected entity aliases", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  const first = await handleFeedbackRequest({
    feedbackType: "entity_correction",
    payload: {
      input: "xayah-new",
      correction: "TFT17_Xayah"
    },
    aliasCandidate: {
      alias: "xayah-new",
      entityType: "unit",
      apiName: "TFT17_Xayah",
      confidence: 0.7
    }
  }, runtime);
  const second = await handleFeedbackRequest({
    feedbackType: "alias_candidate",
    payload: {
      input: "guinsoo-new"
    },
    aliasCandidate: {
      alias: "guinsoo-new",
      entityType: "item",
      apiName: "TFT_Item_GuinsoosRageblade",
      confidence: 0.8
    }
  }, runtime);
  runtime.catalogCache.set("current:1100", {
    catalog: createCatalog()
  });

  const enabled = await handleEntityAliasBatchReviewRequest({
    ids: [first.aliasCandidate.id, second.aliasCandidate.id, second.aliasCandidate.id],
    enabled: true
  }, runtime);
  const enabledAliases = await handleEntityAliasesRequest(runtime, {
    enabled: true
  });
  const disabled = await handleEntityAliasBatchReviewRequest({
    ids: [first.aliasCandidate.id],
    enabled: false
  }, runtime);

  assert.equal(enabled.ok, true);
  assert.equal(enabled.updated, 2);
  assert.deepEqual(enabled.missingIds, []);
  assert.equal(runtime.catalogCache.size, 0);
  assert.equal(enabledAliases.aliases.length, 2);
  assert.equal(disabled.aliases[0].enabled, false);
  await assert.rejects(() => handleEntityAliasBatchReviewRequest({
    ids: [],
    enabled: true
  }, runtime), /at least one positive id/);
});

test("small-window can filter and paginate entity aliases", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  cacheStore.addEntityAlias({
    alias: "first-xayah",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    confidence: 0.7,
    enabled: false
  });
  cacheStore.addEntityAlias({
    alias: "second-guinsoo",
    entityType: "item",
    apiName: "TFT_Item_GuinsoosRageblade",
    confidence: 0.8,
    enabled: false
  });
  cacheStore.addEntityAlias({
    alias: "third-enabled",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    confidence: 0.9,
    enabled: true
  });

  const firstPage = await handleEntityAliasesRequest(runtime, {
    enabled: false,
    limit: 1
  });
  const secondPage = await handleEntityAliasesRequest(runtime, {
    enabled: false,
    limit: 1,
    offset: firstPage.pagination.nextOffset
  });
  const searched = await handleEntityAliasesRequest(runtime, {
    query: "guinsoo",
    limit: 5
  });

  assert.equal(firstPage.aliases.length, 1);
  assert.equal(firstPage.pagination.hasMore, true);
  assert.equal(firstPage.pagination.nextOffset, 1);
  assert.equal(secondPage.aliases.length, 1);
  assert.equal(secondPage.pagination.hasMore, false);
  assert.equal(searched.aliases[0].alias, "second-guinsoo");
});

test("small-window can export entity alias override drafts for manual review", async () => {
  const cacheStore = new MemoryCacheStore();
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore,
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  await handleFeedbackRequest({
    feedbackType: "entity_correction",
    payload: {
      input: "羽毛女",
      correction: "TFT17_Xayah"
    },
    aliasCandidate: {
      alias: "羽毛女",
      entityType: "unit",
      apiName: "TFT17_Xayah",
      confidence: 0.7
    }
  }, runtime);
  await handleFeedbackRequest({
    feedbackType: "alias_candidate",
    payload: {
      input: "鬼索刀"
    },
    aliasCandidate: {
      alias: "鬼索刀",
      entityType: "item",
      apiName: "TFT_Item_GuinsoosRageblade",
      confidence: 0.8
    }
  }, runtime);

  const exported = await handleEntityAliasExportRequest(runtime, {
    enabled: false
  });

  assert.equal(exported.ok, true);
  assert.equal(exported.draft.unitOverrides[0].apiName, "TFT17_Xayah");
  assert.deepEqual(exported.draft.unitOverrides[0].aliases, ["羽毛女"]);
  assert.equal(exported.draft.itemOverrides[0].apiName, "TFT_Item_GuinsoosRageblade");
  assert.match(exported.draft.text, /CANDIDATE_UNIT_ALIAS_OVERRIDES/);
  assert.match(exported.draft.text, /CANDIDATE_ITEM_ALIAS_OVERRIDES/);
  assert.match(exported.draft.text, /Review manually/);
});

test("handleRecommendRequest uses saved preferences unless request overrides them", async () => {
  const capturedParserModes = [];
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => {
      capturedParserModes.push(options.useStructuredParser);
      return recommendForInput(input, {
        ...options,
        response: fixtureRows
      });
    }
  });

  await handlePreferencesRequest({
    preferences: {
      minSamples: 500,
      days: 7,
      structuredParserMode: "never",
      rankFilter: ["MASTER", "DIAMOND"]
    }
  }, runtime);

  const savedOnly = await handleRecommendRequest({
    input: "xayah"
  }, runtime);
  const overridden = await handleRecommendRequest({
    input: "xayah",
    preferences: {
      minSamples: 100,
      structuredParserMode: "always"
    }
  }, runtime);

  assert.equal(savedOnly.payload.query.minSamples, 500);
  assert.equal(savedOnly.payload.query.days, 7);
  assert.deepEqual(savedOnly.payload.query.rankFilter, ["MASTER", "DIAMOND"]);
  assert.equal(savedOnly.payload.meta.rankedBuilds, 1);
  assert.equal(overridden.payload.query.minSamples, 100);
  assert.equal(overridden.payload.meta.rankedBuilds, 2);
  assert.deepEqual(capturedParserModes, ["never", "always"]);
});

test("structured parser preference inherits the runtime mode by default", async () => {
  let capturedMode = null;
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    useStructuredParser: "always",
    recommendForInputImpl: (input, options) => {
      capturedMode = options.useStructuredParser;
      return recommendForInput(input, {
        ...options,
        response: fixtureRows
      });
    }
  });

  await handleRecommendRequest({ input: "xayah" }, runtime);

  assert.equal(capturedMode, "always");
});

test("refresh requests bypass query and default-context cache reads", async () => {
  let capturedOptions = null;
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    recommendForInputImpl: (input, options) => {
      capturedOptions = options;
      return recommendForInput(input, {
        ...options,
        response: fixtureRows
      });
    }
  });

  await handleRecommendRequest({
    input: "xayah",
    refresh: true
  }, runtime);

  assert.equal(capturedOptions.bypassQueryCache, true);
  assert.equal(capturedOptions.bypassDefaultContextCache, true);
});

test("refresh requests invalidate only the active runtime catalog entry", async () => {
  const calls = {
    items: 0,
    units: 0,
    traits: 0,
    latest: 0,
    options: 0,
    builds: 0
  };
  const runtime = createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    fetchItems: true,
    metaTFTClient: {
      async getItems() {
        calls.items += 1;
        return { data: [] };
      },
      async getUnitsUnique() {
        calls.units += 1;
        return { data: [] };
      },
      async getTraits() {
        calls.traits += 1;
        return { data: [] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() {
        calls.latest += 1;
        return [];
      },
      async getCompOptions() {
        calls.options += 1;
        return [];
      },
      async getCompBuilds() {
        calls.builds += 1;
        return [];
      }
    },
    recommendForInputImpl: async () => ({
      query: {
        unit: "TFT17_Xayah",
        starLevel: [2],
        itemCount: 3,
        traitFilters: [],
        ownedItems: [],
        warnings: []
      },
      rankedBuilds: [],
      rows: [],
      filteredBuilds: [],
      cache: {},
      text: "ok"
    })
  });

  runtime.catalogCache.set("other:999", { catalog: createCatalog() });
  await handleRecommendRequest({ input: "xayah" }, runtime);
  await handleRecommendRequest({ input: "xayah" }, runtime);
  await handleRecommendRequest({ input: "xayah", refresh: true }, runtime);

  assert.deepEqual(calls, {
    items: 2,
    units: 2,
    traits: 2,
    latest: 2,
    options: 2,
    builds: 2
  });
  assert.equal(runtime.catalogCache.has("other:999"), true);
  assert.equal(runtime.catalogCache.has("current:1100"), true);
});

test("handleRecommendRequest rejects empty input", async () => {
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {}
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: " "
  }, runtime);

  assert.equal(statusCode, 400);
  assert.equal(payload.ok, false);
});
