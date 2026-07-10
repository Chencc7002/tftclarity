function listFromApiValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(/[&,]\s*|\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function clusterIdOf(value) {
  return String(value?.cluster ?? value?.Cluster ?? value?.cluster_id ?? value?.clusterId ?? "");
}

function sortedValues(values) {
  return [...new Set((values ?? []).map(String).filter(Boolean))].sort();
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readTop4Rate(option = {}) {
  const raw = option.top4Rate
    ?? option.top4_rate
    ?? option.top_four_rate
    ?? option.top4
    ?? option.top_four
    ?? option.top4_percent;
  const value = finiteNumber(raw);
  if (value == null) return null;
  return value > 1 ? value / 100 : value;
}

function readBuildItems(row = {}) {
  if (Array.isArray(row.buildName)) return row.buildName.map(String).filter(Boolean);
  if (Array.isArray(row.build_name)) return row.build_name.map(String).filter(Boolean);
  if (Array.isArray(row.items)) return row.items.map(String).filter(Boolean);
  if (Array.isArray(row.build) && row.build.length) return row.build.map(String).filter(Boolean);

  const raw = row.unit_buildNames
    ?? row.unit_builds
    ?? row.unit_build
    ?? row.buildName
    ?? row.items
    ?? "";
  const itemPart = String(raw).includes("&")
    ? String(raw).split("&").slice(1).join("&")
    : String(raw);
  return itemPart
    .split(/[|&,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBuildUnit(row = {}) {
  if (row.unit) return String(row.unit);
  const raw = row.unit_buildNames ?? row.unit_builds ?? row.unit_build;
  if (!raw) return "";
  return String(raw).split("&")[0] ?? "";
}

function summarizeCompBuildRow(row = {}) {
  const items = readBuildItems(row);
  return {
    clusterId: clusterIdOf(row),
    unit: readBuildUnit(row),
    items,
    count: finiteNumber(row.count, 0),
    avg: finiteNumber(row.avg ?? row.average, Number.POSITIVE_INFINITY),
    score: finiteNumber(row.adjusted_score ?? row.adjustedScore ?? row.score, 0),
    placeChange: finiteNumber(row.place_change ?? row.placeChange),
    unitNumItemsCount: finiteNumber(row.unit_numitems_count ?? row.unitNumItemsCount),
    numItems: finiteNumber(row.num_items ?? row.numItems, items.length),
    sourceEndpoint: "tft-comps-api/comp_builds"
  };
}

function compareCompBuildEvidence(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.count !== a.count) return b.count - a.count;
  return a.avg - b.avg;
}

function summarizeCompBuildEvidence(unitApiName, clusterId, compBuilds = [], limit = 3) {
  return compBuilds
    .map(summarizeCompBuildRow)
    .filter((row) => row.clusterId === String(clusterId))
    .filter((row) => row.unit === unitApiName)
    .filter((row) => row.items.length > 0)
    .sort(compareCompBuildEvidence)
    .slice(0, limit);
}

export function normalizeDefaultContextStrategy(value = "popular") {
  const strategy = String(value ?? "popular").trim().toLowerCase();
  if (["popular", "sample", "samples", "count", "sample_count"].includes(strategy)) return "popular";
  if (["score", "highest_score"].includes(strategy)) return "score";
  if (["avg", "average", "lowest_avg", "best_avg"].includes(strategy)) return "avg";
  if (["top4", "top4_rate", "top_four", "top_four_rate", "highest_top4"].includes(strategy)) return "top4";
  return "popular";
}

export function normalizeSpecialContextMode(value = "exclude") {
  const mode = String(value ?? "exclude").trim().toLowerCase();
  if (["prefer", "special", "only_special"].includes(mode)) return "prefer";
  if (["include", "allow", "all"].includes(mode)) return "include";
  return "exclude";
}

function specialContextTraits(traits = []) {
  return traits.filter((trait) => /(?:UniqueTrait|Augment)(?:_|$)/i.test(String(trait)));
}

function compareDefaultContextCandidates(strategy, a, b) {
  if (strategy === "top4") {
    if (b.top4Rate !== a.top4Rate) return b.top4Rate - a.top4Rate;
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    return a.avg - b.avg;
  }

  if (strategy === "score") {
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    return a.avg - b.avg;
  }

  if (strategy === "avg") {
    if (a.avg !== b.avg) return a.avg - b.avg;
    if (b.count !== a.count) return b.count - a.count;
    return b.score - a.score;
  }

  if (b.count !== a.count) return b.count - a.count;
  if (b.score !== a.score) return b.score - a.score;
  return a.avg - b.avg;
}

function strategySourceDescription(strategy) {
  if (strategy === "top4") return "MetaTFT /comps，按含该英雄阵容的前四率、score、样本数和平均名次选择";
  if (strategy === "score") return "MetaTFT /comps，按含该英雄阵容的 score、样本数和平均名次选择";
  if (strategy === "avg") return "MetaTFT /comps，按含该英雄阵容的平均名次、样本数和 score 选择";
  return "MetaTFT /comps，按含该英雄阵容的样本数、score 和平均名次选择";
}

function summarizeCandidate(candidate = {}) {
  return {
    clusterId: candidate.clusterId,
    compName: candidate.compName,
    units: candidate.units,
    traits: candidate.traits,
    traitFilters: candidate.traits,
    sourceEndpoint: candidate.sourceEndpoint,
    count: candidate.count,
    score: candidate.score,
    avg: candidate.avg,
    top4Rate: candidate.top4Rate ?? null,
    specialContext: Boolean(candidate.specialContext),
    specialTraits: candidate.specialTraits ?? [],
    compBuilds: candidate.compBuilds ?? []
  };
}

function candidateLabel(candidate = {}) {
  return candidate.compName ?? (candidate.clusterId ? `cluster ${candidate.clusterId}` : "主流阵容");
}

function traitKey(candidate = {}) {
  return sortedValues(candidate.traits).join("|");
}

function traitOverlapRatio(a = {}, b = {}) {
  const left = new Set(sortedValues(a.traits));
  const right = new Set(sortedValues(b.traits));
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;

  let intersection = 0;
  for (const trait of left) {
    if (right.has(trait)) intersection += 1;
  }
  return intersection / union.size;
}

function relativeDifference(a, b, floor = 1) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), floor);
}

function candidatesAreClose(selected, alternative, strategy) {
  const countIsClose = alternative.count / Math.max(selected.count, 1) >= 0.8;
  if (strategy === "avg") {
    return Number.isFinite(selected.avg) && Number.isFinite(alternative.avg)
      ? Math.abs(selected.avg - alternative.avg) <= 0.25
      : countIsClose;
  }
  if (strategy === "top4" && selected.top4Rate > 0 && alternative.top4Rate > 0) {
    return Math.abs(selected.top4Rate - alternative.top4Rate) <= 0.03;
  }
  if (strategy === "score" || strategy === "top4") {
    return selected.score !== 0 || alternative.score !== 0
      ? relativeDifference(selected.score, alternative.score) <= 0.1
      : countIsClose;
  }
  return countIsClose;
}

function strategyLabel(strategy) {
  if (strategy === "top4") return "前四优先";
  if (strategy === "score") return "score 优先";
  if (strategy === "avg") return "均名优先";
  return "样本优先";
}

function buildAmbiguity(selected, alternatives, strategy) {
  const differentTraitAlternatives = alternatives
    .filter((candidate) => traitKey(candidate) !== traitKey(selected));
  if (!differentTraitAlternatives.length) return null;

  const significantAlternatives = differentTraitAlternatives
    .filter((candidate) => traitOverlapRatio(selected, candidate) <= 0.25)
    .filter((candidate) => candidatesAreClose(selected, candidate, strategy));

  const alternativeLabels = differentTraitAlternatives
    .slice(0, 2)
    .map(candidateLabel);
  return {
    reason: "different_trait_candidates",
    selected: candidateLabel(selected),
    alternatives: alternativeLabels,
    significant: significantAlternatives.length > 0,
    significantAlternativeClusterIds: significantAlternatives
      .slice(0, 2)
      .map((candidate) => candidate.clusterId),
    warning: significantAlternatives.length > 0
      ? `默认阵容存在指标接近但羁绊差异明显的候选：${[candidateLabel(selected), ...alternativeLabels].join(" / ")}；需要确认具体阵容。`
      : `默认阵容存在不同羁绊候选：${[candidateLabel(selected), ...alternativeLabels].join(" / ")}；已按${strategyLabel(strategy)}选择 ${candidateLabel(selected)}。`
  };
}

export function createDefaultContextCacheFingerprint(context = {}) {
  if (!context?.found) return null;
  return JSON.stringify({
    clusterId: String(context.clusterId ?? ""),
    units: sortedValues(context.units),
    traits: sortedValues(context.traits ?? context.traitFilters),
    sourceEndpoint: context.sourceEndpoint ?? null,
    strategy: context.strategy ?? null,
    specialContextMode: normalizeSpecialContextMode(context.specialContextMode)
  });
}

function createCompBuildEvidenceFingerprint(context = {}) {
  if (!context?.found) return null;

  const builds = (context.compBuilds ?? [])
    .map((build) => ({
      clusterId: String(build.clusterId ?? ""),
      unit: String(build.unit ?? ""),
      items: sortedValues(build.items),
      count: finiteNumber(build.count, 0),
      avg: finiteNumber(build.avg, null),
      score: finiteNumber(build.score, null),
      placeChange: finiteNumber(build.placeChange, null),
      unitNumItemsCount: finiteNumber(build.unitNumItemsCount, null),
      numItems: finiteNumber(build.numItems, null)
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return JSON.stringify(builds);
}

export function selectDefaultContextForUnit(unitApiName, data = {}, options = {}) {
  const minClusterSamples = options.minClusterSamples ?? 100;
  const strategy = normalizeDefaultContextStrategy(options.strategy);
  const specialContextMode = normalizeSpecialContextMode(
    options.specialContextMode ?? (options.allowSpecialContexts ? "include" : "exclude")
  );
  const candidateLimit = Number.isInteger(options.candidateLimit) && options.candidateLimit > 0
    ? options.candidateLimit
    : 3;
  const clusterInfo = data.clusterInfo ?? data.latestClusterInfo ?? [];
  const compOptions = data.compOptions ?? [];
  const compBuilds = data.compBuilds ?? [];
  const infoByCluster = new Map(clusterInfo.map((info) => [clusterIdOf(info), info]));

  const allCandidates = compOptions
    .map((option) => {
      const units = listFromApiValue(option.units_list ?? option.units ?? option.units_string);
      const traits = listFromApiValue(option.traits_list ?? option.traits ?? option.traits_string);
      const specialTraits = specialContextTraits(traits);
      const count = Number(option.count ?? option.games ?? 0);
      const score = Number(option.score ?? 0);
      const avg = Number(option.avg ?? option.average ?? Number.POSITIVE_INFINITY);
      const top4Rate = readTop4Rate(option) ?? 0;
      const clusterId = clusterIdOf(option);
      const info = infoByCluster.get(clusterId);

      return {
        clusterId,
        compName: option.comp_name ?? option.name_string ?? info?.name_string ?? null,
        units,
        traits,
        count,
        score,
        avg,
        top4Rate,
        specialContext: specialTraits.length > 0,
        specialTraits,
        sourceEndpoint: "tft-comps-api/comp_options"
      };
    })
    .filter((candidate) => candidate.units.includes(unitApiName))
    .filter((candidate) => candidate.count >= minClusterSamples);

  allCandidates.sort((a, b) => compareDefaultContextCandidates(strategy, a, b));

  const specialCandidates = allCandidates.filter((candidate) => candidate.specialContext);
  const ordinaryCandidates = allCandidates.filter((candidate) => !candidate.specialContext);
  let candidates = allCandidates;
  let specialContextFallback = false;

  if (specialContextMode === "prefer" && specialCandidates.length) {
    candidates = specialCandidates;
  } else if (specialContextMode === "exclude" && ordinaryCandidates.length) {
    candidates = ordinaryCandidates;
  } else if (specialContextMode === "exclude" && specialCandidates.length) {
    specialContextFallback = true;
  }

  const selected = candidates[0];
  if (!selected) {
    return {
      found: false,
      traitFilters: [],
      warning: "未找到稳定主流阵容，未补羁绊"
    };
  }

  const context = {
    found: true,
    clusterId: selected.clusterId,
    compName: selected.compName,
    units: selected.units,
    traits: selected.traits,
    traitFilters: selected.traits,
    sourceEndpoint: selected.sourceEndpoint,
    strategy,
    specialContextMode,
    specialContext: selected.specialContext,
    specialTraits: selected.specialTraits,
    specialCandidateCount: specialCandidates.length,
    excludedSpecialCandidateCount: specialContextMode === "exclude" && ordinaryCandidates.length
      ? specialCandidates.length
      : 0,
    specialContextFallback,
    count: selected.count,
    score: selected.score,
    avg: selected.avg,
    top4Rate: selected.top4Rate ?? null,
    compBuilds: summarizeCompBuildEvidence(unitApiName, selected.clusterId, compBuilds, options.compBuildLimit ?? 3),
    candidates: candidates.slice(0, candidateLimit).map(summarizeCandidate),
    alternatives: candidates
      .filter((candidate) => candidate.clusterId !== selected.clusterId)
      .slice(0, Math.max(0, candidateLimit - 1))
      .map(summarizeCandidate),
    sourceDescription: strategySourceDescription(strategy)
  };
  const warnings = [];
  if (context.excludedSpecialCandidateCount > 0) {
    warnings.push(`\u5df2\u6392\u9664 ${context.excludedSpecialCandidateCount} \u4e2a\u5e26\u660e\u786e\u4e13\u5c5e\u73a9\u6cd5\u6807\u8bb0\u7684\u5019\u9009\u9635\u5bb9\u3002`);
  }
  if (specialContextFallback) {
    warnings.push("\u53ea\u627e\u5230\u5e26\u660e\u786e\u4e13\u5c5e\u73a9\u6cd5\u6807\u8bb0\u7684\u9635\u5bb9\uff0c\u5df2\u4f5c\u4e3a\u9ed8\u8ba4\u4e0a\u4e0b\u6587\u4f7f\u7528\u3002");
  }
  const ambiguity = buildAmbiguity(selected, candidates.filter((candidate) => candidate.clusterId !== selected.clusterId), strategy);
  if (ambiguity) {
    context.ambiguity = ambiguity;
    warnings.push(ambiguity.warning);
  }
  if (warnings.length) context.warning = warnings.join("\uff1b");
  context.cacheFingerprint = createDefaultContextCacheFingerprint(context);
  return context;
}

export function validateDefaultContextCache(cachedContext, unitApiName, data = {}, options = {}) {
  const currentContext = selectDefaultContextForUnit(unitApiName, data, options);
  if (!cachedContext?.found) {
    return {
      valid: false,
      currentContext,
      reason: "cached_context_missing"
    };
  }
  if (!currentContext?.found) {
    return {
      valid: false,
      currentContext,
      reason: "current_context_missing"
    };
  }

  const cachedFingerprint = cachedContext.cacheFingerprint
    ?? createDefaultContextCacheFingerprint(cachedContext);
  const currentFingerprint = currentContext.cacheFingerprint
    ?? createDefaultContextCacheFingerprint(currentContext);
  const clusterMatches = cachedFingerprint === currentFingerprint;
  const compareCompBuildEvidence = options.useCompBuilds !== false
    && (options.compBuildsProvided ?? Object.hasOwn(data, "compBuilds"));
  const cachedCompBuildsFingerprint = createCompBuildEvidenceFingerprint(cachedContext);
  const currentCompBuildsFingerprint = createCompBuildEvidenceFingerprint(currentContext);
  const compBuildEvidenceMatches = !compareCompBuildEvidence
    || cachedCompBuildsFingerprint === currentCompBuildsFingerprint;

  return {
    valid: clusterMatches && compBuildEvidenceMatches,
    currentContext,
    reason: !clusterMatches
      ? "cluster_changed"
      : compBuildEvidenceMatches
        ? null
        : "comp_builds_changed"
  };
}
