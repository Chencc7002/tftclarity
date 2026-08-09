import { resolve } from "node:path";
import {
  KnowledgeRetriever,
  SQLiteSemanticDocumentStore,
  createPersistentSemanticRetriever
} from "../src/index.js";
import { ACCEPTANCE_M17_DOCUMENT } from "../src/app/small-window-server.js";

const indexArg = process.argv.find((value) => value.startsWith("--semantic-index="));
const indexPath = resolve(
  indexArg?.slice("--semantic-index=".length)
    ?? process.env.TFT_AGENT_SEMANTIC_INDEX_PATH
    ?? ".artifacts/r1-acceptance/semantic-index.sqlite"
);

const store = await SQLiteSemanticDocumentStore.open({ filePath: indexPath });
try {
  await store.upsert(ACCEPTANCE_M17_DOCUMENT);
  const documents = await store.list({
    seasonContextId: "set17-live",
    documentTypes: ["mechanism_knowledge"],
    patch: "16.14",
    locale: "zh-CN"
  });
  const seeded = documents.find((document) => document.id === ACCEPTANCE_M17_DOCUMENT.id);
  if (!seeded) throw new Error("M17 preflight failed: document id is missing");
  if (seeded.metadata?.namespace !== "mechanism_knowledge") {
    throw new Error("M17 preflight failed: namespace is not mechanism_knowledge");
  }

  const retriever = createPersistentSemanticRetriever({ store, provider: null });
  const directHits = await retriever.search("M17 启动装备 首次施法等待", {
    seasonContextId: "set17-live",
    documentTypes: ["mechanism_knowledge"],
    patch: "16.14",
    locale: "zh-CN",
    topK: 4,
    minimumScore: 0.1
  });
  if (!directHits.some((hit) => hit.id === ACCEPTANCE_M17_DOCUMENT.id)) {
    throw new Error("M17 preflight failed: direct SemanticRetriever query did not hit");
  }

  const evidence = await new KnowledgeRetriever({ retriever }).searchEvidence(
    "M17 启动装备为什么影响首次施法等待？",
    {
      seasonContextId: "set17-live",
      documentTypes: ["mechanism_knowledge"],
      patch: "16.14",
      locale: "zh-CN",
      topK: 4,
      minimumScore: 0.1
    }
  );
  if (!evidence.some((entry) => entry.sourceId === "M17" || entry.evidenceId?.includes("M17"))) {
    throw new Error("M17 preflight failed: KnowledgeRetriever query did not hit");
  }

  console.log(JSON.stringify({
    ok: true,
    indexPath,
    documentId: seeded.id,
    namespace: seeded.metadata.namespace,
    directHitIds: directHits.map((hit) => hit.id),
    evidenceCount: evidence.length
  }, null, 2));
} finally {
  store.close();
}
