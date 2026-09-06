import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { queryEntityCatalog } from "../src/domain/tft/entity-catalog-query.js";
import { normalizeEntityNameResolutionMode } from "../src/domain/tft/entity-name-candidates.js";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { ToolExecutor } from "../src/agent/tools/executor.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";

const fixture = JSON.parse(readFileSync(new URL("../eval/entity-names/typos.json", import.meta.url), "utf8"));
const timestamp = "2026-09-06T00:00:00.000Z";
function query(inputName, entityType = "unit", options = {}) {
  return queryEntityCatalog({ catalog: options.catalog ?? structuredClone(fixture.catalog), updatedAt: timestamp,
    input: { entityType, filters: { names: [inputName], ...options.filters } },
    nameResolution: { mode: options.mode ?? "suggest", onObservation: options.onObservation } });
}

for (const entry of fixture.cases) {
  test(`entity typo ${entry.group}: ${entry.type}/${entry.input}`, () => {
    const observations = [];
    const result = query(entry.input, entry.type, { onObservation: value => observations.push(value) });
    const request = result.resolution.requests[0];
    if (!entry.expected.length) {
      assert.equal(request.status, "not_found");
      assert.deepEqual(request.candidates, []);
    } else {
      assert.equal(request.status, "ambiguous");
      for (const id of entry.expected) assert.ok(request.candidates.some(candidate => candidate.apiName === id), JSON.stringify(request));
      assert.equal(request.candidates[0].apiName, entry.expected[0]);
      assert.ok(result.results.length > 0);
    }
    if (entry.autoAccept === false) assert.equal(observations[0].autoAcceptEligible, false);
  });
}

test("shadow mode preserves the complete legacy payload and emits bounded telemetry only", () => {
  const catalog = structuredClone(fixture.catalog);
  const observations = [];
  for (const entry of fixture.cases) {
    const old = query(entry.input, entry.type, { catalog, mode: "off" });
    const shadow = query(entry.input, entry.type, { catalog, mode: "shadow", onObservation: event => observations.push(event) });
    assert.deepEqual(shadow, old);
  }
  assert.equal(observations.length, fixture.cases.length);
  assert.ok(observations.some(event => event.autoAcceptEligible));
  for (const event of observations) {
    assert.equal(event.llmCallsAdded, 0);
    assert.ok(Number.isFinite(event.durationMs));
    assert.equal(event.inputName, undefined);
    assert.equal(event.candidates, undefined);
    assert.ok(!JSON.stringify(event).includes("厄斐"));
  }
});

test("off and unknown modes do not compute candidates or call observers", () => {
  for (const mode of ["off", "on", "automatic", "", undefined]) {
    assert.equal(normalizeEntityNameResolutionMode(mode), "off");
  }
  assert.equal(normalizeEntityNameResolutionMode(" SHADOW "), "shadow");
  query("洋刀", "item", { mode: "off", onObservation: () => assert.fail("off observer") });
});

test("exact names, collisions and curated fuzzy aliases retain precedence", () => {
  const catalog = structuredClone(fixture.catalog);
  catalog.units.push({ apiName: "Test_Exact", zhName: "那美", current: true });
  catalog.units[0].fuzzyAliases = ["厄飞流斯"];
  for (const [name, type] of [["那美", "unit"], ["巨杀", "item"], ["厄飞流斯", "unit"]]) {
    const legacy = query(name, type, { catalog, mode: "off" });
    assert.deepEqual(query(name, type, { catalog, onObservation: () => assert.fail("exact path observer") }), legacy);
  }
  assert.equal(query("那美", "unit", { catalog }).resolution.requests[0].candidates[0].apiName, "Test_Exact");
});

test("catalog mutations, seasons and caller-visible candidates cannot poison the cached index", () => {
  const catalog = structuredClone(fixture.catalog);
  const first = query("卡尔马", "unit", { catalog });
  first.resolution.requests[0].candidates[0].apiName = "poison";
  assert.equal(query("卡尔马", "unit", { catalog }).resolution.requests[0].candidates[0].apiName, "Test_Karma");
  catalog.units.find(unit => unit.apiName === "Test_Karma").current = false;
  assert.equal(query("卡尔马", "unit", { catalog }).resolution.requests[0].status, "not_found");
  assert.equal(query("卡尔马", "unit").resolution.requests[0].candidates[0].apiName, "Test_Karma");
  catalog.units[0].aliases.push("白昼月神");
  assert.equal(query("白昼月伸", "unit", { catalog }).resolution.requests[0].candidates[0].apiName, "Test_Aphelios");
  catalog.units[0].aliases.pop();
  assert.equal(query("白昼月伸", "unit", { catalog }).resolution.requests[0].status, "not_found");
});

test("explicit cost and item category constrain fuzzy candidates without hiding variant ambiguity", () => {
  assert.equal(query("卡尔马", "unit", { filters: { cost: 2 } }).resolution.requests[0].status, "not_found");
  const result = query("巨沙", "item", { filters: { categories: ["ordinary_completed"] } });
  assert.deepEqual(result.resolution.requests[0].candidates.map(c => c.apiName), ["Test_Giant"]);
  assert.equal(result.resolution.requests[0].status, "ambiguous");
});

test("observer errors and rejected promises do not alter successful results", async () => {
  const expected = query("洋刀", "item");
  assert.deepEqual(query("洋刀", "item", { onObservation: () => { throw new Error("unavailable"); } }), expected);
  assert.deepEqual(query("洋刀", "item", { onObservation: async () => { throw new Error("unavailable"); } }), expected);
  await new Promise(resolve => setImmediate(resolve));
});

test("candidate lists are bounded and never silently resolve a truncated collision", () => {
  const catalog = { units: Array.from({ length: 8 }, (_, i) => ({ apiName: `Test_${i}`, zhName: "共享英雄", current: true })), items: [], traits: [] };
  const request = query("共享英熊", "unit", { catalog }).resolution.requests[0];
  assert.equal(request.status, "ambiguous");
  assert.equal(request.candidateCount, 8);
  assert.equal(request.candidates.length, 5);
  assert.equal(request.candidatesTruncated, true);
});

test("registered tool rejects model-supplied resolution modes and reports real catalog candidates", async () => {
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  const executor = new ToolExecutor({ registry });
  const handler = input => queryEntityCatalog({ catalog: structuredClone(fixture.catalog), input, updatedAt: timestamp, nameResolution: { mode: "suggest" } });
  await assert.rejects(executor.execute("entity_catalog_query", {
    entityType: "unit", filters: { names: ["卡尔马"] }, nameResolution: { mode: "automatic" }
  }, { handler }), /Invalid input/u);
  const result = await executor.execute("entity_catalog_query", { entityType: "unit", filters: { names: ["卡尔马"] } }, { handler });
  assert.ok(JSON.stringify(result).includes("Test_Karma"));
  assert.ok(JSON.stringify(result).includes("ambiguous"));
});
