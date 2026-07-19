export const CONCLUSION_SCHEMA_VERSION = "llm_conclusion.v1";
export const CONCLUSION_VALIDATION_FEEDBACK_SCHEMA_VERSION = "conclusion_validation_feedback.v1";

export const CONCLUSION_ERROR_CATEGORIES = Object.freeze([
  "format_error",
  "unsupported_number",
  "unsupported_entity",
  "missing_coverage",
  "missing_risk_notice",
  "analysis_boundary",
  "stale_or_missing_evidence",
  "intent_or_entity_error",
  "provider_unavailable"
]);

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
const GENERIC_CATALOG_ALIASES = new Set([
  "攻速", "攻击速度", "攻击力", "法强", "法术强度", "护甲", "魔抗", "魔法抗性",
  "生命", "生命值", "法力", "法力值", "回血", "吸血", "暴击", "暴击率", "射程", "移速"
]);

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
  for (const record of evidence?.structuredEvidence ?? []) {
    if (record?.evidenceId) records.set(record.evidenceId, record);
  }
  for (const record of evidence?.recommendations ?? []) {
    if (record?.evidenceId) records.set(record.evidenceId, record);
  }
  for (const record of evidence?.itemSignals ?? []) {
    if (record?.evidenceId) records.set(record.evidenceId, record);
  }
  for (const record of evidence?.comparison?.options ?? []) {
    if (record?.evidenceId) records.set(record.evidenceId, record);
  }
  for (const record of evidence?.semanticEvidence ?? []) {
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
  collect(record);
  collect(record?.metadata);
  if (record?.metadata?.canonicalName) names.push(record.metadata.canonicalName);
  for (const alias of record?.metadata?.aliases ?? []) names.push(alias);
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

function naturalEntityVariants(value) {
  const name = String(value ?? "").trim();
  if (!name) return [];
  const values = new Set([name]);
  const emblemBase = name.replace(/(?:纹章|徽章|转职|转)$/u, "").trim();
  if (emblemBase && emblemBase !== name) {
    values.add(emblemBase);
    values.add(`${emblemBase}纹章`);
    values.add(`${emblemBase}转`);
    values.add(`${emblemBase}转职`);
  }
  return [...values];
}

function catalogEntityNames(entity) {
  return [
    entity?.apiName,
    entity?.filterId,
    entity?.preferredDisplayName,
    entity?.zhName,
    entity?.displayName,
    entity?.shortName,
    ...(entity?.aliases ?? [])
  ].filter(Boolean).flatMap(naturalEntityVariants);
}

function allowedNames(evidence, records = null, catalog = null) {
  const values = new Set();
  const add = (value) => {
    if (value?.apiName) naturalEntityVariants(value.apiName).forEach((name) => values.add(name));
    if (value?.name) naturalEntityVariants(value.name).forEach((name) => values.add(name));
  };
  add(evidence?.query?.unit);
  for (const key of ["lockedItems", "excludedItems", "comparisonItems", "traits"]) {
    for (const value of evidence?.query?.[key] ?? []) add(value);
  }
  for (const record of records ?? evidenceRecords(evidence).values()) {
    for (const name of recordNames(record)) values.add(name);
  }
  for (const name of [...values]) naturalEntityVariants(name).forEach((variant) => values.add(variant));
  for (const collection of [catalog?.items, catalog?.units, catalog?.traits]) {
    for (const entity of collection ?? []) {
      const names = catalogEntityNames(entity);
      if (names.some((name) => values.has(name))) names.forEach((name) => values.add(name));
    }
  }
  return values;
}

function catalogNames(catalog) {
  const names = new Set();
  for (const collection of [catalog?.items, catalog?.units, catalog?.traits]) {
    for (const entity of collection ?? []) {
      catalogEntityNames(entity)
        .filter((name) => !GENERIC_CATALOG_ALIASES.has(name))
        .forEach((name) => names.add(name));
    }
  }
  return names;
}

function statsFor(records) {
  return [...records].map((record) => record?.stats).filter(Boolean);
}

function collectNumericValues(value, output = new Set(), seen = new Set()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    output.add(value);
    return output;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNumericValues(entry, output, seen));
  } else {
    Object.values(value).forEach((entry) => collectNumericValues(entry, output, seen));
  }
  return output;
}

