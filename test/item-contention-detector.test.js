import assert from "node:assert/strict";
import test from "node:test";
import { detectItemContention } from "../src/domain/tft/item-contention-detector.js";

function build(optionId, rank, items, samples) {
  return {
    optionId,
    rank,
    role: rank === 1 ? "stable" : "alternative",
    items: items.map((apiName) => ({ apiName, displayName: apiName })),
    metrics: { samples },
    evidencePath: `/buildOptions/${rank - 1}`
  };
}

test("detects cross-unit item intersections without assigning priority", () => {
  const plan = detectItemContention([
    {
      apiName: "Unit_A",
      name: "Alpha",
      available: true,
      buildOptions: [
        build("a-1", 1, ["Item_Shared", "Item_A"], 100),
        build("a-2", 2, ["Item_Second", "Item_A"], 60)
      ]
    },
    {
      apiName: "Unit_B",
      name: "Beta",
      available: true,
      buildOptions: [
        build("b-1", 1, ["Item_Shared", "Item_B"], 90),
        build("b-2", 2, ["Item_Second", "Item_B"], 40)
      ]
    },
    {
      apiName: "Unit_C",
      name: "Gamma",
      available: true,
      buildOptions: [build("c-1", 1, ["Item_Shared", "Item_C"], 80)]
    }
  ], { compositionId: "cluster:dynamic" });
  assert.equal(plan.status, "available");
  assert.equal(plan.contentionStatus, "available");
  assert.equal(plan.coverageStatus, "complete");
  assert.equal(plan.priorityConclusion, "not_evaluated");
  assert.deepEqual(plan.apiNames, ["Item_Shared", "Item_Second"]);
  assert.equal(plan.contestedItems[0].participantCount, 3);
  assert.deepEqual(
    plan.contestedItems[0].participants.map((entry) => entry.unitRef.apiName),
    ["Unit_A", "Unit_B", "Unit_C"]
  );
});

test("returns no_contention instead of inventing a contested item", () => {
  const plan = detectItemContention([
    { apiName: "Unit_A", available: true, buildOptions: [build("a", 1, ["Item_A"], 10)] },
    { apiName: "Unit_B", available: true, buildOptions: [build("b", 1, ["Item_B"], 20)] }
  ]);
  assert.equal(plan.status, "no_contention");
  assert.equal(plan.coverageStatus, "complete");
  assert.deepEqual(plan.contestedItems, []);
  assert.deepEqual(plan.apiNames, []);
});

test("requires build evidence from at least two different units", () => {
  const plan = detectItemContention([
    { apiName: "Unit_A", available: true, buildOptions: [build("a", 1, ["Item_A"], 10)] },
    { apiName: "Unit_B", name: "Beta", available: false, buildOptions: [], warning: "request timeout" }
  ]);
  assert.equal(plan.status, "insufficient_build_data");
  assert.equal(plan.coverageStatus, "partial");
  assert.equal(plan.eligibleUnitCount, 2);
  assert.equal(plan.successfulUnitCount, 1);
  assert.equal(plan.failedUnitCount, 1);
  assert.deepEqual(plan.failedUnits[0], {
    unit: { apiName: "Unit_B", name: "Beta" },
    reason: "timeout",
    detail: "request timeout"
  });
});

test("marks no-contention over a successful subset as partial coverage", () => {
  const plan = detectItemContention([
    { apiName: "Unit_A", available: true, buildOptions: [build("a", 1, ["Item_A"], 10)] },
    { apiName: "Unit_B", available: true, buildOptions: [build("b", 1, ["Item_B"], 20)] },
    { apiName: "Unit_C", available: false, buildOptions: [], shortageReason: "not_found" }
  ]);
  assert.equal(plan.status, "no_contention");
  assert.equal(plan.coverageStatus, "partial");
  assert.deepEqual(plan.successfulUnits.map((entry) => entry.apiName), ["Unit_A", "Unit_B"]);
  assert.deepEqual(plan.failedUnits.map((entry) => entry.unit.apiName), ["Unit_C"]);
  assert.ok(plan.warnings.includes("partial_coverage"));
});
