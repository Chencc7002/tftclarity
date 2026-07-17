import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  EmbeddingSemanticRetriever,
  FunctionEmbeddingProvider,
  MemoryCacheStore,
  OpenAICompatibleEmbeddingProvider,
  SQLiteSemanticDocumentStore,
  auditSemanticIndex,
  buildSemanticCorpus,
  buildSemanticIndex,
  createCatalog,
  createPersistentSemanticRetriever,
  recommendForInput,
  retrieveSemanticPlan
} from "../src/index.js";
import {
  createSmallWindowRuntimeAsync,
  getSmallWindowRuntimeStatus
} from "../src/app/small-window-server.js";

let sqliteRuntimeAvailable = true;
try {
  await import("node:sqlite");
} catch {
  try {
    await import("better-sqlite3");
  } catch {
    sqliteRuntimeAvailable = false;
  }
}
const sqliteTest = sqliteRuntimeAvailable ? test : test.skip;
const execFileAsync = promisify(execFile);

async function temporaryDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), "tft-semantic-index-"));
  return {
    filePath: join(directory, "semantic.sqlite"),
    cleanup: () => rm(directory, { recursive: true, force: true })
  };
}

const semanticDocuments = [
  {
    id: "17.7:zh-CN:unit:TFT17_MasterYi",
    documentType: "unit",
    apiName: "TFT17_MasterYi",
    content: "易大师 剑圣 Master Yi",
    embedding: [1, 0, 0],
    embeddingModel: "fixture-embedding-v1",
    patch: "17.7",
    locale: "zh-CN",
    source: "official_catalog",
    metadata: { canonicalName: "易大师", aliases: ["剑圣"] }
  },
  {
    id: "17.7:zh-CN:item:TFT_Item_GuinsoosRageblade",
    documentType: "item",
    apiName: "TFT_Item_GuinsoosRageblade",
    content: "鬼索的狂暴之刃 羊刀",
    embedding: [0, 1, 0],
    embeddingModel: "fixture-embedding-v1",
    patch: "17.7",
    locale: "zh-CN",
    source: "official_catalog"
  }
];

sqliteTest("SQLite semantic index persists metadata and Float32 vectors across process-style reopen", async (t) => {
  const { filePath, cleanup } = await temporaryDatabase(t);
  const first = await SQLiteSemanticDocumentStore.open({ filePath });
  assert.deepEqual(await first.upsert(semanticDocuments), { inserted: 2, updated: 0, unchanged: 0 });
  assert.equal(await first.count({ patch: "17.7", locale: "zh-CN", hasEmbedding: true }), 2);
  first.close();

  const reopened = await SQLiteSemanticDocumentStore.open({ filePath });
  t.after(async () => {
    reopened.close();
    await cleanup();
  });
  const rows = await reopened.list({ documentTypes: ["unit"], patch: "17.7", locale: "zh-CN" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].apiName, "TFT17_MasterYi");
  assert.equal(rows[0].embeddingModel, "fixture-embedding-v1");
  assert.deepEqual(rows[0].embedding, [1, 0, 0]);
  assert.deepEqual(rows[0].metadata.aliases, ["剑圣"]);
  assert.equal(reopened.getMeta("schemaVersion").value, "semantic_index.v1");
});

sqliteTest("persistent vector retriever embeds the query and searches vectors loaded from SQLite", async (t) => {
  const { filePath, cleanup } = await temporaryDatabase(t);
  const store = await SQLiteSemanticDocumentStore.open({ filePath });
  t.after(async () => {
    store.close();
    await cleanup();
  });
  await store.upsert(semanticDocuments);
  let queryEmbeddingCalls = 0;
  const provider = new FunctionEmbeddingProvider(async () => {
    queryEmbeddingCalls += 1;
    return [[0.99, 0.01, 0]];
  }, {
    model: "fixture-embedding-v1"
  });
  const retriever = new EmbeddingSemanticRetriever({ provider, store });
  const hits = await retriever.search("剑圣", {
    documentTypes: ["unit"], patch: "17.7", locale: "zh-CN"
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].apiName, "TFT17_MasterYi");
  assert.equal(hits[0].metadata.retrievalMode, "embedding");
  await retriever.search("剑圣", {
    documentTypes: ["item"], patch: "17.7", locale: "zh-CN"
  });
  assert.equal(queryEmbeddingCalls, 1, "the same query vector should be reused across intent/entity filters");
});

