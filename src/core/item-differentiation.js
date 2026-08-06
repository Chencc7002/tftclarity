export const ITEM_DIFFERENTIATION_ALGORITHM_VERSION = "item-differentiation.v1";

export const ITEM_DIFFERENTIATION_MINIMUMS = Object.freeze({
  avgPlacement: 0.10,
  top4Rate: 0.02,
  winRate: 0.02
});

const METRIC_ALIASES = Object.freeze({
  avg: "avgPlacement",
  averagePlacement: "avgPlacement",
  avgPlacement: "avgPlacement",
  avg_first: "avgPlacement",
  robust_first: "avgPlacement",
  games_first: "avgPlacement",
  top4: "top4Rate",
  top4Rate: "top4Rate",
  top4_first: "top4Rate",
  win: "winRate",
  winRate: "winRate",
  win_first: "winRate"
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function apiName(value) {
  return String(value?.apiName ?? value ?? "").trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metricName(value) {
  return METRIC_ALIASES[String(value ?? "")] ?? "avgPlacement";
}

function multiset(values) {
  const counts = new Map();
  const records = new Map();
  for (const value of array(values)) {
    const id = apiName(value);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!records.has(id)) {
      records.set(id, typeof value === "object" ? value : { apiName: id, name: id });
    }
  }
  return { counts, records };
}

export function subtractLockedItems(items, lockedItems = []) {
  const remaining = array(items).slice();
  for (const locked of array(lockedItems)) {
    const id = apiName(locked);
    const index = remaining.findIndex((item) => apiName(item) === id);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

function singleSlotDifference(leftItems, rightItems) {
  if (leftItems.length !== rightItems.length) return null;
  const left = multiset(leftItems);
  const right = multiset(rightItems);
  const leftOnly = [];
  const rightOnly = [];
  const ids = new Set([...left.counts.keys(), ...right.counts.keys()]);
  for (const id of ids) {
    const difference = (left.counts.get(id) ?? 0) - (right.counts.get(id) ?? 0);
    for (let index = 0; index < Math.max(0, difference); index += 1) {
      leftOnly.push(left.records.get(id));
    }
    for (let index = 0; index < Math.max(0, -difference); index += 1) {
      rightOnly.push(right.records.get(id));
    }
  }
  return leftOnly.length === 1 && rightOnly.length === 1
    ? { leftItem: leftOnly[0], rightItem: rightOnly[0] }
    : null;
}

function gain(metric, itemBuild, otherBuild) {
  const itemValue = finite(itemBuild?.stats?.[metric]);
  const otherValue = finite(otherBuild?.stats?.[metric]);
  if (itemValue === null || otherValue === null) return null;
  return metric === "avgPlacement"
    ? otherValue - itemValue
    : itemValue - otherValue;
}

function weightedMean(comparisons) {
  const totalWeight = comparisons.reduce((total, entry) => total + entry.weight, 0);
  if (totalWeight <= 0) return null;
  return comparisons.reduce((total, entry) => total + (entry.gain * entry.weight), 0) / totalWeight;
}

function buildPair(left, right, difference, metric, index) {
  const leftGain = gain(metric, left, right);
  const rightGain = gain(metric, right, left);
  const weight = Math.min(
    Math.max(0, finite(left?.stats?.games) ?? 0),
    Math.max(0, finite(right?.stats?.games) ?? 0)
  );
  if (leftGain === null || rightGain === null || weight <= 0) return null;
  return {
    evidenceId: `build-pair:${index}`,
    kind: "build_single_slot_comparison",
    metric,
    leftBuildEvidenceId: left.evidenceId,
    rightBuildEvidenceId: right.evidenceId,
    leftItem: difference.leftItem,
    rightItem: difference.rightItem,
    leftGain: Number(leftGain.toFixed(4)),
    rightGain: Number(rightGain.toFixed(4)),
    weight,
    stable: left.stable === true && right.stable === true
  };
}

export function analyzeItemDifferentiation({
  recommendations = [],
  lockedItems = [],
  primaryMetric = "avgPlacement"
} = {}) {
  const metric = metricName(primaryMetric);
  const minimumDifference = ITEM_DIFFERENTIATION_MINIMUMS[metric];
  const visibleBuilds = array(recommendations).slice(0, 3).map((build) => ({
    ...build,
    remainingItems: subtractLockedItems(build?.items, lockedItems)
  }));
  const pairSignals = [];
  for (let leftIndex = 0; leftIndex < visibleBuilds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < visibleBuilds.length; rightIndex += 1) {
      const left = visibleBuilds[leftIndex];
      const right = visibleBuilds[rightIndex];
      const difference = singleSlotDifference(left.remainingItems, right.remainingItems);
      if (!difference) continue;
      const pair = buildPair(left, right, difference, metric, pairSignals.length + 1);
      if (pair) pairSignals.push(pair);
    }
  }

  const lockedIds = new Set(array(lockedItems).map(apiName).filter(Boolean));
  const byItem = new Map();
  const addComparison = (item, pair, itemGain) => {
    const id = apiName(item);
    if (!id || lockedIds.has(id)) return;
    const signal = byItem.get(id) ?? { item, comparisons: [] };
    signal.comparisons.push({
      pairEvidenceId: pair.evidenceId,
      gain: itemGain,
      weight: pair.weight,
      stable: pair.stable
    });
    byItem.set(id, signal);
  };
  for (const pair of pairSignals) {
    addComparison(pair.leftItem, pair, pair.leftGain);
    addComparison(pair.rightItem, pair, pair.rightGain);
  }

  const itemSignals = [...byItem.values()].map((signal) => {
    const score = weightedMean(signal.comparisons);
    const stable = signal.comparisons.length > 0 && signal.comparisons.every((entry) => entry.stable);
    return {
      kind: "item_differentiation_signal",
      item: signal.item,
      metric,
      score: score === null ? null : Number(score.toFixed(4)),
      comparisonCount: signal.comparisons.length,
      stable,
      lowSample: !stable,
      minimumDifference,
      keyDifferentiator: false,
      pairEvidenceIds: signal.comparisons.map((entry) => entry.pairEvidenceId)
    };
  }).sort((left, right) => (
    Number(right.score ?? Number.NEGATIVE_INFINITY) - Number(left.score ?? Number.NEGATIVE_INFINITY)
      || right.comparisonCount - left.comparisonCount
      || apiName(left.item).localeCompare(apiName(right.item))
  ));

  const rankedStableCandidates = itemSignals.filter((signal) => (
    signal.comparisonCount >= 2
      && signal.stable
      && Number(signal.score) > 0
  ));
  const leader = Number(rankedStableCandidates[0]?.score) >= minimumDifference
    ? rankedStableCandidates[0]
    : null;
  const runnerUp = leader ? rankedStableCandidates[1] ?? null : null;
  const hasClearLeader = Boolean(
    leader
      && (!runnerUp || Number(leader.score) - Number(runnerUp.score) >= minimumDifference)
  );
  if (hasClearLeader) leader.keyDifferentiator = true;

  itemSignals.forEach((signal, index) => {
    signal.evidenceId = `item-differentiator:${index + 1}`;
  });

  return {
    algorithmVersion: ITEM_DIFFERENTIATION_ALGORITHM_VERSION,
    metric,
    minimumDifference,
    hasClearLeader,
    keyDifferentiatorEvidenceId: hasClearLeader ? leader.evidenceId : null,
    pairSignals,
    itemSignals
  };
}
