import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { YouTubeKnowledgeIndexManager } from "../src/knowledge/youtube-index-manager.js";
import { KnowledgeRetriever } from "../src/knowledge/knowledge-retriever.js";
import {
  MemorySemanticDocumentStore,
  SQLiteSemanticDocumentStore
} from "../src/retrieval/semantic-document-store.js";
import { TfidfSemanticRetriever } from "../src/retrieval/semantic-retriever.js";

function document({
  sourceId = "abc123xyz00",
  videoVersion = "version-a",
  transcriptHash = "transcript-a",
  patch = "17.7",
  index = 0,
  text = "霞优先制作羊刀。",
  status = "success",
  generatedAt = "2026-07-29T00:00:00Z"
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
      season: "set17-live",
      patch,
      region: null,
      locale: "zh-CN",
      topics: ["霞", "羊刀"],
      timestampStart: 10 + index,
      timestampEnd: 20 + index,
      claimType: "creator_advice",
      conditions: ["需要攻速启动"],
      sourceUrl: `https://www.youtube.com/watch?v=${sourceId}`,
      generatedAt,
      namespace: "video_guides",
      videoVersion,
      transcriptHash,
      segmentId: `${videoVersion}:000${index}:segment`,
      segmentIndex: index,
      segmentStatus: "success",
      ingestionRunId: `run-${generatedAt}`,
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
  patch = "17.7",
  status = "success",
  documents = [document({ sourceId, videoVersion, transcriptHash, patch, status })],
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
      durationSeconds: 120,
      season: "set17-live",
      patch,
      region: null,
      locale: "zh-CN"
    },
    segments: documents.map((value, index) => ({
      segmentId: value.metadata.segmentId,
      index,
      status: "success"
    })),
    quarantine,
    documents
  };
}

test("YouTube manager embeds only changed content and prunes only the same video scope", async () => {
  const store = new MemorySemanticDocumentStore();
  const calls = [];
  const provider = {
    model: "test-embedding",
    isAvailable: () => true,
    async embed(texts) {
      calls.push([...texts]);
      return texts.map((_, index) => [1, index + 1]);
    }
  };
  const manager = new YouTubeKnowledgeIndexManager({
    store,
    embeddingProvider: provider,
    seasonContextId: "set17-live"
  });
  const firstEnvelope = envelope({
    documents: [
      document({ index: 0 }),
      document({ index: 1, text: "霞第二件补无尽。" })
    ]
  });
  const first = await manager.indexEnvelope(firstEnvelope);
  assert.equal(first.inserted, 2);
  assert.equal(first.embedded, 2);

  const refreshedDocuments = firstEnvelope.documents.map((value) => ({
    ...value,
    metadata: {
      ...value.metadata,
      generatedAt: "2026-07-29T01:00:00Z",
      ingestionRunId: "run-002"
    }
  }));
  const refreshed = await manager.indexEnvelope(envelope({ documents: refreshedDocuments }));
  assert.equal(refreshed.embedded, 0);
  assert.equal(refreshed.updated, 2);
  assert.equal(calls.length, 1);

  await manager.indexEnvelope(envelope({
    sourceId: "other123456",
    videoVersion: "other-version",
    transcriptHash: "other-transcript",
    documents: [document({
      sourceId: "other123456",
      videoVersion: "other-version",
      transcriptHash: "other-transcript"
    })]
  }));
  const replacement = await manager.indexEnvelope(envelope({
    videoVersion: "version-b",
    transcriptHash: "transcript-b",
    documents: [document({
      videoVersion: "version-b",
      transcriptHash: "transcript-b",
      text: "霞优先羊刀，第二件根据前排选择。"
    })]
  }));
  assert.equal(replacement.inserted, 1);
  assert.equal(replacement.removed, 2);
  const remaining = await store.list({
    seasonContextId: "set17-live",
    documentType: "video_guide"
  });
  assert.equal(remaining.length, 2);
  assert.ok(remaining.some((value) => value.metadata.sourceId === "other123456"));
  assert.ok(remaining.some((value) => value.metadata.videoVersion === "version-b"));
});

test("YouTube metadata disclosure updates the record without re-embedding content", async () => {
  const store = new MemorySemanticDocumentStore();
  const calls = [];
  const provider = {
    model: "test-embedding",
    isAvailable: () => true,
    async embed(texts) {
      calls.push([...texts]);
      return texts.map(() => [1, 2]);
    }
  };
  const manager = new YouTubeKnowledgeIndexManager({
    store,
    embeddingProvider: provider,
    seasonContextId: "set17-live"
  });
  const initial = envelope();
  const first = await manager.indexEnvelope(initial);
  const changed = structuredClone(initial);
  changed.documents[0].metadata.reviewStatus = "human_reviewed";
  changed.documents[0].metadata.contentDisclosure = (
    "AI-generated from the transcript and subsequently human-reviewed."
  );
  const second = await manager.indexEnvelope(changed);
  const stored = (await store.list({
    seasonContextId: "set17-live",
    documentType: "video_guide"
  }))[0];
  assert.equal(first.embedded, 1);
  assert.equal(second.embedded, 0);
  assert.equal(second.updated, 1);
  assert.equal(calls.length, 1);
  assert.equal(stored.metadata.reviewStatus, "human_reviewed");
});

