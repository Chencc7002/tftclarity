import test from "node:test";
import assert from "node:assert/strict";

import {
  ITEM_DIFFERENTIATION_ALGORITHM_VERSION,
  analyzeItemDifferentiation,
  subtractLockedItems
} from "../src/core/item-differentiation.js";

const item = (apiName, name = apiName) => ({ apiName, name });
const dawn = item("TFT_Item_Artifact_Dawncore", "黎明核心");
const rageblade = item("rageblade", "羊刀");
const deathblade = item("deathblade", "杀人剑");
const infinityEdge = item("infinity-edge", "无尽");

function build(evidenceId, items, avgPlacement, games = 100, extraStats = {}) {
  return {
    evidenceId,
    items,
    stats: { avgPlacement, games, top4Rate: 0.5, winRate: 0.1, ...extraStats },
    stable: true,
    lowSample: false
  };
}

test("Dawncore completion example identifies Rageblade as the stable largest differentiator", () => {
  const result = analyzeItemDifferentiation({
    lockedItems: [dawn],
    recommendations: [
      build("build:1", [dawn, rageblade, infinityEdge], 2.97),
      build("build:2", [dawn, deathblade, rageblade], 2.13),
      build("build:3", [dawn, deathblade, infinityEdge], 3.58)
    ]
  });

  assert.equal(result.algorithmVersion, ITEM_DIFFERENTIATION_ALGORITHM_VERSION);
  assert.equal(result.pairSignals.length, 3);
  assert.equal(result.hasClearLeader, true);
  const signal = result.itemSignals.find((entry) => entry.item.apiName === rageblade.apiName);
  assert.equal(signal.comparisonCount, 2);
  assert.equal(signal.score, 1.03);
  assert.equal(signal.keyDifferentiator, true);
  assert.equal(result.itemSignals.some((entry) => entry.item.apiName === dawn.apiName), false);
});

test("average placement is lower-is-better while top-four and win rates are higher-is-better", () => {
  const placement = analyzeItemDifferentiation({
    recommendations: [
      build("build:1", [rageblade], 2.5),
      build("build:2", [deathblade], 3.5)
    ]
  });
  const top4 = analyzeItemDifferentiation({
    primaryMetric: "top4Rate",
    recommendations: [
      build("build:1", [rageblade], 4, 100, { top4Rate: 0.7 }),
      build("build:2", [deathblade], 4, 100, { top4Rate: 0.4 })
    ]
  });
  const win = analyzeItemDifferentiation({
    primaryMetric: "winRate",
    recommendations: [
      build("build:1", [rageblade], 4, 100, { winRate: 0.25 }),
      build("build:2", [deathblade], 4, 100, { winRate: 0.1 })
    ]
  });

  assert.equal(placement.itemSignals.find((entry) => entry.item.apiName === rageblade.apiName).score, 1);
  assert.equal(top4.itemSignals.find((entry) => entry.item.apiName === rageblade.apiName).score, 0.3);
  assert.equal(win.itemSignals.find((entry) => entry.item.apiName === rageblade.apiName).score, 0.15);
});

test("sort names resolve to their supported differentiation metrics", () => {
  const recommendations = [
    build("build:1", [dawn, rageblade, infinityEdge], 3.0, 100, { top4Rate: 0.60, winRate: 0.20 }),
    build("build:2", [dawn, deathblade, rageblade], 2.5, 100, { top4Rate: 0.70, winRate: 0.30 }),
    build("build:3", [dawn, deathblade, infinityEdge], 3.5, 100, { top4Rate: 0.50, winRate: 0.10 })
  ];
  const analyze = (primaryMetric) => analyzeItemDifferentiation({
    recommendations,
    lockedItems: [dawn],
    primaryMetric
  }).metric;

  assert.equal(analyze("top4_first"), "top4Rate");
  assert.equal(analyze("win_first"), "winRate");
  assert.equal(analyze("robust_first"), "avgPlacement");
});

test("pair weighting uses the smaller build sample and one comparison never creates a unique priority", () => {
  const result = analyzeItemDifferentiation({
    lockedItems: [dawn],
    recommendations: [
      build("build:1", [dawn, rageblade], 2, 10),
      build("build:2", [dawn, deathblade], 4, 100)
    ]
  });

  assert.equal(result.pairSignals[0].weight, 10);
  assert.equal(result.itemSignals[0].comparisonCount, 1);
  assert.equal(result.itemSignals[0].keyDifferentiator, false);
  assert.equal(result.hasClearLeader, false);
});

test("low-sample pairs and near-tied scores do not create a stable unique priority", () => {
  const lowSampleBuilds = [
    build("build:1", [dawn, rageblade, infinityEdge], 2.9),
    build("build:2", [dawn, deathblade, rageblade], 2.1),
    build("build:3", [dawn, deathblade, infinityEdge], 3.5)
  ];
  lowSampleBuilds[0].stable = false;
  lowSampleBuilds[0].lowSample = true;
  const lowSample = analyzeItemDifferentiation({
    lockedItems: [dawn],
    recommendations: lowSampleBuilds
  });
  assert.equal(lowSample.hasClearLeader, false);

  const tied = analyzeItemDifferentiation({
    lockedItems: [dawn],
    recommendations: [
      build("build:1", [dawn, rageblade, infinityEdge], 3.5),
      build("build:2", [dawn, deathblade, rageblade], 2),
      build("build:3", [dawn, deathblade, infinityEdge], 3.5)
    ]
  });
  assert.equal(tied.hasClearLeader, false);
});

test("locked multiset subtraction removes only the user-specified copies", () => {
  assert.deepEqual(
    subtractLockedItems([dawn, dawn, rageblade], [dawn]).map((entry) => entry.apiName),
    [dawn.apiName, rageblade.apiName]
  );
  assert.deepEqual(
    subtractLockedItems([dawn, dawn, rageblade], [dawn, dawn]).map((entry) => entry.apiName),
    [rageblade.apiName]
  );
});
