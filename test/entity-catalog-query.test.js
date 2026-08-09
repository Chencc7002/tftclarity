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

test("entity catalog resolves exact normalized aliases and reports ambiguity explicitly", () => {
  const { catalog, details } = fixture();
  catalog.units[0].aliases = ["卡尔玛", "Karma"];
  catalog.units[1].aliases = ["共享别名"];
  catalog.units[2].aliases = ["共享别名"];

  const resolved = queryEntityCatalog({
    catalog,
    details,
    input: { entityType: "unit", filters: { names: ["  ＫＡＲＭＡ  "] } }
  });
  assert.equal(resolved.resolution.mode, "exact_alias");
  assert.equal(resolved.resolution.requests[0].status, "resolved");
  assert.equal(resolved.resolution.requests[0].candidates[0].apiName, "TFT17_A");
  assert.equal(resolved.results.length, 1);

  const ambiguous = queryEntityCatalog({
    catalog,
    details,
    input: { entityType: "unit", filters: { names: ["共享别名"] } }
  });
  assert.equal(ambiguous.resolution.requests[0].status, "ambiguous");
  assert.deepEqual(
    ambiguous.resolution.requests[0].candidates.map((entry) => entry.apiName),
    ["TFT17_B", "TFT17_C"]
  );
  assert.equal(ambiguous.results.length, 2);

  const missing = queryEntityCatalog({
    catalog,
    details,
    input: { entityType: "unit", filters: { names: ["不存在"] } }
  });
  assert.equal(missing.resolution.requests[0].status, "not_found");
  assert.deepEqual(missing.results, []);
});

test("entity catalog exact resolution covers unit apiName, item aliases and base trait ids only", () => {
  const { catalog, details } = fixture();
  const item = {
    apiName: "TFT_Item_GuinsoosRageblade",
    zhName: "鬼索的狂暴之刃",
    shortName: "羊刀",
    aliases: ["鬼索"],
    current: true,
    obtainable: true
  };
  catalog.items.push(item);
  catalog.itemByApiName.set(item.apiName, item);

  for (const [entityType, name, expectedApiName] of [
    ["unit", "TFT17_A", "TFT17_A"],
    ["item", "羊刀", "TFT_Item_GuinsoosRageblade"],
    ["trait", "木灵", "TFT17_Woodling"]
  ]) {
    const result = queryEntityCatalog({
      catalog,
      details,
      input: { entityType, filters: { names: [name] } }
    });
    assert.equal(result.resolution.requests[0].status, "resolved");
    assert.equal(result.resolution.requests[0].candidates[0].apiName, expectedApiName);
    assert.deepEqual(result.requestedNames, [name]);
  }

  const substring = queryEntityCatalog({
    catalog,
    details,
    input: { entityType: "item", filters: { names: ["羊"] } }
  });
  assert.equal(substring.resolution.requests[0].status, "not_found");
});

test("entity catalog tool schema bounds names and rejects names with apiNames", async () => {
  const { catalog, details } = fixture();
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const executor = new (await import("../src/agent/tools/executor.js")).ToolExecutor({ registry });
  const handler = (input) => queryEntityCatalog({ catalog, details, input });
  await assert.rejects(
    () => executor.execute("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["甲"], apiNames: ["TFT17_A"] }
    }, { handler }),
    /Invalid input for entity_catalog_query/u
  );
  await assert.rejects(
    () => executor.execute("entity_catalog_query", {
      entityType: "unit",
      filters: { names: [] }
    }, { handler }),
    /Invalid input for entity_catalog_query/u
  );
  await assert.rejects(
    () => executor.execute("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["1", "2", "3", "4", "5", "6"] }
    }, { handler }),
    /Invalid input for entity_catalog_query/u
  );
  await assert.rejects(
    () => executor.execute("entity_catalog_query", {
      entityType: "unit",
      filters: { names: ["x".repeat(81)] }
    }, { handler }),
    /Invalid input for entity_catalog_query/u
  );
});
