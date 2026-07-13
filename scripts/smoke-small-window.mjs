import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonFileCacheStore,
  MemoryCacheStore,
  createCatalog
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

const HOT_CACHE_MAX_MS = Number(process.env.SMOKE_HOT_CACHE_MAX_MS ?? 100);
const LOCAL_CACHE_MAX_MS = Number(process.env.SMOKE_LOCAL_CACHE_MAX_MS ?? 300);

const fixtureRows = [
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_LastWhisper|TFT_Item_Deathblade",
    placement_count: [60, 55, 50, 50, 40, 30, 20, 10]
  },
  {
    unit_builds: "TFT17_Xayah&TFT5_Item_GuinsoosRagebladeRadiant|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [160, 140, 120, 100, 80, 60, 40, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT17_Item_HPTankEmblemItem|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [8, 6, 4, 3, 2, 1, 1, 0]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_InfinityEdge|TFT_Item_GiantSlayer|TFT_Item_Deathblade",
    placement_count: [90, 80, 70, 60, 40, 30, 20, 10]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
    placement_count: [150, 120, 90, 70, 40, 25, 15, 10]
  }
];

const fixtureCompId = "TFT17_Aatrox&TFT17_Xayah|TFT17_Stargazer_1&TFT17_Stargazer_Serpent_1";
const fixtureCompCandidates = {
  data: [
    {
      units_traits: fixtureCompId,
      comp_name: "观星霞",
      placement_count: [220, 190, 160, 130, 80, 50, 30, 20]
    },
    {
      units_traits: "TFT17_Jhin&TFT17_Xayah|TFT17_RangedTrait_1&TFT17_Stargazer_Shield_1",
      comp_name: "狙神霞",
      placement_count: [120, 110, 100, 90, 70, 50, 30, 20]
    }
  ],
  filter_adjustment: { sample_size: 123456 }
};

