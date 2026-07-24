import { normalizeAlias } from "../core/normalizer.js";
import { pinyinAliasesForRecord } from "../data/pinyin-aliases.js";
import { retrieveEntityCandidates } from "../llm/entity-candidate-retriever.js";
import { resolveGameConcept } from "./concept-resolver.js";

export const ENTITY_LINK_RESULT_VERSION = "entity-link-result.v1";
export const ENTITY_RESOLUTION_ORDER = Object.freeze([
  "exact",
  "normalized_alias",
  "current_patch_catalog",
  "pinyin_fuzzy",
  "semantic_retrieval",
  "llm_candidate_rerank"
]);

const TYPE_MAP = Object.freeze({
  champion: "unit",
  item: "item",
  trait: "trait"
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function recordsFor(catalog, expectedType) {
  const records = expectedType === "champion"
    ? catalog?.units
    : expectedType === "item"
      ? catalog?.items
      : expectedType === "trait"
        ? catalog?.traits
        : [];
  const byId = new Map(array(records).map((record) => [record.apiName, record]));
  return array(records).filter((record) => {
    if (record.current === false) return false;
    const replacement = byId.get(record.supersededBy);
    return !(replacement?.current && replacement?.obtainable !== false);
  });
}

function recordId(record, expectedType) {
  return expectedType === "trait" ? record.filterId ?? record.apiName : record.apiName;
}

function canonicalName(record, expectedType) {
  if (expectedType === "item") return record.preferredDisplayName ?? record.shortName ?? record.zhName ?? record.displayName ?? record.apiName;
  if (expectedType === "trait") return record.displayName ?? record.zhName ?? record.shortName ?? record.apiName;
  return record.zhName ?? record.displayName ?? record.shortName ?? record.apiName;
}

function officialNames(record, expectedType) {
  return [
    recordId(record, expectedType),
    record.zhName,
    record.displayName,
    expectedType === "item" ? record.preferredDisplayName : null
  ].filter(Boolean).map(String);
}

function aliases(record, expectedType) {
  const official = new Set(officialNames(record, expectedType).map(normalizeAlias));
  const pinyin = new Set(pinyinAliasesForRecord(record, TYPE_MAP[expectedType]).map(normalizeAlias));
  return [record.shortName, ...(record.aliases ?? [])]
    .filter(Boolean)
    .map(String)
    .filter((alias) => !official.has(normalizeAlias(alias)) && !pinyin.has(normalizeAlias(alias)));
}

function candidate(record, expectedType, value = {}) {
  return {
    id: String(recordId(record, expectedType)),
    canonicalName: String(canonicalName(record, expectedType)),
    type: expectedType,
    version: String(value.version ?? record.patch ?? "current"),
    matchedAlias: value.matchedAlias ?? null,
    source: String(value.source ?? "current_patch_catalog"),
    confidence: Math.max(0, Math.min(1, Number(value.confidence ?? 0)))
  };
}

function deduplicateCandidates(values) {
  const byId = new Map();
  for (const value of values) {
    if (!value?.id) continue;
    const existing = byId.get(value.id);
    if (!existing || value.confidence > existing.confidence) byId.set(value.id, value);
  }
  return [...byId.values()].sort((left, right) => (
    right.confidence - left.confidence || left.canonicalName.localeCompare(right.canonicalName)
  ));
}

function deterministicCandidates(rawText, expectedType, catalog, version) {
  const records = recordsFor(catalog, expectedType);
  const exact = records.filter((record) => officialNames(record, expectedType).includes(String(rawText)));
  if (exact.length) {
    return exact.map((record) => candidate(record, expectedType, {
      version,
      matchedAlias: rawText,
      source: "exact",
      confidence: 1
    }));
  }

  const normalized = normalizeAlias(rawText);
  const aliasMatches = records.filter((record) => (
    aliases(record, expectedType).some((alias) => normalizeAlias(alias) === normalized)
  ));
  if (aliasMatches.length) {
    return aliasMatches.map((record) => candidate(record, expectedType, {
      version,
      matchedAlias: aliases(record, expectedType).find((alias) => normalizeAlias(alias) === normalized),
      source: "normalized_alias",
      confidence: 0.99
    }));
  }

  const catalogMatches = records.filter((record) => (
    officialNames(record, expectedType).some((name) => normalizeAlias(name) === normalized)
  ));
  return catalogMatches.map((record) => candidate(record, expectedType, {
    version,
    matchedAlias: rawText,
    source: "current_patch_catalog",
    confidence: 0.97
  }));
}

function fuzzyCandidates(rawText, expectedType, catalog, version, options) {
  const entityType = TYPE_MAP[expectedType];
  if (!entityType) return [];
  return (options.candidateRetriever ?? retrieveEntityCandidates)(rawText, {
    catalog,
    entityTypes: [entityType],
    limit: options.candidateLimit ?? 5
  }).map((value) => {
    const record = recordsFor(catalog, expectedType).find((item) => (
      String(recordId(item, expectedType)) === String(value.apiName)
    ));
    if (!record) return null;
    return candidate(record, expectedType, {
      version,
      matchedAlias: value.matchedAlias,
      source: "pinyin_fuzzy",
      confidence: value.confidence
    });
  }).filter(Boolean);
}

async function semanticCandidates(rawText, expectedType, catalog, version, options) {
  if (typeof options.semanticRetriever?.search !== "function") return [];
  const entityType = TYPE_MAP[expectedType];
  const hits = await options.semanticRetriever.search(rawText, {
    documentTypes: [entityType],
    patch: options.patch,
    locale: options.locale ?? "zh-CN",
    topK: options.candidateLimit ?? 5
  });
  return array(hits).map((hit) => {
    const hitId = hit.apiName ?? hit.metadata?.apiName ?? hit.id;
    const record = recordsFor(catalog, expectedType).find((item) => (
      String(recordId(item, expectedType)) === String(hitId)
    ));
    if (!record) return null;
    return candidate(record, expectedType, {
      version,
      matchedAlias: hit.metadata?.matchedAlias ?? null,
      source: "semantic_retrieval",
      confidence: Math.min(0.92, Number(hit.score ?? 0))
    });
  }).filter(Boolean);
}

function resolveUnique(candidates, options = {}) {
  const top = candidates[0];
  if (!top) return null;
  if (top.source === "exact" || top.source === "normalized_alias" || top.source === "current_patch_catalog") {
    return candidates.filter((value) => value.confidence === top.confidence).length === 1 ? top : null;
  }
  const minimumConfidence = Number(options.minimumConfidence ?? 0.9);
  const minimumMargin = Number(options.minimumMargin ?? 0.08);
  const runnerUp = candidates.find((value) => value.id !== top.id);
  if (top.confidence < minimumConfidence) return null;
  if (runnerUp && top.confidence - runnerUp.confidence < minimumMargin) return null;
  return top;
}

function passthroughEntity(entity, version) {
  if (entity.expectedType === "patch") {
    const rawText = String(entity.rawText ?? "");
    const id = /当前|當前|这版|這版|现在|現在/u.test(rawText) ? "patch.current" : `patch.${rawText}`;
    return {
      rawText,
      resolvedId: id,
      canonicalName: rawText,
      expectedType: "patch",
      version,
      candidates: [{ id, canonicalName: rawText, type: "patch", version, source: "exact", confidence: 1 }],
      source: "exact",
      confidence: 1
    };
  }
  return {
    rawText: String(entity.rawText ?? ""),
    resolvedId: null,
    canonicalName: null,
    expectedType: entity.expectedType,
    version,
    candidates: [],
    source: "unresolved",
    confidence: 0
  };
}

export async function linkEntityMention(entity = {}, options = {}) {
  const expectedType = String(entity.expectedType ?? entity.type ?? "game_concept");
  const rawText = String(entity.rawText ?? entity.mention ?? "").trim();
  const version = String(options.patch ?? options.catalog?.version ?? "current");
  if (expectedType === "game_concept") return resolveGameConcept(rawText);
  if (!TYPE_MAP[expectedType]) return passthroughEntity({ rawText, expectedType }, version);

  let candidates = deterministicCandidates(rawText, expectedType, options.catalog, version);
  if (!candidates.length) {
    candidates = fuzzyCandidates(rawText, expectedType, options.catalog, version, options);
  }
  if (!resolveUnique(candidates, options) && typeof options.semanticRetriever?.search === "function") {
    candidates = deduplicateCandidates([
      ...candidates,
      ...await semanticCandidates(rawText, expectedType, options.catalog, version, options)
    ]);
  } else {
    candidates = deduplicateCandidates(candidates);
  }
  if (candidates.length > 1 && typeof options.candidateReranker === "function") {
    const reranked = await options.candidateReranker({
      rawText,
      expectedType,
      candidates: structuredClone(candidates)
    });
    if (Array.isArray(reranked)) {
      const permitted = new Set(candidates.map((value) => value.id));
      candidates = deduplicateCandidates(reranked
        .filter((value) => permitted.has(value.id))
        .map((value) => ({ ...value, source: "llm_candidate_rerank" })));
    }
  }
  const top = resolveUnique(candidates, options);
  return {
    schemaVersion: ENTITY_LINK_RESULT_VERSION,
    rawText,
    resolvedId: top?.id ?? null,
    canonicalName: top?.canonicalName ?? null,
    expectedType,
    version,
    candidates: candidates.slice(0, options.candidateLimit ?? 5),
    source: top?.source ?? (candidates[0]?.source ?? "unresolved"),
    confidence: top?.confidence ?? (candidates[0]?.confidence ?? 0)
  };
}

export async function linkTaskFrameEntities(taskFrame, options = {}) {
  const link = (entity) => linkEntityMention(entity, options);
  const [subjects, candidates, concepts] = await Promise.all([
    Promise.all(array(taskFrame?.subjects).map(link)),
    Promise.all(array(taskFrame?.candidates).map(link)),
    Promise.all(array(taskFrame?.concepts).map(link))
  ]);
  return {
    ...taskFrame,
    subjects,
    candidates,
    concepts
  };
}
