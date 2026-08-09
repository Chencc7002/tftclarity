import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCompositionChange,
  evaluateCompositionReplacement
} from "../src/domain/tft/composition-replacement-evaluator.js";

function unit(apiName, name, traits, extra = {}) {
  return { apiName, name, traitNames: traits, ...extra };
}

function trait(apiName, name, thresholds) {
  return { apiName, name, tierCounts: thresholds };
}

const details = {
  meta: { updatedAt: "2026-08-07T00:00:00.000Z" },
  units: new Map([
    ["Unit_A", unit("Unit_A", "Alpha", ["Flame", "Guard"])],
    ["Unit_B", unit("Unit_B", "Beta", ["Flame"])],
    ["Unit_C", unit("Unit_C", "Gamma", ["Guard"])],
    ["Unit_D", unit("Unit_D", "Delta", ["Frost", "Guard"])]
  ]),
  traits: new Map([
    ["Trait_Flame", trait("Trait_Flame", "Flame", [2, 4])],
    ["Trait_Guard", trait("Trait_Guard", "Guard", [2, 4])],
    ["Trait_Frost", trait("Trait_Frost", "Frost", [2, 3])]
  ])
};

const composition = {
  compositionRef: { compId: "cluster:dynamic", name: "Dynamic Comp", patch: "current" },
  members: ["Unit_A", "Unit_B", "Unit_C"].map((apiName) => ({ apiName })),
  source: { updatedAt: "2026-08-07T00:00:00.000Z" }
};

test("given replacement deterministically calculates trait and breakpoint deltas", () => {
  const result = evaluateCompositionReplacement({
    composition,
    targetApiName: "Unit_A",
    replacementApiName: "Unit_D",
    details
  });
  assert.equal(result.status, "evaluated");
  assert.equal(result.membershipValidation.targetIsMember, true);
  assert.equal(result.strengthConclusion, "not_evaluated");
  const flame = result.traitDeltas.find((delta) => delta.traitRef.apiName === "Trait_Flame");
  const frost = result.traitDeltas.find((delta) => delta.traitRef.apiName === "Trait_Frost");
  assert.deepEqual(
    { before: flame.beforeCount, after: flame.afterCount, change: flame.breakpointChange },
    { before: 2, after: 1, change: "deactivated" }
  );
  assert.deepEqual(
    { before: frost.beforeCount, after: frost.afterCount, change: frost.breakpointChange },
    { before: 0, after: 1, change: "count_increased" }
  );
  assert.equal(result.traitDeltas.some((delta) => delta.traitRef.apiName === "Trait_Guard"), false);
  assert.equal(result.summary.deactivated, 1);
  assert.ok(result.warnings.includes("replacement_strength_not_evaluated"));
});

test("replacement evaluator rejects targets outside the resolved composition", () => {
  const result = evaluateCompositionReplacement({
    composition,
    targetApiName: "Unit_D",
    replacementApiName: "Unit_A",
    details
  });
  assert.equal(result.status, "invalid_target");
  assert.equal(result.failureReason, "target_not_member_of_composition");
  assert.deepEqual(result.traitDeltas, []);
});

test("replacement evaluator rejects duplicate members instead of inventing a new lineup", () => {
  const result = evaluateCompositionReplacement({
    composition,
    targetApiName: "Unit_A",
    replacementApiName: "Unit_B",
    details
  });
  assert.equal(result.status, "invalid_replacement");
  assert.equal(result.failureReason, "replacement_already_in_composition");
});

test("add change deterministically appends one unit and recalculates affected breakpoints", () => {
  const result = evaluateCompositionChange({
    operation: "add",
    composition,
    incomingApiName: "Unit_D",
    details
  });
  assert.equal(result.status, "evaluated");
  assert.equal(result.operation, "add");
  assert.equal(result.target, null);
  assert.equal(result.incoming.apiName, "Unit_D");
  assert.deepEqual(result.memberChange.before, ["Unit_A", "Unit_B", "Unit_C"]);
  assert.deepEqual(result.memberChange.after, ["Unit_A", "Unit_B", "Unit_C", "Unit_D"]);
  const guard = result.traitDeltas.find((delta) => delta.traitRef.apiName === "Trait_Guard");
  const frost = result.traitDeltas.find((delta) => delta.traitRef.apiName === "Trait_Frost");
  assert.deepEqual(
    { before: guard.beforeCount, after: guard.afterCount, change: guard.breakpointChange },
    { before: 2, after: 3, change: "count_increased" }
  );
  assert.deepEqual(
    { before: frost.beforeCount, after: frost.afterCount, change: frost.breakpointChange },
    { before: 0, after: 1, change: "count_increased" }
  );
  assert.equal(result.summary.countIncreased, 2);
  assert.equal(result.strengthConclusion, "not_evaluated");
});

test("remove change deterministically removes one member and recalculates affected breakpoints", () => {
  const result = evaluateCompositionChange({
    operation: "remove",
    composition,
    targetApiName: "Unit_A",
    details
  });
  assert.equal(result.status, "evaluated");
  assert.equal(result.operation, "remove");
  assert.equal(result.incoming, null);
  assert.deepEqual(result.memberChange.after, ["Unit_B", "Unit_C"]);
  const flame = result.traitDeltas.find((delta) => delta.traitRef.apiName === "Trait_Flame");
  const guard = result.traitDeltas.find((delta) => delta.traitRef.apiName === "Trait_Guard");
  assert.equal(flame.breakpointChange, "deactivated");
  assert.equal(guard.breakpointChange, "deactivated");
  assert.equal(result.summary.deactivated, 2);
});

test("add change rejects a unit already present in the composition", () => {
  const result = evaluateCompositionChange({
    operation: "add",
    composition,
    incomingApiName: "Unit_B",
    details
  });
  assert.equal(result.status, "invalid_incoming");
  assert.equal(result.failureReason, "incoming_already_in_composition");
  assert.deepEqual(result.traitDeltas, []);
});

test("composition change validates operation-specific unit arguments", () => {
  const addWithoutIncoming = evaluateCompositionChange({
    operation: "add",
    composition,
    details
  });
  assert.equal(addWithoutIncoming.status, "invalid_incoming");
  assert.equal(addWithoutIncoming.failureReason, "incoming_api_name_required");

  const removeWithoutTarget = evaluateCompositionChange({
    operation: "remove",
    composition,
    details
  });
  assert.equal(removeWithoutTarget.status, "invalid_target");
  assert.equal(removeWithoutTarget.failureReason, "target_api_name_required");
});
