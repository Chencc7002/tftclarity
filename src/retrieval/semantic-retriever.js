import { normalizeAlias } from "../core/normalizer.js";
import { retrieveEntityCandidates } from "../llm/entity-candidate-retriever.js";
import { EmbeddingProviderUnavailableError } from "../llm/embedding-provider.js";
import { createSemanticHit } from "./contracts.js";
import { HybridReranker } from "./hybrid-reranker.js";

function array(value) {
  return Array.isArray(value) ? value : [];
}

const CURRENT_STATS_DOCUMENT_TYPES = new Set([
  "meta_snapshot",
  "unit_stats",
  "comp_stats",
  "item_stats",
  "trend_snapshot"
]);

function normalizedRank(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return values.map((entry) => String(entry).trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

function latestIso(left, right) {
  const leftTime = Date.parse(left ?? "");
  const rightTime = Date.parse(right ?? "");
  if (!Number.isFinite(leftTime)) return right ?? null;
  if (!Number.isFinite(rightTime)) return left ?? null;
  return leftTime >= rightTime ? left : right;
}

export async function listCurrentStatsScopesFromStore(store, options = {}) {
  const documents = await store.list({
    seasonContextId: options.seasonContextId ?? "set17-live",
    documentTypes: [...CURRENT_STATS_DOCUMENT_TYPES],
    locale: options.locale,
    includeGlobalLocale: false
  });
  const now = Number(options.now ?? Date.now());
  const scopes = new Map();
  for (const document of documents) {
    const metadata = document.metadata ?? {};
    const expiresAtTime = Date.parse(metadata.expiresAt ?? "");
    if (
      document.source !== "metatft"
      || metadata.namespace !== "current_stats"
      || (Number.isFinite(expiresAtTime) && expiresAtTime <= now)
    ) continue;
    const scope = {
      seasonContextId: String(document.seasonContextId ?? "set17-live"),
      season: String(metadata.season ?? ""),
      patch: String(document.patch ?? metadata.patch ?? ""),
      rank: normalizedRank(metadata.rank),
      timeWindow: String(metadata.timeWindow ?? ""),
      region: String(metadata.region ?? "").toLowerCase(),
      locale: String(document.locale ?? metadata.locale ?? ""),
      generatedAt: metadata.generatedAt ?? document.updatedAt ?? null,
      expiresAt: metadata.expiresAt ?? null,
      documentCount: 0,
      documentTypes: []
    };
    const key = [
      scope.seasonContextId,
      scope.season,
      scope.patch,
      scope.rank,
      scope.timeWindow,
      scope.region,
      scope.locale
    ].join("\u0000");
    const existing = scopes.get(key);
    if (existing) {
      existing.documentCount += 1;
      existing.documentTypes = [...new Set([...existing.documentTypes, document.documentType])].sort();
      existing.generatedAt = latestIso(existing.generatedAt, scope.generatedAt);
      existing.expiresAt = latestIso(existing.expiresAt, scope.expiresAt);
    } else {
      scope.documentCount = 1;
      scope.documentTypes = [document.documentType];
      scopes.set(key, scope);
    }
  }
  return [...scopes.values()].sort((left, right) => [
    left.seasonContextId,
    left.patch,
    left.rank,
    left.timeWindow,
    left.region,
    left.locale
  ].join("|").localeCompare([
    right.seasonContextId,
    right.patch,
    right.rank,
    right.timeWindow,
    right.region,
    right.locale
  ].join("|")));
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
  const currentStats = CURRENT_STATS_DOCUMENT_TYPES.has(document.documentType);
  const videoGuide = document.documentType === "video_guide";
  if (videoGuide) {
    const metadata = document.metadata ?? {};
    if (
      document.source !== "youtube"
      || metadata.namespace !== "video_guides"
      || !metadata.videoVersion
      || metadata.isCurrentVersion !== true
      || !["success", "partial_success"].includes(metadata.ingestionStatus)
      || !options.patch
      || String(document.patch ?? metadata.patch ?? "") !== String(options.patch)
    ) return false;
  }
  if (
    options.patch
    && (
      currentStats
        ? String(document.patch ?? document.metadata?.patch ?? "") !== String(options.patch)
        : videoGuide
          ? String(document.patch ?? document.metadata?.patch ?? "") !== String(options.patch)
        : document.patch && document.patch !== options.patch
    )
  ) return false;
  if (options.locale && document.locale && document.locale !== options.locale) return false;
  if (String(document.seasonContextId ?? "set17-live") !== String(options.seasonContextId ?? "set17-live")) return false;
  if (currentStats) {
    const metadata = document.metadata ?? {};
    if (options.rank && String(metadata.rank ?? "") !== String(options.rank)) return false;
    if (options.timeWindow && String(metadata.timeWindow ?? "") !== String(options.timeWindow)) return false;
    if (
      options.region
      && String(metadata.region ?? "").toLowerCase() !== String(options.region).toLowerCase()
    ) return false;
  }
  return true;
}

function hitFor(document, score, source) {
  return createSemanticHit({
    id: document.id,
    seasonContextId: document.seasonContextId,
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
      seasonContextId: options.seasonContextId ?? "set17-live",
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
    this.queryVectorCache = new Map();
    this.maxCachedQueries = Math.max(1, Number(options.maxCachedQueries ?? 256));
  }

  async search(query, options = {}) {
    if (!this.provider?.isAvailable?.()) throw new EmbeddingProviderUnavailableError();
    const queryText = String(query ?? "");
    const cacheKey = `${this.provider.model ?? "unknown"}\u0000${queryText}`;
    let queryVector = this.queryVectorCache.get(cacheKey);
    if (!queryVector) {
      [queryVector] = await this.provider.embed([queryText], { purpose: "semantic_search" });
      this.queryVectorCache.set(cacheKey, queryVector);
      if (this.queryVectorCache.size > this.maxCachedQueries) {
        this.queryVectorCache.delete(this.queryVectorCache.keys().next().value);
      }
    }
    const documents = await this.store.list({
      ...options,
      embeddingModel: options.embeddingModel ?? this.provider.model,
      hasEmbedding: true
    });
    return documents
      .filter((document) => filterDocument(document, options) && Array.isArray(document.embedding))
      .map((document) => hitFor(document, vectorCosine(queryVector, document.embedding), "embedding"))
      .filter((hit) => hit.score >= Number(options.minimumScore ?? 0))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, Math.max(1, Number(options.topK ?? 8)));
  }
}

export class FallbackSemanticRetriever extends SemanticRetriever {
  constructor(primary, fallback, options = {}) {
    super();
    this.primary = primary;
    this.fallback = fallback;
    this.onFallback = options.onFallback ?? null;
  }

  async search(query, options = {}) {
    try {
      const hits = await this.primary?.search?.(query, options);
      if (array(hits).length) return hits;
    } catch (error) {
      (options.onFallback ?? this.onFallback)?.(error);
    }
    const hits = await this.fallback.search(query, options);
    return hits.map((hit) => ({
      ...hit,
      metadata: { ...hit.metadata, fallback: true }
    }));
  }
}

export class HybridSemanticRetriever extends SemanticRetriever {
  constructor(retriever, options = {}) {
    super();
    if (!retriever?.search) throw new TypeError("HybridSemanticRetriever requires a SemanticRetriever");
    this.retriever = retriever;
    this.lexicalRetriever = options.lexicalRetriever ?? null;
    this.reranker = options.reranker ?? new HybridReranker();
    this.candidateMultiplier = Math.max(1, Number(options.candidateMultiplier ?? 4));
    this.maxCandidates = Math.max(8, Number(options.maxCandidates ?? 64));
  }

  async search(query, options = {}) {
    const topK = Math.max(1, Number(options.topK ?? 8));
    const candidateTopK = Math.min(
      this.maxCandidates,
      Math.max(topK, Math.ceil(topK * this.candidateMultiplier))
    );
    const candidateOptions = {
      ...options,
      topK: candidateTopK,
      minimumScore: Number(options.candidateMinimumScore ?? -1)
    };
    const [primaryHits, lexicalHits] = await Promise.all([
      this.retriever.search(query, candidateOptions),
      this.lexicalRetriever && this.lexicalRetriever !== this.retriever
        ? this.lexicalRetriever.search(query, { ...candidateOptions, minimumScore: 0 })
        : []
    ]);
    return this.reranker.rerank(query, [...primaryHits, ...lexicalHits], {
      ...options,
      topK,
      minimumScore: Number(options.minimumScore ?? 0)
    });
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

export function createPersistentSemanticRetriever({ store, provider, onFallback = null } = {}) {
  if (!store?.list) throw new TypeError("createPersistentSemanticRetriever requires a SemanticDocumentStore");
  const fallback = new TfidfSemanticRetriever({ store });
  const retriever = provider
    ? new FallbackSemanticRetriever(
        new EmbeddingSemanticRetriever({ provider, store }),
        fallback,
        { onFallback }
      )
    : fallback;
  const hybrid = new HybridSemanticRetriever(retriever, {
    lexicalRetriever: provider ? fallback : null
  });
  hybrid.listCurrentStatsScopes = (options = {}) => listCurrentStatsScopesFromStore(store, options);
  return hybrid;
}

export async function retrieveSemanticPlan(plan, retriever, options = {}) {
  if (!retriever || !Array.isArray(plan?.semanticQueries)) return [];
  const hits = [];
  for (const query of plan.semanticQueries) {
    const values = await retriever.search(query.query, {
      documentTypes: query.types,
      seasonContextId: options.seasonContextId ?? "set17-live",
      patch: query.patch,
      locale: query.locale,
      topK: query.topK,
      minimumScore: options.minimumScore,
      onFallback: options.onFallback
    });
    hits.push(...new HybridReranker().rerank(query.query, values, {
      documentTypes: query.types,
      seasonContextId: options.seasonContextId ?? "set17-live",
      patch: query.patch,
      locale: query.locale,
      topK: query.topK,
      minimumScore: options.minimumScore
    }));
  }
  return hits;
}