sqliteTest("incremental builder embeds only changed content, prunes stale scoped documents and audits the result", async (t) => {
  const { filePath, cleanup } = await temporaryDatabase(t);
  const store = await SQLiteSemanticDocumentStore.open({ filePath });
  t.after(async () => {
    store.close();
    await cleanup();
  });
  let embeddedTexts = [];
  const provider = new FunctionEmbeddingProvider(async (texts) => {
    embeddedTexts.push(...texts);
    return texts.map((text) => [text.length, text.includes("剑圣") ? 1 : 0, 1]);
  }, { model: "incremental-v1" });
  const source = semanticDocuments.map(({ embedding, embeddingModel, ...document }) => document);

  const first = await buildSemanticIndex({ store, provider, documents: source });
  assert.equal(first.embedded, 2);
  assert.equal(first.inserted, 2);
  assert.equal(embeddedTexts.length, 2);

  embeddedTexts = [];
  const unchanged = await buildSemanticIndex({ store, provider, documents: source });
  assert.equal(unchanged.embedded, 0);
  assert.equal(unchanged.unchanged, 2);
  assert.equal(embeddedTexts.length, 0);

  const changedSource = [{ ...source[0], content: `${source[0].content} 无极剑圣` }];
  const changed = await buildSemanticIndex({ store, provider, documents: changedSource });
  assert.equal(changed.embedded, 1);
  assert.equal(changed.updated, 1);
  assert.equal(changed.removed, 1);
  assert.equal(await store.count(), 1);
  assert.equal((await auditSemanticIndex(store, { embeddingModel: "incremental-v1" })).healthy, true);
});

test("OpenAI-compatible provider sends batched embedding requests and restores response index order", async () => {
  const requests = [];
  const provider = new OpenAICompatibleEmbeddingProvider({
    endpoint: "https://embedding.example/v1",
    model: "embedding-prod-v1",
    apiKey: "secret-key",
    batchSize: 2,
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      const batch = JSON.parse(init.body).input;
      return {
        ok: true,
        async json() {
          return { data: batch.map((text, index) => ({ index, embedding: [text.length, index + 1] })).reverse() };
        }
      };
    }
  });
  const vectors = await provider.embed(["a", "bbbb", "ccc"]);
  assert.deepEqual(vectors, [[1, 1], [4, 2], [3, 1]]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://embedding.example/v1/embeddings");
  assert.equal(requests[0].init.headers.authorization, "Bearer secret-key");
  assert.equal(requests[0].body.model, "embedding-prod-v1");
});

test("semantic corpus contains versioned entity and curated intent documents without realtime stats", () => {
  const documents = buildSemanticCorpus({
    patch: "17.7",
    units: [{ apiName: "TFT17_MasterYi", zhName: "易大师", aliases: ["剑圣"], current: true }],
    items: [{ apiName: "TFT_Item_Test", zhName: "测试装备", category: "ordinary_completed", current: true }],
    traits: []
  }, { locale: "zh-CN" });
  assert.ok(documents.some((document) => document.id === "17.7:zh-CN:unit:TFT17_MasterYi"));
  assert.ok(documents.some((document) => document.documentType === "intent_sample" && document.intent === "unit_emblem_rankings"));
  assert.equal(documents.some((document) => /statistics|realtime/iu.test(document.source)), false);
});

test("high-confidence intent samples participate in the real recommendation orchestration", async () => {
  const semanticRetriever = {
    async search(_input, options) {
      assert.deepEqual(options.documentTypes, ["intent_sample"]);
      return [{ id: "intent:comp_trends", intent: "comp_trends", score: 0.93 }];
    }
  };
  const result = await recommendForInput("现在值得关注什么", {
    semanticRetriever,
    compResponse: { data: { comps: [] } },
    useSession: false
  });
  assert.equal(result.type, "comp_trends");
  assert.equal(result.parsed.intent, "comp_trends");
  assert.deepEqual(result.parsed.parser.semanticIntent, {
    attempted: true,
    accepted: true,
    intent: "comp_trends",
    evidenceId: "intent:comp_trends",
    score: 0.93,
    candidates: [{ id: "intent:comp_trends", intent: "comp_trends", score: 0.93 }]
  });
});

