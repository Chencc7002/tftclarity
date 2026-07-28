import test from "node:test";
import assert from "node:assert/strict";

import {
  ROBUST_RANKING_VERSION,
  rankBuilds
} from "../src/core/ranker.js";

function build(name, games, top4Rate, winRate, avgPlacement) {
  return {
    name,
    items: [`item:${name}`],
    stats: { games, top4Rate, winRate, avgPlacement }
  };
}

test("robust applicability ranking prefers dramatically broader coverage when performance is close", () => {
  const narrow = build("narrow", 627, 0.931, 0.257, 2.46);
  const broad = build("broad", 18_672, 0.906, 0.203, 2.62);
  const third = build("third", 693, 0.885, 0.205, 2.72);

  const ranked = rankBuilds([narrow, broad, third], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.equal(ranked[0].name, "broad");
  assert.equal(ranked[0].ranking.method, ROBUST_RANKING_VERSION);
  assert.equal(ranked[0].ranking.coverageScore, 1);
  assert.ok(ranked[0].ranking.score > ranked[1].ranking.score);
});

test("robust applicability ranking continuously rewards a viable high-sample leader", () => {
  const exceptional = build("exceptional", 627, 0.98, 0.40, 1.80);
  const broad = build("broad", 18_672, 0.906, 0.203, 2.62);

  const ranked = rankBuilds([exceptional, broad], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.equal(ranked[0].name, "broad");
  assert.equal(ranked[0].ranking.generalRecommendation, true);
  assert.ok(ranked[0].ranking.sampleLeadRatio > 4);
  assert.equal(ranked[1].name, "exceptional");
});

test("screenshot scenario promotes the 38k-sample build while retaining stronger-stat candidates", () => {
  const highPerformance = build("light-whisper", 4_641, 0.661, 0.273, 3.51);
  const broad = build("double-kraken", 38_223, 0.599, 0.191, 3.91);
  const third = build("giant-slayer", 3_996, 0.612, 0.195, 3.86);

  const ranked = rankBuilds([highPerformance, broad, third], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.deepEqual(ranked.map((entry) => entry.name), ["double-kraken", "light-whisper", "giant-slayer"]);
  assert.equal(ranked[0].ranking.generalRecommendation, true);
  assert.ok(ranked[0].ranking.sampleLeadRatio > 8);
  assert.equal(ranked[1].stats.top4Rate > ranked[0].stats.top4Rate, true);
});

test("plane screenshot promotes the 14k-sample build without a hard sample-ratio threshold", () => {
  const first = build("double-deathblade", 5_165, 0.567, 0.084, 4.23);
  const second = build("giant-slayer", 4_598, 0.55, 0.087, 4.25);
  const broad = build("sunderer", 14_717, 0.531, 0.076, 4.36);

  const ranked = rankBuilds([first, second, broad], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.deepEqual(ranked.map((entry) => entry.name), ["sunderer", "double-deathblade", "giant-slayer"]);
  assert.equal(ranked[0].ranking.generalRecommendation, true);
  assert.ok(ranked[0].ranking.sampleLeadRatio > 2.8);
  assert.equal(ranked[0].ranking.applicabilityBasis, "coverage_adjusted_score");
});

test("nami screenshot promotes the 65k-sample build while preserving performance evidence", () => {
  const highPerformance = build("morello-shojin-statikk", 2_103, 0.762, 0.242, 3.17);
  const second = build("morello-cap-shojin", 1_249, 0.749, 0.228, 3.19);
  const broad = build("jg-double-nashor", 65_514, 0.653, 0.176, 3.71);

  const ranked = rankBuilds([highPerformance, second, broad], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.deepEqual(ranked.map((entry) => entry.name), ["jg-double-nashor", "morello-shojin-statikk", "morello-cap-shojin"]);
  assert.equal(ranked[0].ranking.generalRecommendation, true);
  assert.ok(ranked[0].ranking.sampleLeadRatio > 30);
  assert.ok(ranked[1].ranking.performanceScore > ranked[0].ranking.performanceScore);
});

test("sample confidence does not promote a broadly underperforming build", () => {
  const weakBroad = build("weak-broad", 40_000, 0.42, 0.08, 5.10);
  const viable = build("viable", 4_000, 0.61, 0.18, 3.90);

  const ranked = rankBuilds([weakBroad, viable], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.equal(ranked[0].name, "viable");
  assert.equal(ranked.find((entry) => entry.name === "weak-broad").ranking.generalRecommendation, false);
  assert.equal(ranked.find((entry) => entry.name === "weak-broad").ranking.coverageEligible, false);
});

test("explicit top-four sorting remains available without the applicability model", () => {
  const narrow = build("narrow", 627, 0.931, 0.257, 2.46);
  const broad = build("broad", 18_672, 0.906, 0.203, 2.62);

  const ranked = rankBuilds([narrow, broad], {
    minSamples: 100,
    sort: "top4_first"
  });

  assert.equal(ranked[0].name, "narrow");
  assert.equal(ranked[0].ranking, undefined);
});
