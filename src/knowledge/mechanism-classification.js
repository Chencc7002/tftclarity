import { createHash } from "node:crypto";

export const MECHANISM_CLASSIFICATION_SCHEMA_VERSION = "mechanism-classification.v1";

function cleanText(value, maxLength = 1600) {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function rows(value) {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

export function parseMechanismClassificationQuery(input) {
  const text = String(input ?? "").trim();
  const compact = text.replace(/\s+/gu, "");
  const lower = compact.toLowerCase();
  const hasDevelopment = /发育/u.test(compact) || /develop(?:ment|able|ing)?/u.test(lower);
  const hasGrowth = /成长/u.test(compact) || /grow(?:th|ing)?/u.test(lower);
  if (!hasDevelopment && !hasGrowth) return null;

  const asksForSet = /(?:哪些|什么|有谁|列出|盘点|汇总|总结|可发育|能发育|可成长|能成长)/u.test(compact)
    || /(?:which|what|list|all|any)/u.test(lower);
  if (!asksForSet) return null;

  const hasUnit = /(?:棋子|弈子|英雄|champion|unit)/u.test(lower);
  const hasTrait = /(?:羁绊|trait)/u.test(lower);
  const entityTypes = hasUnit && !hasTrait
    ? ["unit"]
    : hasTrait && !hasUnit
      ? ["trait"]
      : ["unit", "trait"];
  const metric = hasGrowth && hasDevelopment
    ? "both"
    : hasGrowth ? "growth" : "development";
  return {
    schemaVersion: "mechanism-classification-query.v1",
    metric,
    entityTypes
  };
}

export function buildMechanismClassificationEvidence(entityDetails = {}) {
  entityDetails ??= {};
  const units = rows(entityDetails.units).map((unit) => ({
    entityType: "unit",
    apiName: String(unit?.apiName ?? unit?.characterName ?? "").trim(),
    name: cleanText(unit?.name, 120),
    cost: Number.isFinite(Number(unit?.cost)) ? Number(unit.cost) : null,
    traits: (unit?.traitNames ?? unit?.traits ?? []).map((value) => cleanText(value, 80)).filter(Boolean),
    abilityName: cleanText(unit?.ability?.name, 160),
    description: cleanText(
      unit?.ability?.description ?? unit?.ability?.desc ?? unit?.description,
      1800
    )
  }));
  const traits = rows(entityDetails.traits).map((trait) => ({
    entityType: "trait",
    apiName: String(trait?.apiName ?? trait?.key ?? "").trim(),
    name: cleanText(trait?.name, 120),
    description: cleanText(trait?.description ?? trait?.desc, 2200),
    levels: rows(trait?.levels).map((level) => ({
      units: Number.isFinite(Number(level?.units)) ? Number(level.units) : null,
      effect: cleanText(level?.effect ?? level?.description, 1000)
    })).filter((level) => level.units !== null || level.effect)
  }));
  return [...units, ...traits].filter((entity) => entity.apiName && entity.name);
}

function booleanValue(value) {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function confidenceValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function stringList(value, maxItems = 6) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, maxItems);
}

function normalizedScope(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["cross_round", "cross-round", "permanent", "跨回合"].includes(text)) return "cross_round";
  if (["in_combat", "in-combat", "combat", "战斗内", "单场战斗"].includes(text)) return "in_combat";
  if (["none", "无"].includes(text)) return "none";
  return "uncertain";
}

function normalizedPersistence(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["permanent", "cross_round", "永久", "跨回合"].includes(text)) return "permanent";
  if (["resets_after_combat", "reset", "战斗后重置"].includes(text)) return "resets_after_combat";
  if (["one_time", "one-time", "一次性"].includes(text)) return "one_time";
  if (["none", "无"].includes(text)) return "none";
  return "uncertain";
}

