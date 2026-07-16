export const CONCLUSION_SCHEMA_VERSION = "llm_conclusion.v1";

const ROOT_KEYS = new Set([
  "schemaVersion", "status", "headline", "summary", "reasons", "alternatives", "nextAction", "riskNotice"
]);
const ENTRY_KEYS = new Set(["evidenceIds", "text"]);
const ABSOLUTE_OR_CAUSAL = /(?:(?<!不)(?<!未)必定|(?<!不)(?<!未)必然|(?<!不)(?<!不能)(?<!无法)(?<!难以)(?<!不可)保证|(?<!非)(?<!不是)(?<!并非)(?<!不能视为)必备|(?<!非)(?<!不是)(?<!并非)必出|必须出|稳操胜券|唯一(?:最强|核心)|绝对最强|百分之百|100%胜率|导致(?:胜率|前四率|登顶率).{0,8}(?:提高|提升|增加)|使(?:胜率|前四率|登顶率).{0,8}(?:提高|提升|增加))/u;
const WINNER_CLAIM = /(?:更优|胜出|优于|领先|最佳|首选|更好|最强)/u;
const LOW_SAMPLE_CLAIM = /(?:低样本|样本(?:量)?不足|不能视为稳定推荐|不稳定推荐)/u;
const CORE_CLAIM = /核心(?:装备|装|选择|趋势|倾向|单件)/u;
const API_NAME = /\bTFT\w*_[A-Za-z0-9_]+\b/gu;
const QUOTED_ENTITY = /[“"]([^”"\n]{1,24}(?:刀|弓|剑|甲|杖|冠|拳|刃|矛|锤|盾|盔|铠|爪|枪|炮|帽|纹章|徽章))[”"]/gu;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value ?? {})) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function naturalizeTechnicalTerms(value) {
  return String(value)
    .replace(/\bgames\s*=\s*(\d+)\b/giu, "$1场")
    .replace(/\btop4Rate\s*=\s*(\d+(?:\.\d+)?)\s*%/giu, "前四率$1%")
    .replace(/\bwinRate\s*=\s*(\d+(?:\.\d+)?)\s*%/giu, "登顶率$1%")
    .replace(/\bavgPlacement\s*=\s*(\d+(?:\.\d+)?)/giu, "平均名次$1")
    .replace(/\bcoverage\s*=\s*(\d+(?:\.\d+)?)\s*%/giu, "覆盖率$1%")
    .replace(/\b(?:build|item(?:-signal)?):\d+\b/giu, "")
    .replace(/\bavgPlacementChange\s*[:=]?\s*(-?\d+(?:\.\d+)?)/giu, "近3天平均名次变化 $1")
    .replace(/[（(]\s*(?:分别)?\s*(?:见|引用|来自)?\s*(?:与|和|及|、|,|，|\s)*[)）]/gu, "")
    .replace(/([,，、；;:：])\s*([)）])/gu, "$2")
    .replace(/\s*[（(]\s*core\s*=\s*(?:true|false)\s*[)）]/giu, "")
    .replace(/(?:为\s*)?core\s*=\s*true\b/giu, "属于核心信号")
    .replace(/(?:为\s*)?core\s*=\s*false\b/giu, "属于非核心信号")
    .replace(/\brecommendationCount\b/gu, "推荐方案数")
    .replace(/\bappearanceRate\b/gu, "出现比例")
    .replace(/\bstable\s*(?:=|为)\s*(?:true|真)(?=$|[\s,，。；;）)])/giu, "被标记为稳定")
    .replace(/\bstable\s*(?:=|为)\s*(?:false|假)(?=$|[\s,，。；;）)])/giu, "被标记为不稳定")
    .replace(/\blowSample\s*(?:=|为)\s*(?:true|真)(?=$|[\s,，。；;）)])/giu, "被标记为低样本")
    .replace(/\blowSample\s*(?:=|为)\s*(?:false|假)(?=$|[\s,，。；;）)])/giu, "未标记为低样本")
    .replace(/标记为\s*unstable\b/giu, "标记为不稳定")
    .replace(/标记为\s*stable\b/giu, "标记为稳定")
    .replace(/\blowSample\b/gu, "低样本")
    .replace(/\bunstable\b/gu, "不稳定")
    .replace(/\bstable\b/gu, "稳定")
    .replace(/被标(?:记)?为\s+(稳定|不稳定|低样本)/gu, "被标记为$1");
}

