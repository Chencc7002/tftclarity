import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryCacheStore,
  MemorySemanticDocumentStore,
  SQLiteCacheStore,
  SQLiteSemanticDocumentStore,
  createAssetResolver,
  createCatalog,
  createSeasonContextService,
  makeCompCandidateCacheKey,
  makeQueryCacheKey
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest,
  loadRuntimeCatalog
} from "../src/app/small-window-server.js";

async function nodeSQLite() {
  try {
    return await import("node:sqlite");
  } catch {
    return null;
  }
}

test("SeasonContext registry exposes only safe public records", () => {
  const service = createSeasonContextService();
  const records = service.listPublic();
  const set17 = records.find((record) => record.id === "set17-live");
  const set18 = records.find((record) => record.id === "set18-live");

  assert.equal(service.defaultContextId, "set18-live");
  assert.equal(set18.selectable, true);
  assert.equal(set18.themeId, "set18");
  assert.equal(set18.status, "live");
  assert.equal(set18.availability.available, true);
  assert.equal(set17.selectable, false);
  assert.equal(set17.status, "unavailable");
  assert.equal(set17.themeId, "set17");
  assert.equal(set18.theme.documentTitle, "TFTClarity｜云顶数据智答");
  assert.equal(set18.theme.wallpaper.seasonId, "set-18");
  assert.equal(set18.theme.patchNoteVersion, "18.1");
  assert.equal(set17.theme.patchNoteVersion, "17.9");
  assert.equal(records.some((record) => record.id === "set18-pbe"), false);
  assert.equal("source" in set18, false);
  assert.equal("catalogNamespace" in set18, false);
  assert.doesNotMatch(JSON.stringify(records), /api-hc\.metatft\.com|pbe-comps/);
});

test("Set 18 live can be selected and queried through its isolated provider context", () => {
  const service = createSeasonContextService();
  const selected = service.resolveForSelection("set18-live");
  const queryable = service.resolveForQuery("set18-live");

  assert.equal(selected.id, "set18-live");
  assert.equal(queryable.id, "set18-live");
  assert.equal(queryable.source.queue, "1100");
  assert.equal(queryable.source.tftSet, "TFTSet18");
  assert.equal(queryable.source.lookupChannel, "latest");
  assert.equal(queryable.currentPatch, "18.1");
  assert.equal(queryable.availability.available, true);
  assert.throws(
    () => service.resolveForSelection("set18-pbe"),
    (error) => error.code === "season_context_not_found"
  );
});

test("Set 18 live catalog uses MetaTFT lookup localization without leaking Set 17 seeds", async () => {
  const cacheStore = new MemoryCacheStore();
  const catalogStoreCalls = [];
  for (const methodName of ["getItemCatalog", "getDomainCatalog", "setItemCatalog", "setDomainCatalog"]) {
    const original = cacheStore[methodName].bind(cacheStore);
    cacheStore[methodName] = (value, options, maybeOptions) => {
      const storeOptions = methodName.startsWith("set") ? maybeOptions : options;
      catalogStoreCalls.push({ methodName, options: storeOptions });
      return original(value, options, maybeOptions);
    };
  }
  const runtime = createSmallWindowRuntime({
    cacheStore,
    catalogMetaTFTClient: {
      async getItems() {
        return { data: [{ items: "DA_JeweledGauntlet" }] };
      },
      async getUnitsUnique() {
        return { data: [{ units_unique: "TFT18_Ahri-1" }] };
      },
      async getTraits() {
        return { data: [{ traits: "DA_Riftbeast18_3" }] };
      }
    },
    compsClient: {
      async getLatestClusterInfo() { return {}; },
      async getCompOptions() { return {}; },
      async getCompBuilds() { return {}; },
      async getSetLookup() {
        return {
          items: [{ apiName: "DA_JeweledGauntlet", name: "珠光护手" }],
          units: [{ apiName: "TFT18_Ahri", name: "阿狸", cost: 2 }],
          traits: [{ apiName: "DA_Riftbeast18", name: "裂隙野兽" }]
        };
      }
    }
  });

  const entry = await loadRuntimeCatalog(runtime, {
    seasonContextId: "set18-live",
    providerVersion: "metatft-live.v1",
    effectivePatch: "18.1",
    patch: "current",
    queue: "1100",
    tftSet: "TFTSet18",
    lookupChannel: "latest",
    lookupLocale: "zh_cn"
  });
  const resolver = createAssetResolver();

  assert.equal(entry.catalog.unitByApiName.get("TFT18_Ahri").zhName, "阿狸");
  assert.equal(entry.catalog.unitByApiName.get("TFT18_Ahri").cost, 2);
  assert.equal(entry.catalog.unitByApiName.has("TFT17_Xayah"), false);
  assert.equal(entry.catalog.traitByFilterId.get("DA_Riftbeast18_3").zhName, "峡谷野怪");
  assert.equal(
    entry.catalog.traitByFilterId.get("DA_Riftbeast18_3").aliases.includes("裂隙野兽"),
    true
  );
  assert.equal(entry.catalog.traitByFilterId.has("TFT17_Stargazer_1"), false);
  assert.equal(entry.catalog.itemByApiName.get("DA_JeweledGauntlet").category, "ordinary_completed");
  assert.equal(entry.catalog.itemByApiName.get("DA_JeweledGauntlet").zhName, "珠光护手");
  assert.match(resolver.resolveUnit("TFT18_Ahri").iconUrl, /champions\/tft18_ahri\.png$/);
  assert.match(resolver.resolveUnit("DA_18_Ahri").iconUrl, /champions\/da_18_ahri\.png$/);
  assert.match(resolver.resolveUnit("DA_18_Yorick").fallbackIconUrl, /champions\/tft18_yorick\.png$/);
  assert.match(resolver.resolveUnit("DA_Karma18").iconUrl, /champions\/da_karma18\.png$/);
  assert.match(resolver.resolveItem("DA_JeweledGauntlet").iconUrl, /items\/da_jeweledgauntlet\.png$/);
  assert.match(resolver.resolveTrait("DA_Riftbeast18_3").iconUrl, /traits\/da_riftbeast18\.png$/);
  assert.ok(catalogStoreCalls.length >= 4);
  for (const call of catalogStoreCalls) {
    assert.equal(call.options.seasonContextId, "set18-live");
    assert.equal(call.options.provider, "metatft");
    assert.equal(call.options.providerVersion, "metatft-live.v1");
    assert.equal(call.options.queue, "1100");
  }
});