export function normalizeMechanismClassifications(value, evidence = []) {
  const rawEntries = Array.isArray(value) ? value : value?.entries ?? value?.classifications ?? [];
  const byApiName = new Map(evidence.map((entity) => [
    `${entity.entityType}:${String(entity.apiName).toLowerCase()}`,
    entity
  ]));
  const byName = new Map(evidence.map((entity) => [
    `${entity.entityType}:${String(entity.name).toLowerCase()}`,
    entity
  ]));
  const normalized = [];
  const seen = new Set();
  for (const raw of rawEntries) {
    const entityType = raw?.entityType === "trait" ? "trait" : raw?.entityType === "unit" ? "unit" : null;
    if (!entityType) continue;
    const apiKey = `${entityType}:${String(raw?.apiName ?? "").trim().toLowerCase()}`;
    const nameKey = `${entityType}:${String(raw?.name ?? "").trim().toLowerCase()}`;
    const source = byApiName.get(apiKey) ?? byName.get(nameKey);
    if (!source) continue;
    const identity = `${entityType}:${source.apiName}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const growthScope = normalizedScope(raw?.growthScope);
    const persistence = normalizedPersistence(raw?.persistence);
    const requestedGrowth = booleanValue(raw?.isGrowth);
    const definitionMatchedGrowth = requestedGrowth
      && growthScope === "cross_round"
      && persistence === "permanent";
    const invalidGrowthClaim = requestedGrowth && !definitionMatchedGrowth;
    const needsReview = booleanValue(raw?.needsReview) || invalidGrowthClaim;
    const isDevelopment = booleanValue(raw?.isDevelopment);
    if (!requestedGrowth && !isDevelopment && !needsReview) continue;
    normalized.push({
      entityType,
      apiName: source.apiName,
      name: source.name,
      isGrowth: requestedGrowth,
      isDevelopment,
      definitionMatchedGrowth,
      growthScope,
      persistence,
      trigger: cleanText(raw?.trigger, 300),
      progression: cleanText(raw?.progression, 400),
      effects: stringList(raw?.effects),
      summary: cleanText(raw?.summary, 500),
      evidence: stringList(raw?.evidence, 4),
      confidence: confidenceValue(raw?.confidence),
      needsReview,
      reviewReason: cleanText(
        invalidGrowthClaim
          ? "模型声称是成长，但未同时确认跨回合与永久保留"
          : raw?.reviewReason,
        300
      ) || null
    });
  }
  return normalized;
}

function evidenceFingerprint(evidence) {
  return createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex")
    .slice(0, 20);
}

function matchesQuery(entry, query) {
  if (!query.entityTypes.includes(entry.entityType)) return false;
  if (query.metric === "growth") return entry.isGrowth || entry.needsReview;
  if (query.metric === "development") return entry.isDevelopment;
  return entry.isGrowth || entry.isDevelopment || entry.needsReview;
}

function answerText(entries, query) {
  const typeText = query.entityTypes.length === 2
    ? "棋子和羁绊"
    : query.entityTypes[0] === "unit" ? "棋子" : "羁绊";
  const metricText = query.metric === "growth"
    ? "成长型"
    : query.metric === "development" ? "可发育" : "成长或可发育";
  if (!entries.length) return `当前资料中没有识别出${metricText}${typeText}。`;
  const reviewCount = entries.filter((entry) => entry.needsReview).length;
  return `当前赛季识别出 ${entries.length} 个${metricText}${typeText}${reviewCount ? `，其中 ${reviewCount} 个因跨回合信息不足需要复核` : ""}。`;
}

export async function answerMechanismClassificationQuery(options = {}) {
  const query = options.query ?? parseMechanismClassificationQuery(options.input);
  if (!query) return null;
  if (typeof options.provider !== "function") {
    throw Object.assign(new Error("成长/发育分类器未配置可用的 LLM"), {
      code: "mechanism_classifier_unavailable",
      statusCode: 503
    });
  }
  const allEvidence = buildMechanismClassificationEvidence(options.entityDetails);
  const evidenceGroups = query.entityTypes.map((entityType) => ({
    entityType,
    evidence: allEvidence.filter((entity) => entity.entityType === entityType)
  })).filter((group) => group.evidence.length);
  if (!evidenceGroups.length) {
    throw Object.assign(new Error("当前赛季没有可供分类的棋子或羁绊详情"), {
      code: "mechanism_entity_details_unavailable",
      statusCode: 503
    });
  }
  const seasonId = String(options.seasonContext?.id ?? "current");
  const cache = options.cache ?? new Map();
  const loadPromises = options.loadPromises ?? new Map();
  const loadGroup = async (group) => {
    const fingerprint = evidenceFingerprint(group.evidence);
    const cacheKey = `${seasonId}:${options.provider.promptVersion ?? "unknown-prompt"}:${group.entityType}:${fingerprint}`;
    if (options.refresh) cache.delete(cacheKey);
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, entityType: group.entityType, fingerprint, cacheStatus: "hit" };
    let cacheStatus = "miss";
    let loadPromise = loadPromises.get(cacheKey);
    if (!loadPromise) {
      loadPromise = (async () => {
        const providerResult = await options.provider({
          evidence: group.evidence,
          seasonContext: options.seasonContext
        });
        const loaded = {
          entries: normalizeMechanismClassifications(
            providerResult?.value ?? providerResult,
            group.evidence
          ),
          modelOutput: providerResult?.value ?? providerResult,
          usage: providerResult?.usage ?? null,
          providerRequestId: providerResult?.providerRequestId ?? null,
          createdAt: new Date().toISOString(),
          entityCount: group.evidence.length
        };
        cache.set(cacheKey, loaded);
        return loaded;
      })();
      loadPromises.set(cacheKey, loadPromise);
    } else {
      cacheStatus = "shared";
    }
    try {
      return {
        ...await loadPromise,
        entityType: group.entityType,
        fingerprint,
        cacheStatus
      };
    } finally {
      if (loadPromises.get(cacheKey) === loadPromise) loadPromises.delete(cacheKey);
    }
  };
  const classifications = await Promise.all(evidenceGroups.map(loadGroup));
  const classifiedEntries = classifications.flatMap((classification) => classification.entries);
  const entries = classifiedEntries
    .filter((entry) => matchesQuery(entry, query))
    .sort((left, right) => (
      left.entityType.localeCompare(right.entityType)
      || Number(right.isGrowth) - Number(left.isGrowth)
      || right.confidence - left.confidence
      || left.name.localeCompare(right.name, "zh-CN")
    ));
  const text = answerText(entries, query);
  const cacheStatuses = [...new Set(classifications.map((group) => group.cacheStatus))];
  const cacheStatus = cacheStatuses.length === 1 ? cacheStatuses[0] : "mixed";
  const modelOutput = {
    schemaVersion: "mechanism-classification-model-output.v1",
    groups: Object.fromEntries(classifications.map((group) => [group.entityType, group.modelOutput]))
  };
  return {
    ok: true,
    type: "mechanism_classification",
    schemaVersion: MECHANISM_CLASSIFICATION_SCHEMA_VERSION,
    query,
    entries,
    modelOutput,
    text,
    answer: {
      summary: text,
      methodology: "按定义文档对当前赛季棋子与羁绊原文进行 LLM 分类；原始模型判断保持不变，本地规则另行提示成长是否满足跨回合与永久保留。"
    },
    source: options.entityDetails?.meta ?? null,
    classificationMeta: {
      seasonContextId: seasonId,
      entityCount: classifications.reduce((sum, group) => sum + group.entityCount, 0),
      classifiedCount: classifiedEntries.length,
      cache: cacheStatus,
      fingerprint: classifications.map((group) => `${group.entityType}:${group.fingerprint}`).join("|"),
      model: options.provider.model ?? null,
      promptVersion: options.provider.promptVersion ?? null,
      createdAt: classifications.map((group) => group.createdAt).sort().at(-1),
      usage: Object.fromEntries(classifications.map((group) => [group.entityType, group.usage])),
      providerRequestId: Object.fromEntries(
        classifications.map((group) => [group.entityType, group.providerRequestId])
      )
    }
  };
}
