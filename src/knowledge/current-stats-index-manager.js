import { createHash } from "node:crypto";

import {
  CURRENT_STATS_DOCUMENT_TYPES,
  CURRENT_STATS_SCHEMA_VERSION,
  assertCurrentStatsKnowledgeDocument,
  knowledgeDocumentToSemanticDocument
} from "./knowledge-document-schema.js";
import {
  createCurrentStatsScope,
  currentStatsScopeKey
} from "./metatft-document-generator.js";
import {
  renderCurrentStatsSemanticProjection,
  resolveCurrentStatsSemanticConfig,
  stabilizeCurrentStatsSemanticProjection
} from "./current-stats-semantic-projection.js";

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function recordHash(document, searchableContentHash) {
  const metadata = { ...document.metadata };
  delete metadata.contentHash;
  delete metadata.recordHash;
  return sha256(stableStringify({
    contentHash: searchableContentHash,
    seasonContextId: document.seasonContextId,
    documentType: document.documentType,
    patch: document.patch,
    locale: document.locale,
    source: document.source,
    updatedAt: document.updatedAt,
    metadata
  }));
}

function sameScope(document, scope) {
  const metadata = document.metadata ?? {};
  return (
    document.seasonContextId === scope.season
    && CURRENT_STATS_DOCUMENT_TYPES.includes(document.documentType)
    && metadata.namespace === "current_stats"
    && String(document.patch ?? metadata.patch ?? "") === scope.patch
    && String(metadata.rank ?? "") === scope.rank
    && String(metadata.timeWindow ?? "") === scope.timeWindow
    && String(metadata.region ?? "").toLowerCase() === scope.region
    && String(document.locale ?? metadata.locale ?? "") === scope.locale
  );
}

function assertDocumentScope(document, scope) {
  const metadata = document.metadata;
  const fields = {
    season: metadata.season,
    patch: metadata.patch,
    rank: metadata.rank,
    timeWindow: metadata.timeWindow,
    region: metadata.region,
    locale: metadata.locale
  };
  for (const [key, value] of Object.entries(fields)) {
    if (String(value ?? "").toLowerCase() !== String(scope[key] ?? "").toLowerCase()) {
      throw new RangeError(
        `Current stats document ${document.id} has ${key}=${value}; expected ${scope[key]}`
      );
    }
  }
}

export class CurrentStatsIndexManager {
  constructor(options = {}) {
    if (!options.store?.upsert || !options.store?.list || !options.store?.remove) {
      throw new TypeError("CurrentStatsIndexManager requires a semantic document store");
    }
    this.store = options.store;
    this.embeddingProvider = options.embeddingProvider ?? null;
    this.semanticConfig = options.semanticConfig ?? null;
  }

  async indexBatch(input = {}, options = {}) {
    const scope = createCurrentStatsScope(options.scope ?? input.scope);
    const documents = (Array.isArray(input) ? input : input.documents ?? [])
      .map((value) => assertCurrentStatsKnowledgeDocument(value));
    if (!documents.length) throw new RangeError("Current stats batch requires at least one document");
    documents.forEach((document) => assertDocumentScope(document, scope));

    const existing = await this.store.list({
      seasonContextId: scope.season,
      documentTypes: CURRENT_STATS_DOCUMENT_TYPES,
      patch: scope.patch,
      locale: scope.locale
    });
    const existingScope = existing.filter((document) => sameScope(document, scope));
    const existingById = new Map(existingScope.map((document) => [document.id, document]));
    const provider = options.embeddingProvider ?? this.embeddingProvider;
    let semanticDocuments = documents.map((document) => {
      const current = existingById.get(document.id);
      const semanticConfig = resolveCurrentStatsSemanticConfig({
        ...document.metadata.semanticProjectionConfig,
        ...this.semanticConfig,
        ...options.semanticConfig
      });
      const semanticProjection = stabilizeCurrentStatsSemanticProjection(
        document.metadata.semanticProjection,
        current?.metadata?.semanticProjection,
        semanticConfig
      );
      const projectionChanged = (
        stableStringify(semanticProjection)
        !== stableStringify(current?.metadata?.semanticProjection)
      );
      const renderedDocument = {
        ...document,
        text: !projectionChanged && current?.content
          ? current.content
          : renderCurrentStatsSemanticProjection(semanticProjection),
        metadata: {
          ...document.metadata,
          semanticProjection,
          semanticProjectionConfig: semanticConfig
        }
      };
      const semantic = knowledgeDocumentToSemanticDocument(renderedDocument, {
        seasonContextId: scope.season
      });
      const searchableContentHash = sha256(stableStringify(semanticProjection));
      const freshnessHash = recordHash(semantic, searchableContentHash);
      const withProof = {
        ...semantic,
        contentHash: searchableContentHash,
        recordHash: freshnessHash,
        metadata: {
          ...semantic.metadata,
          currentStatsSchemaVersion: CURRENT_STATS_SCHEMA_VERSION,
          contentHash: searchableContentHash,
          recordHash: freshnessHash
        }
      };
      if (
        current?.contentHash === withProof.contentHash
        && Array.isArray(current.embedding)
        && current.embedding.length
        && (!provider?.model || current.embeddingModel === provider.model)
      ) {
        return {
          ...withProof,
          embedding: current.embedding,
          embeddingModel: current.embeddingModel
        };
      }
      return withProof;
    });

    const needsEmbedding = semanticDocuments.filter((document) => !Array.isArray(document.embedding));
    let embeddingsGenerated = 0;
    if (needsEmbedding.length && provider?.isAvailable?.()) {
      const vectors = await provider.embed(
        needsEmbedding.map((document) => document.content),
        { purpose: "current_stats_ingestion" }
      );
      const vectorsById = new Map(needsEmbedding.map((document, index) => [document.id, vectors[index]]));
      embeddingsGenerated = vectorsById.size;
      semanticDocuments = semanticDocuments.map((document) => (
        vectorsById.has(document.id)
          ? {
              ...document,
              embedding: vectorsById.get(document.id),
              embeddingModel: provider.model
            }
          : document
      ));
    }

    const upserted = await this.store.upsert(semanticDocuments, {
      allowCurrentStats: true
    });
    const retainedIds = new Set(semanticDocuments.map((document) => document.id));
    const staleIds = existingScope
      .filter((document) => !retainedIds.has(document.id))
      .map((document) => document.id);
    const removed = await this.store.remove(staleIds, {
      seasonContextId: scope.season
    });

    this.store.setMeta?.(`currentStatsBatch:${currentStatsScopeKey(scope)}`, JSON.stringify({
      generatedAt: scope.generatedAt,
      expiresAt: scope.expiresAt,
      documents: documents.length
    }));
    return {
      schemaVersion: "current_stats_index_report.v1",
      namespace: "current_stats",
      scope,
      documents: documents.length,
      embedded: embeddingsGenerated,
      vectorsPresent: semanticDocuments.filter((document) => Array.isArray(document.embedding)).length,
      inserted: upserted.inserted,
      updated: upserted.updated,
      unchanged: upserted.unchanged,
      removed
    };
  }
}

export function createCurrentStatsIndexManager(options = {}) {
  return new CurrentStatsIndexManager(options);
}
