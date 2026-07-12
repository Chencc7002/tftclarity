import { DEFAULT_RANK_FILTER, createCatalog } from "../data/static-data.js";
import { isLowSampleBuild, stableSampleThreshold } from "./ranker.js";

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function itemName(apiName, catalog) {
  const item = catalog.itemByApiName.get(apiName);
  return item?.shortName ?? item?.zhName ?? apiName;
}

function traitName(filterId, catalog) {
  const trait = catalog.traitByFilterId.get(filterId);
  return trait?.displayName ?? trait?.zhName ?? filterId;
}

function unitName(apiName, catalog) {
  const unit = catalog.unitByApiName.get(apiName);
  return unit?.zhName ?? apiName;
}

function policyLabel(policy) {
  if (policy === "include_radiant") return "含光明装备";
  if (policy === "include_artifact") return "含神器装备";
  if (policy === "include_special") return "含特殊装备";
  return "普通装备";
}

function rankLabel(rankFilter) {
  const ranks = [...new Set(rankFilter ?? [])];
  const defaultSet = new Set(DEFAULT_RANK_FILTER);
  if (ranks.length === defaultSet.size && ranks.every((rank) => defaultSet.has(rank))) {
    return "铂金以上";
  }
  return ranks.length ? ranks.join(",") : "未指定段位";
}

function patchLabel(patch) {
  return patch === "current" ? "当前版本" : patch;
}

function buildLine(build, catalog, ownedItems = []) {
  const displayItems = ownedItems.length
    ? build.items.filter((apiName) => !ownedItems.includes(apiName))
    : build.items;
  return displayItems.map((apiName) => itemName(apiName, catalog)).join(" + ");
}

function comparisonSortLabel(sort) {
  if (sort === "win_first") return "吃鸡率优先";
  if (sort === "robust_first") return "高样本优先";
  return "前四率优先";
}

function formatComparison(comparison, query, catalog, warnings) {
  const lines = [];
  if (comparison.winner) {
    lines.push(`对比结论：${itemName(comparison.winner, catalog)}更优（${comparisonSortLabel(comparison.sort)}）`);
  } else if (comparison.allQualified && !comparison.allStable) {
    lines.push("低样本参考：对比项虽达到所选阈值，但未全部达到稳定展示门槛，不作胜出结论。");
  } else {
    lines.push("暂不能给出稳定对比结论：对比项未全部达到样本阈值。");
  }

  for (const entry of comparison.entries) {
    const sampleWarning = !entry.qualified
      ? `（低于样本>=${comparison.minSamples}）`
      : !entry.stable
        ? `（低样本，稳定门槛>=${comparison.stabilityMinSamples}）`
        : "";
    lines.push(
      `${itemName(entry.apiName, catalog)}：前四 ${percent(entry.stats.top4Rate)} / 吃鸡 ${percent(entry.stats.winRate)} / 均名 ${entry.stats.avgPlacement.toFixed(2)} / 聚合样本 ${entry.stats.games}${sampleWarning}`
    );
    if (entry.representativeBuild) {
      lines.push(`代表三件套：${buildLine(entry.representativeBuild, catalog, query.ownedItems)}`);
    }
  }

  lines.push("", "口径：聚合包含各选项且尽量排除其他对比项的三件套 placement_count。", "");
  appendQueryDetails(lines, query, catalog, [
    ...warnings,
    ...(comparison.warnings ?? [])
  ]);
  return lines.join("\n");
}

function conditionLine(query, catalog) {
  const unit = unitName(query.unit, catalog);
  const star = query.starLevel.join("/");
  const traits = query.traitFilters.length
    ? query.traitFilters.map((filterId) => traitName(filterId, catalog)).join(" + ")
    : "未补羁绊";

  return `${star}星${unit} / ${traits} / ${query.itemCount}件${policyLabel(query.itemPolicy)} / ${patchLabel(query.patch)} / 近${query.days}天 / ${rankLabel(query.rankFilter)} / 样本>=${query.minSamples}`;
}

function assumptionLabel(assumption, catalog, prefix) {
  if (assumption.key === "unit") return `${prefix}${unitName(assumption.value, catalog)}`;
  if (assumption.key === "star_level") return `${prefix}${assumption.value.join("/")}星`;
  if (assumption.key === "item_count") return `${prefix}${assumption.value}件装备`;
  if (assumption.key === "item_policy") return `${prefix}${policyLabel(assumption.value)}`;
  if (assumption.key === "patch") return `${prefix}当前版本`;
  if (assumption.key === "days") return `${prefix}近${assumption.value}天`;
  if (assumption.key === "rank_filter") return `${prefix}${rankLabel(assumption.value)}`;
  if (assumption.key === "min_samples") return `${prefix}样本>=${assumption.value}`;
  if (assumption.key === "trait_filters" && assumption.value.length > 0) {
    return `${prefix}羁绊：${assumption.value.map((filterId) => traitName(filterId, catalog)).join(" + ")}`;
  }
  return null;
}