function textNumericValues(value, output = new Set()) {
  for (const match of String(value ?? "").matchAll(/(?<![A-Za-z0-9_])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9_])/gu)) {
    output.add(Number(match[1]));
  }
  return output;
}

function collectEntityCopyCounts(record, output) {
  const collections = [
    record?.items,
    record?.representativeItems,
    ...(record?.units ?? []).map((unit) => unit?.items),
    ...(record?.commonPairings ?? []).map((pairing) => pairing?.items)
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    const counts = new Map();
    for (const entity of collection) {
      const key = typeof entity === "string"
        ? entity
        : entity?.apiName ?? entity?.name ?? null;
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      if (count > 1) output.add(count);
    }
  }
  return output;
}

function allowedNumericValues(records, evidence) {
  const values = new Set();
  for (const record of records) {
    collectNumericValues(record, values);
    collectEntityCopyCounts(record, values);
    if (record?.authority === "official_static_catalog" || /description/u.test(String(record?.type ?? ""))) {
      textNumericValues(record?.text, values);
    }
  }
  collectNumericValues(evidence?.query, values);
  const days = Number(evidence?.query?.days);
  if (Number.isFinite(days) && days > 0) values.add(days * 24);
  return values;
}

function matchesAllowedNumber(value, allowed) {
  for (const candidate of allowed) {
    const representations = [
      candidate,
      ...[0, 1, 2, 3, 4].map((digits) => Number(candidate.toFixed(digits)))
    ];
    if (candidate >= 0 && candidate <= 1) {
      const percentage = candidate * 100;
      representations.push(percentage, ...[0, 1, 2].map((digits) => Number(percentage.toFixed(digits))));
    }
    if (representations.some((entry) => Math.abs(entry - value) <= 0.00005)) return true;
  }
  return false;
}

function sampleCountMentions(text) {
  const mentions = [];
  let remaining = String(text ?? "");
  remaining = remaining.replace(/(\d+)\s*(?:场|局)(?:样本)?/gu, (full, value) => {
    mentions.push({ text: full, value: Number(value) });
    return " ";
  });
  remaining = remaining.replace(/样本(?:数|量)?\s*(?:为|是|有|[:：=])?\s*(\d+)(?!\d)/gu, (full, value) => {
    mentions.push({ text: full, value: Number(value) });
    return " ";
  });
  return { mentions, remaining };
}

function stripSupportedDateLiterals(text, evidence) {
  let output = String(text ?? "");
  const updatedAt = String(evidence?.dataStatus?.updatedAt ?? "").trim();
  const date = updatedAt.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!date) return output;
  const [, year, month, day] = date;
  for (const value of [
    `${year}-${month}-${day}`,
    `${year}/${month}/${day}`,
    `${year}年${Number(month)}月${Number(day)}日`,
    `${year}年${month}月${day}日`
  ]) {
    output = output.replace(new RegExp(escapedPattern(value), "gu"), " ");
  }
  return output;
}

function stripStructuralNumbers(text) {
  return String(text ?? "")
    .replace(/(?:第|方案|选项|候选|备选|推荐|组合|套装)\s*\d+(?:\s*(?:个|项|套))?/gu, " ")
    .replace(/\d+\s*(?:种|套|项)(?=$|[\s,，。；;、])/gu, " ");
}

function containsPositiveLowSampleClaim(text) {
  const remaining = String(text ?? "")
    .replace(/(?:并非|不是|不属于|不算|非|没有|无|未标记为)\s*(?:低样本|样本(?:量)?不足|不稳定推荐)/gu, " ")
    .replace(/样本(?:量)?\s*(?:并不|不算|并非|不是)\s*不足/gu, " ")
    .replace(/(?:低|小)样本(?:波动)?\s*(?:校正|修正|调整)/gu, " ")
    .replace(/(?:校正|修正|调整|降低|避免)(?:了|过|后的)?\s*(?:低|小)样本(?:波动|影响|偏差)?/gu, " ");
  return LOW_SAMPLE_CLAIM.test(remaining);
}

