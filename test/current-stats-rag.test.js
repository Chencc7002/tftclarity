import assert from "node:assert/strict";
import test from "node:test";

import {
  CurrentStatsIndexManager,
  DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG,
  KnowledgeRetriever,
  MemorySemanticDocumentStore,
  buildCompStatsDocuments,
  buildTrendSnapshotDocument,
  createCurrentStatsScope,
  createPersistentSemanticRetriever,
  generateCurrentStatsDocuments,
  resolveCurrentStatsSemanticConfig,
  validateKnowledgeDocument
} from "../src/index.js";

function fixture(scopeOverrides = {}) {
  const scope = createCurrentStatsScope({
    season: "set17-live",
    patch: "17.7",
    rank: ["MASTER", "CHALLENGER"],
    days: 3,
    region: "global",
    locale: "zh-CN",
    generatedAt: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-07-30T00:00:00.000Z",
    ...scopeOverrides
  });
  return generateCurrentStatsDocuments({
    totalResponse: {
      data: [{ placement_count: [100, 90, 80, 70, 60, 50, 40, 30] }],
      filter_adjustment: { sample_size: 520 }
    },
    unitsResponse: {
      data: [
        { units_unique: "TFT17_Xayah-1", placement_count: [10, 9, 8, 7, 6, 5, 4, 3] },
        { units_unique: "TFT17_Xayah-2", placement_count: [8, 7, 6, 5, 4, 3, 2, 1] },
        { units_unique: "TFT17_Aatrox-1", placement_count: [5, 5, 5, 5, 5, 5, 5, 5] }
      ]
    },
    compRankingResult: {
      source: { sampleSize: 520 },
      candidates: [
        {
          compId: "cluster:1",
          name: "Xayah comp",
          units: [{ apiName: "TFT17_Xayah", name: "Xayah" }],
          traits: [{ filterId: "TFT17_Stargazer_1", name: "Stargazer" }],
          stats: {
            games: 300,
            avgPlacement: 4.1,
            top4Rate: 0.55,
            winRate: 0.14,
            selectionRate: 0.22
          }
        },
        {
          compId: "cluster:2",
          name: "Aatrox comp",
          units: [{ apiName: "TFT17_Aatrox", name: "Aatrox" }],
          traits: [],
          stats: {
            games: 220,
            avgPlacement: 4.4,
            top4Rate: 0.5,
            winRate: 0.1,
            selectionRate: 0.15
          }
        }
      ],
      rankings: {
        top4Rate: [{
          compId: "cluster:1",
          name: "Xayah comp",
          stats: { games: 300, top4Rate: 0.55 }
        }]
      }
    }
  }, {
    scope,
    unitName: (apiName) => apiName.replace("TFT17_", "")
  });
}

function projectionScope(scopeOverrides = {}) {
  return createCurrentStatsScope({
    season: "set17-live",
    patch: "17.7",
    rank: ["MASTER", "CHALLENGER"],
    days: 3,
    region: "global",
    locale: "zh-CN",
    generatedAt: "2026-07-28T00:00:00.000Z",
    expiresAt: "2026-07-30T00:00:00.000Z",
    ...scopeOverrides
  });
}

function compStatsDocument(overrides = {}, semanticConfig = {}) {
  const scope = projectionScope(overrides.scope);
  const base = {
    compId: "cluster:projection",
    name: "Projection comp",
    units: [{ apiName: "TFT17_Xayah", name: "Xayah" }],
    traits: [{ filterId: "TFT17_Stargazer_1", name: "Stargazer" }],
    coreBuilds: [{
      unitApiName: "TFT17_Xayah",
      items: ["TFT_Item_RageBlade", "TFT_Item_GiantSlayer"]
    }],
    stats: {
      games: 300,
      avgPlacement: 4.101,
      top4Rate: 0.5504,
      winRate: 0.1404,
      selectionRate: 0.2204
    },
    contested: false,
    trend: { direction: "flat", avgPlacementChange: 0 },
    source: { updatedAt: 1000 },
    ...overrides,
    stats: {
      games: 300,
      avgPlacement: 4.101,
      top4Rate: 0.5504,
      winRate: 0.1404,
      selectionRate: 0.2204,
      ...overrides.stats
    }
  };
  return {
    scope,
    document: buildCompStatsDocuments(
      { candidates: [base] },
      { scope, semanticConfig }
    )[0]
  };
}