function assumptionLine(query, catalog, source, prefix) {
  const assumptions = query.assumptions
    .filter((assumption) => assumption.source === source)
    .map((assumption) => {
      return assumptionLabel(assumption, catalog, prefix);
    })
    .filter(Boolean);

  return assumptions.join(" / ");
}

function compBuildEvidenceLine(query, catalog) {
  const build = query.defaultContext?.compBuilds?.[0];
  if (!build?.items?.length) return null;
  const metrics = [];
  if (Number.isFinite(Number(build.count))) metrics.push(`样本 ${Number(build.count)}`);
  if (Number.isFinite(Number(build.avg))) metrics.push(`均名 ${Number(build.avg).toFixed(2)}`);
  return `阵容装备参考：${build.items.map((apiName) => itemName(apiName, catalog)).join(" + ")}${metrics.length ? `（${metrics.join(" / ")}）` : ""}`;
}

function appendQueryDetails(lines, query, catalog, warnings) {
  lines.push(`查询条件：${conditionLine(query, catalog)}`);
  const defaultLine = [
    assumptionLine(query, catalog, "system_default", "默认 "),
    assumptionLine(query, catalog, "default", "默认 ")
  ].filter(Boolean).join(" / ");
  if (defaultLine) lines.push(`系统补全：${defaultLine}`);
  const sessionLine = [
    assumptionLine(query, catalog, "conversation", ""),
    assumptionLine(query, catalog, "session", "")
  ].filter(Boolean).join(" / ");
  if (sessionLine) lines.push(`沿用上轮：${sessionLine}`);
  const preferenceLine = assumptionLine(query, catalog, "preference", "");
  if (preferenceLine) lines.push(`长期偏好：${preferenceLine}`);
  if (query.excludedItems?.length) {
    lines.push(`已排除：${query.excludedItems.map((apiName) => itemName(apiName, catalog)).join(" + ")}`);
  }
  if (query.defaultContext?.sourceDescription) {
    lines.push(`默认阵容来源：${query.defaultContext.sourceDescription}`);
  }
  const compBuildLine = compBuildEvidenceLine(query, catalog);
  if (compBuildLine) lines.push(compBuildLine);
  if (warnings.length) lines.push(`提示：${warnings.join("；")}`);
}

export function formatRecommendation(rankedBuilds, query, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const warnings = [...new Set([
    ...(query.warnings ?? []),
    ...(query.validation?.warnings ?? []),
    ...(options.warnings ?? [])
  ])];
  const topBuilds = rankedBuilds.slice(0, 3);

  if (options.comparison) {
    return formatComparison(options.comparison, query, catalog, warnings);
  }

  if (topBuilds.length === 0) {
    const lines = ["没有找到满足条件的稳定三件套。", ""];
    appendQueryDetails(lines, query, catalog, warnings);
    return lines.join("\n");
  }

  const [best, ...alternatives] = topBuilds;
  const bestIsLowSample = isLowSampleBuild(best, query);
  const stabilityMinSamples = stableSampleThreshold(query);
  const ownedLine = query.ownedItems.length
    ? `已锁定：${query.ownedItems.map((apiName) => itemName(apiName, catalog)).join(" + ")}\n`
    : "";
  const title = bestIsLowSample
    ? (query.ownedItems.length ? "低样本补齐参考" : "低样本参考")
    : (query.ownedItems.length ? "推荐补齐" : "推荐");

  const lines = [
    `${ownedLine}${title}：${buildLine(best, catalog, query.ownedItems)}`,
    `前四 ${percent(best.stats.top4Rate)} / 吃鸡 ${percent(best.stats.winRate)} / 均名 ${best.stats.avgPlacement.toFixed(2)} / 样本 ${best.stats.games}`
  ];
  if (bestIsLowSample) {
    lines.push(`样本低于稳定展示门槛 ${stabilityMinSamples}，仅供参考，不作稳定推荐。`);
  }

  if (alternatives.length) {
    lines.push("", bestIsLowSample ? "其他参考：" : "备选：");
    alternatives.forEach((build, index) => {
      const sampleWarning = isLowSampleBuild(build, query) ? "（低样本）" : "";
      lines.push(`${index + 1}. ${buildLine(build, catalog, query.ownedItems)}，前四 ${percent(build.stats.top4Rate)}，吃鸡 ${percent(build.stats.winRate)}，样本 ${build.stats.games}${sampleWarning}`);
    });
  }

  lines.push("");
  appendQueryDetails(lines, query, catalog, warnings);

  return lines.join("\n");
}
