import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import "dotenv/config";

import {
  CurrentStatsIndexManager,
  DEFAULT_QUERY_OPTIONS,
  KnowledgeRetriever,
  SQLiteSemanticDocumentStore,
  createCurrentStatsScope,
  createPersistentSemanticRetriever,
  currentStatsScopeKey,
  fetchMetaTftCurrentStats
} from "../src/index.js";

function assertSmoke(condition, message) {
  if (!condition) throw new Error(`Current stats smoke failed: ${message}`);
}

function shiftedBatch(generated, scopeOverrides) {
  const scope = createCurrentStatsScope({
    ...generated.scope,
    ...scopeOverrides
  });
  const oldKey = currentStatsScopeKey(generated.scope);
  const newKey = currentStatsScopeKey(scope);
  return {
    ...generated,
    scope,
    documents: generated.documents.map((document) => ({
      ...document,
      id: document.id.replace(`metatft:${oldKey}:`, `metatft:${newKey}:`),
      metadata: {
        ...document.metadata,
        season: scope.season,
        patch: scope.patch,
        rank: scope.rank,
        timeWindow: scope.timeWindow,
        region: scope.region,
        locale: scope.locale,
        generatedAt: scope.generatedAt,
        expiresAt: scope.expiresAt,
        semanticProjection: {
          ...document.metadata.semanticProjection,
          scope: {
            season: scope.season,
            patch: scope.patch,
            rank: scope.rank,
            timeWindow: scope.timeWindow,
            region: scope.region
          }
        }
      }
    }))
  };
}

const dayOne = new Date();
dayOne.setUTCHours(0, 0, 0, 0);
const generatedAt = dayOne.toISOString();
const expiresAt = new Date(dayOne.getTime() + 48 * 60 * 60 * 1000).toISOString();
const scope = createCurrentStatsScope({
  season: process.env.CURRENT_STATS_SEASON ?? "set17-live",
  patch: process.env.CURRENT_STATS_PATCH ?? "17.8",
  rank: DEFAULT_QUERY_OPTIONS.rankFilter,
  days: DEFAULT_QUERY_OPTIONS.days,
  region: "global",
  locale: "zh-CN",
  generatedAt,
  expiresAt
});
const temporaryDirectory = await mkdtemp(join(tmpdir(), "tft-current-stats-"));
const indexPath = join(temporaryDirectory, "semantic-index.sqlite");
const store = await SQLiteSemanticDocumentStore.open({ filePath: indexPath });

