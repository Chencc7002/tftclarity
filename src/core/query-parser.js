import { DEFAULT_QUERY_OPTIONS, createCatalog } from "../data/static-data.js";
import { digitValue, normalizeAlias, normalizeText, uniqueValues } from "./normalizer.js";
import { resolveEntities } from "./entity-resolver.js";
import { resolveHighConfidenceEntityCandidates } from "./high-confidence-entity-resolver.js";
import { isCompRankingInput, parseCompRankingQuery } from "./comp-query.js";
import { isCompAnalysisInput, parseCompAnalysisRequest } from "./comp-analysis.js";

function parseStarLevels(input) {
  const matches = [...normalizeText(input).matchAll(/([123一二三两])星/g)];
  return uniqueValues(matches.map((match) => digitValue(match[1]))).filter((star) => star >= 1 && star <= 3);
}

function parseItemCount(input) {
  const normalized = normalizeText(input);
  if (/(剩下|另外|再补|补).{0,4}([12一二两])件/.test(normalized)) return undefined;
  if (/三件套/.test(normalized)) return 3;
  // “哪一件光明装备最好”中的“一件”表示从排行里选一个，不是要求
  // MetaTFT 只返回携带一件装备的样本。特殊装备排行仍需基于完整三件套聚合。
  if (requestsCategoryRanking(normalized)) return undefined;
  const match = normalized.match(/([123一二三两])件(普通)?(装备|装)?/);
  const count = match ? digitValue(match[1]) : null;
  if (count == null) return undefined;
  return count >= 0 && count <= 3 ? count : undefined;
}

function parseMinSamples(input) {
  const normalized = normalizeText(input);
  if (/(?:移除|取消|关闭|不要|不设|不设置|去掉)(?:最低)?样本(?:下限|门槛|限制)|(?:无|没有)样本(?:下限|门槛|限制)|样本(?:不限|无下限)/.test(normalized)) {
    return 0;
  }
  const match = normalized.match(/样本(?:>=|大于等于|不少于|至少)?(\d{1,6})/);
  return match ? Number(match[1]) : undefined;
}

function mentionsArtifactCategory(input) {
  const normalized = normalizeText(input);
  return normalized.includes("神器") || /奥恩装(?!备)/.test(normalized);
}

function mentionsEmblemCategory(input) {
  const normalized = normalizeText(input);
  return normalized.includes("纹章")
    || normalized.includes("转职")
    || /(?:什么|哪个|哪些)转(?!换|成)/.test(normalized);
}

function parseItemCategories(input) {
  const normalized = normalizeText(input);
  const categories = [];
  if (mentionsEmblemCategory(normalized)) categories.push("emblem");
  if (mentionsArtifactCategory(normalized)) categories.push("artifact");
  if (normalized.includes("光明")) categories.push("radiant");
  return uniqueValues(categories);
}

function requestsCategoryRanking(input) {
  const normalized = normalizeText(input);
  return /(?:有|能用|能带|可以用|可以带)?(?:哪些|什么|哪(?:一|几)?件).{0,4}(?:纹章|转职|神器|光明(?:装备)?)/.test(normalized)
    || /(?:纹章|转职|神器|光明(?:装备)?).{0,4}(?:有哪些|有些什么|有哪几件)/.test(normalized)
    || /(?:有?什么|哪些|哪个|哪件).{0,10}(?:好|强|强力|厉害|适合|推荐|优先|值得)/.test(normalized)
    || /(?:好|强|强力|厉害|适合|推荐|优先|值得).{0,10}(?:有?什么|哪些|哪个|哪件)/.test(normalized)
    || /(?:最好|最强|最适合|最优|表现最好).{0,6}(?:纹章|转职|神器|光明(?:装备)?)/.test(normalized)
    || /(?:纹章|转职|神器|光明(?:装备)?).{0,6}(?:最好|最强|最适合|最优|表现最好)/.test(normalized)
    || /(?:应该|该|适合|推荐).{0,6}(?:带|携带|选择|拿|用)?(?:什么|哪个|哪些|哪(?:一|几)?件).{0,5}(?:纹章|转职|转(?!换|成)|神器|光明(?:装备)?)/.test(normalized)
    || /(?:带|携带|选择|拿|用).{0,4}(?:什么|哪个|哪些|哪(?:一|几)?件).{0,5}(?:纹章|转职|转(?!换|成)|神器|光明(?:装备)?)/.test(normalized)
    || /(?:纹章|转职|神器|光明(?:装备)?).{0,4}(?:推荐|排行|排名)/.test(normalized);
}

