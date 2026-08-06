import assert from "node:assert/strict";
import test from "node:test";

import {
  KNOWLEDGE_DOCUMENT_SCHEMA_VERSION,
  assertKnowledgeDocument,
  knowledgeDocumentToSemanticDocument,
  validateKnowledgeDocument
} from "../src/knowledge/knowledge-document-schema.js";

function videoDocument(overrides = {}) {
  return {
    id: "youtube:abc123xyz00:item_priority:1",
    documentType: "video_guide",
    title: "霞的装备优先级",
    text: "作者建议在缺少其他攻速来源时优先制作羊刀。",
    metadata: {
      source: "youtube",
      sourceId: "abc123xyz00",
      sourceTitle: "霞完整攻略",
      author: "测试频道",
      publishedAt: "2026-07-20",
      season: "S18",
      patch: "18.1",
      region: "NA",
      locale: "zh-CN",
      topics: ["霞", "羊刀", "装备"],
      timestampStart: 332,
      timestampEnd: 351,
      claimType: "creator_advice",
      conditions: ["缺少其他稳定攻速来源"],
      sourceUrl: "https://www.youtube.com/watch?v=abc123xyz00",
      videoVersion: "version-001",
      transcriptHash: "transcript-hash-001",
      segmentId: "version-001:0000:segment",
      segmentIndex: 0,
      segmentStatus: "success",
      ingestionRunId: "run-001",
      ingestionStatus: "success",
      extractionModel: "test-model",
      extractionPromptVersion: "youtube-guide-extraction.v2",
      aiGenerated: true,
      contentOrigin: "ai_generated_transcript_summary",
      reviewStatus: "ai_generated_unreviewed",
      contentDisclosure: "AI-generated from the transcript; not human-reviewed.",
      isCurrentVersion: true
    },
    ...overrides
  };
}

test("KnowledgeDocument normalizes and validates video guide provenance", () => {
  const value = assertKnowledgeDocument(videoDocument());
  assert.equal(value.schemaVersion, KNOWLEDGE_DOCUMENT_SCHEMA_VERSION);
  assert.equal(value.metadata.namespace, "video_guides");
  assert.equal(value.metadata.timestampStart, 332);
  assert.equal(value.metadata.videoVersion, "version-001");
  assert.equal(value.metadata.aiGenerated, true);
  assert.equal(value.metadata.reviewStatus, "ai_generated_unreviewed");
  assert.deepEqual(value.metadata.topics, ["霞", "羊刀", "装备"]);
});

test("KnowledgeDocument rejects video guide without timestamp and source", () => {
  const value = videoDocument({
    metadata: {
      source: "youtube",
      claimType: "creator_advice"
    }
  });
  const validation = validateKnowledgeDocument(value);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("video_guide metadata.timestampStart is required"));
  assert.ok(validation.errors.includes("video_guide metadata.sourceId is required"));
});

test("KnowledgeDocument enforces advice boundaries", () => {
  const strategic = validateKnowledgeDocument({
    ...videoDocument(),
    id: "youtube:test:strategic",
    metadata: {
      ...videoDocument().metadata,
      claimType: "strategic_advice",
      conditions: []
    }
  });
  assert.equal(strategic.valid, false);
  assert.match(strategic.errors.join(" "), /applicable condition/);

  const speculation = validateKnowledgeDocument({
    ...videoDocument(),
    id: "youtube:test:speculation",
    text: "霞一定会成为版本最强主 C",
    metadata: {
      ...videoDocument().metadata,
      claimType: "speculation"
    }
  });
  assert.equal(speculation.valid, false);
  assert.match(speculation.errors.join(" "), /uncertainty language/);
});

test("KnowledgeDocument converts to existing SQLite semantic document contract", () => {
  const document = knowledgeDocumentToSemanticDocument(videoDocument(), {
    seasonContextId: "set18-live"
  });
  assert.equal(document.seasonContextId, "set18-live");
  assert.equal(document.documentType, "video_guide");
  assert.equal(document.source, "youtube");
  assert.equal(document.metadata.namespace, "video_guides");
  assert.equal(document.metadata.sourceId, "abc123xyz00");
});
