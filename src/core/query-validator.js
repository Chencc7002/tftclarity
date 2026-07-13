import { createCatalog } from "../data/static-data.js";

const VALID_ITEM_POLICIES = new Set([
  "ordinary_only",
  "include_radiant",
  "include_artifact",
  "include_special"
]);
const VALID_ITEM_CATEGORIES = new Set([
  "ordinary_completed",
  "radiant",
  "artifact",
  "emblem",
  "support",
  "set_special"
]);

const POLICY_CATEGORIES = {
  ordinary_only: new Set(["ordinary_completed"]),
  include_radiant: new Set(["ordinary_completed", "radiant"]),
  include_artifact: new Set(["ordinary_completed", "artifact"]),
  include_special: new Set(["ordinary_completed", "radiant", "artifact", "emblem", "support", "set_special"])
};

export function validateQueryContext(query, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const errors = [];
  const warnings = [];

  if (!query.unit || !catalog.unitByApiName.has(query.unit)) {
    errors.push("未识别到当前版本可查询的英雄");
  }

  for (const star of query.starLevel ?? []) {
    if (!Number.isInteger(star) || star < 1 || star > 3) {
      errors.push(`星级不合法：${star}`);
    }
  }

  if (!Number.isInteger(query.itemCount) || query.itemCount < 0 || query.itemCount > 3) {
    errors.push(`装备数量不合法：${query.itemCount}`);
  }

  if (!VALID_ITEM_POLICIES.has(query.itemPolicy)) {
    errors.push(`装备策略不合法：${query.itemPolicy}`);
  }
  for (const category of query.itemCategories ?? []) {
    if (!VALID_ITEM_CATEGORIES.has(category)) errors.push(`装备类别不合法：${category}`);
  }

  for (const traitFilter of query.traitFilters ?? []) {
    if (!catalog.traitByFilterId.has(traitFilter)) {
      errors.push(`羁绊 ${traitFilter} 不在当前版本羁绊字典中`);
    }
  }

  const lockedItems = query.lockedItems ?? query.ownedItems ?? [];
  const comparisonItems = query.comparisonItems ?? query.comparison?.itemApiNames ?? [];
  const referencedItems = [...new Set([
    ...lockedItems,
    ...comparisonItems,
    ...(query.excludedItems ?? [])
  ])];
  for (const itemApiName of referencedItems) {
    const item = catalog.itemByApiName.get(itemApiName);
    if (!item) {
      errors.push(`装备 ${itemApiName} 不在本地装备字典中`);
      continue;
    }
    const excludedOnly = (query.excludedItems ?? []).includes(itemApiName)
      && !lockedItems.includes(itemApiName)
      && !comparisonItems.includes(itemApiName);
    if ((!item.current || !item.obtainable) && !excludedOnly) {
      warnings.push(`“${item.shortName ?? item.zhName}”当前版本不属于可用装备`);
    }
    if (query.itemPolicy === "ordinary_only" && item.category !== "ordinary_completed" && !excludedOnly) {
      warnings.push(`普通装备查询中不会混入“${item.shortName ?? item.zhName}”这类 ${item.category} 装备`);
    }
    if (
      comparisonItems.includes(itemApiName)
      && !POLICY_CATEGORIES[query.itemPolicy]?.has(item.category)
    ) {
      errors.push(`比较候选“${item.shortName ?? item.zhName}”不属于当前装备策略 ${query.itemPolicy}`);
    }
  }

  const conflictingItems = lockedItems.filter((item) => (query.excludedItems ?? []).includes(item));
  if (conflictingItems.length > 0) {
    errors.push(`装备不能同时锁定和排除：${conflictingItems.join(",")}`);
  }
  const excludedComparisonItems = comparisonItems
    .filter((item) => (query.excludedItems ?? []).includes(item));
  if (excludedComparisonItems.length > 0) {
    errors.push(`装备不能同时参与比较和排除：${excludedComparisonItems.join(",")}`);
  }
  const lockedComparisonItems = comparisonItems.filter((item) => lockedItems.includes(item));
  if (lockedComparisonItems.length > 0) {
    errors.push(`装备不能同时锁定和参与比较：${lockedComparisonItems.join(",")}`);
  }
  if (query.intent === "unit_item_comparison" && comparisonItems.length < 2) {
    errors.push("装备比较至少需要两个候选");
  }
  if (comparisonItems.length > 5) {
    errors.push("装备比较最多支持五个候选");
  }
  if (comparisonItems.length > 0 && query.comparisonMode !== "exclusive_presence") {
    errors.push(`装备比较模式不合法：${query.comparisonMode ?? "missing"}`);
  }
  if (comparisonItems.length > 0 && lockedItems.length + 1 > query.itemCount) {
    errors.push(`已锁定 ${lockedItems.length} 件装备，完整出装没有剩余候选位置`);
  }

  if (query.defaultContext) {
    const units = query.defaultContext.units;
    if (!Array.isArray(units) || !units.includes(query.unit)) {
      errors.push("默认阵容 cluster 不包含目标英雄");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
