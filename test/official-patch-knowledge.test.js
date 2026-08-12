import assert from "node:assert/strict";
import test from "node:test";

import {
  KnowledgeRetriever,
  MemoryCacheStore,
  MemorySemanticDocumentStore,
  buildOfficialPatchKnowledgeDocuments,
  buildOfficialPatchSemanticDocuments,
  buildSemanticCorpus,
  createTfidfSemanticRetriever,
  createCatalog,
  extractPatchVersionFromQuestion,
  validateKnowledgeDocument
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";

test("17.9 official patch announcement is a valid, source-linked knowledge document", () => {
  const documents = buildOfficialPatchKnowledgeDocuments({ versions: ["17.9"] });
  assert.equal(documents.length, 1);
  const [document] = documents;
  assert.equal(validateKnowledgeDocument(document, { normalize: false }).valid, true);
  assert.equal(document.documentType, "patch_note");
  assert.equal(document.metadata.patch, "17.9");
  assert.equal(document.metadata.claimType, "official_fact");
  assert.match(document.metadata.sourceUrl, /teamfighttactics\.leagueoflegends\.com/u);
  assert.match(document.text, /魔法森林/u);
  assert.match(document.text, /牧羊人/u);
  assert.match(document.text, /崔斯特掷出 9 时必定获得金币/u);
});

test("semantic corpus includes official patch notes without realtime-stat authority", () => {
  const documents = buildSemanticCorpus({ patch: "17.9", units: [], items: [], traits: [] });
  const patchNote = documents.find((document) => (
    document.documentType === "patch_note" && document.patch === "17.9"
  ));
  assert.ok(patchNote);
  assert.equal(patchNote.source, "riot_games");
  assert.equal(patchNote.metadata.claimType, "official_fact");
});

test("AI knowledge retrieval can answer a version-change question from the 17.9 announcement", async () => {
  const store = new MemorySemanticDocumentStore(buildOfficialPatchSemanticDocuments());
  const retriever = new KnowledgeRetriever({
    retriever: createTfidfSemanticRetriever({ store })
  });
  const evidence = await retriever.search("17.9 版本更新了什么？", {
    seasonContextId: "set17-live",
    patch: "17.9",
    locale: "zh-CN",
    scopes: ["static_knowledge"]
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].patch, "17.9");
  assert.equal(evidence[0].claimType, "official_fact");
  assert.match(evidence[0].claim, /牧羊人/u);
  assert.match(evidence[0].sourceUrl, /patch-17-9/u);
});

test("patch version extraction preserves an explicitly requested historical version", () => {
  assert.equal(extractPatchVersionFromQuestion("17.7 版本有哪些变化"), "17.7");
  assert.equal(extractPatchVersionFromQuestion("本版本更新公告"), null);
});

test("small-window AI answers 17.9 change questions through patch-note RAG", async () => {
  const calls = [];
  const patchDocument = buildOfficialPatchSemanticDocuments()
    .find((document) => document.patch === "17.9");
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    semanticRetriever: {
      async search(query, options) {
        calls.push({ query, options });
        return [{
          ...patchDocument,
          score: 0.95,
          metadata: {
            ...patchDocument.metadata,
            content: patchDocument.content
          }
        }];
      }
    }
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "17.9 版本改了什么？"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.type, "coach_answer");
  assert.equal(payload.mode, "rag");
  assert.equal(payload.answerModeRoute.patchNotesRequested, true);
  assert.match(payload.assistantResponse.text, /牧羊人/u);
  assert.equal(payload.knowledgeEvidence[0].claimType, "official_fact");
  assert.match(payload.knowledgeEvidence[0].sourceUrl, /patch-17-9/u);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.patch, "17.9");
  assert.ok(calls[0].options.documentTypes.includes("patch_note"));
});
