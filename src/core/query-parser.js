import { DEFAULT_QUERY_OPTIONS, createCatalog } from "../data/static-data.js";
import { digitValue, normalizeAlias, normalizeText, uniqueValues } from "./normalizer.js";
import { resolveEntities } from "./entity-resolver.js";
import { resolveHighConfidenceEntityCandidates } from "./high-confidence-entity-resolver.js";
import { isCompRankingInput, parseCompRankingQuery } from "./comp-query.js";

function parseStarLevels(input) {
  const matches = [...normalizeText(input).matchAll(/([123一二三两])星/g)];
  return uniqueValues(matches.map((match) => digitValue(match[1]))).filter((star) => star >= 1 && star <= 3);
}

function parseItemCount(input) {
  const normalized = normalizeText(input);
  if (/(剩下|另外|再补|补).{0,4}([12一二两])件/.test(normalized)) return undefined;
  if (/三件套/.test(normalized)) return 3;
  const match = normalized.match(/([123一二三两])件(普通)?(装备|装)?/);
  const count = match ? digitValue(match[1]) : null;
  if (count == null) return undefined;
  return count >= 0 && count <= 3 ? count : undefined;
}

function parseMinSamples(input) {
  const normalized = normalizeText(input);
  const match = normalized.match(/样本(?:>=|大于等于|不少于|至少)?(\d{1,5})/);
  return match ? Number(match[1]) : undefined;
}

const RANK_ORDER = Object.freeze([
  "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM",
  "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"
]);

const RANK_ALIASES = Object.freeze([
  ["黑铁", "IRON"], ["青铜", "BRONZE"], ["白银", "SILVER"],
  ["黄金", "GOLD"], ["铂金", "PLATINUM"], ["翡翠", "EMERALD"],
  ["钻石", "DIAMOND"], ["大师", "MASTER"], ["宗师", "GRANDMASTER"],
  ["王者", "CHALLENGER"]
]);

function rankAtOrAbove(rank) {
  const index = RANK_ORDER.indexOf(rank);
  return index < 0 ? [] : RANK_ORDER.slice(index).reverse();
}

function rankRange(from, to) {
  const start = RANK_ORDER.indexOf(from);
  const end = RANK_ORDER.indexOf(to);
  if (start < 0 || end < 0) return [];
  return RANK_ORDER.slice(Math.min(start, end), Math.max(start, end) + 1).reverse();
}

export function parseRankFilter(input) {
  const normalized = normalizeText(input);
  const mentions = RANK_ALIASES.filter(([label]) => normalized.includes(label));
  if (!mentions.length) return undefined;
  const range = normalized.match(/(黑铁|青铜|白银|黄金|铂金|翡翠|钻石|大师|宗师|王者)(?:到|至|-)(黑铁|青铜|白银|黄金|铂金|翡翠|钻石|大师|宗师|王者)/);
  if (range) {
    const from = RANK_ALIASES.find(([label]) => label === range[1])?.[1];
    const to = RANK_ALIASES.find(([label]) => label === range[2])?.[1];
    return rankRange(from, to);
  }
  const [label, rank] = mentions[0];
  if (normalized.includes(`${label}以上`) || normalized.includes(`${label}及以上`)) {
    return rankAtOrAbove(rank);
  }
  if (normalized.includes(`只看${label}`) || normalized.includes(`仅看${label}`)) return [rank];
  return mentions.length === 1 ? [rank] : uniqueValues(mentions.map(([, value]) => value));
}

export function parseDays(input) {
  const normalized = normalizeText(input);
  const match = normalized.match(/(?:近|最近)(\d{1,2}|一|二|三|两|七|十四|三十)天/);
  if (!match) return /(?:今天|近一天|最近一天)/.test(normalized) ? 1 : undefined;
  const chinese = { 一: 1, 二: 2, 两: 2, 三: 3, 七: 7, 十四: 14, 三十: 30 };
  const value = Number(match[1]) || chinese[match[1]];
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : undefined;
}

export function parseCompMention(input) {
  const text = String(input ?? "").trim();
  const signature = text.match(/\bcomp\s*[:：=]\s*(TFT[^\s，。！？]+\|TFT[^\s，。！？]+)/i);
  if (signature) return signature[1];

  const inComp = text.match(/在\s*([^，。！？\n]{1,60}?)\s*(?:comp|阵容)\s*(?:里|中|下)/i);
  if (inComp) return inComp[1].trim();

  const labeled = text.match(/(?:comp|阵容)\s*[:：=]\s*([^，。！？\n]{1,80}?)(?=\s*(?:里|中|下|$))/i);
  return labeled?.[1]?.trim() || undefined;
}

