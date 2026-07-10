import { calculatePlacementStats } from "./stats-calculator.js";
import { compareRankedBuilds, rankBuilds, stableSampleThreshold } from "./ranker.js";

function placementCountForBuild(build) {
  const values = build.raw?.placement_count ?? build.raw?.placementCount ?? [];
  return Array.from({ length: 8 }, (_, index) => Number(values[index]) || 0);
}

function aggregatePlacementCounts(builds) {
  const totals = Array(8).fill(0);
  for (const build of builds) {
    const counts = placementCountForBuild(build);
    for (let index = 0; index < totals.length; index += 1) {
      totals[index] += counts[index];
    }
  }
  return totals;
}

function optionBuilds(builds, option, comparisonOptions) {
  const otherOptions = new Set(comparisonOptions.filter((candidate) => candidate !== option));
  const inclusive = builds.filter((build) => build.items.includes(option));
  const exclusive = inclusive.filter((build) => (
    build.items.every((item) => !otherOptions.has(item))
  ));
  return {
    builds: exclusive.length > 0 ? exclusive : inclusive,
    isolation: exclusive.length > 0 ? "exclusive" : "inclusive_fallback"
  };
}

function itemLabel(apiName, catalog) {
  const item = catalog?.itemByApiName?.get(apiName);
  return item?.shortName ?? item?.zhName ?? apiName;
}

export function compareItemOptions(builds, query, config = {}) {
  const comparisonOptions = [...new Set(query.comparison?.itemApiNames ?? [])];
  if (!query.comparison?.requested || comparisonOptions.length < 2) return null;

  const minSamples = query.minSamples ?? 100;
  const stabilityMinSamples = stableSampleThreshold(query);
  const warnings = [];
  const entries = comparisonOptions.map((apiName) => {
    const selected = optionBuilds(builds, apiName, comparisonOptions);
    if (selected.isolation === "inclusive_fallback" && selected.builds.length > 0) {
      warnings.push(`${itemLabel(apiName, config.catalog)} 没有排除其他对比项后的独立组合，已使用包含该装备的全部组合`);
    }
    const placementCount = aggregatePlacementCounts(selected.builds);
    const stats = calculatePlacementStats(placementCount);
    const representativeBuild = rankBuilds([...selected.builds], {
      ...query,
      minSamples: 0
    })[0] ?? null;
    return {
      apiName,
      stats,
      placementCount,
      buildCount: selected.builds.length,
      isolation: selected.isolation,
      qualified: stats.games >= minSamples,
      stable: stats.games >= stabilityMinSamples,
      representativeBuild
    };
  });

  entries.sort((left, right) => {
    if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
    return compareRankedBuilds({ stats: left.stats }, { stats: right.stats }, query);
  });

  const allQualified = entries.length === comparisonOptions.length && entries.every((entry) => entry.qualified);
  const allStable = entries.length === comparisonOptions.length && entries.every((entry) => entry.stable);
  const winner = allQualified && allStable ? entries[0]?.apiName ?? null : null;
  if (!allQualified) {
    const insufficient = entries
      .filter((entry) => !entry.qualified)
      .map((entry) => `${itemLabel(entry.apiName, config.catalog)} 样本 ${entry.stats.games}`);
    warnings.push(`对比项未全部达到样本阈值 ${minSamples}：${insufficient.join(" / ")}`);
  } else if (!allStable) {
    const insufficient = entries
      .filter((entry) => !entry.stable)
      .map((entry) => `${itemLabel(entry.apiName, config.catalog)} 样本 ${entry.stats.games}`);
    warnings.push(`对比项样本低于稳定展示门槛 ${stabilityMinSamples}，不作胜出结论：${insufficient.join(" / ")}`);
  }

  return {
    requested: true,
    options: comparisonOptions,
    entries,
    winner,
    allQualified,
    allStable,
    sort: query.sort,
    minSamples,
    stabilityMinSamples,
    warnings
  };
}

export function comparisonRankedBuilds(comparison) {
  if (!comparison) return [];
  return comparison.entries
    .filter((entry) => entry.representativeBuild)
    .map((entry) => ({
      ...entry.representativeBuild,
      stats: entry.stats,
      comparisonOption: entry.apiName,
      comparisonQualified: entry.qualified,
      comparisonStable: entry.stable,
      comparisonIsolation: entry.isolation
    }));
}