test("current-patch entity vectors can resolve a missing unit before structured retrieval", async () => {
  const catalog = createCatalog({
    patch: "current",
    units: [{ apiName: "TFT17_MasterYi", zhName: "易大师", aliases: ["剑圣"], current: true }]
  });
  const semanticRetriever = {
    async search(_input, options) {
      if (options.documentTypes.includes("intent_sample")) {
        return [{ id: "intent:emblem", documentType: "intent_sample", intent: "unit_emblem_rankings", score: 0.95 }];
      }
      return [{
        id: "current:zh-CN:unit:TFT17_MasterYi",
        documentType: "unit",
        apiName: "TFT17_MasterYi",
        score: 0.91,
        metadata: { canonicalName: "易大师" }
      }];
    }
  };
  const result = await recommendForInput("那个无极剑客应该带什么转", {
    catalog,
    semanticRetriever,
    response: { data: [] },
    useSession: false
  });
  assert.equal(result.query.unit, "TFT17_MasterYi");
  assert.equal(result.query.intent, "unit_emblem_rankings");
  assert.equal(result.parsed.parser.semanticEntities.acceptedUnit, "TFT17_MasterYi");
  assert.equal(result.parsed.parser.semanticEntities.evidenceId, "current:zh-CN:unit:TFT17_MasterYi");
});

sqliteTest("small-window runtime opens the persistent semantic index and exposes only safe status metadata", async (t) => {
  const { filePath, cleanup } = await temporaryDatabase(t);
  const provider = new FunctionEmbeddingProvider(async (texts) => texts.map(() => [1, 0]), { model: "runtime-v1" });
  const runtime = await createSmallWindowRuntimeAsync({
    cacheStore: new MemoryCacheStore(),
    embeddingMode: "on",
    embeddingProvider: provider,
    embeddingModel: "runtime-v1",
    semanticIndexPath: filePath
  }, {});
  t.after(async () => {
    runtime.semanticDocumentStore.close();
    await cleanup();
  });
  assert.ok(runtime.semanticDocumentStore instanceof SQLiteSemanticDocumentStore);
  assert.ok(runtime.semanticRetriever);
  const status = getSmallWindowRuntimeStatus(runtime);
  assert.equal(status.semanticIndex.enabled, true);
  assert.equal(status.semanticIndex.persistent, true);
  assert.equal(status.semanticIndex.model, "runtime-v1");
  assert.equal(JSON.stringify(status).includes("secret"), false);

  await runtime.semanticDocumentStore.upsert(semanticDocuments.map((document) => ({
    ...document,
    embeddingModel: "runtime-v1",
    embedding: [1, 0]
  })));
  const hits = await retrieveSemanticPlan({
    semanticQueries: [{ query: "剑圣", types: ["unit"], patch: "17.7", locale: "zh-CN", topK: 2 }]
  }, createPersistentSemanticRetriever({ store: runtime.semanticDocumentStore, provider }));
  assert.equal(hits[0].apiName, "TFT17_MasterYi");
});

sqliteTest("semantic index CLI performs a real provider build followed by a healthy audit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tft-semantic-cli-"));
  const filePath = join(directory, "semantic.sqlite");
  const inputPath = join(directory, "catalog.json");
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const input = Array.isArray(payload.input) ? payload.input : [payload.input];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        data: input.map((text, index) => ({ index, embedding: [String(text).length, index + 1, 1] }))
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await writeFile(inputPath, JSON.stringify({
      patch: "17.7",
      units: [{ apiName: "TFT17_MasterYi", zhName: "易大师", aliases: ["剑圣"], current: true }],
      items: [],
      traits: []
    }), "utf8");
    const address = server.address();
    const env = {
      ...process.env,
      TFT_AGENT_EMBEDDING_MODE: "on",
      TFT_AGENT_EMBEDDING_PROVIDER: "openai_compatible",
      TFT_AGENT_EMBEDDING_ENDPOINT: `http://127.0.0.1:${address.port}/v1`,
      TFT_AGENT_EMBEDDING_MODEL: "cli-fixture-v1",
      TFT_AGENT_EMBEDDING_API_KEY: "fixture-secret"
    };
    const root = fileURLToPath(new URL("../", import.meta.url));
    const build = await execFileAsync(process.execPath, [
      "scripts/build-semantic-index.mjs", "--db", filePath, "--input", inputPath
    ], { cwd: root, env });
    const buildReport = JSON.parse(build.stdout);
    assert.ok(buildReport.documents > 1);
    assert.equal(buildReport.documents, buildReport.embedded);
    assert.equal(buildReport.embeddingModel, "cli-fixture-v1");

    const audit = await execFileAsync(process.execPath, [
      "scripts/audit-semantic-index.mjs", "--db", filePath
    ], { cwd: root, env });
    const auditReport = JSON.parse(audit.stdout);
    assert.equal(auditReport.healthy, true);
    assert.equal(auditReport.documents, buildReport.documents);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
