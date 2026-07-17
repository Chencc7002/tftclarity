import { createHash } from "node:crypto";

function contentHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeDocument(value = {}) {
  const content = String(value.content ?? value.text ?? "").trim();
  if (!value.id || !value.documentType || !content) throw new TypeError("Semantic document requires id, documentType and content");
  if (value.realtime === true || value.metadata?.realtime === true || /metatft.*(?:daily|realtime|statistics)/iu.test(String(value.source ?? ""))) {
    throw new RangeError("Realtime MetaTFT statistics cannot be stored in the static semantic index");
  }
  return {
    id: String(value.id),
    documentType: String(value.documentType),
    content,
    contentHash: value.contentHash ?? contentHash(content),
    embeddingModel: value.embeddingModel ?? null,
    embedding: Array.isArray(value.embedding) ? value.embedding.map(Number) : null,
    apiName: value.apiName ? String(value.apiName) : null,
    intent: value.intent ? String(value.intent) : null,
    patch: value.patch ?? null,
    locale: value.locale ?? null,
    source: String(value.source ?? "local_static_index"),
    updatedAt: value.updatedAt ?? new Date().toISOString(),
    metadata: value.metadata && typeof value.metadata === "object" ? { ...value.metadata } : {}
  };
}

export class SemanticDocumentStore {
  async upsert() {
    throw new Error("SemanticDocumentStore.upsert must be implemented");
  }

  async list() {
    throw new Error("SemanticDocumentStore.list must be implemented");
  }

  async remove() {
    throw new Error("SemanticDocumentStore.remove must be implemented");
  }
}

export class MemorySemanticDocumentStore extends SemanticDocumentStore {
  constructor(documents = []) {
    super();
    this.documents = new Map();
    for (const document of documents) {
      const normalized = normalizeDocument(document);
      this.documents.set(normalized.id, normalized);
    }
  }

  async upsert(documents) {
    const result = { inserted: 0, updated: 0, unchanged: 0 };
    for (const value of Array.isArray(documents) ? documents : [documents]) {
      const document = normalizeDocument(value);
      const existing = this.documents.get(document.id);
      if (existing?.contentHash === document.contentHash && existing?.embeddingModel === document.embeddingModel) {
        result.unchanged += 1;
        continue;
      }
      result[existing ? "updated" : "inserted"] += 1;
      this.documents.set(document.id, document);
    }
    return result;
  }

  async list(filters = {}) {
    const types = new Set(Array.isArray(filters.documentTypes) ? filters.documentTypes : filters.documentType ? [filters.documentType] : []);
    return [...this.documents.values()].filter((document) => {
      if (types.size && !types.has(document.documentType)) return false;
      if (filters.patch && document.patch && document.patch !== filters.patch) return false;
      if (filters.locale && document.locale && document.locale !== filters.locale) return false;
      return true;
    }).map((document) => ({ ...document, metadata: { ...document.metadata } }));
  }

  async remove(ids) {
    let removed = 0;
    for (const id of Array.isArray(ids) ? ids : [ids]) removed += Number(this.documents.delete(String(id)));
    return removed;
  }
}

export { contentHash as semanticContentHash, normalizeDocument as normalizeSemanticDocument };
