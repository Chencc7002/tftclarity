import { normalizeSemanticDocument } from "./semantic-document-store.js";

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function scopeKey(document) {
  return JSON.stringify([document.patch ?? null, document.locale ?? null]);
}

export async function buildSemanticIndex({
  store,
  provider,
  documents,
  batchSize = 64,
  prune = true,
  requireEmbeddings = true,
  onProgress = null
} = {}) {
  if (!store?.upsert || !store?.list) throw new TypeError("buildSemanticIndex requires a SemanticDocumentStore");
  const normalized = [...new Map((documents ?? []).map((value) => {
    const document = normalizeSemanticDocument(value);
    return [document.id, document];
  })).values()];
  if (!normalized.length) throw new RangeError("buildSemanticIndex requires at least one semantic document");
  if (requireEmbeddings && !provider?.isAvailable?.()) {
    throw new Error("A configured EmbeddingProvider is required to build the vector index");
  }
  const existing = new Map((await store.list()).map((document) => [document.id, document]));
  const model = provider?.model ?? null;
  const changed = normalized.filter((document) => {
    const current = existing.get(document.id);
    if (!current || current.contentHash !== document.contentHash) return true;
    if (!requireEmbeddings) return false;
    return !Array.isArray(current.embedding) || current.embeddingModel !== model;
  });
  const embedded = new Map();
  if (changed.length && provider?.isAvailable?.()) {
    for (const batch of chunks(changed, Math.max(1, Number(batchSize) || 64))) {
      const vectors = await provider.embed(batch.map((document) => document.content), { purpose: "semantic_index_build" });
      batch.forEach((document, index) => embedded.set(document.id, vectors[index]));
      onProgress?.({ phase: "embedding", completed: embedded.size, total: changed.length });
    }
  }
  const candidates = normalized.map((document) => {
    const vector = embedded.get(document.id);
    if (vector) return { ...document, embedding: vector, embeddingModel: model };
    const current = existing.get(document.id);
    if (current?.contentHash === document.contentHash && Array.isArray(current.embedding)) {
      return { ...document, embedding: current.embedding, embeddingModel: current.embeddingModel };
    }
    return document;
  });
  if (requireEmbeddings && candidates.some((document) => !Array.isArray(document.embedding))) {
    throw new Error("Vector index build produced documents without embeddings");
  }
  const upserted = await store.upsert(candidates);
  let removed = 0;
  if (prune) {
    const retained = new Set(normalized.map((document) => document.id));
    const scopes = new Set(normalized.map(scopeKey));
    const staleIds = [...existing.values()]
      .filter((document) => scopes.has(scopeKey(document)) && !retained.has(document.id))
      .map((document) => document.id);
    removed = await store.remove(staleIds);
  }
  store.setMeta?.("embeddingModel", model ?? "none");
  store.setMeta?.("lastBuildAt", new Date().toISOString());
  store.setMeta?.("documentCount", String(normalized.length));
  const report = {
    schemaVersion: "semantic_index_build_report.v1",
    embeddingModel: model,
    documents: normalized.length,
    embedded: embedded.size,
    inserted: upserted.inserted,
    updated: upserted.updated,
    unchanged: upserted.unchanged,
    removed,
    requireEmbeddings,
    builtAt: new Date().toISOString()
  };
  onProgress?.({ phase: "complete", report });
  return report;
}

export async function auditSemanticIndex(store, options = {}) {
  if (!store?.list) throw new TypeError("auditSemanticIndex requires a SemanticDocumentStore");
  const documents = await store.list();
  const issues = [];
  const expectedModel = options.embeddingModel ?? null;
  const dimensionsByModel = new Map();
  const contentScopes = new Map();
  const countsByType = {};
  const countsByPatch = {};
  for (const document of documents) {
    countsByType[document.documentType] = (countsByType[document.documentType] ?? 0) + 1;
    countsByPatch[document.patch ?? "global"] = (countsByPatch[document.patch ?? "global"] ?? 0) + 1;
    if (!Array.isArray(document.embedding) || !document.embedding.length) {
      issues.push({ code: "missing_embedding", documentId: document.id });
      continue;
    }
    if (document.embedding.some((value) => !Number.isFinite(Number(value)))) {
      issues.push({ code: "invalid_embedding", documentId: document.id });
    }
    if (!document.embeddingModel) issues.push({ code: "missing_embedding_model", documentId: document.id });
    if (expectedModel && document.embeddingModel !== expectedModel) {
      issues.push({ code: "stale_embedding_model", documentId: document.id, actual: document.embeddingModel, expected: expectedModel });
    }
    const knownDimensions = dimensionsByModel.get(document.embeddingModel);
    if (knownDimensions && knownDimensions !== document.embedding.length) {
      issues.push({ code: "dimension_mismatch", documentId: document.id, actual: document.embedding.length, expected: knownDimensions });
    } else if (!knownDimensions) {
      dimensionsByModel.set(document.embeddingModel, document.embedding.length);
    }
    const key = JSON.stringify([document.documentType, document.patch, document.locale, document.contentHash]);
    const previous = contentScopes.get(key);
    if (previous && previous !== document.id) {
      issues.push({ code: "duplicate_content", documentId: document.id, duplicateOf: previous });
    } else {
      contentScopes.set(key, document.id);
    }
  }
  return {
    schemaVersion: "semantic_index_audit_report.v1",
    healthy: issues.length === 0,
    documents: documents.length,
    countsByType,
    countsByPatch,
    dimensionsByModel: Object.fromEntries(dimensionsByModel),
    issues,
    auditedAt: new Date().toISOString()
  };
}
