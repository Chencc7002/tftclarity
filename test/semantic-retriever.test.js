import assert from "node:assert/strict";
import test from "node:test";

import {
  EmbeddingProvider,
  EmbeddingSemanticRetriever,
  EntityCandidateSemanticRetriever,
  FallbackSemanticRetriever,
  FunctionEmbeddingProvider,
  MemorySemanticDocumentStore,
  TfidfSemanticRetriever,
  createPersistentSemanticRetriever,
  createCatalog
} from "../src/index.js";

const documents = [
  {
    id: "unit:TFT17_MasterYi",
    documentType: "unit",
    content: "易大师 剑圣 无极剑圣 Master Yi",
    apiName: "TFT17_MasterYi",
    patch: "17.7",
    locale: "zh-CN",
    source: "catalog"
  },
  {
    id: "unit:TFT16_MasterYi",
    documentType: "unit",
    content: "易大师 剑圣 Master Yi",
    apiName: "TFT16_MasterYi",
    patch: "16.8",
    locale: "zh-CN",
    source: "catalog"
  },
  {
    id: "intent:unit_emblem_rankings",
    documentType: "intent_example",
    content: "剑圣应该带什么转 易大师适合什么纹章",
    intent: "unit_emblem_rankings",
    patch: "17.7",
    locale: "zh-CN",
    source: "curated_intent_examples"
  }
];

test("TF-IDF SemanticRetriever applies document type, patch and locale filters", async () => {
  const store = new MemorySemanticDocumentStore(documents);
  const retriever = new TfidfSemanticRetriever({ store });
  const hits = await retriever.search("剑圣", {
    documentTypes: ["unit"],
    patch: "17.7",
    locale: "zh-CN",
    topK: 5
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "unit:TFT17_MasterYi");
  assert.equal(hits[0].schemaVersion, "semantic_hit.v1");
  assert.equal(hits[0].metadata.retrievalMode, "tfidf");
});

test("existing entity candidate TF-IDF is available through the SemanticRetriever adapter", async () => {
  const retriever = new EntityCandidateSemanticRetriever({ catalog: createCatalog() });
  const hits = await retriever.search("霞", { documentTypes: ["unit"], patch: "17.7" });
  assert.ok(hits.length > 0);
  assert.equal(hits[0].documentType, "unit");
  assert.equal(hits[0].metadata.retrievalMode, "legacy_tfidf_adapter");
});

test("Embedding provider failure automatically falls back to local TF-IDF", async () => {
  const store = new MemorySemanticDocumentStore(documents);
  const unavailable = new EmbeddingProvider({ available: false });
  const retriever = new FallbackSemanticRetriever(
    new EmbeddingSemanticRetriever({ provider: unavailable, store }),
    new TfidfSemanticRetriever({ store })
  );
  const hits = await retriever.search("适合什么纹章", {
    documentTypes: ["intent_example"], patch: "17.7", locale: "zh-CN"
  });
  assert.equal(hits[0].intent, "unit_emblem_rankings");
  assert.equal(hits[0].metadata.fallback, true);
});

test("persistent semantic retrieval applies hybrid exact-name priority after vector candidate retrieval", async () => {
  const store = new MemorySemanticDocumentStore([
    {
      id: "unit:exact",
      documentType: "unit",
      content: "易大师 剑圣 Master Yi",
      apiName: "TFT17_MasterYi",
      embedding: [-1, 0],
      embeddingModel: "fixture-v1",
      patch: "17.7",
      locale: "zh-CN",
      source: "official_catalog",
      metadata: { canonicalName: "易大师", aliases: ["剑圣"] }
    },
    ...Array.from({ length: 70 }, (_, index) => ({
      id: `unit:vector-only:${index}`,
      documentType: "unit",
      content: `相似但不是目标实体 ${index}`,
      apiName: `TFT17_Distractor${index}`,
      embedding: [1, index / 1000],
      embeddingModel: "fixture-v1",
      patch: "17.7",
      locale: "zh-CN",
      source: "official_catalog",
      metadata: { canonicalName: `干扰项${index}`, aliases: [] }
    }))
  ]);
  const provider = new FunctionEmbeddingProvider(async () => [[1, 0]], { model: "fixture-v1" });
  const retriever = createPersistentSemanticRetriever({ store, provider });
  const hits = await retriever.search("剑圣", {
    documentTypes: ["unit"],
    patch: "17.7",
    locale: "zh-CN",
    topK: 2,
    minimumScore: 0.76
  });
  assert.equal(hits[0].id, "unit:exact");
  assert.equal(hits[0].score, 0.97);
  assert.equal(hits[0].metadata.hybridMatchType, "alias_exact");
  assert.equal(hits[1].metadata.hybridMatchType, "vector");
  assert.equal(hits[0].metadata.retrievalMode, "tfidf");
  assert.equal(hits[1].metadata.retrievalMode, "embedding");
});

test("semantic document store supports incremental upsert and rejects realtime statistics", async () => {
  const store = new MemorySemanticDocumentStore(documents.slice(0, 1));
  assert.deepEqual(await store.upsert(documents[0]), { inserted: 0, updated: 0, unchanged: 1 });
  assert.deepEqual(await store.upsert({ ...documents[0], content: `${documents[0].content} 易` }), {
    inserted: 0, updated: 1, unchanged: 0
  });
  await assert.rejects(() => store.upsert({
    id: "stats:daily",
    documentType: "statistics",
    content: "今日平均名次 3.2",
    source: "metatft_daily_statistics"
  }), /cannot be stored/u);
});