function naturalizeEvidenceReferences(value, records) {
  let text = String(value ?? "");
  for (const [evidenceId, record] of records ?? []) {
    if (!record?.name || !String(evidenceId).startsWith("comp:")) continue;
    text = text.replace(new RegExp(`(?<![A-Za-z0-9_-])${escapedPattern(evidenceId)}(?![A-Za-z0-9_-])`, "gu"), record.name);
  }
  return text;
}

function readText(value, path, limit, errors, { nullable = false, records = null } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") {
    errors.push(`${path} must be a string${nullable ? " or null" : ""}`);
    return "";
  }
  const text = naturalizeEvidenceReferences(naturalizeTechnicalTerms(value), records).trim();
  if (!text) errors.push(`${path} must not be empty`);
  if (text.length > limit) errors.push(`${path} exceeds ${limit} characters`);
  return text;
}

function evidenceRecords(evidence) {
  const records = new Map();
  for (const record of evidence?.recommendations ?? []) {
    if (record?.evidenceId) records.set(record.evidenceId, record);
  }
  for (const record of evidence?.itemSignals ?? []) {
    if (record?.evidenceId) records.set(record.evidenceId, record);
  }
  for (const record of evidence?.comparison?.options ?? []) {
    if (record?.evidenceId) records.set(record.evidenceId, record);
  }
  return records;
}

function allStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => allStrings(entry, output));
  else if (isObject(value)) Object.values(value).forEach((entry) => allStrings(entry, output));
  return output;
}

function recordNames(record) {
  const names = [];
  const collect = (value) => {
    if (!value) return;
    if (typeof value.apiName === "string") names.push(value.apiName);
    if (typeof value.name === "string") names.push(value.name);
  };
  collect(record?.item);
  for (const item of record?.items ?? []) collect(item);
  for (const item of record?.representativeItems ?? []) collect(item);
  for (const pairing of record?.commonPairings ?? []) {
    for (const item of pairing?.items ?? []) collect(item);
  }
  if (record?.compId) names.push(record.compId);
  if (record?.name) names.push(record.name);
  for (const unit of record?.units ?? []) {
    collect(unit);
    for (const item of unit?.items ?? []) collect(item);
  }
  for (const trait of record?.traits ?? []) collect(trait);
  return names.filter(Boolean);
}

function allowedNames(evidence, records = null) {
  const values = new Set();
  const add = (value) => {
    if (value?.apiName) values.add(String(value.apiName));
    if (value?.name) values.add(String(value.name));
  };
  add(evidence?.query?.unit);
  for (const key of ["lockedItems", "excludedItems", "comparisonItems", "traits"]) {
    for (const value of evidence?.query?.[key] ?? []) add(value);
  }
  for (const record of records ?? evidenceRecords(evidence).values()) {
    for (const name of recordNames(record)) values.add(name);
  }
  return values;
}

function catalogNames(catalog) {
  const names = new Set();
  for (const collection of [catalog?.items, catalog?.units, catalog?.traits]) {
    for (const entity of collection ?? []) {
      for (const key of ["apiName", "filterId", "preferredDisplayName", "zhName", "shortName"]) {
        if (entity?.[key]) names.add(String(entity[key]));
      }
    }
  }
  return names;
}

function statsFor(records) {
  return [...records].map((record) => record?.stats).filter(Boolean);
}

function validateNumbers(text, records, path, errors) {
  const stats = statsFor(records);
  const rates = stats.flatMap((entry) => [entry.top4Rate, entry.winRate, entry.pickRate])
    .concat([...records].flatMap((record) => [record?.appearanceRate, record?.coverage]))
    .filter(Number.isFinite)
    .map((value) => Number((value * 100).toFixed(1)));
  const games = stats.map((entry) => Number(entry.games))
    .concat([...records].flatMap((record) => [
      ...(record?.commonPairings ?? []).map((pairing) => Number(pairing?.games)),
      ...(record?.copyCounts ?? []).map((copy) => Number(copy?.games))
    ]))
    .filter(Number.isFinite);
  const placements = stats.map((entry) => Number(entry.avgPlacement)).filter(Number.isFinite);

  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*%/gu)) {
    const value = Number(match[1]);
    const approximateInteger = !match[1].includes(".")
      && /(?:约|大约|接近|近)\s*$/u.test(text.slice(Math.max(0, match.index - 4), match.index));
    const supported = rates.some((allowed) => approximateInteger
      ? Math.round(allowed) === value
      : Math.abs(allowed - value) <= 0.051);
    if (!supported) {
      errors.push(`${path} contains unsupported percentage: ${match[0]}`);
    }
  }
  for (const match of text.matchAll(/(\d+)\s*(?:场|局|个?样本)/gu)) {
    const value = Number(match[1]);
    if (!games.includes(value)) errors.push(`${path} contains unsupported sample count: ${match[0]}`);
  }
  for (const match of text.matchAll(/(?:均名|平均名次)\s*(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)/gu)) {
    const value = Number(match[1]);
    if (!placements.some((allowed) => Math.abs(Number(allowed.toFixed(2)) - value) <= 0.005)) {
      errors.push(`${path} contains unsupported average placement: ${match[0]}`);
    }
  }
}

