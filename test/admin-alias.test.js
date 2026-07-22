import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MemoryCacheStore,
  SQLiteCacheStore,
  createCatalog,
  applyEntityAliasesToCatalog,
  parseQuery
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleAdminAliasBackup,
  handleAdminAliasCreate,
  handleAdminAliasDelete,
  handleAdminAliasExport,
  handleAdminAliasImport,
  handleAdminAliasMatch,
  handleAdminAliasUpdate,
  handleAdminAuditRequest,
  handleEntityMemoryClearRequest,
  loadRuntimeCatalog,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

async function nodeSQLite() {
  try {
    return await import("node:sqlite");
  } catch {
    return null;
  }
}

function runtime(options = {}) {
  return createSmallWindowRuntime({
    cacheStore: new MemoryCacheStore(),
    catalog: createCatalog(),
    fetchItems: false,
    adminToken: "admin-secret",
    ...options
  });
}

test("admin alias CRUD is season-scoped, audited and immediately updates the effective catalog", async () => {
  const app = runtime();
  const created = await handleAdminAliasCreate({
    seasonContextId: "set17-live",
    alias: "星弩霞",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    enabled: true
  }, app);
  assert.equal(created.alias.seasonContextId, "set17-live");

  const catalog = (await loadRuntimeCatalog(app, {
    seasonContextId: "set17-live",
    providerVersion: "metatft-live.v1",
    effectivePatch: "current",
    patch: "current",
    queue: "1100"
  })).catalog;
  assert.equal(parseQuery("星弩霞三件装备", { catalog }).unit, "TFT17_Xayah");

  const matched = await handleAdminAliasMatch({
    seasonContextId: "set17-live",
    input: "星弩霞"
  }, app);
  assert.equal(matched.matched, true);
  assert.equal(matched.matches[0].apiName, "TFT17_Xayah");

  const updated = await handleAdminAliasUpdate(created.alias.id, {
    seasonContextId: "set17-live",
    alias: "星弩手",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    enabled: false
  }, app);
  assert.equal(updated.alias.alias, "星弩手");
  assert.equal(updated.alias.enabled, false);

  const removed = await handleAdminAliasDelete(created.alias.id, "set17-live", app);
  assert.equal(removed.alias.alias, "星弩手");
  assert.equal(app.cacheStore.listEntityAliases({ seasonContextId: "set17-live" }).length, 0);

  const audits = await handleAdminAuditRequest(app, { seasonContextId: "set17-live" });
  assert.deepEqual(audits.audits.map((entry) => entry.action), ["delete", "update", "create"]);
});

test("admin import and backup preserve disabled records and reject unknown entity targets", async () => {
  const app = runtime();
  const imported = await handleAdminAliasImport({
    seasonContextId: "set17-live",
    aliases: [
      { alias: "霞霞", entityType: "unit", apiName: "TFT17_Xayah", enabled: true },
      { alias: "羊刀刀", entityType: "item", apiName: "TFT_Item_GuinsoosRageblade", enabled: false }
    ]
  }, app);
  assert.equal(imported.imported, 2);
  const backup = await handleAdminAliasBackup(app, { seasonContextId: "set17-live" });
  assert.equal(backup.schemaVersion, "entity_alias_backup.v1");
  assert.equal(backup.aliases.length, 2);
  assert.equal(backup.aliases.some((alias) => !alias.enabled), true);

  await assert.rejects(() => handleAdminAliasCreate({
    seasonContextId: "set17-live",
    alias: "不存在",
    entityType: "unit",
    apiName: "TFT999_Unknown"
  }, app), /不存在目标实体/);
});

test("an enabled database alias truly overrides the same base JSON alias target", () => {
  const base = createCatalog({
    units: [
      { apiName: "TFT17_Original", zhName: "原实体", aliases: ["共享俗称"] },
      { apiName: "TFT17_Rebound", zhName: "新实体", aliases: [] }
    ],
    items: [],
    traits: []
  });
  const applied = applyEntityAliasesToCatalog(base, [{
    id: 1,
    seasonContextId: "set17-live",
    alias: "共享俗称",
    entityType: "unit",
    apiName: "TFT17_Rebound",
    enabled: true,
    source: "admin"
  }]).catalog;
  const parsed = parseQuery("共享俗称三件装备", { catalog: applied });
  assert.equal(parsed.unit, "TFT17_Rebound");
  assert.equal(parsed.parser.entityAmbiguities.length, 0);
});