const RANK_ORDER = Object.freeze([
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON"
]);

const RANK_ALIASES = [
  ["CHALLENGER", /(?:王者|最强王者|challenger)/i],
  ["GRANDMASTER", /(?:宗师|\bgrandmaster\b)/i],
  ["MASTER", /(?:大师|\bmaster\b)/i],
  ["DIAMOND", /(?:钻石|diamond)/i],
  ["EMERALD", /(?:翡翠|emerald)/i],
  ["PLATINUM", /(?:铂金|白金|platinum)/i],
  ["GOLD", /(?:黄金|gold)/i],
  ["SILVER", /(?:白银|silver)/i],
  ["BRONZE", /(?:青铜|bronze)/i],
  ["IRON", /(?:黑铁|iron)/i]
];

function rankMentions(input) {
  const text = normalizeText(input);
  return RANK_ALIASES
    .filter(([, pattern]) => pattern.test(text))
    .map(([rank]) => rank);
}

export function parseRankFilter(input) {
  const text = normalizeText(input);
  const mentions = rankMentions(text);
  if (mentions.length === 0) return undefined;

  const indexes = mentions.map((rank) => RANK_ORDER.indexOf(rank));
  if (/(?:以上|及以上|或以上|往上|起步)/.test(text)) {
    const lowestIncluded = Math.max(...indexes);
    return RANK_ORDER.slice(0, lowestIncluded + 1);
  }
  if (/(?:以下|及以下|或以下|往下)/.test(text)) {
    const highestIncluded = Math.min(...indexes);
    return RANK_ORDER.slice(highestIncluded);
  }
  if (mentions.length >= 2 && /(?:到|至|~|～|-)/.test(text)) {
    const start = Math.min(...indexes);
    const end = Math.max(...indexes);
    return RANK_ORDER.slice(start, end + 1);
  }
  return uniqueValues(mentions);
}

