import assert from "node:assert/strict";
import test from "node:test";

import {
  INTENT_ENVELOPE_SCHEMA_VERSION,
  RetrievalPlanner,
  createIntentEnvelope,
  createCatalog,
  recommendFromRows,
  parseQuery,
  buildQueryContext,
  validateQueryContext
} from "../src/index.js";

function envelopeFor(input) {
  const catalog = createCatalog();
  const parsed = parseQuery(input, { catalog });
  const query = buildQueryContext(parsed, { catalog });
  const validation = validateQueryContext(query, { catalog });
  return createIntentEnvelope({ input, parsed, query, validation, catalog });
}

test("IntentEnvelope exports the versioned unified parsing contract", () => {
  const envelope = envelopeFor("霞怎么出装？");
  assert.equal(envelope.schemaVersion, INTENT_ENVELOPE_SCHEMA_VERSION);
  assert.equal(envelope.intent, "unit_build_rankings");
  assert.equal(envelope.entities[0].type, "unit");
  assert.equal(envelope.needsClarification, false);
  assert.ok(envelope.requestedMetrics.includes("avgPlacement"));
});

test("RetrievalPlanner emits only registered structured operations and skips optional semantics for exact entities", () => {
  const planner = new RetrievalPlanner();
  const plan = planner.plan(envelopeFor("霞怎么出装？"));
  assert.equal(plan.schemaVersion, "retrieval_plan.v1");
  assert.equal(plan.structuredQueries.length, 1);
  assert.equal(plan.structuredQueries[0].source, "metatft");
  assert.equal(plan.structuredQueries[0].operation, "unit_builds");
  assert.equal(plan.structuredQueries[0].params.unit, "TFT17_Xayah");
  assert.deepEqual(plan.semanticQueries, []);
  assert.equal(plan.promptKey, "unit-build-rankings");
});

test("RetrievalPlanner blocks low-confidence or conflicting envelopes before data retrieval", () => {
  const planner = new RetrievalPlanner();
  const plan = planner.plan({
    ...envelopeFor("霞怎么出装？"),
    confidence: 0.4,
    needsClarification: true
  });
  assert.equal(plan.needsClarification, true);
  assert.deepEqual(plan.structuredQueries, []);
  assert.equal(plan.promptKey, null);
});

test("RetrievalPlanner maps every conclusion intent to a fixed prompt and operation", () => {
  const planner = new RetrievalPlanner();
  const base = envelopeFor("霞怎么出装？");
  const cases = [
    ["unit_build_rankings", "unit_builds", "unit-build-rankings"],
    ["unit_build_completion", "unit_builds", "unit-build-rankings"],
    ["unit_best_3_items", "unit_builds", "unit-build-rankings"],
    ["unit_item_rankings", "unit_builds", "unit-item-rankings"],
    ["unit_item_comparison", "unit_builds", "unit-item-comparison"],
    ["unit_emblem_rankings", "unit_builds", "unit-emblem-rankings"],
    ["comp_rankings", "comps_rankings", "comp-rankings"],
    ["comp_trends", "comps_trends", "comp-trends"]
  ];
  for (const [intent, operation, promptKey] of cases) {
    const plan = planner.plan({
      ...base,
      intent,
      confidence: 1,
      needsClarification: false,
      entities: intent.startsWith("comp_") ? [] : base.entities
    });
    assert.equal(plan.structuredQueries[0].operation, operation, intent);
    assert.equal(plan.promptKey, promptKey, intent);
  }
});

test("detail intents stay structured-only and have no conclusion prompt", () => {
  const planner = new RetrievalPlanner();
  const base = envelopeFor("霞怎么出装？");
  const plan = planner.plan({ ...base, intent: "unit_details" });
  assert.equal(plan.structuredQueries[0].source, "official_catalog");
  assert.equal(plan.structuredQueries[0].operation, "unit_details");
  assert.equal(plan.promptKey, null);
});

test("existing deterministic recommendation results expose an auditable envelope and retrieval plan", () => {
  const result = recommendFromRows("霞怎么出装？", [{
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [100, 90, 80, 70, 60, 50, 40, 30]
  }], { catalog: createCatalog(), preferences: { minSamples: 0 } });
  assert.equal(result.intentEnvelope.schemaVersion, "intent_envelope.v1");
  assert.equal(result.retrievalPlan.schemaVersion, "retrieval_plan.v1");
  assert.equal(result.retrievalPlan.structuredQueries[0].operation, "unit_builds");
});