test("effective alias export merges base aliases with enabled database overrides", async () => {
  const app = runtime({
    catalog: createCatalog({
      units: [
        { apiName: "TFT17_Original", zhName: "原实体", aliases: ["共享俗称"] },
        { apiName: "TFT17_Rebound", zhName: "新实体", aliases: ["新实体俗称"] }
      ]
    })
  });
  const original = app.catalog.units.find((unit) => unit.apiName === "TFT17_Original");
  const rebound = app.catalog.units.find((unit) => unit.apiName === "TFT17_Rebound");
  const sharedAlias = original.aliases[0];
  await handleAdminAliasCreate({
    seasonContextId: "set17-live",
    alias: sharedAlias,
    entityType: "unit",
    apiName: rebound.apiName,
    enabled: true
  }, app);
  await handleAdminAliasCreate({
    seasonContextId: "set17-live",
    alias: "停用导出测试",
    entityType: "unit",
    apiName: original.apiName,
    enabled: false
  }, app);

  const exported = await handleAdminAliasExport(app, { seasonContextId: "set17-live" });
  assert.equal(exported.schemaVersion, "entity_alias_effective_export.v1");
  assert.equal(exported.aliases.some((entry) => (
    entry.alias === sharedAlias && entry.apiName === rebound.apiName
  )), true);
  assert.equal(exported.aliases.some((entry) => (
    entry.alias === sharedAlias && entry.apiName === original.apiName
  )), false);
  assert.equal(exported.aliases.some((entry) => entry.alias === "停用导出测试"), false);
  assert.equal(exported.aliases.some((entry) => entry.source === "effective"), true);
});

test("admin HTTP entry and mutation APIs enforce server-side authentication", async () => {
  const app = runtime();
  const started = await startSmallWindowServer({
    runtime: app,
    host: "127.0.0.1",
    port: 0,
    prewarmCatalog: false
  });
  try {
    const unauthenticatedPage = await fetch(`${started.url}admin`);
    assert.equal(unauthenticatedPage.status, 401);
    assert.match(unauthenticatedPage.headers.get("www-authenticate"), /Basic/);

    const unauthenticatedApi = await fetch(`${started.url}api/admin/aliases?seasonContextId=set17-live`);
    assert.equal(unauthenticatedApi.status, 404);

    const rejectedWrite = await fetch(`${started.url}api/admin/aliases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(rejectedWrite.status, 403);
    assert.match((await rejectedWrite.json()).error, /authorization required/i);

    for (const pathname of ["api/entity-aliases/review", "api/entity-aliases/review-batch", "api/entity-memory/clear"]) {
      const legacyRejected = await fetch(`${started.url}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1, ids: [1], enabled: true })
      });
      assert.equal(legacyRejected.status, 403, pathname);
    }

    const basic = `Basic ${Buffer.from("admin:admin-secret").toString("base64")}`;
    const authenticatedPage = await fetch(`${started.url}admin`, {
      headers: { authorization: basic }
    });
    assert.equal(authenticatedPage.status, 200);
    assert.match(await authenticatedPage.text(), /赛季内容管理/);

    const created = await fetch(`${started.url}api/admin/aliases`, {
      method: "POST",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        seasonContextId: "set17-live",
        alias: "管理霞",
        entityType: "unit",
        apiName: "TFT17_Xayah"
      })
    });
    assert.equal(created.status, 200);
    const createdPayload = await created.json();
    assert.equal(createdPayload.alias.alias, "管理霞");

    const legacyReviewed = await fetch(`${started.url}api/entity-aliases/review`, {
      method: "POST",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        seasonContextId: "set17-live",
        id: createdPayload.alias.id,
        enabled: false
      })
    });
    assert.equal(legacyReviewed.status, 200);
    assert.equal((await legacyReviewed.json()).alias.enabled, false);
    assert.equal(app.cacheStore.listAdminAudits({ seasonContextId: "set17-live" })[0].action, "disable");
  } finally {
    await new Promise((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
  }
});

