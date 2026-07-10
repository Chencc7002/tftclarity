import { createCatalog } from "../data/static-data.js";
import { normalizeAlias } from "../core/normalizer.js";

const DEFAULT_LIMIT = 5;
const DEFAULT_ENTITY_TYPES = new Set(["unit", "item", "trait"]);
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const ENTITY_INDEX_CACHE = new WeakMap();

function compactStrings(values) {
  return [...new Set(
    values
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value).trim())
      .filter(Boolean)
  )];
}

function apiToken(value) {
  return String(value ?? "")
    .replace(/^TFT\d*_/, "")
    .replace(/_[0-9]+$/, "");
}

function entityTarget(record, entityType) {
  return entityType === "trait"
    ? record.filterId ?? record.apiName
    : record.apiName;
}

function entityLabel(record, entityType) {
  if (entityType === "item") {
    return record.shortName ?? record.zhName ?? record.displayName ?? record.apiName;
  }
  if (entityType === "trait") {
    return record.displayName ?? record.zhName ?? record.apiName ?? record.filterId;
  }
  return record.zhName ?? record.displayName ?? record.apiName;
}

function aliasesForRecord(record, entityType) {
  return compactStrings([
    record.zhName,
    record.shortName,
    record.displayName,
    ...(record.aliases ?? []),
    record.apiName,
    record.filterId,
    apiToken(record.apiName),
    entityType === "trait" ? apiToken(record.filterId) : null
  ]);
}

function recordsForEntityType(catalog, entityType) {
  if (entityType === "unit") return catalog.units ?? [];
  if (entityType === "item") return catalog.items ?? [];
  if (entityType === "trait") return catalog.traits ?? [];
  return [];
}

function buildEntityDocuments(catalog, entityTypes) {
  const documents = [];
  for (const entityType of entityTypes) {
    for (const record of recordsForEntityType(catalog, entityType)) {
      const apiName = entityTarget(record, entityType);
      const aliases = aliasesForRecord(record, entityType);
      for (const alias of aliases) {
        const normalizedAlias = normalizeAlias(alias);
        if (!normalizedAlias) continue;
        documents.push({
          entityType,
          apiName,
          label: entityLabel(record, entityType),
          alias,
          normalizedAlias,
          keywordTerms: tokenizeKeywords(alias),
          vectorTerms: tokenizeVectorFeatures(alias),
          record
        });
      }
    }
  }
  return documents;
}

function normalizeEntityTypes(value) {
  const values = typeof value === "string"
    ? [value]
    : Array.from(value ?? DEFAULT_ENTITY_TYPES);
  const entityTypes = [...new Set(
    values
      .map((entityType) => String(entityType).toLowerCase())
      .filter((entityType) => DEFAULT_ENTITY_TYPES.has(entityType))
  )].sort();

  return entityTypes.length
    ? entityTypes
    : [...DEFAULT_ENTITY_TYPES].sort();
}