function trendStatsDocument(names, semanticConfig = {}) {
  const scope = projectionScope();
  const knownChanges = new Map([
    ["Alpha", -0.1],
    ["Beta", -0.11],
    ["Gamma", -0.12]
  ]);
  const rising = names.map((name, index) => ({
    compId: `cluster:${name.toLowerCase()}`,
    name,
    stats: { games: 100 + index },
    trend: {
      direction: "rising",
      avgPlacementChange: knownChanges.get(name) ?? -0.1 - index * 0.01
    }
  }));
  return {
    scope,
    document: buildTrendSnapshotDocument(
      { rising, falling: [], trend: { source: "metatft" } },
      { scope, semanticConfig }
    )
  };
}

function countingProvider() {
  const state = { texts: [] };
  return {
    state,
    provider: {
      model: "projection-test",
      isAvailable: () => true,
      async embed(texts) {
        state.texts.push(...texts);
        return texts.map((text) => [text.length, 1]);
      }
    }
  };
}

test("current_stats generator creates strict, granular, semantic documents", () => {
  const generated = fixture();
  assert.deepEqual(generated.countsByType, {
    meta_snapshot: 1,
    trend_snapshot: 1,
    unit_stats: 2,
    comp_stats: 2
  });
  assert.equal(generated.documents.length, 6);
  for (const document of generated.documents) {
    const validation = validateKnowledgeDocument(document);
    assert.equal(validation.valid, true, validation.errors.join("; "));
    assert.equal(document.metadata.namespace, "current_stats");
    assert.equal(document.metadata.source, "metatft");
    assert.equal(document.metadata.claimType, "statistics");
    assert.match(document.text, /MetaTFT/);
    assert.doesNotMatch(document.text, /^\s*[\[{]/u);
  }
  assert.equal(generated.documents.filter((document) => document.documentType === "unit_stats").length, 2);
  assert.equal(generated.documents.filter((document) => document.documentType === "comp_stats").length, 2);
  assert.equal(generated.documents.filter((document) => document.documentType === "trend_snapshot").length, 1);
});

test("current_stats strict schema rejects missing scope and invalid freshness", () => {
  const document = fixture().documents[0];
  const missingRegion = validateKnowledgeDocument({
    ...document,
    metadata: { ...document.metadata, region: null }
  });
  assert.equal(missingRegion.valid, false);
  assert.match(missingRegion.errors.join(" "), /region is required/);

  const invalidFreshness = validateKnowledgeDocument({
    ...document,
    metadata: { ...document.metadata, generatedAt: "not-a-date" }
  });
  assert.equal(invalidFreshness.valid, false);
  assert.match(invalidFreshness.errors.join(" "), /valid ISO date/);
});

test("current_stats manager is idempotent and refreshes metadata with stable IDs", async () => {
  const store = new MemorySemanticDocumentStore();
  const manager = new CurrentStatsIndexManager({ store });
  const generated = fixture();
  const first = await manager.indexBatch(generated, { scope: generated.scope });
  assert.equal(first.inserted, generated.documents.length);
  const second = await manager.indexBatch(generated, { scope: generated.scope });
  assert.equal(second.unchanged, generated.documents.length);

  const nextScope = createCurrentStatsScope({
    ...generated.scope,
    generatedAt: "2026-07-29T00:00:00.000Z",
    expiresAt: "2026-07-31T00:00:00.000Z"
  });
  const next = {
    ...generated,
    scope: nextScope,
    documents: generated.documents.map((document) => ({
      ...document,
      metadata: {
        ...document.metadata,
        generatedAt: nextScope.generatedAt,
        expiresAt: nextScope.expiresAt
      }
    }))
  };
  assert.deepEqual(next.documents.map((document) => document.id), generated.documents.map((document) => document.id));
  const refreshed = await manager.indexBatch(next, { scope: next.scope });
  assert.equal(refreshed.updated, generated.documents.length);
  assert.equal(refreshed.inserted, 0);
});

test("freshness-only updates do not call embedding again", async () => {
  let embeddedTexts = 0;
  const provider = {
    model: "test-embedding",
    isAvailable: () => true,
    async embed(texts) {
      embeddedTexts += texts.length;
      return texts.map((text) => [text.length, 1]);
    }
  };
  const store = new MemorySemanticDocumentStore();
  const manager = new CurrentStatsIndexManager({ store, embeddingProvider: provider });
  const generated = fixture();
  const first = await manager.indexBatch(generated, { scope: generated.scope });
  assert.equal(first.embedded, generated.documents.length);
  assert.equal(first.vectorsPresent, generated.documents.length);

  const nextScope = createCurrentStatsScope({
    ...generated.scope,
    generatedAt: "2026-07-29T00:00:00.000Z",
    expiresAt: "2026-07-31T00:00:00.000Z"
  });
  const next = {
    ...generated,
    scope: nextScope,
    documents: generated.documents.map((document) => ({
      ...document,
      metadata: {
        ...document.metadata,
        generatedAt: nextScope.generatedAt,
        expiresAt: nextScope.expiresAt
      }
    }))
  };
  const refreshed = await manager.indexBatch(next, { scope: nextScope });
  assert.equal(refreshed.updated, generated.documents.length);
  assert.equal(refreshed.embedded, 0);
  assert.equal(refreshed.vectorsPresent, generated.documents.length);
  assert.equal(embeddedTexts, generated.documents.length);
});

test("semantic projection precision and ranking policy are centralized configuration", () => {
  assert.deepEqual(DEFAULT_CURRENT_STATS_SEMANTIC_CONFIG, {
    avgPlacementDecimals: 2,
    ratePercentageDecimals: 1,
    rankingChangeThreshold: 2,
    criticalRankBoundaries: []
  });
  const configured = resolveCurrentStatsSemanticConfig({
    avgPlacementDecimals: 3,
    ratePercentageDecimals: 2,
    rankingChangeThreshold: 3,
    criticalRankBoundaries: [10, 1, 4, 4]
  }, {});
  assert.deepEqual(configured, {
    avgPlacementDecimals: 3,
    ratePercentageDecimals: 2,
    rankingChangeThreshold: 3,
    criticalRankBoundaries: [1, 4, 10]
  });
  assert.throws(
    () => resolveCurrentStatsSemanticConfig({ rankingChangeThreshold: 0 }, {}),
    /rankingChangeThreshold/
  );
});

test("semantic body excludes sample counts while raw metadata keeps exact values", () => {
  const { document } = compStatsDocument();
  assert.doesNotMatch(document.text, /样本数为|300|300 场/u);
  assert.match(document.text, /平均名次 4\.10/u);
  assert.match(document.text, /前四率 55\.0%/u);
  assert.match(document.text, /登顶率 14\.0%/u);
  assert.match(document.text, /选择率 22\.0%/u);
  assert.equal(document.metadata.rawData.stats.games, 300);
  assert.equal(document.metadata.rawData.stats.avgPlacement, 4.101);
  assert.equal(document.metadata.rawData.stats.top4Rate, 0.5504);
  assert.equal(document.metadata.semanticProjectionConfig.avgPlacementDecimals, 2);
  assert.equal(document.metadata.semanticProjectionConfig.ratePercentageDecimals, 1);
});

test("configured precision changes the normalized semantic projection", () => {
  const { document } = compStatsDocument({}, {
    avgPlacementDecimals: 3,
    ratePercentageDecimals: 2
  });
  assert.match(document.text, /平均名次 4\.101/u);
  assert.match(document.text, /前四率 55\.04%/u);
  assert.equal(document.metadata.semanticProjection.metrics.avgPlacement, "4.101");
  assert.equal(document.metadata.semanticProjection.metrics.top4Rate, "55.04%");
});

test("small raw metric and sample changes update metadata without embedding", async () => {
  const counter = countingProvider();
  const store = new MemorySemanticDocumentStore();
  const manager = new CurrentStatsIndexManager({
    store,
    embeddingProvider: counter.provider
  });
  const firstBatch = compStatsDocument();
  const first = await manager.indexBatch([firstBatch.document], { scope: firstBatch.scope });
  const previous = (await store.list())[0];

  const nextBatch = compStatsDocument({
    stats: {
      games: 301,
      avgPlacement: 4.104,
      top4Rate: 0.55049,
      winRate: 0.14049,
      selectionRate: 0.22049
    },
    source: { updatedAt: 2000 }
  });
  const next = await manager.indexBatch([nextBatch.document], { scope: nextBatch.scope });
  const stored = (await store.list())[0];

  assert.equal(first.embedded, 1);
  assert.equal(next.updated, 1);
  assert.equal(next.embedded, 0);
  assert.equal(counter.state.texts.length, 1);
  assert.equal(stored.contentHash, previous.contentHash);
  assert.notEqual(stored.recordHash, previous.recordHash);
  assert.equal(stored.metadata.rawData.stats.games, 301);
  assert.equal(stored.metadata.rawData.stats.avgPlacement, 4.104);
  assert.equal(stored.content, previous.content);
});

test("ordinary one-place ranking swaps reuse the previous semantic projection", async () => {
  const counter = countingProvider();
  const store = new MemorySemanticDocumentStore();
  const manager = new CurrentStatsIndexManager({
    store,
    embeddingProvider: counter.provider
  });
  const firstBatch = trendStatsDocument(["Alpha", "Beta"]);
  await manager.indexBatch([firstBatch.document], { scope: firstBatch.scope });
  const previous = (await store.list())[0];
  const nextBatch = trendStatsDocument(["Beta", "Alpha"]);
  const next = await manager.indexBatch([nextBatch.document], { scope: nextBatch.scope });
  const stored = (await store.list())[0];

  assert.equal(next.updated, 1);
  assert.equal(next.embedded, 0);
  assert.equal(counter.state.texts.length, 1);
  assert.equal(stored.contentHash, previous.contentHash);
  assert.deepEqual(
    stored.metadata.semanticProjection.rising.map((entry) => [entry.name, entry.rank]),
    [["Alpha", 1], ["Beta", 2]]
  );
  assert.deepEqual(
    stored.metadata.rawData.rising.map((entry) => entry.name),
    ["Beta", "Alpha"]
  );
});

test("critical ranking boundaries apply only when explicitly configured", async () => {
  const semanticConfig = {
    rankingChangeThreshold: 2,
    criticalRankBoundaries: [1]
  };
  const counter = countingProvider();
  const store = new MemorySemanticDocumentStore();
  const manager = new CurrentStatsIndexManager({
    store,
    embeddingProvider: counter.provider,
    semanticConfig
  });
  const firstBatch = trendStatsDocument(["Alpha", "Beta"], semanticConfig);
  await manager.indexBatch([firstBatch.document], { scope: firstBatch.scope });
  const nextBatch = trendStatsDocument(["Beta", "Alpha"], semanticConfig);
  const next = await manager.indexBatch([nextBatch.document], { scope: nextBatch.scope });
  const stored = (await store.list())[0];

  assert.equal(next.embedded, 1);
  assert.equal(counter.state.texts.length, 2);
  assert.deepEqual(
    stored.metadata.semanticProjection.rising.map((entry) => [entry.name, entry.rank]),
    [["Beta", 1], ["Alpha", 2]]
  );
});

test("ranking change threshold controls when a multi-place move changes projection", async () => {
  for (const [threshold, expectedEmbedded] of [[3, 0], [2, 1]]) {
    const semanticConfig = {
      rankingChangeThreshold: threshold,
      criticalRankBoundaries: []
    };
    const counter = countingProvider();
    const store = new MemorySemanticDocumentStore();
    const manager = new CurrentStatsIndexManager({
      store,
      embeddingProvider: counter.provider,
      semanticConfig
    });
    const firstBatch = trendStatsDocument(["Alpha", "Beta", "Gamma"], semanticConfig);
    await manager.indexBatch([firstBatch.document], { scope: firstBatch.scope });
    const nextBatch = trendStatsDocument(["Beta", "Gamma", "Alpha"], semanticConfig);
    const next = await manager.indexBatch([nextBatch.document], { scope: nextBatch.scope });
    assert.equal(next.embedded, expectedEmbedded, `threshold=${threshold}`);
  }
});

test("entity, equipment, composition, risk and trend changes force embedding", async (t) => {
  const cases = [
    ["entity", { name: "Renamed projection comp" }],
    ["equipment", {
      coreBuilds: [{
        unitApiName: "TFT17_Xayah",
        items: ["TFT_Item_RageBlade", "TFT_Item_Deathblade"]
      }]
    }],
    ["composition", {
      units: [
        { apiName: "TFT17_Xayah", name: "Xayah" },
        { apiName: "TFT17_Aatrox", name: "Aatrox" }
      ]
    }],
    ["risk", { lowSample: true }],
    ["trend", { trend: { direction: "rising", avgPlacementChange: -0.2 } }]
  ];
  for (const [label, overrides] of cases) {
    await t.test(label, async () => {
      const counter = countingProvider();
      const store = new MemorySemanticDocumentStore();
      const manager = new CurrentStatsIndexManager({
        store,
        embeddingProvider: counter.provider
      });
      const firstBatch = compStatsDocument();
      await manager.indexBatch([firstBatch.document], { scope: firstBatch.scope });
      const nextBatch = compStatsDocument(overrides);
      const next = await manager.indexBatch([nextBatch.document], { scope: nextBatch.scope });
      assert.equal(next.updated, 1);
      assert.equal(next.embedded, 1);
      assert.equal(counter.state.texts.length, 2);
    });
  }
});

test("current_stats retrieval and prune stay inside the exact scope", async () => {
  const store = new MemorySemanticDocumentStore();
  await store.upsert({
    id: "sentinel:youtube",
    documentType: "video_guide",
    content: "sentinel",
    source: "youtube",
    metadata: { namespace: "video_guides" }
  });
  const manager = new CurrentStatsIndexManager({ store });
  const generated = fixture();
  await manager.indexBatch(generated, { scope: generated.scope });
  const reduced = { ...generated, documents: generated.documents.slice(0, 2) };
  const report = await manager.indexBatch(reduced, { scope: reduced.scope });
  assert.equal(report.removed, generated.documents.length - 2);
  assert.equal((await store.list({ documentType: "video_guide" })).length, 1);

  const retriever = new KnowledgeRetriever({
    retriever: createPersistentSemanticRetriever({ store })
  });
  const options = {
    scopes: ["current_stats"],
    seasonContextId: generated.scope.season,
    patch: generated.scope.patch,
    rank: generated.scope.rank,
    timeWindow: generated.scope.timeWindow,
    region: generated.scope.region,
    locale: generated.scope.locale,
    minimumScore: 0,
    now: Date.parse(generated.scope.generatedAt)
  };
  assert.ok((await retriever.search("MetaTFT current", options)).length > 0);
  assert.equal((await retriever.search("MetaTFT current", options))[0].timestampStart, null);
  assert.equal((await retriever.search("MetaTFT current", { ...options, region: "cn" })).length, 0);
  assert.equal((await retriever.search("MetaTFT current", { ...options, patch: "17.6" })).length, 0);
  assert.equal((await retriever.search("MetaTFT current", { ...options, rank: "MASTER" })).length, 0);
});

test("current_stats documents cannot bypass the dedicated manager", async () => {
  const store = new MemorySemanticDocumentStore();
  const document = fixture().documents[0];
  await assert.rejects(
    () => store.upsert({
      seasonContextId: document.metadata.season,
      id: document.id,
      documentType: document.documentType,
      content: document.text,
      source: document.metadata.source,
      metadata: document.metadata
    }),
    /dedicated current-stats index manager/
  );
});