function assertSmoke(condition, message) {
  if (!condition) {
    throw new Error(`Small-window smoke check failed: ${message}`);
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  assertSmoke(response.ok, payload?.error ?? `${response.status} ${response.statusText}`);
  return payload;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function verifyPersistentLocalCacheTarget() {
  const directory = mkdtempSync(join(tmpdir(), "tft-agent-cache-smoke-"));
  const filePath = join(directory, "cache.json");
  let firstRemoteCalls = 0;
  let unexpectedRemoteCalls = 0;

  try {
    const firstRuntime = createSmallWindowRuntime({
      catalog: createCatalog(),
      cacheStore: new JsonFileCacheStore({ filePath }),
      fetchItems: false,
      metaTFTClient: {
        async getCompCandidates() {
          return fixtureCompCandidates;
        },
        async getUnitBuilds() {
          firstRemoteCalls += 1;
          return { data: fixtureRows };
        }
      },
      compsClient: {}
    });
    const first = await handleRecommendRequest({ input: "xayah" }, firstRuntime);
    assertSmoke(first.payload.ok === true, "persistent cache seed query failed");
    assertSmoke(firstRemoteCalls === 1, "persistent cache seed query did not use remote fixture once");

    const reopenedRuntime = createSmallWindowRuntime({
      catalog: createCatalog(),
      cacheStore: new JsonFileCacheStore({ filePath }),
      fetchItems: false,
      metaTFTClient: {
        async getCompCandidates() {
          unexpectedRemoteCalls += 1;
          throw new Error("persistent Comp candidate cache unexpectedly missed");
        },
        async getUnitBuilds() {
          unexpectedRemoteCalls += 1;
          throw new Error("persistent cache unexpectedly missed");
        }
      },
      compsClient: {}
    });
    const cached = await handleRecommendRequest({ input: "xayah" }, reopenedRuntime);
    assertSmoke(cached.payload.cache?.query?.hit === true, "reopened JSON cache did not hit query cache");
    assertSmoke(unexpectedRemoteCalls === 0, "reopened JSON cache called the remote client");
    assertSmoke(
      cached.payload.meta.durationMs <= LOCAL_CACHE_MAX_MS,
      `local cache exceeded ${LOCAL_CACHE_MAX_MS}ms: ${cached.payload.meta.durationMs}ms`
    );
    return cached.payload.meta.durationMs;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const cacheStore = new MemoryCacheStore();
const seedCatalog = createCatalog();
const smokeCatalog = createCatalog({
  units: [
    ...seedCatalog.units,
    {
      apiName: "TFT17_Aatrox",
      zhName: "亚托克斯",
      aliases: ["亚托克斯", "剑魔", "aatrox"]
    }
  ],
  items: [
    ...seedCatalog.items,
    {
      apiName: "TFT17_Item_HPTankEmblemItem",
      zhName: "斗士纹章",
      shortName: "斗士纹章",
      aliases: ["斗士纹章", "斗士转"],
      category: "emblem",
      current: true,
      obtainable: true
    }
  ]
});
let unitBuildCalls = 0;
let compCandidateCalls = 0;
const runtime = createSmallWindowRuntime({
  catalog: smokeCatalog,
  cacheStore,
  fetchItems: false,
  officialItemDetails: new Map(),
  metaTFTClient: {
    async getCompCandidates(plan) {
      compCandidateCalls += 1;
      if (plan.params.rank === "CHALLENGER") {
        return {
          data: [{
            ...fixtureCompCandidates.data[0],
            placement_count: [1, 1, 1, 1, 1, 1, 1, 1]
          }],
          filter_adjustment: { sample_size: 100 }
        };
      }
      return fixtureCompCandidates;
    },
    async getUnitBuilds() {
      unitBuildCalls += 1;
      return { data: fixtureRows };
    }
  },
  compsClient: {}
});

const started = await startSmallWindowServer({
  host: "127.0.0.1",
  port: 0,
  runtime
});

try {
  const baseUrl = started.url.replace(/\/$/, "");
  console.log(`Small-window smoke url=${started.url}`);
  const catalogPrewarm = await started.catalogPrewarm;
  assertSmoke(catalogPrewarm.ok === true, "catalog prewarm did not complete safely");
  assertSmoke(catalogPrewarm.skipped === true, "fixed-catalog smoke should skip dynamic prewarm");

  const health = await jsonRequest(`${baseUrl}/api/health`);
  assertSmoke(health.ok === true, "health endpoint did not return ok");

  const runtimeStatus = await jsonRequest(`${baseUrl}/api/runtime`);
  assertSmoke(runtimeStatus.runtime?.cache?.type === "memory", "runtime status did not report memory cache");
  assertSmoke(runtimeStatus.runtime?.structuredParser?.enabled === false, "runtime status should show LLM disabled by default");
  assertSmoke(runtimeStatus.runtime?.requests?.explorerTimeoutMs === 2200, "runtime status did not report bounded Explorer timeout");

  const page = await fetch(`${baseUrl}/`);
  assertSmoke(page.ok, "static page did not load");
  assertSmoke((await page.text()).includes("query-input"), "static page is missing query input");

  await jsonRequest(`${baseUrl}/api/preferences`, {
    method: "POST",
    body: JSON.stringify({
      preferences: {
        minSamples: 500,
        structuredParserMode: "never",
        rankFilter: ["MASTER", "DIAMOND"]
      }
    })
  });
  const preferences = await jsonRequest(`${baseUrl}/api/preferences`);
  assertSmoke(preferences.preferences.minSamples === 500, "preferences did not persist");
  assertSmoke(preferences.preferences.structuredParserMode === "never", "structured parser mode did not persist");

  const callsBeforeMultipleUnits = unitBuildCalls;
  const multipleUnits = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞和剑魔哪个装备更好？"
    })
  });
  assertSmoke(multipleUnits.clarification?.reason === "multiple_units", "multi-unit query was not blocked");
  assertSmoke(multipleUnits.clarification.entityCandidates?.length === 2, "multi-unit candidates were not serialized");
  assertSmoke(unitBuildCalls === callsBeforeMultipleUnits, "multi-unit clarification called unit_builds");

  const callsBeforeSortConflict = unitBuildCalls;
  const sortConflict = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞吃鸡优先，但也要稳健高样本"
    })
  });
  assertSmoke(sortConflict.clarification?.reason === "conflicting_sort", "sort conflict was not blocked");
  assertSmoke(unitBuildCalls === callsBeforeSortConflict, "sort conflict called unit_builds");

  const callsBeforeMissingComparison = unitBuildCalls;
  const missingComparison = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞的羊刀和神秘刀哪个好？"
    })
  });
  assertSmoke(
    missingComparison.clarification?.reason === "missing_comparison_option",
    "missing comparison option was not clarified"
  );
  assertSmoke(unitBuildCalls === callsBeforeMissingComparison, "missing comparison option called unit_builds");

  // The comparison clarification intentionally persists its pending unit/items.
  // Start the independent typo-candidate scenario with a clean conversation.
  const clearedPendingComparison = await jsonRequest(`${baseUrl}/api/session/clear`, {
    method: "POST"
  });
  assertSmoke(clearedPendingComparison.ok === true, "pending comparison session was not cleared");

  const clarification = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "xayha best items"
    })
  });
  assertSmoke(clarification.clarification?.reason === "missing_unit", "typo query did not ask for unit clarification");
  assertSmoke(
    clarification.clarification.entityCandidates?.[0]?.apiName === "TFT17_Xayah",
    "typo query did not return Xayah candidate"
  );
  assertSmoke(
    clarification.clarification.entityCandidates[0].inputFragment === "xayha",
    "candidate did not preserve input fragment"
  );

  const callsBeforeUnresolvedItem = unitBuildCalls;
  const unresolvedItem = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞有guinso，剩下两件怎么带？"
    })
  });
  assertSmoke(unresolvedItem.clarification?.reason === "unresolved_item", "item typo was not clarified");
  assertSmoke(
    unresolvedItem.clarification.entityCandidates?.[0]?.apiName === "TFT_Item_GuinsoosRageblade",
    "item typo did not return Guinsoo candidate"
  );
  assertSmoke(unitBuildCalls === callsBeforeUnresolvedItem, "item typo clarification called unit_builds");

  const feedback = await jsonRequest(`${baseUrl}/api/feedback`, {
    method: "POST",
    body: JSON.stringify({
      feedbackType: "alias_candidate",
      payload: {
        input: "xayha best items"
      },
      aliasCandidate: {
        alias: "xayha",
        entityType: "unit",
        apiName: "TFT17_Xayah",
        confidence: 0.8
      }
    })
  });
  assertSmoke(feedback.aliasCandidate?.enabled === false, "alias candidate should be disabled by default");

  const aliases = await jsonRequest(`${baseUrl}/api/entity-aliases?limit=1&query=xayha`);
  assertSmoke(aliases.aliases.length === 1, "alias search did not return saved candidate");
  assertSmoke(aliases.pagination.limit === 1, "alias pagination missing limit");

  const reviewed = await jsonRequest(`${baseUrl}/api/entity-aliases/review`, {
    method: "POST",
    body: JSON.stringify({
      id: feedback.aliasCandidate.id,
      enabled: true
    })
  });
  assertSmoke(reviewed.alias.enabled === true, "alias review did not enable candidate");

  const resolved = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "xayha"
    })
  });
  assertSmoke(resolved.query.unit === "TFT17_Xayah", "enabled alias did not resolve through catalog memory");
  assertSmoke(resolved.cards.length > 0, "enabled alias did not produce recommendation cards");

  const hotCached = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "xayha"
    })
  });
  assertSmoke(hotCached.cache?.query?.hit === true, "repeated query did not hit hot cache");
  assertSmoke(
    hotCached.meta.durationMs <= HOT_CACHE_MAX_MS,
    `hot cache exceeded ${HOT_CACHE_MAX_MS}ms: ${hotCached.meta.durationMs}ms`
  );

  const comparison = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "2星霞3观星，羊刀和无尽哪个更好？",
      preferences: {
        minSamples: 100
      }
    })
  });
  assertSmoke(comparison.comparison?.allQualified === true, "item comparison did not qualify both options");
  assertSmoke(comparison.type === "unit_item_comparison", "item comparison response type was not serialized");
  assertSmoke(comparison.results?.length === 2, "formal comparison results were not serialized");
  assertSmoke(comparison.overlap?.games === 540, "shared-candidate fixture was not isolated as overlap games");
  assertSmoke(comparison.decision?.primaryMetric === "top4Rate", "comparison primary metric was not serialized");
  assertSmoke(comparison.source?.endpoint === "tft-explorer-api/unit_builds", "comparison source endpoint was not serialized");
  assertSmoke(comparison.comparison?.entries?.length === 2, "item comparison did not return two entries");
  assertSmoke(comparison.cards?.length === 2, "item comparison did not return two cards");
  assertSmoke(comparison.cards.every((card) => !card.winner), "overlap-gated comparison incorrectly marked a winner");
  assertSmoke(comparison.decision?.reason === "overlap_too_high", "comparison did not explain the winner gate");
  assertSmoke(comparison.cards.every((card) => card.items.some((item) => item.compared)), "comparison cards did not mark compared items");
  assertSmoke(comparison.lockedItems?.length === 0, "comparison options were incorrectly serialized as locked items");

  const excluded = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞不要羊刀，其他三件普通装备怎么带？",
      preferences: {
        minSamples: 100
      }
    })
  });
  assertSmoke(excluded.query?.ownedItems?.length === 0, "excluded item was serialized as owned");
  assertSmoke(excluded.query?.excludedItemNames?.[0] === "羊刀", "excluded item name was not serialized");
  assertSmoke(excluded.cards?.length > 0, "exclusion query did not return an alternative build");
  assertSmoke(
    excluded.cards.every((card) => card.items.every((item) => item.apiName !== "TFT_Item_GuinsoosRageblade")),
    "excluded item leaked into recommendation cards"
  );
  assertSmoke(excluded.text.includes("已排除：羊刀"), "excluded item was missing from query details");

  const resultFeedbackBody = {
    feedbackType: "good_recommendation",
    payload: {
      feedbackId: "small-window-smoke:comparison:0",
      input: "2星霞3观星，羊刀和无尽哪个更好？",
      cardIndex: 0,
      query: {
        ...comparison.query,
        comparisonOptions: comparison.query?.comparison?.itemApiNames
      },
      recommendation: {
        title: comparison.cards[0].title,
        items: comparison.cards[0].items.map((item) => item.apiName),
        ...comparison.cards[0].stats,
        lowSample: comparison.cards[0].lowSample,
        winner: comparison.cards[0].winner
      },
      cache: comparison.cache?.query
    }
  };
  const resultFeedback = await jsonRequest(`${baseUrl}/api/feedback`, {
    method: "POST",
    body: JSON.stringify(resultFeedbackBody)
  });
  assertSmoke(resultFeedback.feedback?.feedbackType === "good_recommendation", "result feedback was not stored");
  const duplicateFeedback = await jsonRequest(`${baseUrl}/api/feedback`, {
    method: "POST",
    body: JSON.stringify({
      ...resultFeedbackBody,
      feedbackType: "bad_recommendation"
    })
  });
  assertSmoke(duplicateFeedback.duplicate === true, "duplicate result feedback was stored twice");

  const radiant = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞有光明羊刀，另外两件怎么带？"
    })
  });
  assertSmoke(radiant.query?.itemPolicy === "include_radiant", "radiant item policy was not inferred");
  assertSmoke(radiant.query?.minSamples === 0, "special owned item did not default to zero samples");
  assertSmoke(radiant.lockedItems?.[0]?.name === "光明羊刀", "radiant owned item was not locked");
  assertSmoke(radiant.cards?.length === 1, "radiant recommendation card was not returned");

  const conversationId = "small-window-multiturn-smoke";
  const firstTurn = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      conversationId,
      input: "大师以上霞什么三件装备最强？",
      preferences: { minSamples: 10 }
    })
  });
  assertSmoke(firstTurn.query?.rankFilter?.join(",") === "CHALLENGER,GRANDMASTER,MASTER", "master-and-above rank range was not parsed");
  assertSmoke(firstTurn.query?.comp === null, "unspecified Comp was synthesized");
  assertSmoke(firstTurn.source?.compCandidates === null, "unrestricted query exposed a Comp candidate request");
  assertSmoke(!Object.keys(firstTurn.source?.requestParams ?? {}).some((key) => key.startsWith("sf[")), "unrestricted query retained Comp sf params");
  const secondTurn = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      conversationId,
      input: "近一天呢？",
      preferences: { minSamples: 10 }
    })
  });
  assertSmoke(secondTurn.query?.days === 1, "follow-up did not override days");
  assertSmoke(secondTurn.query?.unit === "TFT17_Xayah", "follow-up did not inherit the unit");
  assertSmoke(secondTurn.query?.constraints?.unit?.source === "conversation", "follow-up unit source was not serialized");
  assertSmoke(secondTurn.query?.constraints?.days?.source === "current_input", "follow-up day source was not serialized");
  assertSmoke(secondTurn.query?.comp === null, "days follow-up synthesized a Comp");
  assertSmoke(compCandidateCalls === 0, "unrestricted turns fetched Comp candidates");

  const explicitComp = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞在观星霞阵容里什么装备最强？",
      conversationId: "smoke-explicit-comp",
      preferences: { minSamples: 100 }
    })
  });
  assertSmoke(explicitComp.query?.comp?.status === "applied", "explicit Comp was not applied");
  assertSmoke(explicitComp.query?.comp?.value?.selection === "explicit", "explicit Comp selection was not serialized");
  assertSmoke(explicitComp.query?.comp?.source === "current_input", "explicit Comp source was not current_input");
  assertSmoke(explicitComp.source?.requestParams?.trait === undefined, "explicit Comp was converted to a top-level trait filter");

  const unrestricted = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "只看王者霞什么三件装备最强？",
      conversationId: "smoke-no-stable-comp",
      preferences: { minSamples: 100 }
    })
  });
  assertSmoke(unrestricted.query?.comp === null, "unrestricted response synthesized Comp state");
  assertSmoke(!Object.keys(unrestricted.source?.requestParams ?? {}).some((key) => key.startsWith("sf[")), "unrestricted final request retained Comp sf params");
  assertSmoke(unrestricted.source?.requestParams?.trait === undefined, "unrestricted final request used a trait fallback");

  const radiantItems = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({ input: "霞的光明装备哪个最好？" })
  });
  assertSmoke(radiantItems.type === "unit_item_rankings", "radiant category did not use item rankings");
  assertSmoke(radiantItems.query?.minSamples === 0, "radiant category did not default to zero samples");
  assertSmoke(radiantItems.query?.itemCategories?.join(",") === "radiant", "radiant category constraint was lost");
  assertSmoke(radiantItems.itemRankings?.every((item) => item.apiName.includes("Radiant")), "radiant ranking mixed ordinary items");

  const emblemItems = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({ input: "霞的纹章哪个最好？" })
  });
  assertSmoke(emblemItems.type === "unit_item_rankings", "emblem category did not use item rankings");
  assertSmoke(emblemItems.query?.minSamples === 0, "emblem category did not default to zero samples");
  assertSmoke(emblemItems.itemRankings?.[0]?.apiName === "TFT17_Item_HPTankEmblemItem", "emblem ranking did not return emblem data");

  const singleItems = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞哪个单件装备表现最好？",
      preferences: { minSamples: 10 }
    })
  });
  assertSmoke(singleItems.type === "unit_item_rankings", "single-item intent was not serialized");
  assertSmoke(singleItems.itemRankings?.length > 0, "single-item rankings were empty");
  const kraken = singleItems.itemRankings.find((item) => item.apiName === "TFT_Item_RunaansHurricane");
  assertSmoke(kraken?.name === "海妖之怒", "current Kraken canonical name was lost");
  assertSmoke(kraken?.copyCounts?.some((copy) => copy.copyCount === 2), "double-Kraken copy count evidence was lost");

  const callsBeforeHistoricalAlias = unitBuildCalls;
  const historicalAlias = await jsonRequest(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input: "霞能不能带分裂弓？"
    })
  });
  assertSmoke(
    historicalAlias.query?.ownedItems?.includes("TFT_Item_RunaansHurricane"),
    "historical Runaan alias did not resolve to the current item"
  );
  assertSmoke(historicalAlias.decision == null, "historical Runaan alias was incorrectly marked unavailable");
  assertSmoke(historicalAlias.query?.unit === "TFT17_Xayah", "historical alias query did not preserve the unit");
  assertSmoke(historicalAlias.lockedItems?.[0]?.name === "海妖之怒", "historical alias did not serialize the current canonical name");
  assertSmoke(historicalAlias.cards?.[0]?.items?.filter((item) => item.apiName === "TFT_Item_RunaansHurricane").length === 2, "red buff plus double Kraken row was not preserved");
  assertSmoke(unitBuildCalls > callsBeforeHistoricalAlias, "current Kraken query did not reach unit_builds");

  const localCacheDurationMs = await verifyPersistentLocalCacheTarget();

  const entityMemoryCleared = await jsonRequest(`${baseUrl}/api/entity-memory/clear`, {
    method: "POST"
  });
  assertSmoke(entityMemoryCleared.cleared.feedbackEvents === 2, "entity memory clear did not remove feedback");
  assertSmoke(entityMemoryCleared.cleared.candidateAliases === 0, "entity memory clear should preserve reviewed aliases");

  const cleared = await jsonRequest(`${baseUrl}/api/cache/clear`, {
    method: "POST"
  });
  assertSmoke(cleared.ok === true, "cache clear failed");

  console.log(JSON.stringify({
    ok: true,
    url: started.url,
    aliasCandidateId: feedback.aliasCandidate.id,
    rankedBuilds: resolved.meta.rankedBuilds,
    unitBuildCalls,
    hotCacheDurationMs: hotCached.meta.durationMs,
    localCacheDurationMs
  }, null, 2));
  console.log("Small-window smoke checks passed.");
} finally {
  await closeServer(started.server);
}