test("SQLite preserves the vector across metadata-only disclosure updates", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "youtube-disclosure-sqlite-"));
  const store = await SQLiteSemanticDocumentStore.open({
    filePath: join(root, "index.sqlite")
  });
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const calls = [];
  const provider = {
    model: "test-embedding",
    isAvailable: () => true,
    async embed(texts) {
      calls.push([...texts]);
      return texts.map(() => [0.25, 0.75]);
    }
  };
  const manager = new YouTubeKnowledgeIndexManager({
    store,
    embeddingProvider: provider,
    seasonContextId: "set17-live"
  });
  const initial = envelope();
  const first = await manager.indexEnvelope(initial);
  const changed = structuredClone(initial);
  changed.documents[0].metadata.reviewStatus = "human_reviewed";
  changed.documents[0].metadata.contentDisclosure = (
    "AI-generated from the transcript and subsequently human-reviewed."
  );
  const second = await manager.indexEnvelope(changed);
  const third = await manager.indexEnvelope(changed);
  const stored = (await store.list({
    seasonContextId: "set17-live",
    documentType: "video_guide"
  }))[0];
  assert.equal(first.embedded, 1);
  assert.equal(second.embedded, 0);
  assert.equal(second.updated, 1);
  assert.equal(third.embedded, 0);
  assert.equal(third.unchanged, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(stored.embedding, [0.25, 0.75]);
  assert.equal(stored.embeddingModel, "test-embedding");
  assert.equal(stored.metadata.reviewStatus, "human_reviewed");
});

test("partial_success documents are indexable and failed/legacy versions are not retrieved", async () => {
  const store = new MemorySemanticDocumentStore();
  const manager = new YouTubeKnowledgeIndexManager({
    store,
    seasonContextId: "set17-live"
  });
  const partialDocument = document({ status: "partial_success" });
  const partial = envelope({
    status: "partial_success",
    documents: [partialDocument],
    quarantine: [{ segmentId: "version-a:0001:failed" }]
  });
  partial.segments.push({
    segmentId: "version-a:0001:failed",
    index: 1,
    status: "quarantined"
  });
  const report = await manager.indexEnvelope(partial);
  assert.equal(report.status, "partial_success");
  assert.equal(report.quarantinedSegments, 1);

  const retriever = new KnowledgeRetriever({
    retriever: new TfidfSemanticRetriever({ store })
  });
  const current = await retriever.search("霞羊刀", {
    scopes: ["video_guides"],
    seasonContextId: "set17-live",
    patch: "17.7",
    locale: "zh-CN",
    minimumScore: 0
  });
  assert.equal(current.length, 1);
  assert.equal(current[0].videoVersion, "version-a");
  assert.equal(current[0].ingestionStatus, "partial_success");

  const wrongPatch = await retriever.search("霞羊刀", {
    scopes: ["video_guides"],
    seasonContextId: "set17-live",
    patch: "17.8",
    locale: "zh-CN",
    minimumScore: 0
  });
  assert.deepEqual(wrongPatch, []);

  const missingPatch = await retriever.search("霞羊刀", {
    scopes: ["video_guides"],
    seasonContextId: "set17-live",
    locale: "zh-CN",
    minimumScore: 0
  });
  assert.deepEqual(missingPatch, []);
});

test("same-version partial retry preserves documents from quarantined segments", async () => {
  const store = new MemorySemanticDocumentStore();
  const manager = new YouTubeKnowledgeIndexManager({
    store,
    seasonContextId: "set17-live"
  });
  const successful = envelope({
    documents: [
      document({ index: 0, text: "霞优先羊刀。" }),
      document({ index: 1, text: "霞第二件补无尽。" })
    ]
  });
  await manager.indexEnvelope(successful);

  const retainedDocument = successful.documents[1];
  const partialDocument = document({
    index: 0,
    status: "partial_success",
    text: "霞优先羊刀。"
  });
  const partial = envelope({
    status: "partial_success",
    documents: [partialDocument],
    quarantine: [{ segmentId: retainedDocument.metadata.segmentId }]
  });
  partial.segments.push({
    segmentId: retainedDocument.metadata.segmentId,
    index: 1,
    status: "quarantined"
  });

  const report = await manager.indexEnvelope(partial);
  assert.equal(report.removed, 0);
  assert.equal(report.preservedQuarantinedSegmentDocuments, 1);
  assert.deepEqual(
    report.preservedQuarantinedSegmentDocumentIds,
    [retainedDocument.id]
  );

  const remaining = await store.list({
    seasonContextId: "set17-live",
    documentType: "video_guide"
  });
  assert.equal(remaining.length, 2);
  const preserved = remaining.find((value) => value.id === retainedDocument.id);
  assert.equal(preserved.metadata.preservedFromQuarantinedSegment, true);
  assert.equal(preserved.metadata.latestIngestionStatus, "partial_success");
});

test("a partial new video version does not preserve documents from the old version", async () => {
  const store = new MemorySemanticDocumentStore();
  const manager = new YouTubeKnowledgeIndexManager({
    store,
    seasonContextId: "set17-live"
  });
  const successful = envelope({
    documents: [
      document({ index: 0 }),
      document({ index: 1, text: "霞第二件补无尽。" })
    ]
  });
  await manager.indexEnvelope(successful);

  const nextDocument = document({
    index: 0,
    status: "partial_success",
    videoVersion: "version-b",
    transcriptHash: "transcript-b",
    text: "新版本霞优先羊刀。"
  });
  const partial = envelope({
    status: "partial_success",
    videoVersion: "version-b",
    transcriptHash: "transcript-b",
    documents: [nextDocument],
    quarantine: [{ segmentId: "version-b:0001:failed" }]
  });
  partial.segments.push({
    segmentId: "version-b:0001:failed",
    index: 1,
    status: "quarantined"
  });

  const report = await manager.indexEnvelope(partial);
  assert.equal(report.preservedQuarantinedSegmentDocuments, 0);
  assert.equal(report.removed, 2);
  const remaining = await store.list({
    seasonContextId: "set17-live",
    documentType: "video_guide"
  });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].metadata.videoVersion, "version-b");
});
