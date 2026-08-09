export const DIFFERENTIATING_ITEM_SELECTOR_VERSION = "differentiating-item-selector.v1";

function itemApiNames(option) {
  return (option?.items ?? []).map((item) => String(item?.apiName ?? item)).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

export function selectDifferentiatingItems(buildOptions = [], options = {}) {
  const limit = Math.max(1, Math.min(4, Number(options.limit ?? 4)));
  const [baseline, ...alternatives] = buildOptions;
  if (!baseline || alternatives.length === 0) {
    return {
      schemaVersion: DIFFERENTIATING_ITEM_SELECTOR_VERSION,
      strategy: "stable_relative_replacement_pairs",
      baselineOptionId: baseline?.optionId ?? null,
      apiNames: [],
      comparisons: [],
      truncated: false,
      warnings: []
    };
  }

  const baselineItems = itemApiNames(baseline);
  const comparisons = alternatives.map((alternative) => {
    const alternativeItems = itemApiNames(alternative);
    const baselineSet = new Set(baselineItems);
    const alternativeSet = new Set(alternativeItems);
    const removed = baselineItems.filter((apiName) => !alternativeSet.has(apiName));
    const added = alternativeItems.filter((apiName) => !baselineSet.has(apiName));
    const pairs = Array.from({ length: Math.max(removed.length, added.length) }, (_, index) => ({
      removedApiName: removed[index] ?? null,
      addedApiName: added[index] ?? null
    }));
    return {
      optionId: String(alternative.optionId),
      rank: Number(alternative.rank ?? 0),
      removedApiNames: removed,
      addedApiNames: added,
      pairs,
      selectedPairs: []
    };
  });

  const selected = [];
  const trySelectPair = (comparison, pair) => {
    const additions = unique([pair.removedApiName, pair.addedApiName].filter(Boolean))
      .filter((apiName) => !selected.includes(apiName));
    if (selected.length + additions.length > limit) return false;
    selected.push(...additions);
    comparison.selectedPairs.push({ ...pair });
    return true;
  };

  // Each alternative receives one complete replacement pair before remaining
  // differences are considered. This prevents rank 2 from consuming the full
  // mechanism budget and keeps the selection deterministic.
  comparisons.forEach((comparison) => {
    if (comparison.pairs[0]) trySelectPair(comparison, comparison.pairs[0]);
  });
  comparisons.forEach((comparison) => {
    comparison.pairs.slice(1).forEach((pair) => trySelectPair(comparison, pair));
  });

  const selectedPairCount = comparisons.reduce((total, entry) => total + entry.selectedPairs.length, 0);
  const totalPairCount = comparisons.reduce((total, entry) => total + entry.pairs.length, 0);
  const truncated = selectedPairCount < totalPairCount;
  return {
    schemaVersion: DIFFERENTIATING_ITEM_SELECTOR_VERSION,
    strategy: "stable_relative_replacement_pairs",
    baselineOptionId: String(baseline.optionId),
    apiNames: selected,
    comparisons: comparisons.map((entry) => ({
      optionId: entry.optionId,
      rank: entry.rank,
      removedApiNames: entry.removedApiNames,
      addedApiNames: entry.addedApiNames,
      selectedPairs: entry.selectedPairs
    })),
    truncated,
    warnings: truncated ? ["mechanism_evidence_truncated"] : []
  };
}

export function itemDetailsBatchMatchesPlan(apiNames, plan) {
  const requested = Array.isArray(apiNames) ? apiNames.map(String) : [];
  const expected = Array.isArray(plan?.apiNames) ? plan.apiNames.map(String) : [];
  return requested.length === expected.length
    && requested.every((apiName, index) => apiName === expected[index]);
}
