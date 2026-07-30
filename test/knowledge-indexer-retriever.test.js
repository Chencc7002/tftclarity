import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidenceBundle } from "../src/knowledge/evidence-bundle-builder.js";
import { KnowledgeIndexer } from "../src/knowledge/knowledge-indexer.js";
import { KnowledgeRetriever } from "../src/knowledge/knowledge-retriever.js";
import { MemorySemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";
import { TfidfSemanticRetriever } from "../src/retrieval/semantic-retriever.js";

const GUIDE = {
  id: "youtube:abc123xyz00:item_priority:1",
  documentType: "video_guide",
  title: "霞装备攻略",
  text: "霞需要羊刀叠加攻速，作者建议优先制作羊刀。",
  metadata: {
    source: "youtube",
    sourceId: "abc123xyz00",
    sourceTitle: "霞装备攻略",
    author: "测试频道",
    publishedAt: "2026-07-20",
    season: "set18-live",
    patch: "18.1",
    locale: "zh-CN",
    topics: ["霞", "羊刀", "装备"],
    timestampStart: 332,
    claimType: "creator_advice",
    conditions: ["缺少其他攻速来源"],
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
  }
};

test("video guide is idempotently indexed and retrieved with provenance", async () => {
  const store = new MemorySemanticDocumentStore();
  const indexer = new KnowledgeIndexer({ store, seasonContextId: "set18-live" });
  const first = await indexer.index([GUIDE]);
  const second = await indexer.index([GUIDE]);
  assert.equal(first.inserted, 1);
  assert.equal(second.unchanged, 1);

  const retriever = new KnowledgeRetriever({
    retriever: new TfidfSemanticRetriever({ store })
  });
  const evidence = await retriever.search("霞为什么需要羊刀", {
    scopes: ["video_guides"],
    seasonContextId: "set18-live",
    patch: "18.1",
    minimumScore: 0
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceTitle, "霞装备攻略");
  assert.equal(evidence[0].author, "测试频道");
  assert.equal(evidence[0].timestampStart, 332);
  assert.equal(evidence[0].sourceUrl, GUIDE.metadata.sourceUrl);
  assert.equal(evidence[0].aiGenerated, true);
  assert.equal(evidence[0].reviewStatus, "ai_generated_unreviewed");
});

test("knowledge retrieval excludes expired evidence", async () => {
  const store = new MemorySemanticDocumentStore();
  const indexer = new KnowledgeIndexer({ store, seasonContextId: "set18-live" });
  await indexer.index([{
    ...GUIDE,
    id: "youtube:abc123xyz00:item_priority:expired",
    metadata: {
      ...GUIDE.metadata,
      expiresAt: "2026-07-01T00:00:00Z"
    }
  }]);
  const retriever = new KnowledgeRetriever({
    retriever: new TfidfSemanticRetriever({ store })
  });
  const evidence = await retriever.search("霞为什么需要羊刀", {
    scopes: ["video_guides"],
    seasonContextId: "set18-live",
    patch: "18.1",
    minimumScore: 0,
    now: Date.parse("2026-07-28T00:00:00Z")
  });
  assert.deepEqual(evidence, []);
});

test("EvidenceBundle preserves MetaTFT authority over creator advice", () => {
  const bundle = buildEvidenceBundle({
    mode: "hybrid",
    structuredResult: {
      type: "unit_build_rankings",
      query: { unit: "TFT18_Xayah" },
      source: { provider: "MetaTFT", updatedAt: "2026-07-28T00:00:00Z" },
      rankedBuilds: [{
        evidenceId: "stats:build:1",
        items: ["羊刀", "无尽", "轻语"],
        stats: {
          games: 1843,
          avgPlacement: 4.02,
          top4Rate: 0.563,
          winRate: 0.141
        }
      }]
    },
    knowledgeEvidence: [{
      evidenceId: "youtube:abc123xyz00:item_priority:1",
      claimType: "creator_advice",
      claim: "高血量前排多时可换巨杀"
    }]
  });
  assert.equal(bundle.queryResult.candidates[0].evidenceId, "stats:build:1");
  assert.equal(bundle.authorityRules.currentBestAuthority, "metatft");
  assert.equal(bundle.authorityRules.creatorAdviceMayOverrideStatistics, false);
});
