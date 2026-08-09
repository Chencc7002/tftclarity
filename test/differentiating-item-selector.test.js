import assert from "node:assert/strict";
import test from "node:test";
import {
  itemDetailsBatchMatchesPlan,
  selectDifferentiatingItems
} from "../src/domain/tft/differentiating-item-selector.js";

const option = (optionId, rank, items) => ({
  optionId,
  rank,
  items: items.map((apiName) => ({ apiName }))
});

test("differentiating item selector keeps one replacement pair per alternative within four items", () => {
  const plan = selectDifferentiatingItems([
    option("stable", 1, ["Shojin", "JG", "Archangel"]),
    option("alt-1", 2, ["Shojin", "Morello", "Archangel"]),
    option("alt-2", 3, ["BlueBuff", "JG", "Guardbreaker"])
  ]);

  assert.deepEqual(plan.apiNames, ["JG", "Morello", "Shojin", "BlueBuff"]);
  assert.deepEqual(plan.comparisons[0].selectedPairs, [{ removedApiName: "JG", addedApiName: "Morello" }]);
  assert.deepEqual(plan.comparisons[1].selectedPairs, [{ removedApiName: "Shojin", addedApiName: "BlueBuff" }]);
  assert.equal(plan.truncated, true);
  assert.deepEqual(plan.warnings, ["mechanism_evidence_truncated"]);
  assert.equal(itemDetailsBatchMatchesPlan(plan.apiNames, plan), true);
  assert.equal(itemDetailsBatchMatchesPlan(["JG", "Morello", "BlueBuff", "Shojin"], plan), false);
});
