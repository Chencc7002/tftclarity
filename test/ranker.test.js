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

test("robust applicability ranking still allows a materially stronger sufficient-sample build to win", () => {
  const exceptional = build("exceptional", 627, 0.98, 0.40, 1.80);
  const broad = build("broad", 18_672, 0.906, 0.203, 2.62);

  const ranked = rankBuilds([exceptional, broad], {
    minSamples: 100,
    sort: "robust_first"
  });

  assert.equal(ranked[0].name, "exceptional");
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
