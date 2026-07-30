import {
  assertKnowledgeDocument,
  knowledgeDocumentToSemanticDocument
} from "./knowledge-document-schema.js";

function array(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.documents)) return value.documents;
  if (Array.isArray(value?.knowledgeDocuments)) return value.knowledgeDocuments;
  return value ? [value] : [];
}

export class KnowledgeIndexer {
  constructor(options = {}) {
    if (!options.store?.upsert) throw new TypeError("KnowledgeIndexer requires a SemanticDocumentStore");
    this.store = options.store;
    this.embeddingProvider = options.embeddingProvider ?? null;
    this.seasonContextId = options.seasonContextId ?? "set17-live";
  }

  async index(input, options = {}) {
    const documents = array(input).map((value) => assertKnowledgeDocument(value));
    if (!documents.length) throw new RangeError("KnowledgeIndexer requires at least one document");
    let semanticDocuments = documents.map((document) => knowledgeDocumentToSemanticDocument(document, {
      seasonContextId: options.seasonContextId ?? this.seasonContextId
    }));
    const provider = options.embeddingProvider ?? this.embeddingProvider;
    if (provider?.isAvailable?.()) {
      const vectors = await provider.embed(semanticDocuments.map((document) => document.content), {
        purpose: "knowledge_document_ingestion"
      });
      semanticDocuments = semanticDocuments.map((document, index) => ({
        ...document,
        embedding: vectors[index],
        embeddingModel: provider.model
      }));
    }
    const result = await this.store.upsert(semanticDocuments);
    return {
      schemaVersion: "knowledge_index_report.v1",
      namespace: [...new Set(documents.map((document) => document.metadata.namespace))],
      documents: documents.length,
      embedded: semanticDocuments.filter((document) => Array.isArray(document.embedding)).length,
      ...result
    };
  }
}

export function createKnowledgeIndexer(options = {}) {
  return new KnowledgeIndexer(options);
}
