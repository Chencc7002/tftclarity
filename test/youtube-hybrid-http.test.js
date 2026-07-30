import test from "node:test";
import assert from "node:assert/strict";

import {
  MemoryCacheStore,
  createCatalog
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest,
  resolveSmallWindowSemanticConfig
} from "../src/app/small-window-server.js";

function videoEvidenceHit() {
  return {
    id: "youtube:abc123xyz00:item_priority:1",
    documentType: "video_guide",
    patch: "17.7",
    locale: "zh-CN",
    metadata: {
      source: "youtube",
      sourceId: "abc123xyz00",
      sourceTitle: "霞完整攻略",
      author: "测试频道",
      publishedAt: "2026-07-20",
      season: "set17-live",
      patch: "17.7",
      timestampStart: 120,
      timestampEnd: 145,
      claimType: "creator_advice",
      content: "霞在缺少其他攻速来源时优先做羊刀，用持续叠加的攻速改善长战斗输出。",
      conditions: ["缺少其他攻速来源"],
      sourceUrl: "https://www.youtube.com/watch?v=abc123xyz00",
      namespace: "video_guides",
      videoVersion: "version-001",
      transcriptHash: "transcript-hash-001",
      segmentId: "version-001:0000:segment",
      segmentIndex: 0,
      segmentStatus: "success",
      ingestionStatus: "success",
      aiGenerated: true,
      contentOrigin: "ai_generated_transcript_summary",
      reviewStatus: "ai_generated_unreviewed",
      contentDisclosure: "AI-generated from the transcript; not human-reviewed.",
      extractionModel: "test-model",
      isCurrentVersion: true
    }
  };
}

test("knowledge mode enables local retrieval without remote embeddings", () => {
  const config = resolveSmallWindowSemanticConfig({}, {
    TFT_AGENT_KNOWLEDGE_MODE: "on",
    TFT_AGENT_EMBEDDING_MODE: "off",
    TFT_AGENT_SEMANTIC_INDEX_PATH: ".cache/test-knowledge.sqlite"
  });
  assert.equal(config.enabled, false);
  assert.equal(config.knowledgeEnabled, true);
  assert.equal(config.knowledgeMode, "on");
});

test("RAG HTTP response returns a grounded coach answer and source provenance", async () => {
  const calls = [];
  const runtime = createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    metaTFTClient: {},
    compsClient: {},
    semanticRetriever: {
      async search(query, options) {
        calls.push({ query, options });
        return [videoEvidenceHit()];
      }
    }
  });

  const { statusCode, payload } = await handleRecommendRequest({
    input: "霞为什么需要羊刀？"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.type, "coach_answer");
  assert.equal(payload.mode, "rag");
  assert.equal(payload.answerModeRoute.mode, "rag");
  assert.match(payload.assistantResponse.text, /缺少其他攻速来源/);
  assert.equal(payload.assistantResponse.content.currentRecommendation, null);
  assert.equal(payload.queryResult.candidates.length, 0);
  assert.equal(payload.knowledgeEvidence.length, 1);
  assert.equal(payload.knowledgeEvidence[0].sourceType, "youtube");
  assert.equal(payload.knowledgeEvidence[0].author, "测试频道");
  assert.equal(payload.knowledgeEvidence[0].timestampStart, 120);
  assert.equal(payload.knowledgeEvidence[0].aiGenerated, true);
  assert.equal(
    payload.knowledgeEvidence[0].reviewStatus,
    "ai_generated_unreviewed"
  );
  assert.equal(payload.meta.aiGeneratedContent, true);
  assert.equal(payload.meta.aiGeneratedKnowledgeEvidenceCount, 1);
  assert.match(payload.source.risk, /AI/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.documentTypes.includes("video_guide"), true);
  assert.equal(calls[0].options.documentTypes.includes("mechanism_knowledge"), true);
});
