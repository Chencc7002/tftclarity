import { normalizeAlias } from "../core/normalizer.js";
import { retrieveEntityCandidates } from "../llm/entity-candidate-retriever.js";
import { EmbeddingProviderUnavailableError } from "../llm/embedding-provider.js";
import { createSemanticHit } from "./contracts.js";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function tokens(value) {
  const normalized = String(value ?? "").normalize("NFKC").toLowerCase();
  const words = normalized.match(/[a-z0-9]+|\p{Script=Han}/gu) ?? [];
  const compact = normalizeAlias(normalized);
  const ngrams = [];
  for (const size of [1, 2, 3]) {
    for (let index = 0; index <= compact.length - size; index += 1) ngrams.push(`c${size}:${compact.slice(index, index + size)}`);
  }
  return [...words.map((word) => `w:${word}`), ...ngrams];
}

function frequency(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function cosine(left, right) {
  const a = frequency(tokens(left));
  const b = frequency(tokens(right));
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of a.values()) leftNorm += value * value;
  for (const value of b.values()) rightNorm += value * value;
  for (const [key, value] of a) dot += value * (b.get(key) ?? 0);
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function vectorCosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function filterDocument(document, options) {
  const types = new Set(array(options.documentTypes ?? options.types));
  if (types.size && !types.has(document.documentType)) return false;
  if (options.patch && document.patch && document.patch !== options.patch) return false;
  if (options.locale && document.locale && document.locale !== options.locale) return false;
  return true;
}

function hitFor(document, score, source) {
  return createSemanticHit({
    id: document.id,
    documentType: document.documentType,
    score,
    apiName: document.apiName,
    intent: document.intent,
    patch: document.patch,
    locale: document.locale,
    source: document.source ?? source,
    metadata: {
      ...document.metadata,
      content: document.content,
      canonicalName: document.canonicalName ?? document.metadata?.canonicalName,
      aliases: document.aliases ?? document.metadata?.aliases ?? [],
      retrievalMode: source
    }
  });
}

export class SemanticRetriever {
  async search() {
    throw new Error("SemanticRetriever.search must be implemented");
  }
}

export class TfidfSemanticRetriever extends SemanticRetriever {
  constructor(options = {}) {
    super();
    this.store = options.store ?? null;
    this.documents = array(options.documents);
  }

  async search(query, options = {}) {
    const documents = this.store ? await this.store.list(options) : this.documents;
    const minimumScore = Number(options.minimumScore ?? 0.1);
    return documents
      .filter((document) => filterDocument(document, options))
      .map((document) => hitFor(document, cosine(query, document.content ?? document.text), "tfidf"))
      .filter((hit) => hit.score >= minimumScore)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, Math.max(1, Number(options.topK ?? 8)));
  }
}

export class EntityCandidateSemanticRetriever extends SemanticRetriever {
  constructor(options = {}) {
    super();
    this.catalog = options.catalog;
    this.entityRetriever = options.entityRetriever ?? retrieveEntityCandidates;
  }

  async search(query, options = {}) {
    const candidates = this.entityRetriever(query, {
      catalog: options.catalog ?? this.catalog,
      entityTypes: options.documentTypes ?? options.types,
      limit: options.topK ?? 8
    });
    return candidates.map((candidate) => createSemanticHit({
      id: `${candidate.entityType}:${candidate.apiName}`,
      documentType: candidate.entityType,
      score: candidate.confidence,
      apiName: candidate.apiName,
      patch: options.patch ?? null,
      locale: options.locale ?? "zh-CN",
      source: candidate.source,
      metadata: {
        canonicalName: candidate.label,
        matchedAlias: candidate.matchedAlias,
        matchType: candidate.matchType,
        inputFragment: candidate.inputFragment,
        vectorScore: candidate.vectorScore,
        retrievalMode: "legacy_tfidf_adapter"
      }
    }));
  }
}

export class EmbeddingSemanticRetriever extends SemanticRetriever {
  constructor(options = {}) {
    super();
    this.provider = options.provider;
    this.store = options.store;
  }

  async search(query, options = {}) {
    if (!this.provider?.isAvailable?.()) throw new EmbeddingProviderUnavailableError();
    const [queryVector] = await this.provider.embed([String(query ?? "")], { purpose: "semantic_search" });
    const documents = await this.store.list(options);
    return documents
      .filter((document) => filterDocument(document, options) && Array.isArray(document.embedding))
      .map((document) => hitFor(document, vectorCosine(queryVector, document.embedding), "embedding"))
      .filter((hit) => hit.score >= Number(options.minimumScore ?? 0))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, Math.max(1, Number(options.topK ?? 8)));
  }
}

export class FallbackSemanticRetriever extends SemanticRetriever {
  constructor(primary, fallback) {
    super();
    this.primary = primary;
    this.fallback = fallback;
  }

  async search(query, options = {}) {
    try {
      const hits = await this.primary?.search?.(query, options);
      if (array(hits).length) return hits;
    } catch (error) {
      options.onFallback?.(error);
    }
    const hits = await this.fallback.search(query, options);
    return hits.map((hit) => ({
      ...hit,
      metadata: { ...hit.metadata, fallback: true }
    }));
  }
}

export function createTfidfSemanticRetriever(options = {}) {
  return new TfidfSemanticRetriever(options);
}

export function createEntityCandidateSemanticRetriever(options = {}) {
  return new EntityCandidateSemanticRetriever(options);
}

export function createFallbackSemanticRetriever(primary, fallback) {
  return new FallbackSemanticRetriever(primary, fallback);
}