function validateGenericNumbers(text, records, evidence, path, errors) {
  let remaining = String(text ?? "")
    .replace(/\d+(?:\.\d+)?\s*%/gu, " ")
    .replace(/(?:均名|平均名次)\s*(?:为|是|[:：])?\s*\d+(?:\.\d+)?/gu, " ")
    .replace(/(?:提升|改善)(?:幅度)?\s*(?:为|是|[:：])?\s*\d+(?:\.\d+)?/gu, " ");
  remaining = sampleCountMentions(remaining).remaining;
  remaining = stripStructuralNumbers(stripSupportedDateLiterals(remaining, evidence));
  for (const name of [...records].flatMap(recordNames).filter((name) => /\d/u.test(name))) {
    remaining = remaining.replace(new RegExp(escapedPattern(name), "gu"), " ");
  }
  const allowed = allowedNumericValues(records, evidence);
  for (const match of remaining.matchAll(/(?<![A-Za-z0-9_])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9_])/gu)) {
    const value = Number(match[1]);
    if (!matchesAllowedNumber(value, allowed)) {
      errors.push(`${path} contains unsupported number: ${match[0]}`);
    }
  }
}

function validateNumbers(text, records, evidence, path, errors) {
  const stats = statsFor(records);
  const semanticRates = [...records].flatMap((record) => (
    record?.authority === "official_static_catalog" || /description/u.test(String(record?.type ?? ""))
      ? [...String(record?.text ?? "").matchAll(/(\d+(?:\.\d+)?)\s*%/gu)].map((match) => Number(match[1]))
      : []
  ));
  const rates = stats.flatMap((entry) => [entry.top4Rate, entry.winRate, entry.pickRate])
    .concat([...records].flatMap((record) => [record?.appearanceRate, record?.coverage]))
    .filter(Number.isFinite)
    .map((value) => Number((value * 100).toFixed(1)))
    .concat(semanticRates);
  const games = stats.map((entry) => Number(entry.games))
    .concat([...records].flatMap((record) => [
      ...(record?.commonPairings ?? []).map((pairing) => Number(pairing?.games)),
      ...(record?.copyCounts ?? []).map((copy) => Number(copy?.games))
    ]))
    .filter(Number.isFinite);
  const placements = stats.map((entry) => Number(entry.avgPlacement)).filter(Number.isFinite);
  const improvements = [...records]
    .map((record) => Number(record?.trend?.placementImprovement))
    .filter(Number.isFinite);

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
  for (const mention of sampleCountMentions(text).mentions) {
    if (!games.includes(mention.value)) errors.push(`${path} contains unsupported sample count: ${mention.text}`);
  }
  for (const match of text.matchAll(/(?:均名|平均名次)\s*(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)/gu)) {
    const value = Number(match[1]);
    if (!placements.some((allowed) => Math.abs(Number(allowed.toFixed(2)) - value) <= 0.005)) {
      errors.push(`${path} contains unsupported average placement: ${match[0]}`);
    }
  }
  for (const match of text.matchAll(/(?:提升|改善)(?:幅度)?\s*(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)/gu)) {
    const value = Number(match[1]);
    if (!improvements.some((allowed) => Math.abs(Number(allowed.toFixed(4)) - value) <= 0.00005)) {
      errors.push(`${path} contains unsupported trend improvement: ${match[0]}`);
    }
  }
  validateGenericNumbers(text, records, evidence, path, errors);
}

