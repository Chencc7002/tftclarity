import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryCacheStore,
  MemorySemanticDocumentStore,
  SQLiteCacheStore,
  SQLiteSemanticDocumentStore,
  createCatalog,
  createSeasonContextService,
  makeCompCandidateCacheKey,
  makeQueryCacheKey
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
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
  const live = records.find((record) => record.id === "set17-live");
  const pbe = records.find((record) => record.id === "set18-pbe");

  assert.equal(service.defaultContextId, "set17-live");
  assert.equal(live.selectable, true);
  assert.equal(live.themeId, "set17");
  assert.equal(pbe.status, "coming_soon");
  assert.equal(pbe.selectable, false);
  assert.equal(pbe.availability.available, false);
  assert.equal(live.theme.documentTitle, "tftclarity · Set 17");
  assert.equal(live.theme.wallpaper.seasonId, "set-17");
  assert.equal(live.theme.patchNoteVersion, "17.7");
  assert.equal(pbe.theme.wallpaper.defaultId, null);
  assert.equal(pbe.theme.patchNoteVersion, null);
  assert.match(pbe.theme.riskNotice["en-US"], /cannot be queried/i);
  assert.equal("source" in live, false);
  assert.equal("catalogNamespace" in live, false);
  assert.doesNotMatch(JSON.stringify(records), /api-hc\.metatft\.com|pbe-comps/);
});

test("two selectable live seasons resolve independent UI themes during a simulated switch", () => {
  const registry = createSeasonContextService();
  const set17 = registry.getDefault();
  const set18 = {
    ...structuredClone(set17),
    id: "set18-live",
    label: "Set 18 · Live",
    season: 18,
    isDefault: false,
    catalogNamespace: "set18-live",
    themeId: "set18",
    theme: {
      ...structuredClone(set17.theme),
      documentTitle: "tftclarity · Set 18",
      colors: { primary: "#805ad5", secondary: "#ed64a6" },
      wallpaper: {
        seasonId: "set-18",
        directory: "/assets/wallpapers/set-18/",
        defaultId: "set18-default"
      },
      patchNoteVersion: "18.1"
    }
  };
  const service = createSeasonContextService({ contexts: [set17, set18] });

  const before = service.publicRecord(service.resolveForQuery("set17-live"));
  const after = service.publicRecord(service.resolveForQuery("set18-live"));

  assert.equal(before.id, "set17-live");
  assert.equal(after.id, "set18-live");
  assert.notEqual(after.theme.documentTitle, before.theme.documentTitle);
  assert.notEqual(after.theme.colors.primary, before.theme.colors.primary);
  assert.notEqual(after.theme.wallpaper.seasonId, before.theme.wallpaper.seasonId);
  assert.equal(after.selectable, true);
});

test("invalid and PBE SeasonContexts are rejected before any provider request", async () => {
  let recommendationCalls = 0;
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    fetchItems: false,
    cacheStore: new MemoryCacheStore(),
    recommendForInputImpl: async () => {
      recommendationCalls += 1;
      throw new Error("provider must not be called");
    }
  });

  const pbe = await handleRecommendRequest({
    input: "阵容排行",
    seasonContextId: "set18-pbe"
  }, runtime);
  const invalid = await handleRecommendRequest({
    input: "阵容排行",
    seasonContextId: "https://attacker.invalid/provider"
  }, runtime);

  assert.equal(pbe.statusCode, 409);
  assert.equal(pbe.payload.code, "season_context_coming_soon");
  assert.equal(pbe.payload.seasonContextId, "set18-pbe");
  assert.equal(invalid.statusCode, 404);
  assert.equal(invalid.payload.code, "season_context_not_found");
  assert.equal(recommendationCalls, 0);
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
  store.setQuery("same", { value: "pbe" }, { seasonContextId: "set18-pbe" });
  store.setItemCatalog("current", [{ apiName: "TFT_Item_Same", zhName: "正式服" }], { seasonContextId: "set17-live" });
  store.setItemCatalog("current", [{ apiName: "TFT_Item_Same", zhName: "PBE" }], { seasonContextId: "set18-pbe" });
  store.addEntityAlias({ alias: "同名", entityType: "item", apiName: "TFT_Item_Same", seasonContextId: "set17-live" });
  store.addEntityAlias({ alias: "同名", entityType: "item", apiName: "TFT_Item_Same", seasonContextId: "set18-pbe" });

  assert.equal(store.getQuery("same", { seasonContextId: "set17-live" }).value.value, "live");
  assert.equal(store.getQuery("same", { seasonContextId: "set18-pbe" }).value.value, "pbe");
  assert.equal(store.getItemCatalog("current", { seasonContextId: "set17-live" }).value.items[0].zhName, "正式服");
  assert.equal(store.getItemCatalog("current", { seasonContextId: "set18-pbe" }).value.items[0].zhName, "PBE");
  assert.equal(store.listEntityAliases({ seasonContextId: "set17-live" }).length, 1);
  assert.equal(store.listEntityAliases({ seasonContextId: "set18-pbe" }).length, 1);

  const semantic = new MemorySemanticDocumentStore();
  await semantic.upsert([
    { id: "same", seasonContextId: "set17-live", documentType: "unit", content: "live" },
    { id: "same", seasonContextId: "set18-pbe", documentType: "unit", content: "pbe" }
  ]);
  assert.equal((await semantic.list({ seasonContextId: "set17-live" }))[0].content, "live");
  assert.equal((await semantic.list({ seasonContextId: "set18-pbe" }))[0].content, "pbe");
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
