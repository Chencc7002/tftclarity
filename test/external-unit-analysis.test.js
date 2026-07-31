import test from "node:test";
import assert from "node:assert/strict";
import { aggregateExternalUnits } from "../src/index.js";

test("external unit aggregation excludes native trait members and weights real comp samples", () => {
  const results = aggregateExternalUnits([
    {
      traits: [{ apiName: "TFT17_SpaceGroove" }],
      units: [{ apiName: "TFT17_Native", name: "本家" }, { apiName: "TFT17_A", name: "外援甲" }],
      stats: { games: 600, avgPlacement: 3.5, top4Rate: 0.6, winRate: 0.2 }
    },
    {
      traits: [{ filterId: "TFT17_SpaceGroove_4" }],
      units: [{ apiName: "TFT17_A", name: "外援甲" }, { apiName: "TFT17_B", name: "外援乙" }],
      stats: { games: 400, avgPlacement: 4, top4Rate: 0.5, winRate: 0.1 }
    }
  ], {
    trait: "TFT17_SpaceGroove",
    traitMembers: ["TFT17_Native"],
    minSamples: 300,
    limit: 10
  });
  assert.deepEqual(results.map((entry) => entry.unit), ["TFT17_A", "TFT17_B"]);
  assert.equal(results[0].games, 1000);
  assert.equal(results[0].pickRateWithinTraitComps, 1);
  assert.equal(results[0].avgPlacement, 3.7);
});