function validateNames(text, names, knownCatalogNames, path, errors) {
  for (const match of text.matchAll(API_NAME)) {
    if (!names.has(match[0])) errors.push(`${path} contains an API name absent from evidence: ${match[0]}`);
  }
  for (const name of knownCatalogNames) {
    if (name.length >= 2 && text.includes(name) && !names.has(name)) {
      errors.push(`${path} contains a catalog entity absent from evidence: ${name}`);
    }
  }
  for (const match of text.matchAll(QUOTED_ENTITY)) {
    if (!names.has(match[1])) errors.push(`${path} contains a quoted entity absent from evidence: ${match[1]}`);
  }
}

function primaryRecordNames(record) {
  return [
    record?.item?.apiName,
    record?.item?.name,
    record?.compId,
    record?.name
  ].filter(Boolean).map(String);
}

function inferEvidenceIds(entry, records) {
  const ids = Array.isArray(entry?.evidenceIds)
    ? [...new Set(entry.evidenceIds.map(String))]
    : [];
  const text = String(entry?.text ?? "");
  for (const [id, record] of records) {
    const explicitlyReferenced = new RegExp(`(?<![A-Za-z0-9_-])${escapedPattern(id)}(?![A-Za-z0-9_-])`, "u").test(text);
    const candidateNamed = record?.kind !== "item_core_signal" && primaryRecordNames(record)
      .some((name) => name.length >= 2 && text.includes(name));
    if ((explicitlyReferenced || candidateNamed) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function describesItemAsCore(text, item) {
  return [item?.apiName, item?.name].filter(Boolean).some((name) => {
    const escaped = escapedPattern(name);
    return new RegExp(`(?:${escaped}(?:是|为|可视为|作为).{0,20}核心(?:装备|装|选择|趋势|倾向|单件)|核心(?:装备|装|选择|趋势|倾向|单件)(?:是|为|包括|包含|[:：])?\\s*${escaped})`, "u").test(text);
  });
}

function validateCoreClaim(text, records, evidence, path, errors) {
  if (!CORE_CLAIM.test(text)) return;
  const allSignals = evidence?.itemSignals ?? [];
  const scopedSignals = [...records].filter((record) => record?.kind === "item_core_signal");
  const entryScoped = /^(?:reasons|alternatives)\[/u.test(path);
  const allowedSignals = entryScoped ? scopedSignals : allSignals;
  if (!allowedSignals.some((signal) => signal.core === true)) {
    errors.push(`${path} contains a core-item claim without a linked core signal`);
  }
  for (const signal of allSignals) {
    if (signal.core !== true && describesItemAsCore(text, signal.item)) {
      errors.push(`${path} describes a non-core item as core: ${signal.item?.name ?? signal.item?.apiName}`);
    }
  }
}

function validateTextFacts(text, records, evidence, catalog, path, errors) {
  if (ABSOLUTE_OR_CAUSAL.test(text)) errors.push(`${path} contains an absolute or causal claim`);
  validateCoreClaim(text, records, evidence, path, errors);
  const names = allowedNames(evidence, records);
  validateNames(text, names, catalogNames(catalog), path, errors);
  validateNumbers(text, records, path, errors);
}

function readEntries(value, path, maxEntries, records, evidence, catalog, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  if (value.length > maxEntries) errors.push(`${path} contains more than ${maxEntries} entries`);
  return value.slice(0, maxEntries).map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${entryPath} must be an object`);
      return null;
    }
    unknownKeys(entry, ENTRY_KEYS, entryPath, errors);
    const inferredIds = inferEvidenceIds(entry, records);
    if (!Array.isArray(entry.evidenceIds) || inferredIds.length === 0 || inferredIds.length > 3) {
      errors.push(`${entryPath}.evidenceIds must contain 1 to 3 entries`);
    }
    const ids = inferredIds.slice(0, 3);
    const linkedRecords = [];
    for (const id of ids) {
      if (!records.has(id)) errors.push(`${entryPath}.evidenceIds contains unknown evidence: ${id}`);
      else linkedRecords.push(records.get(id));
    }
    const text = readText(entry.text, `${entryPath}.text`, 220, errors, { records });
    validateTextFacts(text, linkedRecords, evidence, catalog, `${entryPath}.text`, errors);
    return { evidenceIds: ids, text };
  }).filter(Boolean);
}

export function validateConclusionOutput(rawValue, evidence, options = {}) {
  const errors = [];
  if (!isObject(rawValue)) return { valid: false, errors: ["conclusion output must be an object"], value: null };
  unknownKeys(rawValue, ROOT_KEYS, "output", errors);
  if (rawValue.schemaVersion !== CONCLUSION_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CONCLUSION_SCHEMA_VERSION}`);
  if (rawValue.status !== "ok" && rawValue.status !== "insufficient_evidence") {
    errors.push("status must be ok or insufficient_evidence");
  }

  const records = evidenceRecords(evidence);
  const headline = readText(rawValue.headline, "headline", 80, errors, { records });
  const summary = readText(rawValue.summary, "summary", 300, errors, { records });
  const reasons = readEntries(rawValue.reasons, "reasons", 4, records, evidence, options.catalog, errors);
  const alternatives = readEntries(rawValue.alternatives, "alternatives", 3, records, evidence, options.catalog, errors);
  const nextAction = readText(rawValue.nextAction, "nextAction", 200, errors, { records });
  const riskNotice = readText(rawValue.riskNotice, "riskNotice", 180, errors, { nullable: true, records });

  const globalRecords = [...records.values()];
  for (const [path, text] of [["headline", headline], ["summary", summary], ["nextAction", nextAction], ["riskNotice", riskNotice ?? ""]]) {
    validateTextFacts(text, globalRecords, evidence, options.catalog, path, errors);
  }
  const combined = [headline, summary, nextAction, riskNotice, ...reasons.map((entry) => entry.text), ...alternatives.map((entry) => entry.text)].filter(Boolean).join("\n");
  if (evidence?.generationRules?.mustAnalyzeAllDisplayedItemRankings) {
    const referencedIds = new Set([...reasons, ...alternatives].flatMap((entry) => entry.evidenceIds));
    const missing = (evidence?.recommendations ?? []).filter((record) => {
      if (referencedIds.has(record.evidenceId)) return false;
      return ![record?.item?.name, record?.item?.apiName]
        .filter(Boolean)
        .some((name) => combined.includes(name));
    });
    if (missing.length > 0) {
      errors.push(`item-ranking conclusion omits displayed evidence: ${missing.map((record) => record.evidenceId).join(", ")}`);
    }
  }
  if (evidence?.generationRules?.mustAnalyzeDisplayedCompRankings) {
    const referencedIds = new Set([...reasons, ...alternatives].flatMap((entry) => entry.evidenceIds));
    const requiredIds = evidence?.compRankingContext?.directAnalysisEvidenceIds ?? [];
    const missing = requiredIds.filter((evidenceId) => !referencedIds.has(evidenceId));
    if (missing.length > 0) {
      errors.push(`comp-ranking conclusion omits displayed evidence: ${missing.join(",")}`);
    }
  }
  if (evidence?.generationRules?.mustMentionLowSample && !/(?:低样本|样本不足|仅供参考|不稳定)/u.test(combined)) {
    errors.push("low-sample evidence requires a risk notice");
  }
  if (!evidence?.generationRules?.mustMentionLowSample && LOW_SAMPLE_CLAIM.test(combined)) {
    errors.push("stable evidence cannot be described as low-sample");
  }
  if (evidence?.generationRules?.mustMentionStaleData && !/(?:过期|时效|非最新|旧缓存)/u.test(combined)) {
    errors.push("stale evidence requires a freshness risk notice");
  }
  if (evidence?.generationRules?.mustAvoidWinnerClaim && WINNER_CLAIM.test(combined)) {
    errors.push("unresolved comparison cannot claim a winner");
  }

  const value = {
    schemaVersion: CONCLUSION_SCHEMA_VERSION,
    status: rawValue.status,
    headline,
    summary,
    reasons,
    alternatives,
    nextAction,
    riskNotice
  };
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}