function parseSort(input) {
  const normalized = normalizeText(input);
  const intents = [];
  if (/(前四优先|前四率优先|按前四|前四率最高)/.test(normalized)) {
    intents.push("top4_first");
  }
  if (/(吃鸡优先|吃鸡率优先|登顶优先|按登顶|登顶率最高)/.test(normalized)) {
    intents.push("win_first");
  }
  if (/(稳健|高样本|样本最多|按样本|最热门)/.test(normalized)) {
    intents.push("robust_first");
  }
  if (/(均名|平均名次)/.test(normalized)) intents.push("avg_first");
  return {
    value: intents[0],
    intents: uniqueValues(intents)
  };
}

function parseItemPolicy(input, itemMatches = []) {
  const categories = new Set(itemMatches.map((match) => match.record?.category).filter(Boolean));
  const hasRadiant = categories.has("radiant");
  const hasArtifact = categories.has("artifact");
  if (
    categories.has("emblem")
    || categories.has("support")
    || categories.has("set_special")
    || (hasRadiant && hasArtifact)
  ) {
    return "include_special";
  }
  if (hasArtifact) return "include_artifact";
  if (hasRadiant) return "include_radiant";

  const normalized = normalizeText(input);
  if (/(?:只看|仅看|只要|仅要|只用|仅用)普通/.test(normalized)) return "ordinary_only";
  if (normalized.includes("特殊")) return "include_special";
  if (normalized.includes("神器") || normalized.includes("奥恩")) return "include_artifact";
  if (normalized.includes("光明")) return "include_radiant";
  if (normalized.includes("普通") || categories.has("ordinary_completed")) return "ordinary_only";
  return undefined;
}

function inferIntent(input, details = {}) {
  const normalized = normalizeText(input);
  if (normalized.includes("能不能带") || normalized.includes("可不可以带")) {
    return "unit_item_availability";
  }
  if (details.comparison?.requested) return "unit_item_comparison";
  if (/(单件|单装备|哪个装备|哪件装备|优先做.{0,6}装备|装备表现最好|装备最厉害)/.test(normalized)) {
    return "unit_item_rankings";
  }
  if ((details.ownedItems?.length ?? 0) > 0 && /(已有|已经有|携带|带着|前提|剩下|另外|补齐|怎么补)/.test(normalized)) {
    return "unit_build_completion";
  }
  return "unit_build_rankings";
}

function hasExplicitIntent(input, comparison, ownedItems) {
  const normalized = normalizeText(input);
  return comparison?.requested
    || /(单件|单装备|哪个装备|哪件装备|三件套|出装|一套|换一套|阵容|能不能带|可不可以带)/.test(normalized)
    || ((ownedItems?.length ?? 0) > 0 && /(已有|已经有|携带|带着|前提|剩下|另外|补齐|怎么补)/.test(normalized));
}

function exclusionFragments(input) {
  const normalized = normalizeText(input);
  const fragments = [];
  const prefixPattern = /(?:不要|别带|别用|不用|排除|剔除|去掉|换掉|避开|规避|不考虑|不想要|不需要)([^，。！？?；;]*)/g;
  const suffixPattern = /([^，。！？?；;]{1,32}?)(?:都)?(?:不要|不带了|不用了|排除掉|剔除掉|去掉|换掉)(?:了)?(?=[，。！？?；;]|$)/g;

  for (const match of normalized.matchAll(prefixPattern)) {
    if (match[1]) fragments.push(normalizeAlias(match[1]));
  }
  for (const match of normalized.matchAll(suffixPattern)) {
    if (match[1]) fragments.push(normalizeAlias(match[1]));
  }
  return uniqueValues(fragments.filter(Boolean));
}

function parseExcludedItems(input, entities) {
  const fragments = exclusionFragments(input);
  if (fragments.length === 0) return [];
  return uniqueValues(entities.items
    .filter((item) => fragments.some((fragment) => fragment.includes(item.normalizedAlias)))
    .map((item) => item.target));
}

