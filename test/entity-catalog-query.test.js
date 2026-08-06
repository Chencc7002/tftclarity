import test from "node:test";
import assert from "node:assert/strict";
import {
  ToolRegistry,
  compileExecutionPlan,
  createStructuredToolDefinitions,
  createTaskFrame,
  matchTaskCapabilities,
  queryEntityCatalog
} from "../src/index.js";

function fixture() {
  const units = [
    { apiName: "TFT17_A", zhName: "甲", current: true },
    { apiName: "TFT17_B", zhName: "乙", current: true },
    { apiName: "TFT17_C", zhName: "丙", current: true }
  ];
  const trait = {
    apiName: "TFT17_Woodling",
    filterId: "TFT17_Woodling_2",
    zhName: "木灵",
    displayName: "木灵",
    aliases: ["木灵"],
    current: true
  };
  return {
    catalog: {
      units,
      items: [],
      traits: [trait],
      unitByApiName: new Map(units.map((entry) => [entry.apiName, entry])),
      itemByApiName: new Map(),
      traitByApiName: new Map([[trait.apiName, trait]]),
      traitByFilterId: new Map([[trait.filterId, trait]])
    },
    details: {
      meta: { updatedAt: "2026-07-31T00:00:00.000Z" },
      units: new Map([
        ["TFT17_A", { apiName: "TFT17_A", name: "甲", cost: 4, traitNames: ["木灵"] }],
        ["TFT17_B", { apiName: "TFT17_B", name: "乙", cost: 3, traitNames: ["木灵"] }],
        ["TFT17_C", { apiName: "TFT17_C", name: "丙", cost: 4, traitNames: ["别的"] }]
      ]),
      traits: new Map()
    }
  };
}

test("entity_catalog_query filters units by cost and trait", () => {
  const { catalog, details } = fixture();
  const result = queryEntityCatalog({
    catalog,
    details,
    input: {
      entityType: "unit",
      filters: { cost: 4, traits: ["TFT17_Woodling"], current: true },
      projection: ["apiName", "name", "cost", "traits"]
    }
  });
  assert.equal(result.type, "entity_catalog_results");
  assert.equal(result.source, "official_tft_catalog");
  assert.deepEqual(result.results, [{ apiName: "TFT17_A", name: "甲", cost: 4, traits: [] }]);
});
test("entity catalog capability compiles a registered evidence-backed plan", () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const frame = createTaskFrame({
    action: "search",
    concepts: [{ rawText: "木灵", expectedType: "trait", resolvedId: "TFT17_Woodling", confidence: 1 }],
    constraints: { targetEntityType: "champion", cost: 4, relation: "member_of_trait" },
    goal: "find_entities_matching_filters",
    expectedOutput: ["results", "evidence"],
    capabilityRequirements: ["entity_catalog_filtering"],
    confidence: 1,
    understandingStatus: "understood_and_supported"
  });
  const match = matchTaskCapabilities(frame, registry);
  assert.equal(match.mode, "single_tool");
  assert.equal(match.selected[0].tool, "entity_catalog_query");
  const planning = compileExecutionPlan(frame, match, { registry });
  assert.equal(planning.validation.valid, true, planning.validation.errors.join("; "));
  assert.deepEqual(planning.plan.steps[0].arguments.filters, {
    cost: 4,
    traits: ["TFT17_Woodling"],
    current: true
  });
});
