import {
  assertKnowledgeDocument,
  knowledgeDocumentToSemanticDocument
} from "./knowledge-document-schema.js";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sameScope(document, source) {
  const metadata = document?.metadata ?? {};
  return document?.documentType === "video_guide"
    && document?.source === "youtube"
    && metadata.namespace === "video_guides"
    && String(metadata.sourceId ?? "") === String(source.videoId ?? "")
    && String(metadata.season ?? document.seasonContextId ?? "") === String(source.season ?? "")
    && String(metadata.patch ?? document.patch ?? "") === String(source.patch ?? "")
    && String(metadata.region ?? "").toLowerCase() === String(source.region ?? "").toLowerCase()
    && String(metadata.locale ?? document.locale ?? "") === String(source.locale ?? "");
}

function assertEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("YouTube ingestion envelope must be an object");
  }
  if (value.schemaVersion !== "youtube_ingestion.v2") {
    throw new TypeError("YouTube index manager requires youtube_ingestion.v2");
  }
  if (!["success", "partial_success"].includes(value.status)) {
    throw new RangeError(`YouTube ingestion status is not indexable: ${value.status ?? "unknown"}`);
  }
  const source = value.source ?? {};
  for (const key of [
    "videoId",
    "videoVersion",
    "transcriptHash",
    "season",
    "patch",
    "locale"
  ]) {
    if (!source[key]) throw new TypeError(`YouTube ingestion source.${key} is required`);
  }
  const documents = array(value.documents).map((document) => assertKnowledgeDocument(document));
  if (!documents.length) throw new RangeError("YouTube ingestion has no indexable documents");
  for (const document of documents) {
    const metadata = document.metadata;
    if (
      metadata.sourceId !== source.videoId
      || metadata.videoVersion !== source.videoVersion
      || metadata.transcriptHash !== source.transcriptHash
      || metadata.season !== source.season
      || metadata.patch !== source.patch
      || metadata.locale !== source.locale
      || metadata.ingestionStatus !== value.status
      || metadata.isCurrentVersion !== true
    ) {
      throw new TypeError(`YouTube document ${document.id} does not match its ingestion envelope`);
    }
  }
  return { source, documents };
}

export class YouTubeKnowledgeIndexManager {
  constructor(options = {}) {
    if (!options.store?.upsert || !options.store?.list || !options.store?.remove) {
      throw new TypeError("YouTubeKnowledgeIndexManager requires a mutable SemanticDocumentStore");
    }
    this.store = options.store;
    this.embeddingProvider = options.embeddingProvider ?? null;
    this.seasonContextId = options.seasonContextId ?? "set17-live";
  }

  async indexEnvelope(envelope, options = {}) {
    const { source, documents } = assertEnvelope(envelope);
    const seasonContextId = String(
      options.seasonContextId
      ?? source.season
      ?? this.seasonContextId
    );
    const existing = (await this.store.list({
      seasonContextId,
      documentType: "video_guide",
      patch: source.patch,
      locale: source.locale
    })).filter((document) => sameScope(document, source));
    const existingById = new Map(existing.map((document) => [document.id, document]));
    const quarantinedSegmentIds = new Set(
      array(envelope.quarantine)
        .map((record) => String(record?.segmentId ?? ""))
        .filter(Boolean)
    );

    let semanticDocuments = documents.map((document) => (
      knowledgeDocumentToSemanticDocument(document, { seasonContextId })
    ));
    const nextEnvelopeIds = new Set(semanticDocuments.map((document) => document.id));
    const preservedQuarantinedSegmentDocuments = envelope.status === "partial_success"
      ? existing
        .filter((document) => (
          !nextEnvelopeIds.has(document.id)
          && String(document.metadata?.videoVersion ?? "") === String(source.videoVersion)
          && quarantinedSegmentIds.has(String(document.metadata?.segmentId ?? ""))
        ))
        .map((document) => ({
          ...document,
          recordHash: [
            document.contentHash,
            "preserved-quarantined-segment",
            source.videoVersion,
            document.metadata?.segmentId
          ].join(":"),
          updatedAt: new Date().toISOString(),
          metadata: {
            ...document.metadata,
            preservedFromQuarantinedSegment: true,
            latestIngestionStatus: "partial_success"
          }
        }))
      : [];
    semanticDocuments.push(...preservedQuarantinedSegmentDocuments);
    const provider = options.embeddingProvider ?? this.embeddingProvider;
    let embedded = 0;
    if (provider?.isAvailable?.()) {
      const changedIndexes = semanticDocuments
        .map((document, index) => ({
          index,
          changed: existingById.get(document.id)?.content !== document.content
            || !existingById.get(document.id)?.embedding
            || existingById.get(document.id)?.embeddingModel !== provider.model
        }))
        .filter((entry) => entry.changed)
        .map((entry) => entry.index);
      if (changedIndexes.length) {
        const vectors = await provider.embed(
          changedIndexes.map((index) => semanticDocuments[index].content),
          { purpose: "youtube_knowledge_document_ingestion" }
        );
        semanticDocuments = semanticDocuments.map((document, index) => {
          const changedIndex = changedIndexes.indexOf(index);
          return changedIndex < 0
            ? document
            : {
                ...document,
                embedding: vectors[changedIndex],
                embeddingModel: provider.model
              };
        });
        embedded = changedIndexes.length;
      }
    }

    const upsert = await this.store.upsert(semanticDocuments);
    const nextIds = new Set(semanticDocuments.map((document) => document.id));
    const staleIds = existing
      .map((document) => document.id)
      .filter((id) => !nextIds.has(id));
    const removed = staleIds.length
      ? await this.store.remove(staleIds, { seasonContextId })
      : 0;
    return {
      schemaVersion: "youtube_knowledge_index_report.v2",
      namespace: "video_guides",
      status: envelope.status,
      sourceId: source.videoId,
      videoVersion: source.videoVersion,
      transcriptHash: source.transcriptHash,
      season: source.season,
      patch: source.patch,
      region: source.region ?? null,
      locale: source.locale,
      documents: documents.length,
      preservedQuarantinedSegmentDocuments: (
        preservedQuarantinedSegmentDocuments.length
      ),
      preservedQuarantinedSegmentDocumentIds: (
        preservedQuarantinedSegmentDocuments.map((document) => document.id)
      ),
      segments: array(envelope.segments).length,
      quarantinedSegments: array(envelope.quarantine).length,
      embedded,
      removed,
      staleDocumentIds: staleIds,
      ...upsert
    };
  }
}

export function createYouTubeKnowledgeIndexManager(options = {}) {
  return new YouTubeKnowledgeIndexManager(options);
}