try {
  await store.upsert([
    {
      id: "smoke:video",
      documentType: "video_guide",
      content: "YouTube smoke sentinel",
      source: "youtube",
      patch: scope.patch,
      locale: scope.locale,
      metadata: { namespace: "video_guides" }
    },
    {
      id: "smoke:static",
      documentType: "static_game_knowledge",
      content: "Static smoke sentinel",
      source: "local_static_index",
      patch: scope.patch,
      locale: scope.locale,
      metadata: { namespace: "static_knowledge" }
    },
    {
      id: "smoke:mechanism",
      documentType: "mechanism_knowledge",
      content: "Mechanism smoke sentinel",
      source: "local_static_index",
      patch: scope.patch,
      locale: scope.locale,
      metadata: { namespace: "mechanism_knowledge" }
    }
  ]);
  const protectedTypes = ["video_guide", "static_game_knowledge", "mechanism_knowledge"];
  const protectedBefore = await store.count({
    seasonContextId: scope.season,
    documentTypes: protectedTypes
  });

  const generated = await fetchMetaTftCurrentStats({
    scope,
    providerPatch: "current",
    timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS ?? 30000),
    minSamples: 0
  });
  assertSmoke(generated.fetch.unitRows > 0, "real units_unique returned no rows");
  assertSmoke(generated.fetch.compCandidates > 0, "real comps returned no candidates");
  assertSmoke(generated.documents.length > 3, "generator returned too few documents");

  const manager = new CurrentStatsIndexManager({ store });
  const first = await manager.indexBatch(generated, { scope });
  assertSmoke(first.inserted === generated.documents.length, "first run did not insert every document");
  const repeat = await manager.indexBatch(generated, { scope });
  assertSmoke(repeat.unchanged === generated.documents.length, "repeat run was not idempotent");
  assertSmoke(repeat.inserted === 0 && repeat.updated === 0 && repeat.removed === 0, "repeat run mutated rows");

  const dayTwoGeneratedAt = new Date(dayOne.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const dayTwoExpiresAt = new Date(dayOne.getTime() + 72 * 60 * 60 * 1000).toISOString();
  const nextDay = shiftedBatch(generated, {
    generatedAt: dayTwoGeneratedAt,
    expiresAt: dayTwoExpiresAt
  });
  const freshness = await manager.indexBatch(nextDay, { scope: nextDay.scope });
  assertSmoke(freshness.updated === generated.documents.length, "freshness-only update did not refresh every row");
  assertSmoke(freshness.inserted === 0, "next-day update created duplicate stable IDs");

  const retriever = new KnowledgeRetriever({
    retriever: createPersistentSemanticRetriever({ store })
  });
  const searchOptions = {
    scopes: ["current_stats"],
    seasonContextId: scope.season,
    patch: scope.patch,
    rank: scope.rank,
    timeWindow: scope.timeWindow,
    region: scope.region,
    locale: scope.locale,
    topK: 8,
    minimumScore: 0.01,
    now: Date.parse(dayTwoGeneratedAt)
  };
  const hits = await retriever.search("MetaTFT 当前环境热门阵容和英雄统计", searchOptions);
  assertSmoke(hits.length > 0, "natural-language retrieval returned no current_stats evidence");
  assertSmoke(hits.every((hit) => hit.namespace === "current_stats"), "retrieval mixed namespaces");
  assertSmoke(hits.every((hit) => hit.generatedAt === dayTwoGeneratedAt), "retrieval returned stale freshness metadata");

  const wrongRank = await retriever.search("MetaTFT 当前环境", {
    ...searchOptions,
    rank: "CHALLENGER"
  });
  const wrongWindow = await retriever.search("MetaTFT 当前环境", {
    ...searchOptions,
    timeWindow: "7d"
  });
  const wrongRegion = await retriever.search("MetaTFT 当前环境", {
    ...searchOptions,
    region: "cn"
  });
  const wrongPatch = await retriever.search("MetaTFT 当前环境", {
    ...searchOptions,
    patch: "17.6"
  });
  const wrongSeason = await retriever.search("MetaTFT 当前环境", {
    ...searchOptions,
    seasonContextId: "set16-historical"
  });
  assertSmoke(
    [wrongRank, wrongWindow, wrongRegion, wrongPatch, wrongSeason].every((rows) => rows.length === 0),
    "cross-scope isolation returned documents"
  );

  const alternate = shiftedBatch(nextDay, {
    rank: ["CHALLENGER"],
    timeWindow: "7d",
    region: "cn"
  });
  const alternateSingle = {
    ...alternate,
    documents: alternate.documents.slice(0, 1)
  };
  const alternateIndex = await manager.indexBatch(alternateSingle, { scope: alternate.scope });
  assertSmoke(alternateIndex.inserted === 1, "alternate scope was not independently inserted");
  const originalCount = await store.count({
    seasonContextId: scope.season,
    documentTypes: ["meta_snapshot", "trend_snapshot", "unit_stats", "comp_stats"],
    patch: scope.patch,
    locale: scope.locale
  });
  assertSmoke(originalCount === generated.documents.length + 1, "alternate-scope prune affected original scope");

  const protectedAfter = await store.count({
    seasonContextId: scope.season,
    documentTypes: protectedTypes
  });
  assertSmoke(protectedAfter === protectedBefore, "current_stats ingestion removed another namespace");

  console.log(JSON.stringify({
    ok: true,
    source: "real_metatft",
    temporarySQLite: indexPath,
    fetch: generated.fetch,
    generated: {
      total: generated.documents.length,
      byType: generated.countsByType
    },
    firstRun: first,
    repeatRun: repeat,
    nextDayFreshnessRun: freshness,
    retrieval: hits.map((hit) => ({
      evidenceId: hit.evidenceId,
      documentType: hit.documentType,
      title: hit.sourceTitle,
      generatedAt: hit.generatedAt,
      patch: hit.patch,
      rank: hit.rank,
      timeWindow: hit.timeWindow,
      region: hit.region
    })),
    crossScopeIsolation: {
      wrongRank: wrongRank.length,
      wrongWindow: wrongWindow.length,
      wrongRegion: wrongRegion.length,
      wrongPatch: wrongPatch.length,
      wrongSeason: wrongSeason.length
    },
    alternateScope: {
      index: alternateIndex,
      originalScopeDocuments: generated.documents.length,
      combinedCurrentStatsDocuments: originalCount
    },
    protectedNamespaces: {
      before: protectedBefore,
      after: protectedAfter,
      unchanged: protectedBefore === protectedAfter
    }
  }, null, 2));
} finally {
  store.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