function hasExclusionIntent(input) {
  return /(?:不要|别带|别用|不用|排除|剔除|去掉|换掉|避开|规避|不考虑|不想要|不需要)/
    .test(normalizeText(input));
}

function parseComparison(input, entities, excludedItems = []) {
  const normalized = normalizeText(input);
  const requested = /(比较|对比|哪个(?:更)?好|哪个更强|哪件(?:更)?好|谁更好|更适合|二选一|还是)/.test(normalized);
  const excluded = new Set(excludedItems);
  const ownership = requested
    ? normalized.match(/(?:已经有|已有|有了|带着|拿了|锁定|有)(.{1,32}?)(?=，|,|。|；|;|然后|比较|对比|$)/)
    : null;
  const ownershipFragment = normalizeAlias(ownership?.[1]);
  const ownedItemApiNames = requested && ownershipFragment
    ? uniqueValues(entities.items
      .filter((item) => ownershipFragment.includes(item.normalizedAlias) && !excluded.has(item.target))
      .map((item) => item.target))
    : [];
  return {
    requested,
    itemApiNames: requested
      ? uniqueValues(entities.items
        .map((item) => item.target)
        .filter((apiName) => !ownedItemApiNames.includes(apiName) && !excluded.has(apiName)))
      : [],
    ownedItemApiNames
  };
}

function cleanUnresolvedFragment(value, entities) {
  let fragment = normalizeAlias(value);
  for (const match of entities.all ?? []) {
    const alias = normalizeAlias(match.alias);
    if (alias) fragment = fragment.replaceAll(alias, "");
  }
  return fragment.replace(/(?:一个|一件|两件|三件|那个|普通|光明|神器|特殊|装备|羁绊|已经|当前|版本|什么|怎么|如何|可以|能不能|可不可以|不要|别带|别用|不用|排除|剔除|去掉|换掉|避开|规避|不考虑|不想要|不需要|前四|吃鸡|稳健|高样本|样本|优先|吗|呢|呀|啊|的)/g, "");
}

function inferUnresolvedEntityHints(input, entities) {
  const normalized = normalizeText(input);
  const hints = [];

  if (entities.items.length === 0) {
    const ownership = normalized.match(/(?:已经有|已有|有了|带着|拿了|锁定|有)(.{1,24}?)(?:剩下|另外|再补|补齐|怎么补|如何补)/);
    const availability = normalized.match(/(?:能不能带|可不可以带|能带|可以带)(.{1,20}?)(?:吗|呢|呀|啊|\?|？)?$/);
    const exclusion = normalized.match(/(?:不要|别带|别用|不用|排除|剔除|去掉|换掉|避开|规避|不考虑|不想要|不需要)(.{1,24}?)(?:装备|装|怎么|如何|，|。|；|$)/);
    const fragment = cleanUnresolvedFragment(ownership?.[1] ?? availability?.[1] ?? exclusion?.[1], entities);
    if (fragment.length >= 2) {
      hints.push({ entityType: "item", inputFragment: fragment });
    }
  }

  if (entities.traits.length === 0) {
    const levelTrait = normalized.match(/[1-9一二三四五六七八九]([\p{Script=Han}a-z]{2,12}?)(?:羁绊|开了|已开|装备|三件套|三件|怎么|如何|$)/u);
    const beforeOpen = normalized.match(/([\p{Script=Han}a-z]{2,12}?)(?:开了|已开)/u);
    const afterOpen = normalized.match(/(?:开了|已开)([\p{Script=Han}a-z]{2,12}?)(?:装备|怎么|如何|$)/u);
    const fragment = cleanUnresolvedFragment(levelTrait?.[1] ?? beforeOpen?.[1] ?? afterOpen?.[1], entities)
      .replace(/(?:星|件|套|开了|已开)/g, "");
    if (fragment.length >= 2) {
      hints.push({ entityType: "trait", inputFragment: fragment });
    }
  }

  return hints;
}

