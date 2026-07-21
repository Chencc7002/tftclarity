export const CORE_ITEM_FREQUENCY_NUMERATOR = 2;
export const CORE_ITEM_FREQUENCY_DENOMINATOR = 3;

function itemApiName(item) {
  if (typeof item === "string") return item.trim();
  return String(item?.apiName ?? "").trim();
}

export function requiredCoreItemAppearances(recommendationCount) {
  const count = Math.max(0, Number(recommendationCount) || 0);
  return Math.max(2, Math.ceil((count * CORE_ITEM_FREQUENCY_NUMERATOR) / CORE_ITEM_FREQUENCY_DENOMINATOR));
}

export function summarizeCoreItemFrequency(recommendations = []) {
  const displayed = recommendations
    .map((recommendation) => Array.isArray(recommendation?.items) ? recommendation.items : [])
    .filter((items) => items.length > 0);
  const recommendationCount = displayed.length;
  const requiredAppearances = requiredCoreItemAppearances(recommendationCount);
  const frequencies = new Map();

  displayed.forEach((items, recommendationIndex) => {
    const seen = new Set();
    items.forEach((item, itemIndex) => {
      const apiName = itemApiName(item);
      if (!apiName || seen.has(apiName)) return;
      seen.add(apiName);
      const current = frequencies.get(apiName) ?? {
        apiName,
        item,
        appearances: 0,
        firstRecommendationIndex: recommendationIndex,
        firstItemIndex: itemIndex
      };
      current.appearances += 1;
      frequencies.set(apiName, current);
    });
  });

  const items = [...frequencies.values()]
    .map((entry) => ({
      ...entry,
      recommendationCount,
      requiredAppearances,
      appearanceRate: recommendationCount ? entry.appearances / recommendationCount : 0,
      core: recommendationCount >= 2 && entry.appearances >= requiredAppearances
    }))
    .sort((left, right) => right.appearances - left.appearances
      || left.firstRecommendationIndex - right.firstRecommendationIndex
      || left.firstItemIndex - right.firstItemIndex
      || left.apiName.localeCompare(right.apiName));

  return {
    numerator: CORE_ITEM_FREQUENCY_NUMERATOR,
    denominator: CORE_ITEM_FREQUENCY_DENOMINATOR,
    recommendationCount,
    requiredAppearances,
    items,
    coreItems: items.filter((entry) => entry.core)
  };
}
