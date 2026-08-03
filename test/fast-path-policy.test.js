import test from "node:test";
import assert from "node:assert/strict";
import {
  capabilityCoversExpectedOutput,
  evaluateFastPathEligibility,
  isPureEntityCatalogRequest
} from "../src/routing/fast-path-policy.js";

function frame(overrides = {}) {
  return {
    action: "search",
    expectedOutput: ["results", "evidence"],
    capabilityRequirements: [],
    ambiguities: [],
    understandingStatus: "understood_and_supported",
    ...overrides
  };
}

test("fast path output coverage requires every expected output", () => {
  assert.equal(
    capabilityCoversExpectedOutput(["results", "evidence"], ["results", "evidence"]),
    true
  );
  assert.equal(
    capabilityCoversExpectedOutput(["results", "ranking", "evidence"], ["results", "evidence"]),
    false
  );
});

test("entity catalog fast path accepts a pure catalog request", () => {
  const input = "请给我看看所有棋子";
  const result = evaluateFastPathEligibility({
    fastPath: "entity_catalog",
    taskFrame: frame({ action: "analyze", expectedOutput: ["analysis", "evidence"] }),
    pureCatalogRequest: isPureEntityCatalogRequest(input, "unit")
  });

  assert.equal(result.eligible, true);
  assert.equal(result.decision, "answer");
  assert.equal(result.reason, "fully_covered");
});

test("entity catalog fast path rejects a catalog phrase with second-layer requirements", () => {
  const input = "所有棋子中哪些五费卡的出装表现最好？";
  const result = evaluateFastPathEligibility({
    fastPath: "entity_catalog",
    taskFrame: frame({
      capabilityRequirements: ["entity_catalog_filtering", "unit_build_statistics"]
    }),
    pureCatalogRequest: isPureEntityCatalogRequest(input, "unit")
  });

  assert.equal(result.eligible, false);
  assert.equal(result.decision, "defer");
  assert.equal(result.reason, "composite_catalog_request");
});

test("details fast path cannot consume a recommendation request", () => {
  const result = evaluateFastPathEligibility({
    fastPath: "entity_details",
    taskFrame: frame({
      action: "recommend",
      expectedOutput: ["recommendation", "evidence"]
    })
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "action_not_covered");
});

test("entity details may resolve an otherwise unknown encyclopedia alias", () => {
  const result = evaluateFastPathEligibility({
    fastPath: "entity_details",
    taskFrame: frame({
      action: "explain",
      expectedOutput: ["explanation", "evidence"],
      understandingStatus: "ambiguous",
      ambiguities: [{ code: "ambiguous_entity" }]
    }),
    canResolveEntity: true
  });

  assert.equal(result.eligible, true);
});

test("item details fast path defers when carrier statistics are also required", () => {
  const result = evaluateFastPathEligibility({
    fastPath: "item_details",
    taskFrame: frame({
      action: "explain",
      expectedOutput: ["explanation", "evidence"],
      capabilityRequirements: ["item_carrier_statistics"]
    })
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.missingCapabilities, ["item_carrier_statistics"]);
});

test("clarification fast path only returns for a blocking ambiguity", () => {
  const ambiguous = evaluateFastPathEligibility({
    fastPath: "external_support_clarification",
    taskFrame: frame({
      understandingStatus: "ambiguous",
      ambiguities: [{ code: "ambiguous_game_concept" }]
    })
  });
  const understood = evaluateFastPathEligibility({
    fastPath: "external_support_clarification",
    taskFrame: frame()
  });

  assert.equal(ambiguous.eligible, true);
  assert.equal(ambiguous.decision, "clarify");
  assert.equal(understood.eligible, false);
  assert.equal(understood.reason, "clarification_not_blocking");
});

test("RAG fast path defers when structured current statistics are required", () => {
  const result = evaluateFastPathEligibility({
    fastPath: "rag",
    taskFrame: frame({ action: "analyze", expectedOutput: ["analysis", "evidence"] }),
    requiredCapabilities: ["current_structured_statistics"]
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.missingCapabilities, ["current_structured_statistics"]);
});
