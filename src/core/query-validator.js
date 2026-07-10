import { createCatalog } from "../data/static-data.js";

const VALID_ITEM_POLICIES = new Set([
  "ordinary_only",
  "include_radiant",
  "include_artifact",
  "include_special"
]);

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

  for (const traitFilter of query.traitFilters ?? []) {
    if (!catalog.traitByFilterId.has(traitFilter)) {
      errors.push(`羁绊 ${traitFilter} 不在当前版本羁绊字典中`);
    }
  }

  const referencedItems = [...new Set([
    ...(query.ownedItems ?? []),
    ...(query.comparison?.itemApiNames ?? []),
    ...(query.excludedItems ?? [])
  ])];
  for (const itemApiName of referencedItems) {
    const item = catalog.itemByApiName.get(itemApiName);
    if (!item) {
      errors.push(`装备 ${itemApiName} 不在本地装备字典中`);
      continue;
    }
    const excludedOnly = (query.excludedItems ?? []).includes(itemApiName)
      && !(query.ownedItems ?? []).includes(itemApiName)
      && !(query.comparison?.itemApiNames ?? []).includes(itemApiName);
    if ((!item.current || !item.obtainable) && !excludedOnly) {
      warnings.push(`“${item.shortName ?? item.zhName}”当前版本不属于可用装备`);
    }
    if (query.itemPolicy === "ordinary_only" && item.category !== "ordinary_completed" && !excludedOnly) {
      warnings.push(`普通装备查询中不会混入“${item.shortName ?? item.zhName}”这类 ${item.category} 装备`);
    }
  }

  const conflictingItems = (query.ownedItems ?? []).filter((item) => (query.excludedItems ?? []).includes(item));
  if (conflictingItems.length > 0) {
    errors.push(`装备不能同时锁定和排除：${conflictingItems.join(",")}`);
  }
  const excludedComparisonItems = (query.comparison?.itemApiNames ?? [])
    .filter((item) => (query.excludedItems ?? []).includes(item));
  if (excludedComparisonItems.length > 0) {
    errors.push(`装备不能同时参与比较和排除：${excludedComparisonItems.join(",")}`);
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
