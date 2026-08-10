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

test("performance score contains no direct sample-coverage bonus", () => {
  const ranked = rankBuilds([
    build("mainstream", 16_303, 0.59, 0.18, 3.96),
    build("higher-performance", 1_604, 0.62, 0.21, 3.78),
    build("third", 1_802, 0.58, 0.17, 4.02)
  ], { minSamples: 100, sort: "robust_first" });

  for (const entry of ranked) {
    assert.equal(entry.ranking.method, ROBUST_RANKING_VERSION);
    assert.equal(entry.ranking.score, entry.ranking.performanceScore);
    assert.equal(entry.ranking.performanceContribution, entry.ranking.performanceScore);
    assert.equal(entry.ranking.coverageContribution, 0);
  }
});

test("a dominant-sample viable build becomes the mainstream role while alternatives retain performance evidence", () => {
  const mainstream = build("mainstream", 16_303, 0.60, 0.18, 3.92);
  const higherPerformance = build("higher-performance", 1_604, 0.61, 0.20, 3.84);
  const third = build("third", 1_802, 0.59, 0.18, 3.96);
  const weak = build("weak", 700, 0.43, 0.07, 5.05);

  const ranked = rankBuilds([higherPerformance, mainstream, third, weak], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.equal(ranked[0].name, "mainstream");
  assert.equal(ranked[0].ranking.recommendationRole, "mainstream");
  assert.equal(ranked[0].ranking.generalRecommendation, true);
  assert.equal(ranked[0].ranking.applicabilityBasis, "sample_role_and_performance");
  assert.equal(ranked[1].name, "higher-performance");
  assert.ok(ranked[1].ranking.performanceScore > ranked[0].ranking.performanceScore);
  assert.ok(ranked[0].ranking.sampleLeadRatio > 9);
});

test("dynamic sample tiers are relative rather than tied to a 200-game cutoff", () => {
  const ranked = rankBuilds([
    build("large", 190, 0.60, 0.18, 3.9),
    build("middle", 60, 0.60, 0.18, 3.9),
    build("small", 12, 0.60, 0.18, 3.9)
  ], { minSamples: 1, sort: "robust_first" });

  const tiers = Object.fromEntries(ranked.map((entry) => [entry.name, entry.ranking.sampleTier]));
  assert.equal(tiers.large, "high");
  assert.equal(tiers.middle, "medium");
  assert.equal(tiers.small, "low");
});

test("sample tiers use the leading candidate ratio instead of clustering distant samples together", () => {
  const ranked = rankBuilds([
    build("mainstream", 73_060, 0.60, 0.18, 3.9),
    build("narrow", 3_155, 0.64, 0.22, 3.7),
    build("tiny", 800, 0.62, 0.20, 3.8)
  ], { minSamples: 100, sort: "robust_first" });

  const byName = Object.fromEntries(ranked.map((entry) => [entry.name, entry]));
  assert.equal(byName.mainstream.ranking.sampleTier, "high");
  assert.equal(byName.mainstream.ranking.sampleRatio, 1);
  assert.equal(byName.narrow.ranking.sampleTier, "low");
  assert.ok(byName.narrow.ranking.sampleRatio < 0.05);
  assert.equal(byName.tiny.ranking.sampleTier, "low");
});

test("a broadly underperforming build cannot become mainstream from sample volume", () => {
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

test("explicit top-four sorting remains available without the performance-role model", () => {
  const narrow = build("narrow", 627, 0.931, 0.257, 2.46);
  const broad = build("broad", 18_672, 0.906, 0.203, 2.62);

  const ranked = rankBuilds([narrow, broad], {
    minSamples: 100,
    sort: "top4_first"
  });

  assert.equal(ranked[0].name, "narrow");
  assert.equal(ranked[0].ranking, undefined);
});
