import { createCatalog } from "../data/static-data.js";
import { attachStats } from "./stats-calculator.js";

const POLICY_CATEGORIES = {
  ordinary_only: new Set(["ordinary_completed"]),
  include_radiant: new Set(["ordinary_completed", "radiant"]),
  include_artifact: new Set(["ordinary_completed", "artifact"]),
  include_special: new Set(["ordinary_completed", "radiant", "artifact", "emblem", "support", "set_special"])
};

const REQUIRED_SPECIAL_BUILD_CATEGORIES = new Set(["radiant", "artifact"]);

function requiredSpecialBuildCategories(query) {
  const allowed = POLICY_CATEGORIES[query.itemPolicy] ?? new Set();
  return new Set((query.itemCategories ?? []).filter((category) => (
    REQUIRED_SPECIAL_BUILD_CATEGORIES.has(category) && allowed.has(category)
  )));
}

function isAllowedItem(item, policy) {
  if (!item || !item.current || !item.obtainable) return false;
  return POLICY_CATEGORIES[policy]?.has(item.category) ?? false;
}

export function filterBuildRows(rows, query, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const warnings = [];
  const requiredSpecialCategories = requiredSpecialBuildCategories(query);

  const builds = rows
    .map(attachStats)
    .filter((build) => build.items.length === query.itemCount)
    .filter((build) => {
      const itemRecords = build.items.map((apiName) => catalog.itemByApiName.get(apiName));
      const allowed = itemRecords.every((item) => isAllowedItem(item, query.itemPolicy));
      if (!allowed) return false;
      if (requiredSpecialCategories.size > 0
        && !itemRecords.some((item) => requiredSpecialCategories.has(item?.category))) return false;
      if (!(query.ownedItems ?? []).every((ownedItem) => build.items.includes(ownedItem))) return false;
      return !(query.excludedItems ?? []).some((excludedItem) => build.items.includes(excludedItem));
    });

  if (builds.length === 0) {
    warnings.push(requiredSpecialCategories.size > 0
      ? "没有找到包含所查询光明装备或神器的合法三件套"
      : "没有找到满足装备策略、已持有/排除装备和当前版本白名单的组合");
  }

  return {
    builds,
    warnings
  };
}