test("disabled Set 17 retains isolated metadata but rejects selection and queries", () => {
  const service = createSeasonContextService();

  const before = service.publicRecord(service.get("set17-live"));
  for (const resolve of ["resolveForSelection", "resolveForQuery"]) {
    assert.throws(() => service[resolve]("set17-live"), (error) => error.code === "season_context_not_selectable" && error.statusCode === 409);
  }
  assert.equal(before.selectable, false);
  const after = service.publicRecord(service.resolveForQuery("set18-live"));

  assert.equal(before.id, "set17-live");
  assert.equal(after.id, "set18-live");
  assert.notEqual(after.theme.subtitle["zh-CN"], before.theme.subtitle["zh-CN"]);
  assert.notEqual(after.theme.colors.primary, before.theme.colors.primary);
  assert.notEqual(after.theme.wallpaper.seasonId, before.theme.wallpaper.seasonId);
  assert.equal(after.selectable, true);
});

test("Set 18 live requests reach the recommendation path while removed PBE and invalid contexts are rejected", async () => {
  let recommendationCalls = 0;
  let receivedPreferences = null;
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    fetchItems: false,
    cacheStore: new MemoryCacheStore(),
    recommendForInputImpl: async (_input, options) => {
      recommendationCalls += 1;
      receivedPreferences = options.preferences;
      return {
        type: "conversation_exhausted",
        parsed: null,
        query: null,
        validation: { valid: true, errors: [], warnings: [] },
        clarification: null,
        filteredBuilds: [],
        rankedBuilds: [],
        results: [],
        text: "Set 18 ready"
      };
    }
  });

  const live = await handleRecommendRequest({
    input: "阵容排行",
    seasonContextId: "set18-live"
  }, runtime);
  const disabledSet17 = await handleRecommendRequest({input: "阵容排行", seasonContextId: "set17-live"}, runtime);
  assert.equal(disabledSet17.statusCode, 409);
  assert.equal(disabledSet17.payload.code, "season_context_not_selectable");
  const removedPbe = await handleRecommendRequest({
    input: "阵容排行",
    seasonContextId: "set18-pbe"
  }, runtime);
  const invalid = await handleRecommendRequest({
    input: "阵容排行",
    seasonContextId: "https://attacker.invalid/provider"
  }, runtime);

  assert.equal(live.statusCode, 200);
  assert.equal(live.payload.seasonContext.id, "set18-live");
  assert.equal(receivedPreferences.queue, "1100");
  assert.equal(receivedPreferences.tftSet, "TFTSet18");
  assert.equal(removedPbe.statusCode, 404);
  assert.equal(removedPbe.payload.code, "season_context_not_found");
  assert.equal(invalid.statusCode, 404);
  assert.equal(invalid.payload.code, "season_context_not_found");
  assert.equal(recommendationCalls, 1);
});

