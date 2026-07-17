import { normalizeAlias } from "../core/normalizer.js";

export const HYBRID_MATCH_PRIORITY = Object.freeze({
  api_exact: 600,
  canonical_exact: 500,
  alias_exact: 400,
  keyword: 300,
  vector: 200,
  unknown: 100
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedValues(hit) {
  return {
    apiName: normalizeAlias(hit.apiName ?? hit.metadata?.apiName),
    canonicalName: normalizeAlias(hit.metadata?.canonicalName),
    aliases: array(hit.metadata?.aliases ?? hit.metadata?.matchedAlias).map(normalizeAlias).filter(Boolean),
    content: normalizeAlias(hit.metadata?.content)
  };
}

function matchType(query, hit) {
  const normalizedQuery = normalizeAlias(query);
  const values = normalizedValues(hit);
  if (values.apiName && normalizedQuery === values.apiName) return "api_exact";
  if (values.canonicalName && normalizedQuery === values.canonicalName) return "canonical_exact";
  if (values.aliases.includes(normalizedQuery) || normalizeAlias(hit.metadata?.matchedAlias) === normalizedQuery) return "alias_exact";
  if (hit.metadata?.matchType && !["tfidf_vector", "embedding"].includes(hit.metadata.matchType)) return "keyword";
  if (values.content && (values.content.includes(normalizedQuery) || normalizedQuery.includes(values.content))) return "keyword";
  return "vector";
}

function allowed(hit, options) {
  const types = new Set(array(options.documentTypes ?? options.types));
  if (types.size && !types.has(hit.documentType)) return false;
  if (options.locale && hit.locale && hit.locale !== options.locale) return false;
  if (options.patch && hit.patch && hit.patch !== options.patch) return false;
  return true;
}

export class HybridReranker {
  rerank(query, hits, options = {}) {
    const byId = new Map();
    for (const hit of array(hits)) {
      if (!allowed(hit, options)) continue;
      const type = matchType(query, hit);
      const rerankScore = HYBRID_MATCH_PRIORITY[type] + Math.max(0, Math.min(1, Number(hit.score ?? 0)));
      const value = {
        ...hit,
        score: Number(hit.score ?? 0),
        metadata: { ...hit.metadata, hybridMatchType: type, rerankScore }
      };
      const existing = byId.get(value.id);
      if (!existing || existing.metadata.rerankScore < rerankScore) byId.set(value.id, value);
    }
    return [...byId.values()]
      .sort((left, right) => right.metadata.rerankScore - left.metadata.rerankScore || left.id.localeCompare(right.id))
      .slice(0, Math.max(1, Number(options.topK ?? 8)));
  }
}

export function rerankSemanticHits(query, hits, options = {}) {
  return new HybridReranker().rerank(query, hits, options);
}
