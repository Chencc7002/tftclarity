import assert from "node:assert/strict";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { SQLiteSemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";
import { EmbeddingSemanticRetriever, createPersistentSemanticRetriever } from "../src/retrieval/semantic-retriever.js";
import { createEmbeddingProviderFromConfig, resolveEmbeddingProviderConfig } from "../src/llm/embedding-provider.js";

if (process.argv.slice(2).join(" ") !== "--live") throw new Error("Explicit --live is required; run inside the production backend network");
loadLocalEnvironment();
const config = resolveEmbeddingProviderConfig({}, process.env);
if (!config.configured || config.model !== "bge-m3" || new URL(config.endpoint).hostname !== "embedding") {
  throw new Error("This smoke requires the internal embedding service and bge-m3");
}
const store = await SQLiteSemanticDocumentStore.open({ filePath: process.env.TFT_AGENT_SEMANTIC_INDEX_PATH ?? ".cache/semantic-index.sqlite" });
try {
  const provider = createEmbeddingProviderFromConfig(config);
  const vector = new EmbeddingSemanticRetriever({ store, provider });
  const hybrid = createPersistentSemanticRetriever({ store, provider });
  const cases = [
    { patch: "18.5", query: "绯红印记树怪改了什么", expected: "绯红印记树怪" },
    { patch: "18.3", query: "绯红印记树怪改了什么", expected: "绯红印记树怪" },
    { patch: "18.1", query: "阿狸的版本改动", expected: "阿狸" }
  ];
  const results = [];
  for (const c of cases) {
    const options = { seasonContextId: "set18-live", locale: "zh-CN", patch: c.patch, documentTypes: ["patch_note"], topK: 8 };
    const dense = await vector.search(c.query, options);
    const hits = await hybrid.search(c.query, options);
    assert.ok(dense.length, `No vector candidates for ${c.patch}`);
    assert.ok(hits.some((h) => String(h.metadata?.content ?? "").includes(c.expected)), `Missing target entity for ${c.patch}`);
    assert.ok([...dense, ...hits].every((h) => h.patch === c.patch), "Patch isolation failed");
    results.push({ patch: c.patch, vectorIds: dense.map((h) => h.id), hybridIds: hits.map((h) => h.id) });
  }
  console.log(JSON.stringify({ ok: true, model: config.model, cases: results, retrieval: hybrid.getRetrievalStatus(),
    scope: "retrieval_only_not_generated_answer_accuracy" }, null, 2));
} finally { store.close(); }
