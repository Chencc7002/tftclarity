import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSemanticDocumentStore, MemorySemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";
import { FunctionEmbeddingProvider } from "../src/llm/embedding-provider.js";
import { publishStaticKnowledge, inspectStaticKnowledge } from "../src/knowledge/static-knowledge-release.js";
import { buildSemanticIndex } from "../src/retrieval/semantic-index-builder.js";
import { createPersistentSemanticRetriever } from "../src/retrieval/semantic-retriever.js";
import { createSmallWindowRuntimeAsync, getSmallWindowRuntimeStatus } from "../src/app/small-window-server.js";
import { MemoryCacheStore } from "../src/data/cache-store.js";

const scope = { seasonContextId: "set18-live", locale: "zh-CN", dimensions: 2 };
const doc = (id, content = id, overrides = {}) => ({ id, content, documentType: "patch_note",
  source: "riot_games", patch: "18.5", ...scope, ...overrides });
const provider = (embed = (texts) => texts.map(() => [1, 0])) => new FunctionEmbeddingProvider(embed, { model: "test-v1" });
function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  return new SQLiteSemanticDocumentStore({ database: db });
}

test("static release is shadow-first, incremental, season- and owner-scoped", async (t) => {
  const store = database(t);
  const documents = [doc("same", "治疗效果"), doc("new")];
  await store.upsert([doc("same", "旧内容"), doc("stale"),
    doc("same", "S17", { seasonContextId: "set17-live" }),
    doc("video", "攻略", { documentType: "video_guide", source: "youtube" })]);
  const before = await store.list({ allSeasons: true });
  let embedded = 0;
  const p = provider((texts) => { embedded += texts.length; return texts.map(() => [1, 0]); });
  const options = { store, provider: p, documents, ...scope };
  assert.equal((await publishStaticKnowledge({ ...options, shadow: true })).published, false);
  assert.deepEqual(await store.list({ allSeasons: true }), before);
  assert.equal((await publishStaticKnowledge(options)).published, true);
  assert.equal(embedded, 4);
  assert.equal((await publishStaticKnowledge(options)).build.embedded, 0);
  assert.equal(embedded, 4);
  assert.equal((await store.list({ seasonContextId: "set17-live" }))[0].content, "S17");
  assert.equal((await store.list(scope)).some((d) => d.id === "video"), true);
  assert.equal((await store.list(scope)).some((d) => d.id === "stale"), false);
  assert.equal((await inspectStaticKnowledge(store, { ...scope, documents, model: p.model })).healthy, true);
});

test("embedding errors and bad dimensions never replace active data", async (t) => {
  const store = database(t);
  await store.upsert(doc("a", "original", { embedding: [1, 0], embeddingModel: "test-v1" }));
  const before = await store.list(scope);
  for (const p of [provider(() => { throw new Error("offline"); }), provider(() => [[1, 0, 0]]),
    provider(() => [[0, 0]]), provider(() => [[1e100, 0]])]) {
    await assert.rejects(publishStaticKnowledge({ store, provider: p, documents: [doc("a", "new")], ...scope }));
    assert.deepEqual(await store.list(scope), before);
  }
});

test("invalid old dimensions are rebuilt and metadata-only changes reuse vectors", async (t) => {
  const store = database(t);
  await store.upsert(doc("a", "治疗", { embedding: [1], embeddingModel: "test-v1" }));
  const p = provider();
  const options = { store, provider: p, documents: [doc("a", "治疗")], ...scope };
  assert.equal((await publishStaticKnowledge(options)).build.embedded, 1);
  assert.equal((await publishStaticKnowledge({ ...options,
    documents: [doc("a", "治疗", { metadata: { reviewed: true } })] })).build.embedded, 0);
  assert.equal((await store.list(scope))[0].metadata.reviewed, true);
});

test("publication rolls back partial SQL writes and rejects concurrent source changes", async (t) => {
  const store = database(t);
  await store.upsert(doc("a", "original"));
  const before = await store.list(scope);
  const original = store.upsert.bind(store);
  store.upsert = async (docs) => { await original(docs); throw new Error("disk failure"); };
  await assert.rejects(publishStaticKnowledge({ store, provider: provider(), documents: [doc("a", "new")], ...scope }), /disk failure/);
  assert.deepEqual(await store.list(scope), before);
  store.upsert = original;
  const p = provider(async (texts) => { await store.upsert(doc("a", "concurrent")); return texts.map(() => [1, 0]); });
  await assert.rejects(publishStaticKnowledge({ store, provider: p, documents: [doc("a", "new")], ...scope }), /changed during build/);
  assert.equal((await store.list(scope))[0].content, "concurrent");
});

test("generic incremental builder distinguishes same IDs across seasons and scopes pruning", async () => {
  const store = new MemorySemanticDocumentStore([doc("a"), doc("stale"),
    doc("a", "S17", { seasonContextId: "set17-live" })]);
  const p = provider();
  await buildSemanticIndex({ store, provider: p, documents: [doc("a")] });
  assert.equal((await store.list(scope)).length, 1);
  assert.equal((await store.list({ seasonContextId: "set17-live" }))[0].content, "S17");
  assert.equal((await buildSemanticIndex({ store, provider: p, documents: [doc("a")] })).embedded, 0);
});

test("retrieval distinguishes actual vector candidates, missing vectors, and provider failure", async () => {
  const store = new MemorySemanticDocumentStore([doc("a", "治疗效果")]);
  const r = createPersistentSemanticRetriever({ store, provider: provider() });
  await r.search("治疗效果", scope);
  assert.equal(r.getRetrievalStatus().noVectorCandidates, 1);
  await store.upsert(doc("a", "治疗效果", { embedding: [1, 0], embeddingModel: "test-v1" }));
  await r.search("治疗效果", scope);
  assert.equal(r.getRetrievalStatus().vectorCandidateSearches, 1);
  const failed = createPersistentSemanticRetriever({ store, provider: provider(() => { throw new Error("offline"); }) });
  assert.ok((await failed.search("治疗效果", scope)).length);
  assert.equal(failed.getRetrievalStatus().embeddingErrors, 1);
});

test("published startup does not overwrite static content and exposes index health", async (t) => {
  const store = database(t);
  await store.upsert(doc("a", "published", { embedding: [1, 0], embeddingModel: "test-v1" }));
  const before = await store.list({ allSeasons: true });
  const runtime = await createSmallWindowRuntimeAsync({ cacheStore: new MemoryCacheStore(),
    semanticDocumentStore: store, embeddingProvider: provider(), embeddingMode: "on", embeddingModel: "test-v1",
    staticKnowledgeMode: "published", seasonContextId: scope.seasonContextId });
  assert.deepEqual(await store.list({ allSeasons: true }), before);
  const status = getSmallWindowRuntimeStatus(runtime).semanticIndex;
  assert.equal(status.staticKnowledgeMode, "published");
  assert.equal(status.staticKnowledgeHealth.missingEmbeddings, 0);
  assert.equal(status.staticKnowledgeHealth.healthy, false); // Source bundle is intentionally absent.
});