export function parseQuery(input, options = {}) {
  if (isCompRankingInput(input)) {
    const compQuery = parseCompRankingQuery(input, options.compQuery);
    return {
      rawInput: String(input ?? ""),
      ...compQuery,
      unit: undefined,
      unitAlias: undefined,
      parser: {
        usedLLM: false,
        constraintConflicts: [],
        unresolvedEntityHints: [],
        entityAmbiguities: [],
        entityMatches: []
      },
      defaults: DEFAULT_QUERY_OPTIONS
    };
  }
  const catalog = options.catalog ?? createCatalog();
  const exactEntities = resolveEntities(input, { catalog });
  const initialUnresolvedEntityHints = inferUnresolvedEntityHints(input, exactEntities);
  const highConfidenceEntityResolutions = resolveHighConfidenceEntityCandidates(input, {
    catalog,
    entities: exactEntities,
    unresolvedEntityHints: initialUnresolvedEntityHints,
    enabled: options.highConfidenceFuzzy !== false,
    config: typeof options.highConfidenceFuzzy === "object"
      ? options.highConfidenceFuzzy
      : undefined
  });
  const fuzzyMatches = highConfidenceEntityResolutions.map((resolution) => ({
    entityType: resolution.entityType,
    alias: resolution.matchedAlias,
    normalizedAlias: normalizeAlias(resolution.matchedAlias),
    record: resolution.record,
    target: resolution.apiName,
    confidence: resolution.confidence,
    matchType: resolution.matchType,
    source: resolution.source,
    inputFragment: resolution.inputFragment
  }));
  const entities = {
    units: [...exactEntities.units, ...fuzzyMatches.filter((match) => match.entityType === "unit")],
    items: [...exactEntities.items, ...fuzzyMatches.filter((match) => match.entityType === "item")],
    traits: [...exactEntities.traits, ...fuzzyMatches.filter((match) => match.entityType === "trait")],
    all: [...exactEntities.all, ...fuzzyMatches],
    ambiguities: exactEntities.ambiguities
  };
  const unit = entities.units[0]?.target;
  const compMention = parseCompMention(input);
  const traitFilters = compMention
    ? []
    : uniqueValues(entities.traits.map((trait) => trait.target));
  const allItems = uniqueValues(entities.items.map((item) => item.target));
  const excludedItems = parseExcludedItems(input, entities);
  const starLevel = parseStarLevels(input);
  const itemCount = parseItemCount(input);
  const sort = parseSort(input);
  const comparison = parseComparison(input, entities, excludedItems);
  const excludedItemSet = new Set(excludedItems);
  const ownedItems = comparison.requested
    ? comparison.ownedItemApiNames
    : allItems.filter((apiName) => !excludedItemSet.has(apiName));
  const activeItemMatches = entities.items.filter((item) => !excludedItemSet.has(item.target));
  const unresolvedEntityHints = inferUnresolvedEntityHints(input, entities);

  return {
    rawInput: String(input ?? ""),
    intent: inferIntent(input, { comparison, ownedItems }),
    unit,
    unitAlias: entities.units[0]?.alias,
    starLevel: starLevel.length > 0 ? starLevel : undefined,
    itemCount,
    traitFilters,
    compMention,
    itemPolicy: parseItemPolicy(input, activeItemMatches),
    ownedItems,
    excludedItems,
    minSamples: parseMinSamples(input),
    sort: sort.value,
    rankFilter: parseRankFilter(input),
    days: parseDays(input),
    patch: undefined,
    queue: undefined,
    parser: {
      usedLLM: false,
      intentExplicit: hasExplicitIntent(input, comparison, ownedItems),
      constraintConflicts: sort.intents.length > 1
        ? [{ type: "sort", values: sort.intents }]
        : [],
      comparison,
      exclusion: {
        requested: hasExclusionIntent(input),
        itemApiNames: excludedItems
      },
      unresolvedEntityHints,
      entityAmbiguities: entities.ambiguities,
      highConfidenceEntityResolutions: highConfidenceEntityResolutions.map((resolution) => ({
        entityType: resolution.entityType,
        apiName: resolution.apiName,
        label: resolution.label,
        matchedAlias: resolution.matchedAlias,
        inputFragment: resolution.inputFragment,
        confidence: resolution.confidence,
        matchType: resolution.matchType,
        source: resolution.source
      })),
      entityMatches: entities.all.map((match) => ({
        entityType: match.entityType,
        alias: match.alias,
        apiName: match.target,
        confidence: match.confidence,
        ...(match.matchType ? { matchType: match.matchType } : {}),
        ...(match.source ? { source: match.source } : {}),
        ...(match.inputFragment ? { inputFragment: match.inputFragment } : {})
      }))
    },
    defaults: DEFAULT_QUERY_OPTIONS
  };
}