function validateNames(text, names, knownCatalogNames, path, errors) {
  for (const match of text.matchAll(API_NAME)) {
    if (!names.has(match[0])) errors.push(`${path} contains an API name absent from evidence: ${match[0]}`);
  }
  for (const name of knownCatalogNames) {
    const asciiName = /^[A-Za-z0-9_ .'-]+$/u.test(name);
    const appears = asciiName
      ? new RegExp(`(?<![A-Za-z0-9_])${escapedPattern(name)}(?![A-Za-z0-9_])`, "u").test(text)
      : text.includes(name);
    if (name.length >= 2 && appears && !names.has(name)) {
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
  const explicitIds = Array.isArray(entry?.evidenceIds)
    ? [...new Set(entry.evidenceIds.map(String))]
    : [];
  if (explicitIds.length > 3) {
    return { ids: explicitIds, inferred: false, explicitCount: explicitIds.length };
  }
  const ids = [...explicitIds];
  const text = String(entry?.text ?? "");
  for (const [id, record] of records) {
    if (ids.length >= 3) break;
    const explicitlyReferenced = new RegExp(`(?<![A-Za-z0-9_-])${escapedPattern(id)}(?![A-Za-z0-9_-])`, "u").test(text);
    const candidateNamed = record?.kind !== "item_core_signal" && primaryRecordNames(record)
      .some((name) => name.length >= 2 && text.includes(name));
    if ((explicitlyReferenced || candidateNamed) && !ids.includes(id)) ids.push(id);
  }
  return { ids, inferred: explicitIds.length === 0, explicitCount: explicitIds.length };
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
  const namedGlobalCoreSignal = allSignals.some((signal) => (
    signal.core === true && describesItemAsCore(text, signal.item)
  ));
  const hasLinkedCoreSignal = scopedSignals.some((signal) => signal.core === true);
  if (!(entryScoped ? hasLinkedCoreSignal || namedGlobalCoreSignal : allSignals.some((signal) => signal.core === true))) {
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
  const names = allowedNames(evidence, records, catalog);
  validateNames(text, names, catalogNames(catalog), path, errors);
  validateNumbers(text, records, evidence, path, errors);
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
    const resolvedIds = inferEvidenceIds(entry, records);
    if (!Array.isArray(entry.evidenceIds)
      || resolvedIds.ids.length === 0
      || resolvedIds.explicitCount > 3) {
      errors.push(`${entryPath}.evidenceIds must contain 1 to 3 entries`);
    }
    const ids = resolvedIds.ids.slice(0, 3);
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

function pathFromError(message) {
  const match = String(message).match(/^([A-Za-z][A-Za-z0-9_.\[\]-]*)\s/u);
  return match?.[1] ?? "output";
}

function categoryForError(message) {
  const value = String(message);
  if (/unsupported (?:number|percentage|sample count|average placement|trend improvement)/u.test(value)) return "unsupported_number";
  if (/entity absent|API name absent|quoted entity absent|unknown evidence/u.test(value)) return "unsupported_entity";
  if (/omits displayed evidence/u.test(value)) return "missing_coverage";
  if (/risk notice|freshness risk/u.test(value)) return "missing_risk_notice";
  if (/absolute or causal|core-item claim|non-core item|cannot claim a winner|stable evidence cannot|must discuss/u.test(value)) return "analysis_boundary";
  return "format_error";
}

function idsFromError(message) {
  const values = String(message).match(/(?:build|item|item-signal|comparison|comp):\d+/gu) ?? [];
  return [...new Set(values)];
}

function allowedNumbers(evidence) {
  const values = new Set();
  for (const record of evidenceRecords(evidence).values()) {
    collectNumericValues(record, values);
    if (record?.authority === "official_static_catalog" || /description/u.test(String(record?.type ?? ""))) {
      textNumericValues(record?.text, values);
    }
    for (const value of Object.values(record?.stats ?? {})) {
      if (Number.isFinite(Number(value))) values.add(Number(value));
    }
    for (const value of [record?.coverage, record?.appearanceRate, record?.trend?.placementImprovement, record?.trend?.emergenceScore]) {
      if (Number.isFinite(Number(value))) values.add(Number(value));
    }
  }
  return [...values].sort((left, right) => left - right);
}

function issueEvidenceScope(message, evidence, output) {
  const records = evidenceRecords(evidence);
  const match = String(message).match(/^(reasons|alternatives)\[(\d+)\]/u);
  if (!match) {
    return {
      evidenceIds: [...records.keys()],
      records: [...records.values()]
    };
  }
  const entry = output?.[match[1]]?.[Number(match[2])];
  if (!entry) return { evidenceIds: [], records: [] };
  const resolved = inferEvidenceIds(entry, records);
  const evidenceIds = resolved.ids.slice(0, 3).filter((id) => records.has(id));
  return {
    evidenceIds,
    records: evidenceIds.map((id) => records.get(id))
  };
}

function allowedFeedbackNumbers(records, evidence) {
  const values = new Set(allowedNumericValues(records, evidence));
  for (const value of [...values]) {
    if (value >= 0 && value <= 1) {
      values.add(Number((value * 100).toFixed(1)));
      values.add(Number((value * 100).toFixed(2)));
    }
  }
  return [...values].sort((left, right) => left - right);
}

export function classifyConclusionValidationErrors(errors, evidence, options = {}) {
  return [...new Set((errors ?? []).map(String))].map((message) => {
    const category = categoryForError(message);
    const scope = issueEvidenceScope(message, evidence, options.output);
    const issue = {
      category,
      path: pathFromError(message),
      message,
      missingEvidenceIds: category === "missing_coverage" ? idsFromError(message) : [],
      allowedValues: [],
      linkedEvidenceIds: scope.evidenceIds
    };
    if (category === "unsupported_number") {
      issue.allowedValues = scope.records.length > 0
        ? allowedFeedbackNumbers(scope.records, evidence)
        : allowedNumbers(evidence);
    }
    if (category === "unsupported_entity") {
      issue.allowedValues = [...allowedNames(
        evidence,
        scope.records.length > 0 ? scope.records : null,
        options.catalog
      )].sort().slice(0, 120);
    }
    return issue;
  });
}

export function createConclusionValidationFeedback(validation, evidence, options = {}) {
  const maxErrors = Math.max(1, Number(options.maxErrors ?? 8));
  const issues = validation?.issues ?? classifyConclusionValidationErrors(validation?.errors ?? [], evidence, options);
  return {
    schemaVersion: CONCLUSION_VALIDATION_FEEDBACK_SCHEMA_VERSION,
    valid: false,
    errors: issues.slice(0, maxErrors)
  };
}

export function validateConclusionOutput(rawValue, evidence, options = {}) {
  const errors = [];
  if (!isObject(rawValue)) {
    const objectErrors = ["conclusion output must be an object"];
    return {
      valid: false,
      errors: objectErrors,
      issues: classifyConclusionValidationErrors(objectErrors, evidence, options),
      value: null
    };
  }
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
  if (evidence?.generationRules?.mustMentionLowSample
    && !containsPositiveLowSampleClaim(combined)
    && !/(?:仅供参考|不稳定)/u.test(combined)) {
    errors.push("low-sample evidence requires a risk notice");
  }
  if (!evidence?.generationRules?.mustMentionLowSample && containsPositiveLowSampleClaim(combined)) {
    errors.push("stable evidence cannot be described as low-sample");
  }
  if (evidence?.generationRules?.mustMentionStaleData && !/(?:过期|时效|非最新|旧缓存)/u.test(combined)) {
    errors.push("stale evidence requires a freshness risk notice");
  }
  if (evidence?.generationRules?.mustAvoidWinnerClaim && WINNER_CLAIM.test(combined)) {
    errors.push("unresolved comparison cannot claim a winner");
  }
  if (evidence?.generationRules?.mustUseStandardizedTrendImprovement) {
    if (!/(?:提升|改善)/u.test(combined)) errors.push("comp-trend conclusion must discuss standardized placement improvement");
    if (!/(?:登场|热度|使用基础|使用率)/u.test(combined)) errors.push("comp-trend conclusion must discuss pick-rate foundation");
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
  return {
    valid: errors.length === 0,
    errors,
    issues: classifyConclusionValidationErrors(errors, evidence, { ...options, output: rawValue }),
    value: errors.length === 0 ? value : null
  };
}