test("admin cache clearing affects only the selected season", () => {
  const store = new MemoryCacheStore();
  store.setQuery("same", { season: 17 }, { seasonContextId: "set17-live" });
  store.setQuery("same", { season: 18 }, { seasonContextId: "set18-live" });
  store.clearQueryHistory({ seasonContextId: "set17-live" });
  assert.equal(store.getQuery("same", { seasonContextId: "set17-live" }), null);
  assert.equal(store.getQuery("same", { seasonContextId: "set18-live" }).value.season, 18);
});

test("legacy entity-memory clearing is season-scoped and audited", async () => {
  const app = runtime();
  app.cacheStore.addEntityAlias({
    seasonContextId: "set17-live",
    alias: "候选一",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    enabled: false
  });
  app.cacheStore.addEntityAlias({
    seasonContextId: "set18-pbe",
    alias: "候选二",
    entityType: "unit",
    apiName: "TFT18_Test",
    enabled: false
  });
  app.cacheStore.addFeedbackEvent("correction", { seasonContextId: "set17-live" }, {
    seasonContextId: "set17-live"
  });
  app.cacheStore.addFeedbackEvent("correction", { seasonContextId: "set18-pbe" }, {
    seasonContextId: "set18-pbe"
  });

  const cleared = await handleEntityMemoryClearRequest(app, { seasonContextId: "set17-live" });
  assert.deepEqual(cleared.cleared, { candidateAliases: 1, feedbackEvents: 1 });
  assert.equal(app.cacheStore.listEntityAliases({ seasonContextId: "set17-live" }).length, 0);
  assert.equal(app.cacheStore.listEntityAliases({ seasonContextId: "set18-pbe" }).length, 1);
  assert.equal(app.cacheStore.listFeedbackEvents({ seasonContextId: "set17-live" }).length, 0);
  assert.equal(app.cacheStore.listFeedbackEvents({ seasonContextId: "set18-pbe" }).length, 1);
  assert.equal(app.cacheStore.listAdminAudits({ seasonContextId: "set17-live" })[0].entityType, "entity_memory");
});

test("SQLite persists alias CRUD and admin audit records", async (t) => {
  const sqlite = await nodeSQLite();
  if (!sqlite) return t.skip("node:sqlite is unavailable in this runtime");
  const database = new sqlite.DatabaseSync(":memory:");
  const store = new SQLiteCacheStore({ database });
  const created = store.addEntityAlias({
    seasonContextId: "set17-live",
    alias: "持久霞",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    enabled: true
  });
  const updated = store.updateEntityAlias(created.id, { alias: "持久星弩", enabled: false }, {
    seasonContextId: "set17-live"
  });
  store.addAdminAudit({
    seasonContextId: "set17-live",
    action: "update",
    entityType: "entity_alias",
    entityId: created.id,
    before: created,
    after: updated
  });
  assert.equal(store.getEntityAlias(created.id, { seasonContextId: "set17-live" }).alias, "持久星弩");
  assert.equal(store.listAdminAudits({ seasonContextId: "set17-live" })[0].after.enabled, false);
  assert.equal(store.deleteEntityAlias(created.id, { seasonContextId: "set17-live" }).alias, "持久星弩");
  assert.equal(store.getEntityAlias(created.id, { seasonContextId: "set17-live" }), null);
  database.close();
});

test("database alias overrides survive a real SQLite reopen", async (t) => {
  const sqlite = await nodeSQLite();
  if (!sqlite) return t.skip("node:sqlite is unavailable in this runtime");
  const directory = await mkdtemp(join(tmpdir(), "tftclarity-alias-restart-"));
  const filePath = join(directory, "cache.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const firstDatabase = new sqlite.DatabaseSync(filePath);
  const first = new SQLiteCacheStore({ database: firstDatabase });
  const saved = first.addEntityAlias({
    seasonContextId: "set17-live",
    alias: "重启仍在",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    source: "admin",
    updatedBy: "admin"
  });
  firstDatabase.close();

  const secondDatabase = new sqlite.DatabaseSync(filePath);
  const reopened = new SQLiteCacheStore({ database: secondDatabase });
  const restored = reopened.getEntityAlias(saved.id, { seasonContextId: "set17-live" });
  assert.equal(restored.alias, "重启仍在");
  assert.equal(restored.updatedBy, "admin");
  assert.ok(restored.createdAt);
  secondDatabase.close();
});
