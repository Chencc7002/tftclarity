import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQLiteCacheStore, createCatalog } from "../src/index.js";
import {
  createSmallWindowRuntimeAsync,
  getSmallWindowRuntimeStatus,
  handleRecommendRequest
} from "../src/app/small-window-server.js";

const explicitPath = process.env.SQLITE_SMOKE_PATH;
const keepDatabase = /^(1|true|yes)$/i.test(process.env.SQLITE_SMOKE_KEEP ?? "");
let tempDir = null;
let store = null;
let runtime = null;

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

function assertSmoke(condition, message) {
  if (!condition) {
    throw new Error(`SQLite smoke check failed: ${message}`);
  }
}

function isMissingDriverError(error) {
  return /SQLiteCacheStore requires an injected database, node:sqlite, or better-sqlite3/i
    .test(error instanceof Error ? error.message : String(error));
}

function closeDatabase(database) {
  if (typeof database?.close === "function") {
    database.close();
  }
}

async function resolveSmokePath() {
  if (explicitPath) return resolve(explicitPath);
  tempDir = await mkdtemp(join(tmpdir(), "tft-agent-sqlite-"));
  return join(tempDir, "small-window-cache.sqlite");
}

try {
  const smokePath = await resolveSmokePath();
  console.log(`SQLite smoke path=${smokePath}`);

  store = await SQLiteCacheStore.open({
    filePath: smokePath,
    ttlMs: {
      query: 60_000,
      defaultContext: 60_000,
      session: 60_000
    }
  });

  store.setUserPreference("small_window", {
    minSamples: 500,
    rankFilter: ["MASTER", "DIAMOND"]
  });
  assertSmoke(store.getUserPreference("small_window")?.value.minSamples === 500, "user_preferences roundtrip failed");

  store.setItemCatalog("current", [{
    apiName: "TFT_Item_GuinsoosRageblade",
    zhName: "鬼索的狂暴之刃",
    aliases: ["羊刀", "鬼索"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  }]);
  assertSmoke(
    store.getItemCatalog("current")?.value.items[0].apiName === "TFT_Item_GuinsoosRageblade",
    "item_catalog roundtrip failed"
  );

  const domainCatalog = {
    units: [{
      apiName: "TFT17_Xayah",
      zhName: "霞",
      aliases: ["霞", "逆羽", "xayah"],
      current: true
    }],
    traits: [{
      filterId: "TFT17_Stargazer_1",
      apiName: "TFT17_Stargazer",
      zhName: "观星",
      displayName: "3观星",
      aliases: ["观星", "观星者"],
      current: true
    }]
  };
  store.setDomainCatalog("current", domainCatalog);
  assertSmoke(store.getDomainCatalog("current")?.value.units[0].apiName === "TFT17_Xayah", "units roundtrip failed");
  assertSmoke(
    store.getDomainCatalog("current")?.value.traits[0].filterId === "TFT17_Stargazer_1",
    "traits roundtrip failed"
  );
  const clearedDomainCatalog = store.clearDomainCatalog("current");
  assertSmoke(clearedDomainCatalog.units === 1, "clearDomainCatalog did not clear units");
  assertSmoke(clearedDomainCatalog.traits === 1, "clearDomainCatalog did not clear traits");
  assertSmoke(store.getDomainCatalog("current") === null, "clearDomainCatalog left domain records behind");
  store.setDomainCatalog("current", domainCatalog);

  store.setSessionState("last_query", {
    query: {
      unit: "TFT17_Xayah"
    }
  });
  assertSmoke(store.getSessionState("last_query")?.value.query.unit === "TFT17_Xayah", "session_state roundtrip failed");

  store.setQuery("query:sqlite-smoke", {
    request: {
      endpoint: "unit_builds",
      params: {
        patch: "current"
      }
    },
    response: {
      data: [
        {
          unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
          placement_count: [1, 2, 3, 4, 5, 6, 7, 8]
        }
      ]
    },
    computed: {
      ok: true
    }
  });
  assertSmoke(store.getQuery("query:sqlite-smoke")?.value.response.data.length === 1, "query_cache roundtrip failed");

  store.setDefaultContext("default:TFT17_Xayah", {
    unit: "TFT17_Xayah",
    clusterId: "sqlite-smoke",
    units: ["TFT17_Xayah", "TFT17_Jax"],
    traits: ["TFT17_Stargazer_1"],
    sourceEndpoint: "tft-comps-api/comp_options",
    count: 1000,
    score: 80,
    avg: 4.1,
    patch: "current",
    queue: "1100"
  });
  assertSmoke(
    store.getDefaultContext("default:TFT17_Xayah")?.value.clusterId === "sqlite-smoke",
    "default_context_cache roundtrip failed"
  );

  const alias = store.addEntityAlias({
    alias: "xayah-smoke",
    entityType: "unit",
    apiName: "TFT17_Xayah",
    confidence: 0.9,
    source: "sqlite_smoke",
    enabled: false
  });
  assertSmoke(store.findEntityAliases("xayah-smoke").length === 0, "disabled alias should not resolve by default");
  store.setEntityAliasEnabled(alias.id, true);
  assertSmoke(store.findEntityAliases("xayah-smoke")[0]?.apiName === "TFT17_Xayah", "enabled alias lookup failed");

  const feedback = store.addFeedbackEvent("entity_correction", {
    feedbackId: "sqlite-smoke-feedback",
    input: "xayah-smoke",
    correction: "TFT17_Xayah"
  });
  assertSmoke(store.listFeedbackEvents({ feedbackType: "entity_correction" }).length === 1, "feedback_events roundtrip failed");
  assertSmoke(
    store.findFeedbackEventByFeedbackId("sqlite-smoke-feedback")?.id === feedback.id,
    "feedbackId lookup failed"
  );

  const cleared = store.clearQueryHistory();
  assertSmoke(cleared.queryCache === 1, "clearQueryHistory did not clear query cache");
  assertSmoke(store.getUserPreference("small_window")?.value.minSamples === 500, "clearQueryHistory cleared preferences");
  assertSmoke(store.getItemCatalog("current")?.value.items.length === 1, "clearQueryHistory cleared item catalog");
  assertSmoke(store.getDomainCatalog("current")?.value.units.length === 1, "clearQueryHistory cleared domain catalog");

  closeDatabase(store.database);
  store = null;

  let remoteCalls = 0;
  runtime = await createSmallWindowRuntimeAsync({
    cacheStoreType: "sqlite",
    cachePath: smokePath,
    catalog: createCatalog(),
    fetchItems: false,
    metaTFTClient: {
      async getUnitBuilds() {
        remoteCalls += 1;
        return { data: fixtureRows };
      }
    },
    compsClient: {}
  }, {});
  assertSmoke(getSmallWindowRuntimeStatus(runtime).cache.type === "sqlite", "runtime did not select SQLite");
  const firstRecommendation = await handleRecommendRequest({
    input: "2星霞，3观星，携带哪三件普通装备最好？",
    preferences: { minSamples: 100 }
  }, runtime);
  assertSmoke(firstRecommendation.payload.cards.length > 0, "SQLite runtime recommendation failed");
  assertSmoke(remoteCalls === 1, "SQLite runtime did not seed the query cache exactly once");
  closeDatabase(runtime.cacheStore.database);
  runtime = null;

  let unexpectedRemoteCalls = 0;
  runtime = await createSmallWindowRuntimeAsync({
    cacheStoreType: "sqlite",
    cachePath: smokePath,
    catalog: createCatalog(),
    fetchItems: false,
    metaTFTClient: {
      async getUnitBuilds() {
        unexpectedRemoteCalls += 1;
        throw new Error("reopened SQLite runtime unexpectedly missed query cache");
      }
    },
    compsClient: {}
  }, {});
  const cachedRecommendation = await handleRecommendRequest({
    input: "2星霞，3观星，携带哪三件普通装备最好？",
    preferences: { minSamples: 100 }
  }, runtime);
  assertSmoke(cachedRecommendation.payload.cache?.query?.hit === true, "reopened SQLite runtime missed query cache");
  assertSmoke(unexpectedRemoteCalls === 0, "reopened SQLite runtime called the remote client");
  closeDatabase(runtime.cacheStore.database);
  runtime = null;

  const info = await stat(smokePath);
  console.log(JSON.stringify({
    ok: true,
    filePath: smokePath,
    bytes: info.size,
    cleared,
    clearedDomainCatalog,
    runtime: {
      remoteCalls,
      reopenedCacheHit: cachedRecommendation.payload.cache.query.hit,
      unexpectedRemoteCalls
    },
    kept: Boolean(explicitPath || keepDatabase)
  }, null, 2));
  console.log("SQLite smoke checks passed.");
} catch (error) {
  if (isMissingDriverError(error)) {
    console.log("SQLite smoke skipped: no SQLite driver is available.");
    console.log("Install better-sqlite3 or run a Node.js version that provides node:sqlite, then rerun `npm run smoke:sqlite`.");
    console.log(error.message);
  } else {
    throw error;
  }
} finally {
  closeDatabase(runtime?.cacheStore?.database);
  closeDatabase(store?.database);
  if (tempDir && !keepDatabase) {
    await rm(tempDir, {
      recursive: true,
      force: true
    });
  }
}