export function parseDays(input) {
  const text = normalizeText(input);
  const match = text.match(/(?:近|最近|过去)?(\d{1,2}|一|二|三|两|七|十四|三十)天/);
  if (match) {
    const chinese = { 一: 1, 二: 2, 两: 2, 三: 3, 七: 7, 十四: 14, 三十: 30 };
    const days = Number(match[1]) || chinese[match[1]];
    return days >= 1 && days <= 30 ? days : undefined;
  }
  return /(?:今天|近一天|最近一天|过去一天)/.test(text) ? 1 : undefined;
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
  if (/(前四优先|前四率优先|按前四|前四率最高|哪个(?:更)?稳|哪件(?:更)?稳|谁更稳)/.test(normalized)) {
    intents.push("top4_first");
  }
  if (/(吃鸡优先|吃鸡率优先|登顶优先|按登顶|登顶率最高|吃鸡.{0,6}上限|上限.{0,6}吃鸡)/.test(normalized)) {
    intents.push("win_first");
  }
  if (/(样本更多)/.test(normalized)) {
    intents.push("games_first");
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
  if (mentionsEmblemCategory(normalized)) return "include_special";
  if (mentionsArtifactCategory(normalized)) return "include_artifact";
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
  if (details.performanceItem) return "unit_item_rankings";
  if (details.itemCategories?.includes("emblem") && requestsCategoryRanking(normalized)) {
    return "unit_emblem_rankings";
  }
  if ((details.itemCategories?.length ?? 0) > 0 && requestsCategoryRanking(normalized)) {
    return "unit_item_rankings";
  }
  if (/(单件|单装备|核心装备|核心装|哪个装备|哪件装备|优先做.{0,6}装备|装备表现最好|装备最厉害)/.test(normalized)) {
    return "unit_item_rankings";
  }
  if ((details.ownedItems?.length ?? 0) > 0 && /(已有|已经有|携带|带着|前提|剩下|另外|补齐|怎么补)/.test(normalized)) {
    return "unit_build_completion";
  }
  if (/(?:装备|出装|神装|怎么带|带什么|给什么|合成|配方)/.test(normalized)) {
    return "unit_build_rankings";
  }
  if (isCompAnalysisInput(normalized)) {
    return "comp_analysis";
  }
  if (/(?:阵容|版本|当前).{0,8}(?:趋势|上升|提升)|(?:趋势|上升|提升).{0,8}阵容/u.test(normalized)) {
    return "comp_trends";
  }
  if (
    /(?:阵容|阵容榜|上分阵容|热门体系)/.test(normalized)
    && /(?:推荐|热门|排行|排名|强势|上分|哪些|什么)/.test(normalized)
  ) {
    return "comp_rankings";
  }
  if (isCompRankingInput(input)) return "comp_rankings";
  return "unit_build_rankings";
}

function hasExplicitIntent(input, comparison, ownedItems, itemCategories = [], performanceItem = null) {
  const normalized = normalizeText(input);
  return Boolean(performanceItem)
    || comparison?.requested
    || ((itemCategories?.length ?? 0) > 0 && requestsCategoryRanking(normalized))
    || /(单件|单装备|哪个装备|哪件装备|三件套|出装|一套|换一套|阵容|能不能带|可不可以带)/.test(normalized)
    || ((ownedItems?.length ?? 0) > 0 && /(已有|已经有|携带|带着|前提|剩下|另外|补齐|怎么补)/.test(normalized));
}

function exclusionFragments(input) {
  const normalized = normalizeText(input);
  const fragments = [];
  const prefixPattern = /(?:不要|别带|别用|不用|排除|剔除|去掉|换掉|避开|规避|不考虑|不想要|不需要)([^,，。！？?；;]*)/g;
  const suffixPattern = /([^,，。！？?；;]{1,32}?)(?:都)?(?:不要|不带了|不用了|排除掉|剔除掉|去掉|换掉)(?:了)?(?=[,，。！？?；;]|$)/g;

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

function parseComparison(input, entities, excludedItems = [], itemCategories = []) {
  const normalized = normalizeText(input);
  const categoryRankingWithoutNamedItems = itemCategories.length > 0 && entities.items.length === 0;
  const relationshipRequested = /(比较|对比|哪个(?:更)?好|哪个更强|哪件(?:更)?好|谁更好|谁更强|更适合|二选一|还是|选一个|选哪个|选择哪个|拿哪个|用哪个|拿哪件|用哪件|选哪件|\bvs\.?\b)/i.test(normalized);
  const genericSpecialChoiceRequested = categoryRankingWithoutNamedItems
    && /(?:比较|对比|二选一|铁砧|铁毡|选一个|选哪个|选择哪个)/.test(normalized);
  const itemContext = entities.items.length > 0
    || /(?:装备|出装|神器|纹章|转职|特殊装备|铁砧)/.test(normalized)
    || (entities.units.length === 1 && /(?:还是|二选一|\bvs\.?\b)/i.test(normalized));
  const requested = relationshipRequested
    && itemContext
    && (!categoryRankingWithoutNamedItems || genericSpecialChoiceRequested);
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

function parseComparisonMetric(input, requested) {
  if (!requested) return { value: undefined, intents: [] };
  const normalized = normalizeText(input);
  const intents = [];
  if (/(更稳|上分|前四)/.test(normalized)) intents.push("top4Rate");
  if (/(上限|吃鸡|登顶|第一)/.test(normalized)) intents.push("winRate");
  if (/(平均表现|平均名次|平均排名)/.test(normalized)) intents.push("avgPlacement");
  if (/(更常用|常用|热门|使用更多|样本更多|选择率)/.test(normalized)) intents.push("games");
  const uniqueIntents = uniqueValues(intents);
  return {
    value: uniqueIntents[0] ?? "top4Rate",
    intents: uniqueIntents
  };
}

function comparisonSort(primaryMetric) {
  if (!primaryMetric) return undefined;
  if (primaryMetric === "winRate") return "win_first";
  if (primaryMetric === "avgPlacement") return "avg_first";
  if (primaryMetric === "games") return "games_first";
  return "top4_first";
}

function cleanUnresolvedFragment(value, entities) {
  let fragment = normalizeAlias(value);
  for (const match of entities.all ?? []) {
    const alias = normalizeAlias(match.alias);
    if (alias) fragment = fragment.replaceAll(alias, "");
  }
  return fragment.replace(/(?:一个|一件|两件|三件|那个|普通|光明|神器|特殊|装备|羁绊|已经|当前|版本|什么|怎么|如何|可以|能不能|可不可以|包含|允许|含|不要|别带|别用|不用|排除|剔除|去掉|换掉|换成|替换成|改成|把|避开|规避|不考虑|不想要|不需要|前四|吃鸡|稳健|高样本|样本|优先|吗|呢|呀|啊|的)/g, "");
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
    const levelTrait = normalized.match(/[1-9一二三四五六七八九](?!套|个|种)([\p{Script=Han}a-z]{2,12}?)(?:羁绊|开了|已开|装备|三件套|三件|怎么|如何|$)/u);
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

function parseUnknownStargazerEffect(input, entities) {
  let normalized = normalizeText(input);
  for (const item of entities.items) {
    const alias = normalizeText(item.alias);
    if (alias) normalized = normalized.replaceAll(alias, "");
  }
  if (!normalized.includes("观星")) return null;
  const hasVerifiedChild = entities.traits.some((trait) => (
    /^TFT17_Stargazer_(?:Medallion|Shield|Huntress|Fountain|Mountain|Serpent|Wolf)(?:_|$)/
      .test(String(trait.target ?? ""))
  ));
  if (hasVerifiedChild) return null;

  const match = normalized.match(/([\p{Script=Han}a-z]{1,16})\s*观星/iu);
  if (!match?.[1]) return null;
  let fragment = normalizeAlias(match[1]);
  for (const unit of entities.units) {
    const alias = normalizeAlias(unit.alias);
    if (alias) fragment = fragment.replaceAll(alias, "");
  }
  fragment = fragment.replace(/^(?:(?:怎么|如何|想要|我想|我要|这局|再|那|改成|换成|用|带|玩|走|开|要|给|让|把|的|有|在))+/, "");
  if (!fragment) return null;
  return { inputFragment: fragment };
}

export function parseQuery(input, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const compMention = parseCompMention(input);
  const entityInput = typeof compMention === "string" && compMention.includes("|")
    ? String(input ?? "").replace(compMention, " ")
    : input;
  const exactEntities = resolveEntities(entityInput, { catalog });
  const initialUnresolvedEntityHints = inferUnresolvedEntityHints(entityInput, exactEntities);
  const highConfidenceEntityResolutions = resolveHighConfidenceEntityCandidates(entityInput, {
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
  const traitFilters = compMention
    ? []
    : uniqueValues(entities.traits.map((trait) => trait.target));
  const allItems = uniqueValues(entities.items.map((item) => item.target));
  const excludedItems = parseExcludedItems(input, entities);
  const starLevel = parseStarLevels(input);
  const itemCount = parseItemCount(input);
  const sort = parseSort(input);
  const itemCategories = parseItemCategories(input);
  const comparison = parseComparison(input, entities, excludedItems, itemCategories);
  const excludedItemSet = new Set(excludedItems);
  const comparisonItems = comparison.itemApiNames;
  const activeItemMatches = entities.items.filter((item) => !excludedItemSet.has(item.target));
  const performanceItem = !comparison.requested
    && activeItemMatches.length === 1
    && /(?:表现|数据).{0,6}(?:怎么样|如何|好不好)|(?:强不强|好不好|值不值得(?:做|出|拿|带)?)/.test(normalizeText(input))
    ? activeItemMatches[0].target
    : null;
  const lockedItems = comparison.requested
    ? comparison.ownedItemApiNames
    : performanceItem ? [] : allItems.filter((apiName) => !excludedItemSet.has(apiName));
  const ownedItems = lockedItems;
  const comparisonMetric = parseComparisonMetric(input, comparison.requested);
  const primaryMetric = comparisonMetric.value;
  const unresolvedEntityHints = inferUnresolvedEntityHints(entityInput, entities);
  const normalizedInput = normalizeText(input);
  const positiveEmblemScopeText = normalizedInput.replace(
    /(?:不要|别带|别用|不用|排除|剔除|去掉|换掉|避开|规避|不考虑|不想要|不需要).*?(?=但是|但|不过|然后|再|[,，。！？?；;]|$)/g,
    ""
  );
  const emblemCategoryRankingRequested = itemCategories.includes("emblem")
    && requestsCategoryRanking(normalizedInput);
  const genericEmblemActionRequested = /(?:加入|加上|带上|携带|锁定|要|用).{0,6}(?:纹章|转职)/
    .test(positiveEmblemScopeText);
  const genericEmblemRequested = (
    genericEmblemActionRequested
    || /(?:所有|全部|任意|任何|随便).{0,3}(?:纹章|转职)/.test(positiveEmblemScopeText)
  )
    && !emblemCategoryRankingRequested
    && !activeItemMatches.some((item) => item.record?.category === "emblem");
  const unknownStargazerEffectRequested = parseUnknownStargazerEffect(input, entities);
  const genericSpecialComparisonRequested = comparison.requested
    && /(?:神器|纹章|转职|特殊装备|铁砧)/.test(normalizeText(input))
    && comparisonItems.length < 2;
  const multipleItemRelationAmbiguous = !comparison.requested
    && allItems.length >= 2
    && !/(带|用|给|装备|已有|已经有|有了|拿了|锁定|不要|排除|剔除|去掉|换掉)/.test(normalizeText(input));
  const intent = comparison.requested
    ? "unit_item_comparison"
    : inferIntent(input, { comparison, ownedItems, itemCategories, performanceItem });
  const compQuery = ["comp_rankings", "comp_trends", "comp_analysis"].includes(intent)
    ? parseCompRankingQuery(input, { ...(options.compQuery ?? {}), intent })
    : null;
  const analysis = intent === "comp_analysis"
    ? parseCompAnalysisRequest(input, {
      units: entities.units.map((entry) => entry.target),
      traits: entities.traits.map((entry) => entry.target)
    })
    : null;
  const effectiveUnresolvedEntityHints = ["comp_rankings", "comp_trends", "comp_analysis"].includes(intent)
    ? unresolvedEntityHints.filter((hint) => !/^(?:阵容|体系)$/u.test(normalizeAlias(hint.inputFragment)))
    : unresolvedEntityHints;

  return {
    rawInput: String(input ?? ""),
    intent,
    unit,
    unitAlias: entities.units[0]?.alias,
    starLevel: starLevel.length > 0 ? starLevel : undefined,
    itemCount,
    traitFilters,
    compMention,
    itemPolicy: parseItemPolicy(input, activeItemMatches),
    itemCategories,
    performanceItem,
    lockedItems,
    comparisonItems,
    comparisonMode: comparison.requested ? "exclusive_presence" : undefined,
    primaryMetric,
    ownedItems,
    excludedItems,
    minSamples: parseMinSamples(input),
    sort: sort.value ?? comparisonSort(primaryMetric),
    rankFilter: parseRankFilter(input),
    days: parseDays(input),
    patch: /当前版本|当前patch|current patch/i.test(normalizeText(input)) ? "current" : undefined,
    queue: undefined,
    metrics: compQuery?.metrics,
    limit: compQuery?.limit,
    popularRequested: compQuery?.popularRequested,
    specialMode: compQuery?.specialMode,
    trendRequested: compQuery?.trendRequested,
    preferenceRequested: compQuery?.preferenceRequested,
    preferenceConditions: compQuery?.preferenceConditions,
    analysis,
    parser: {
      usedLLM: false,
      intentExplicit: hasExplicitIntent(input, comparison, ownedItems, itemCategories, performanceItem),
      constraintConflicts: [
        ...(sort.intents.length > 1 ? [{ type: "sort", values: sort.intents }] : []),
        ...(comparisonMetric.intents.length > 1
          ? [{ type: "primary_metric", values: comparisonMetric.intents }]
          : [])
      ],
      comparison,
      genericEmblemRequested,
      unknownStargazerEffectRequested,
      genericSpecialComparisonRequested,
      multipleItemRelationAmbiguous,
      exclusion: {
        requested: hasExclusionIntent(input),
        itemApiNames: excludedItems
      },
      unresolvedEntityHints: effectiveUnresolvedEntityHints,
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