function splitCamelCase(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function hanNgrams(value) {
  if (value.length <= 2) return [value];
  const grams = [];
  for (let index = 0; index <= value.length - 2; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

function tokenizeKeywords(value) {
  const prepared = splitCamelCase(value)
    .normalize("NFKC")
    .replace(/[_\-./\\()[\]{}<>,'"`~:;!?，。！？、]/g, " ")
    .toLowerCase();
  const rawTokens = prepared.match(/[a-z0-9]+|\p{Script=Han}+/gu) ?? [];
  const tokens = [];

  for (const token of rawTokens) {
    if (/^[a-z0-9]+$/.test(token)) {
      if (token.length > 1 && !/^tft\d*$/.test(token)) tokens.push(token);
      continue;
    }
    tokens.push(...hanNgrams(token));
  }

  return tokens;
}

function characterFeatures(value, size) {
  if (!value) return [];
  if (value.length <= size) return [`c${size}:${value}`];
  const features = [];
  for (let index = 0; index <= value.length - size; index += 1) {
    features.push(`c${size}:${value.slice(index, index + size)}`);
  }
  return features;
}

function tokenizeVectorFeatures(value) {
  const normalized = normalizeAlias(value);
  if (!normalized) return [];
  return [
    ...characterFeatures(normalized, 1),
    ...characterFeatures(normalized, 2),
    ...characterFeatures(normalized, 3),
    ...tokenizeKeywords(value).map((term) => `k:${term}`)
  ];
}

function buildBm25Stats(documents) {
  const documentCount = documents.length;
  const documentFrequency = new Map();
  let totalLength = 0;

  for (const document of documents) {
    totalLength += document.keywordTerms.length;
    for (const term of new Set(document.keywordTerms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map();
  for (const [term, frequency] of documentFrequency) {
    idf.set(term, Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5)));
  }

  return {
    documentCount,
    averageLength: documentCount > 0 ? totalLength / documentCount : 0,
    idf
  };
}

function termFrequencies(terms) {
  const frequencies = new Map();
  for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  return frequencies;
}

function sparseVector(terms, idf) {
  const vector = new Map();
  let squaredNorm = 0;
  for (const [term, frequency] of termFrequencies(terms)) {
    const inverseDocumentFrequency = idf.get(term);
    if (!inverseDocumentFrequency) continue;
    const weight = (1 + Math.log(frequency)) * inverseDocumentFrequency;
    vector.set(term, weight);
    squaredNorm += weight * weight;
  }
  return {
    values: vector,
    norm: Math.sqrt(squaredNorm)
  };
}

function buildVectorStats(documents) {
  const documentCount = documents.length;
  const documentFrequency = new Map();
  for (const document of documents) {
    for (const term of new Set(document.vectorTerms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map();
  for (const [term, frequency] of documentFrequency) {
    idf.set(term, Math.log((documentCount + 1) / (frequency + 1)) + 1);
  }
  for (const document of documents) {
    document.vector = sparseVector(document.vectorTerms, idf);
  }
  return {
    documentCount,
    dimensions: idf.size,
    idf
  };
}

export function createEntityCandidateIndex(catalog = createCatalog(), options = {}) {
  const entityTypes = normalizeEntityTypes(options.entityTypes);
  const documents = buildEntityDocuments(catalog, entityTypes);
  const vectorStats = buildVectorStats(documents);

  return {
    catalog,
    entityTypes,
    documents,
    bm25Stats: buildBm25Stats(documents),
    vectorStats
  };
}

export function getOrCreateEntityCandidateIndex(catalog = createCatalog(), options = {}) {
  if (!catalog || typeof catalog !== "object") {
    return createEntityCandidateIndex(catalog, options);
  }

  const entityTypes = normalizeEntityTypes(options.entityTypes);
  const cacheKey = entityTypes.join("|");
  let indexes = ENTITY_INDEX_CACHE.get(catalog);
  if (!indexes) {
    indexes = new Map();
    ENTITY_INDEX_CACHE.set(catalog, indexes);
  }

  if (!indexes.has(cacheKey)) {
    indexes.set(cacheKey, createEntityCandidateIndex(catalog, { entityTypes }));
  }
  return indexes.get(cacheKey);
}

export function clearEntityCandidateIndex(catalog) {
  return catalog && typeof catalog === "object"
    ? ENTITY_INDEX_CACHE.delete(catalog)
    : false;
}

function scoreBm25KeywordAlias(queryTerms, document, stats) {
  if (!queryTerms.length || !document.keywordTerms.length || stats.averageLength <= 0) return null;
  const queryUniqueTerms = [...new Set(queryTerms)];
  const documentUniqueTerms = new Set(document.keywordTerms);
  const matchedTerms = queryUniqueTerms.filter((term) => documentUniqueTerms.has(term));
  if (!matchedTerms.length) return null;

  const documentCoverage = matchedTerms.length / documentUniqueTerms.size;
  if (matchedTerms.length < 2 && documentCoverage < 1) return null;

  const termFrequency = new Map();
  for (const term of document.keywordTerms) {
    termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  }

  const documentLength = document.keywordTerms.length;
  const lengthNorm = BM25_K1 * (1 - BM25_B + BM25_B * (documentLength / stats.averageLength));
  let rawScore = 0;

  for (const term of matchedTerms) {
    const frequency = termFrequency.get(term) ?? 0;
    const idf = stats.idf.get(term) ?? 0;
    rawScore += idf * ((frequency * (BM25_K1 + 1)) / (frequency + lengthNorm));
  }

  if (rawScore <= 0) return null;
  const confidence = Math.min(0.9, 0.58 + (rawScore / (rawScore + 4)) * 0.22 + documentCoverage * 0.1);
  if (confidence < 0.66) return null;

  return {
    confidence,
    matchType: "bm25_keyword",
    inputFragment: matchedTerms.join(" "),
    keywordScore: rawScore
  };
}

function scoreTfidfVector(queryVector, queryTerms, document) {
  if (!queryVector?.norm || !document.vector?.norm) return null;
  let dotProduct = 0;
  let overlap = 0;
  const [smaller, larger] = queryVector.values.size <= document.vector.values.size
    ? [queryVector.values, document.vector.values]
    : [document.vector.values, queryVector.values];
  for (const [term, weight] of smaller) {
    const otherWeight = larger.get(term);
    if (otherWeight === undefined) continue;
    dotProduct += weight * otherWeight;
    overlap += 1;
  }
  if (overlap < 3 || dotProduct <= 0) return null;

  const cosine = dotProduct / (queryVector.norm * document.vector.norm);
  if (cosine < 0.28) return null;
  const documentKeywords = new Set(document.keywordTerms);
  const matchedKeywords = [...new Set(queryTerms)].filter((term) => documentKeywords.has(term));
  const confidence = Math.min(0.88, 0.58 + cosine * 0.28);
  if (confidence < 0.66) return null;
  return {
    confidence,
    matchType: "tfidf_vector",
    inputFragment: matchedKeywords.length ? matchedKeywords.join(" ") : null,
    vectorScore: cosine,
    vectorOverlap: overlap
  };
}

function thresholdForAlias(alias) {
  if (alias.length <= 2) return 1;
  if (alias.length <= 4) return 0.74;
  if (alias.length <= 8) return 0.70;
  return 0.66;
}

function ngrams(value, size = 2) {
  if (value.length <= size) return [value];
  const grams = [];
  for (let index = 0; index <= value.length - size; index += 1) {
    grams.push(value.slice(index, index + size));
  }
  return grams;
}

function diceCoefficient(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftGrams = ngrams(left);
  const rightCounts = new Map();
  for (const gram of ngrams(right)) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const gram of leftGrams) {
    const count = rightCounts.get(gram) ?? 0;
    if (count <= 0) continue;
    overlap += 1;
    rightCounts.set(gram, count - 1);
  }

  return (2 * overlap) / (leftGrams.length + [...rightCounts.values()].reduce((sum, count) => sum + count, 0) + overlap);
}

function damerauLevenshtein(left, right) {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const distances = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) distances[row][0] = row;
  for (let col = 0; col < cols; col += 1) distances[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      let best = Math.min(
        distances[row - 1][col] + 1,
        distances[row][col - 1] + 1,
        distances[row - 1][col - 1] + cost
      );

      if (
        row > 1 &&
        col > 1 &&
        left[row - 1] === right[col - 2] &&
        left[row - 2] === right[col - 1]
      ) {
        best = Math.min(best, distances[row - 2][col - 2] + 1);
      }

      distances[row][col] = best;
    }
  }

  return distances[left.length][right.length];
}

function windowsNearLength(value, targetLength) {
  const windows = new Set();
  const minLength = Math.max(2, targetLength - 2);
  const maxLength = Math.min(value.length, targetLength + 2);

  if (value.length <= maxLength) windows.add(value);
  for (let length = minLength; length <= maxLength; length += 1) {
    for (let start = 0; start <= value.length - length; start += 1) {
      windows.add(value.slice(start, start + length));
    }
  }

  return [...windows];
}

function scoreAlias(normalizedInput, normalizedAlias) {
  if (!normalizedInput || !normalizedAlias) return null;
  if (normalizedInput.includes(normalizedAlias)) {
    return {
      confidence: 1,
      matchType: "substring",
      inputFragment: normalizedAlias
    };
  }

  if (normalizedInput.length >= 3 && normalizedAlias.length > 2 && normalizedAlias.includes(normalizedInput)) {
    const confidence = Math.max(0.72, normalizedInput.length / normalizedAlias.length * 0.9);
    return {
      confidence: Math.min(confidence, 0.95),
      matchType: "partial",
      inputFragment: normalizedInput
    };
  }

  const threshold = thresholdForAlias(normalizedAlias);
  if (threshold >= 1) return null;

  let best = 0;
  let bestWindow = null;
  for (const window of windowsNearLength(normalizedInput, normalizedAlias.length)) {
    const editDistance = damerauLevenshtein(normalizedAlias, window);
    const editScore = 1 - (editDistance / Math.max(normalizedAlias.length, window.length));
    const overlapScore = diceCoefficient(normalizedAlias, window) * 0.95;
    const windowScore = Math.max(editScore, overlapScore);
    const bestLengthGap = bestWindow == null ? Infinity : Math.abs(bestWindow.length - normalizedAlias.length);
    const windowLengthGap = Math.abs(window.length - normalizedAlias.length);
    if (
      windowScore > best ||
      (windowScore === best && windowLengthGap < bestLengthGap) ||
      (windowScore === best && windowLengthGap === bestLengthGap && window.length > (bestWindow?.length ?? 0))
    ) {
      best = windowScore;
      bestWindow = window;
    }
  }

  if (best < threshold) return null;
  return {
    confidence: Math.min(best, 0.94),
    matchType: "fuzzy",
    inputFragment: bestWindow
  };
}

function roundConfidence(value) {
  return Math.round(value * 1000) / 1000;
}

export function retrieveEntityCandidates(input, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const inputText = String(input ?? "").slice(0, options.maxInputLength ?? 160);
  const normalizedInput = normalizeAlias(inputText);
  if (!normalizedInput) return [];

  const index = options.index ?? getOrCreateEntityCandidateIndex(catalog, {
    entityTypes: options.entityTypes
  });
  const documents = index.documents;
  const queryTerms = tokenizeKeywords(inputText);
  const bm25Stats = index.bm25Stats;
  const queryVector = sparseVector(tokenizeVectorFeatures(inputText), index.vectorStats.idf);
  const byEntity = new Map();

  for (const document of documents) {
    const score = scoreAlias(normalizedInput, document.normalizedAlias)
      ?? scoreBm25KeywordAlias(queryTerms, document, bm25Stats)
      ?? scoreTfidfVector(queryVector, queryTerms, document);
    if (!score) continue;

    const key = `${document.entityType}:${document.apiName}`;
    const existing = byEntity.get(key);
    if (existing && existing.confidence >= score.confidence) continue;

    byEntity.set(key, {
      entityType: document.entityType,
      apiName: document.apiName,
      label: document.label ?? document.apiName,
      matchedAlias: document.alias,
      inputFragment: score.inputFragment ?? null,
      confidence: roundConfidence(score.confidence),
      matchType: score.matchType,
      ...(score.vectorScore !== undefined ? {
        vectorScore: roundConfidence(score.vectorScore),
        vectorOverlap: score.vectorOverlap
      } : {}),
      source: "local_entity_candidate_retriever"
    });
  }

  return [...byEntity.values()]
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return left.label.localeCompare(right.label);
    })
    .slice(0, options.limit ?? DEFAULT_LIMIT);
}
