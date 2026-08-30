// Category vocabulary, not entity resolution: hero/item identities still come from tools.
const CATEGORY_MENTIONS = /神器|\bartifacts?\b|光明(?:装备)?|\bradiant(?:\s+items?)?\b|普通(?:装备)?/giu;
const NEGATED_PREFIX = /(?:不要|不看|不查|不含|不包括|不包含|排除|去掉|不需要|不是|而非|别查|非|without|exclude)\s*(?:奥恩)?\s*$/iu;
const ADDITIVE_PREFIX = /(?:加入|加上|包含|包括|带上|算上|纳入|include|add)\s*(?:奥恩)?\s*$/iu;
const EXCLUSIVE_SCOPE = /(?:只|仅)(?:看|查|查询|要|用|包括|包含)?\s*(?:(?:奥恩)?神器|光明|artifacts?|radiant)|(?:only|just)\s+(?:artifacts?|radiant)/iu;

export function requestedEquipmentCategoryScope(input) {
  const text = String(input ?? "");
  const categories = [];
  let additive = false;
  for (const match of text.matchAll(CATEGORY_MENTIONS)) {
    const prefix = text.slice(0, match.index);
    if (NEGATED_PREFIX.test(prefix)) continue;
    const category = /光明|radiant/iu.test(match[0]) ? "radiant"
      : /普通/u.test(match[0]) ? "ordinary_completed" : "artifact";
    if (!categories.includes(category)) categories.push(category);
    if (category !== "ordinary_completed") {
      additive ||= ADDITIVE_PREFIX.test(prefix)
        || /^\s*(?:也)?(?:一起)?\s*(?:加入|加上|包含|包括|带上|算上|纳入)/u.test(text.slice(match.index + match[0].length));
    }
  }
  if (!categories.length) return null;
  if (additive && !EXCLUSIVE_SCOPE.test(text) && !categories.includes("ordinary_completed")) {
    categories.unshift("ordinary_completed");
  }
  const artifact = categories.includes("artifact");
  const radiant = categories.includes("radiant");
  return {
    itemPolicy: artifact && radiant ? "include_special"
      : artifact ? "include_artifact" : radiant ? "include_radiant" : "ordinary_only",
    itemCategories: categories
  };
}