test("cache fingerprints include SeasonContext, provider version, patch and queue", () => {
  const base = {
    seasonContextId: "set17-live",
    providerVersion: "metatft-live.v1",
    effectivePatch: "17.7",
    patch: "current",
    queue: "1100",
    intent: "comp_rankings",
    days: 3,
    rankFilter: ["CHALLENGER"]
  };
  const key = makeQueryCacheKey(base);
  for (const changed of [
    { seasonContextId: "set18-live" },
    { providerVersion: "metatft-live.v2" },
    { effectivePatch: "17.8" },
    { queue: "PBE" }
  ]) {
    assert.notEqual(makeQueryCacheKey({ ...base, ...changed }), key);
  }
  assert.notEqual(
    makeCompCandidateCacheKey({ ...base, unit: "TFT17_Xayah" }),
    makeCompCandidateCacheKey({ ...base, seasonContextId: "set18-live", unit: "TFT17_Xayah" })
  );
});

test("memory caches, catalogs, aliases and semantic documents are season-isolated", async () => {
  const store = new MemoryCacheStore();
  store.setQuery("same", { value: "live" }, { seasonContextId: "set17-live" });
  store.setQuery("same", { value: "new" }, { seasonContextId: "set18-live" });
  store.setItemCatalog("current", [{ apiName: "TFT_Item_Same", zhName: "正式服" }], { seasonContextId: "set17-live" });
  store.setItemCatalog("current", [{ apiName: "TFT_Item_Same", zhName: "新赛季" }], { seasonContextId: "set18-live" });
  store.addEntityAlias({ alias: "同名", entityType: "item", apiName: "TFT_Item_Same", seasonContextId: "set17-live" });
  store.addEntityAlias({ alias: "同名", entityType: "item", apiName: "TFT_Item_Same", seasonContextId: "set18-live" });

  assert.equal(store.getQuery("same", { seasonContextId: "set17-live" }).value.value, "live");
  assert.equal(store.getQuery("same", { seasonContextId: "set18-live" }).value.value, "new");
  assert.equal(store.getItemCatalog("current", { seasonContextId: "set17-live" }).value.items[0].zhName, "正式服");
  assert.equal(store.getItemCatalog("current", { seasonContextId: "set18-live" }).value.items[0].zhName, "新赛季");
  assert.equal(store.listEntityAliases({ seasonContextId: "set17-live" }).length, 1);
  assert.equal(store.listEntityAliases({ seasonContextId: "set18-live" }).length, 1);

  const semantic = new MemorySemanticDocumentStore();
  await semantic.upsert([
    { id: "same", seasonContextId: "set17-live", documentType: "unit", content: "live" },
    { id: "same", seasonContextId: "set18-live", documentType: "unit", content: "new" }
  ]);
  assert.equal((await semantic.list({ seasonContextId: "set17-live" }))[0].content, "live");
  assert.equal((await semantic.list({ seasonContextId: "set18-live" }))[0].content, "new");
});

