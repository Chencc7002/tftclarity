import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeRetriever } from "../src/knowledge/knowledge-retriever.js";
import { YouTubeKnowledgeIndexManager } from "../src/knowledge/youtube-index-manager.js";
import { SQLiteSemanticDocumentStore } from "../src/retrieval/semantic-document-store.js";
import { TfidfSemanticRetriever } from "../src/retrieval/semantic-retriever.js";

function guide({
  sourceId = "abc123xyz00",
  videoVersion = "version-a",
  transcriptHash = "transcript-a",
  patch = "18.1",
  index = 0,
  status = "success",
  text = "霞需要羊刀叠加攻速，作者建议优先制作羊刀。"
} = {}) {
  return {
    id: `youtube:${sourceId}:${videoVersion}:item_priority:${index}`,
    documentType: "video_guide",
    title: "霞装备攻略",
    text,
    metadata: {
      source: "youtube",
      sourceId,
      sourceTitle: "霞装备攻略",
      author: "测试频道",
      publishedAt: "2026-07-20",
      season: "set18-live",
      patch,
      locale: "zh-CN",
      topics: ["霞", "羊刀", "装备"],
      timestampStart: 332 + index,
      timestampEnd: 350 + index,
      claimType: "creator_advice",
      conditions: ["缺少其他攻速来源"],
      sourceUrl: `https://www.youtube.com/watch?v=${sourceId}`,
      generatedAt: "2026-07-29T00:00:00Z",
      namespace: "video_guides",
      videoVersion,
      transcriptHash,
      segmentId: `${videoVersion}:000${index}:segment`,
      segmentIndex: index,
      segmentStatus: "success",
      ingestionRunId: "run-001",
      ingestionStatus: status,
      extractionModel: "test-model",
      extractionPromptVersion: "youtube-guide-extraction.v2",
      aiGenerated: true,
      contentOrigin: "ai_generated_transcript_summary",
      reviewStatus: "ai_generated_unreviewed",
      contentDisclosure: "AI-generated from the transcript; not human-reviewed.",
      isCurrentVersion: true
    }
  };
}

function envelope({
  sourceId = "abc123xyz00",
  videoVersion = "version-a",
  transcriptHash = "transcript-a",
  patch = "18.1",
  status = "success",
  documents = [guide({ sourceId, videoVersion, transcriptHash, patch, status })],
  quarantine = []
} = {}) {
  return {
    schemaVersion: "youtube_ingestion.v2",
    runId: "run-001",
    status,
    source: {
      type: "youtube",
      videoId: sourceId,
      videoVersion,
      transcriptHash,
      title: "霞装备攻略",
      author: "测试频道",
      publishedAt: "2026-07-20",
      sourceUrl: `https://www.youtube.com/watch?v=${sourceId}`,
      durationSeconds: 600,
      season: "set18-live",
      patch,
      region: null,
      locale: "zh-CN"
    },
    segments: documents.map((document, index) => ({
      segmentId: document.metadata.segmentId,
      index,
      status: "success"
    })),
    quarantine,
    documents
  };
}

const temporary = await mkdtemp(join(tmpdir(), "tftclarity-youtube-smoke-"));
const filePath = join(temporary, "semantic.sqlite");
try {
  const store = await SQLiteSemanticDocumentStore.open({ filePath });
  const manager = new YouTubeKnowledgeIndexManager({
    store,
    seasonContextId: "set18-live"
  });
  const firstEnvelope = envelope({
    documents: [
      guide({ index: 0 }),
      guide({ index: 1, text: "霞第二件装备优先补无尽。" })
    ]
  });
  const first = await manager.indexEnvelope(firstEnvelope);
  const duplicate = await manager.indexEnvelope(firstEnvelope);
  assert.equal(first.inserted, 2);
  assert.equal(duplicate.unchanged, 2);

  await manager.indexEnvelope(envelope({
    sourceId: "other123456",
    videoVersion: "other-version",
    transcriptHash: "other-transcript",
    documents: [guide({
      sourceId: "other123456",
      videoVersion: "other-version",
      transcriptHash: "other-transcript"
    })]
  }));

  const replacementDocument = guide({
    videoVersion: "version-b",
    transcriptHash: "transcript-b",
    status: "partial_success",
    text: "霞优先做羊刀，后续装备根据前排选择。"
  });
  const replacementEnvelope = envelope({
    videoVersion: "version-b",
    transcriptHash: "transcript-b",
    status: "partial_success",
    documents: [replacementDocument],
    quarantine: [{ segmentId: "version-b:0001:failed" }]
  });
  replacementEnvelope.segments.push({
    segmentId: "version-b:0001:failed",
    index: 1,
    status: "quarantined"
  });
  const replacement = await manager.indexEnvelope(replacementEnvelope);
  assert.equal(replacement.removed, 2);
  assert.equal(replacement.quarantinedSegments, 1);

  const retriever = new KnowledgeRetriever({
    retriever: new TfidfSemanticRetriever({ store })
  });
  const evidence = await retriever.search("霞为什么需要羊刀", {
    scopes: ["video_guides"],
    seasonContextId: "set18-live",
    patch: "18.1",
    locale: "zh-CN",
    minimumScore: 0
  });
  assert.equal(evidence.length, 2);
  assert.equal(
    evidence.filter((value) => value.sourceId === "abc123xyz00").length,
    1
  );
  assert.equal(
    evidence.find((value) => value.sourceId === "abc123xyz00")?.videoVersion,
    "version-b"
  );
  const wrongPatch = await retriever.search("霞为什么需要羊刀", {
    scopes: ["video_guides"],
    seasonContextId: "set18-live",
    patch: "18.2",
    locale: "zh-CN",
    minimumScore: 0
  });
  assert.equal(wrongPatch.length, 0);
  store.close();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    database: filePath,
    first,
    duplicate,
    replacement,
    retrieved: evidence.length,
    wrongPatchRetrieved: wrongPatch.length
  }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
