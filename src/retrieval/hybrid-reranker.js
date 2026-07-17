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
  const matchedAlias = normalizeAlias(hit.metadata?.matchedAlias);
  if (values.apiName && normalizedQuery.includes(values.apiName)) return "api_exact";
  if (values.canonicalName && normalizedQuery.includes(values.canonicalName)) return "canonical_exact";
  if (
    values.aliases.some((alias) => normalizedQuery.includes(alias))
    || (matchedAlias && normalizedQuery.includes(matchedAlias))
  ) return "alias_exact";
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

function confidenceFor(type, score) {
  const semanticScore = Math.max(0, Math.min(1, Number(score ?? 0)));
  if (type === "api_exact") return 1;
  if (type === "canonical_exact") return Math.max(0.99, semanticScore);
  if (type === "alias_exact") return Math.max(0.97, semanticScore);
  if (type === "keyword") return Math.max(0.8, semanticScore);
  return semanticScore;
}

export class HybridReranker {
  rerank(query, hits, options = {}) {
    const byId = new Map();
    for (const hit of array(hits)) {
      if (!allowed(hit, options)) continue;
      const type = matchType(query, hit);
      const semanticScore = Math.max(0, Math.min(1, Number(hit.score ?? 0)));
      const score = confidenceFor(type, semanticScore);
      const rerankScore = HYBRID_MATCH_PRIORITY[type] + semanticScore;
      const value = {
        ...hit,
        score,
        metadata: {
          ...hit.metadata,
          hybridMatchType: type,
          semanticScore,
          rerankScore
        }
      };
      const existing = byId.get(value.id);
      if (!existing || existing.metadata.rerankScore < rerankScore) byId.set(value.id, value);
    }
    return [...byId.values()]
      .filter((hit) => hit.score >= Number(options.minimumScore ?? 0))
      .sort((left, right) => right.metadata.rerankScore - left.metadata.rerankScore || left.id.localeCompare(right.id))
      .slice(0, Math.max(1, Number(options.topK ?? 8)));
  }
}

export function rerankSemanticHits(query, hits, options = {}) {
  return new HybridReranker().rerank(query, hits, options);
}