test("legacy SQLite rows migrate to set17-live and composite keys accept same entity ids", async (t) => {
  const sqlite = await nodeSQLite();
  if (!sqlite) return t.skip("node:sqlite is unavailable in this runtime");
  const database = new sqlite.DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE session_state (
      key TEXT PRIMARY KEY, value_json TEXT NOT NULL, expires_at TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO session_state VALUES ('legacy-session', '{"turn":1}', NULL, '2026-01-01T00:00:00.000Z');
    CREATE TABLE default_context_cache (
      cache_key TEXT PRIMARY KEY, unit TEXT, cluster_id TEXT, comp_name TEXT,
      units_json TEXT, traits_json TEXT, value_json TEXT NOT NULL, source_endpoint TEXT,
      rank TEXT, days INTEGER, patch TEXT, queue TEXT, score REAL, count INTEGER,
      avg REAL, expires_at TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO default_context_cache (
      cache_key, value_json, updated_at
    ) VALUES ('legacy-default', '{"clusterId":"legacy-cluster"}', '2026-01-01T00:00:00.000Z');
    CREATE TABLE comp_trend_history (
      history_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO comp_trend_history VALUES ('legacy-trend', '{"snapshots":[1]}', '2026-01-01T00:00:00.000Z');
    CREATE TABLE entity_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, alias TEXT NOT NULL, normalized_alias TEXT NOT NULL,
      entity_type TEXT NOT NULL, api_name TEXT NOT NULL, confidence REAL NOT NULL,
      source TEXT NOT NULL, patch TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    INSERT INTO entity_aliases (
      alias, normalized_alias, entity_type, api_name, confidence, source, patch, enabled, updated_at
    ) VALUES ('旧俗称', '旧俗称', 'unit', 'TFT_Unit_Same', 1, 'admin', 'current', 1, '2026-01-01T00:00:00.000Z');
    CREATE TABLE item_catalog (
      api_name TEXT PRIMARY KEY, zh_name TEXT, category TEXT NOT NULL, current INTEGER NOT NULL,
      obtainable INTEGER NOT NULL, patch TEXT NOT NULL, aliases_json TEXT NOT NULL,
      raw_json TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO item_catalog VALUES ('TFT_Item_Same', '旧数据', 'ordinary_completed', 1, 1, 'current', '[]', '{}', '2026-01-01T00:00:00.000Z');
    CREATE TABLE units (
      api_name TEXT PRIMARY KEY, zh_name TEXT, aliases_json TEXT NOT NULL, current INTEGER NOT NULL,
      patch TEXT NOT NULL, raw_json TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO units VALUES ('TFT_Unit_Same', '旧英雄', '[]', 1, 'current', '{}', '2026-01-01T00:00:00.000Z');
    CREATE TABLE traits (
      filter_id TEXT PRIMARY KEY, api_name TEXT NOT NULL, zh_name TEXT, display_name TEXT,
      aliases_json TEXT NOT NULL, current INTEGER NOT NULL, patch TEXT NOT NULL,
      raw_json TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO traits VALUES ('TFT_Trait_Same_1', 'TFT_Trait_Same', '旧羁绊', '旧羁绊', '[]', 1, 'current', '{}', '2026-01-01T00:00:00.000Z');
    CREATE TABLE query_cache (
      cache_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, request_json TEXT, response_json TEXT,
      computed_json TEXT, source TEXT NOT NULL DEFAULT 'metatft', patch TEXT,
      expires_at TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO query_cache VALUES ('legacy', '{"legacy":true}', NULL, NULL, NULL, 'metatft', '17.7', NULL, '2026-01-01T00:00:00.000Z');
  `);

  const store = new SQLiteCacheStore({ database });
  assert.equal(store.getQuery("legacy", { seasonContextId: "set17-live" }).value.legacy, true);
  assert.equal(store.getSessionState("legacy-session", { seasonContextId: "set17-live" }).value.turn, 1);
  assert.equal(store.getDefaultContext("legacy-default", { seasonContextId: "set17-live" }).value.clusterId, "legacy-cluster");
  assert.deepEqual(store.getCompTrendHistory("legacy-trend", { seasonContextId: "set17-live" }).value.snapshots, [1]);
  assert.equal(store.listEntityAliases({ seasonContextId: "set17-live" })[0].alias, "旧俗称");
  assert.equal(store.getItemCatalog("current", { seasonContextId: "set17-live" }).value.items[0].zhName, "旧数据");
  store.setItemCatalog("current", [{
    apiName: "TFT_Item_Same",
    zhName: "新赛季同名装备",
    category: "ordinary_completed",
    current: true,
    obtainable: true,
    patch: "current",
    aliases: []
  }], { seasonContextId: "set18-live" });
  assert.equal(store.getItemCatalog("current", { seasonContextId: "set18-live" }).value.items[0].zhName, "新赛季同名装备");
  assert.equal(store.getItemCatalog("current", { seasonContextId: "set17-live" }).value.items[0].zhName, "旧数据");
  const primaryKey = database.prepare("PRAGMA table_info(item_catalog)").all()
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  assert.deepEqual(primaryKey, ["season_context_id", "api_name"]);
  database.close();
});

test("legacy semantic rows migrate without replacement or cross-season overwrite", async (t) => {
  const sqlite = await nodeSQLite();
  if (!sqlite) return t.skip("node:sqlite is unavailable in this runtime");
  const database = new sqlite.DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE semantic_documents (
      id TEXT PRIMARY KEY, document_type TEXT NOT NULL, api_name TEXT, intent TEXT,
      content TEXT NOT NULL, content_hash TEXT NOT NULL, embedding BLOB,
      embedding_dimensions INTEGER, embedding_model TEXT, patch TEXT, locale TEXT,
      source TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
    );
    INSERT INTO semantic_documents VALUES (
      'same', 'unit', 'TFT_Unit_Same', NULL, '旧语义数据', 'hash', NULL, NULL, NULL,
      'current', 'zh-CN', 'legacy', '{}', '2026-01-01T00:00:00.000Z'
    );
  `);
  const store = new SQLiteSemanticDocumentStore({ database });
  await store.upsert({
    id: "same",
    seasonContextId: "set18-live",
    documentType: "unit",
    content: "新赛季语义数据"
  });
  assert.equal((await store.list({ seasonContextId: "set17-live" }))[0].content, "旧语义数据");
  assert.equal((await store.list({ seasonContextId: "set18-live" }))[0].content, "新赛季语义数据");
  database.close();
});
