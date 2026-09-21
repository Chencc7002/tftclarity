import { createLegacySeasonFixture } from "./fixtures/season-context.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCatalog, MemoryCacheStore } from "../src/index.js";
import {
  createDefaultReactToolHandlerBundle,
  createSmallWindowRuntime,
  queryCompositionRankings
} from "../src/app/small-window-server.js";
import { resolveCompositionMention } from "../src/domain/tft/composition-resolution.js";

function comp({ id, name, units, traits = [], coreBuilds = [], games = 100 }) {
  return {
    compId: `cluster:${id}`,
    name,
    patch: "current",
    units: units.map(([apiName, unitName]) => ({ apiName, name: unitName })),
    traits: traits.map(([apiName, traitName]) => ({ apiName, filterId: `${apiName}_2`, name: traitName, tier: 2 })),
    coreBuilds,
    stats: { games },
    source: { clusterId: id, updatedAt: "2026-08-07T00:00:00.000Z" }
  };
}

const rankings = {
  candidates: [
    comp({
      id: "alpha",
      name: "星界 路 云雀",
      units: [["TFT17_Lark", "云雀"], ["TFT17_Oak", "橡树"]],
      traits: [["TFT17_Astral", "星界"]],
      coreBuilds: [{
        unitApiName: "TFT17_Lark",
        items: ["Item_A", "Item_B", "Item_C"],
        games: 321,
        avgPlacement: 3.8
      }],
      games: 1000
    }),
    comp({
      id: "beta",
      name: "先锋 路 云雀",
      units: [["TFT17_Lark", "云雀"], ["TFT17_Pine", "松树"]],
      traits: [["TFT17_Vanguard", "先锋"]],
      games: 800
    })
  ],
  source: { updatedAt: "2026-08-07T00:00:00.000Z" },
  warnings: []
};

test("dynamic composition identity resolves without a hard-coded entity table", () => {
  const result = resolveCompositionMention(rankings, { mention: "星界云雀阵容" });
  assert.equal(result.resolution.status, "resolved");
  assert.equal(result.resolution.matchedBy, "composition_identity");
  assert.equal(result.results[0].compositionRef.compId, "cluster:alpha");
});

test("member-only composition mentions remain ambiguous when live data has multiple matches", () => {
  const result = resolveCompositionMention(rankings, { mention: "云雀阵容" });
  assert.equal(result.resolution.status, "ambiguous");
  assert.equal(result.results.length, 2);
  assert.ok(result.warnings.includes("composition_ambiguous"));
});

test("member evidence does not silently promote membership into carry or tank roles", () => {
  const result = resolveCompositionMention(rankings, { mention: "星界云雀" });
  const lark = result.results[0].members.find((member) => member.apiName === "TFT17_Lark");
  const oak = result.results[0].members.find((member) => member.apiName === "TFT17_Oak");
  assert.deepEqual(lark.relations, ["member_of_comp", "itemized_core_candidate"]);
  assert.equal(lark.roleEvidence.primaryCarry, "unknown");
  assert.equal(lark.roleEvidence.primaryTank, "unknown");
  assert.equal(oak.roleEvidence.itemizedCoreCandidate, "not_observed");
  assert.equal(oak.roleEvidence.coreMember, "unknown");
});

test("composition evidence deterministically plans item-contention build candidates", () => {
  const input = {
    candidates: [comp({
      id: "contention",
      name: "Dynamic Contention",
      units: [["Unit_A", "Alpha"], ["Unit_B", "Beta"], ["Unit_C", "Gamma"]],
      coreBuilds: [
        { unitApiName: "Unit_A", items: ["Item_A"], games: 100 },
        { unitApiName: "Unit_B", items: ["Item_B"], games: 300 },
        { unitApiName: "Unit_C", items: ["Item_C"], games: 200 }
      ]
    })],
    source: { updatedAt: "2026-08-07T00:00:00.000Z" },
    warnings: []
  };
  const result = resolveCompositionMention(input, { mention: "Dynamic Contention" });
  const plan = result.results[0].itemContentionQueryPlan;
  assert.equal(plan.status, "ready");
  assert.equal(plan.compositionId, "cluster:contention");
  assert.deepEqual(plan.apiNames, ["Unit_B", "Unit_C", "Unit_A"]);
  assert.equal(plan.optionsPerUnit, 3);
});

test("unmatched composition mention returns an explicit not-found result", () => {
  const result = resolveCompositionMention(rankings, { mention: "不存在的体系" });
  assert.equal(result.resolution.status, "not_found");
  assert.deepEqual(result.results, []);
  assert.ok(result.warnings.includes("composition_not_found"));
});

test("production composition handler uses matching live definition/statistics clusters", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
    "utf8"
  ));
  let statsRequest = null;
  const runtime = {
    seasonContextService: {
      resolveForQuery() {
        return {
          id: "set17-live",
          currentPatch: "current",
          effectivePatch: "current",
          source: { queue: "1100" }
        };
      }
    },
    compsClient: {
      async getCompsData() { return fixture.compsData; },
      async getCompsStats(input) {
        statsRequest = input;
        return fixture.compsStats;
      }
    }
  };
  const result = await queryCompositionRankings(
    { mention: "ShieldTank Nunu", limit: 5 },
    createCatalog(),
    runtime,
    { details: { units: new Map() } }
  );
  assert.equal(String(statsRequest.cluster_id), "409");
  assert.equal(result.resolution.status, "resolved");
  assert.equal(result.type, "composition_rankings");
  assert.equal(result.query.intent, "comp_rankings");
  assert.equal(result.results[0].compositionRef.compId, "cluster:409002");
  assert.deepEqual(result.results[0].tacticalDetailQueryPlan, {
    schemaVersion: "composition-tactical-detail-query.v1",
    status: "ready",
    compositionId: "409002",
    clusterId: "409",
    units: result.results[0].members.map((member) => member.apiName),
    seasonContextId: "set17-live"
  });
  assert.ok(result.results[0].members.some((member) => (
    member.apiName === "TFT17_Nunu"
    && member.relations.includes("itemized_core_candidate")
    && member.roleEvidence.primaryCarry === "unknown"
  )));
  assert.ok(result.results[0].members.every((member) => Object.hasOwn(member, "iconUrl")));
  assert.ok(result.results[0].traits.every((trait) => Object.hasOwn(trait, "iconUrl")));
  const candidates = await queryCompositionRankings({}, createCatalog(), runtime, { details: { units: new Map() } });
  assert.equal(candidates.resolution.status, "unfiltered");
  for (const row of candidates.results) {
    const prerequisite = row.tacticalDetailQueryPlan.resolutionPrerequisite;
    assert.deepEqual(prerequisite, { tool: "comps_rankings", arguments: { mention: row.compositionRef.compId } });
    const resolved = await queryCompositionRankings(prerequisite.arguments, createCatalog(), runtime, { details: { units: new Map() } });
    assert.equal(resolved.resolution.status, "resolved");
    assert.equal(resolved.results[0].compositionRef.compId, row.compositionRef.compId);
    assert.equal(resolved.results[0].tacticalDetailQueryPlan.resolutionPrerequisite, undefined);
    assert.deepEqual(resolved.results[0].tacticalDetailQueryPlan.units, row.tacticalDetailQueryPlan.units);
  }
});

test("default ReAct bundle never substitutes catalog compOptions for live comps_data", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
    "utf8"
  ));
  const details = { meta: {}, units: new Map(), traits: new Map() };
  let liveDataCalls = 0;
  const runtime = createSmallWindowRuntime({ seasonContextService: createLegacySeasonFixture(),
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    compsData: { compOptions: [{ not: "page definitions" }] },
    officialEntityDetails: details,
    fetchOfficialEntityDetails: async () => details,
    compsClient: {
      async getCompsData() {
        liveDataCalls += 1;
        return fixture.compsData;
      },
      async getCompsStats() { return fixture.compsStats; }
    }
  });
  const bundle = await createDefaultReactToolHandlerBundle({
    request: { seasonContextId: "set17-live" },
    runtime,
    context: {}
  });
  const result = await bundle.handlers.comps_rankings({
    mention: "ShieldTank Nunu",
    limit: 5
  });
  assert.equal(liveDataCalls, 1);
  assert.equal(result.resolution.status, "resolved");
  assert.equal(result.results[0].compositionRef.compId, "cluster:409002");
});

test("opt-in per-request snapshot reuse preserves source data while resolving each identity", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const fixture = JSON.parse(await readFile(new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url), "utf8"));
  const details = { meta: {}, units: new Map(), traits: new Map() };
  let dataCalls = 0, statsCalls = 0;
  const runtime = createSmallWindowRuntime({ catalog: createCatalog(), cacheStore: new MemoryCacheStore(),
    seasonContextService: createLegacySeasonFixture(),
    officialEntityDetails: details, fetchOfficialEntityDetails: async () => details,
    compsClient: { getCompsData: async () => { dataCalls++; return structuredClone(fixture.compsData); },
      getCompsStats: async () => { statsCalls++; return structuredClone(fixture.compsStats); } } });
  runtime.reactCompositionSnapshotReuse = true;
  const newBundle = () => createDefaultReactToolHandlerBundle({ request: { seasonContextId: "set17-live" }, runtime, context: {} });
  const bundle = await newBundle();
  const candidates = await bundle.handlers.comps_rankings({});
  const first = structuredClone(candidates.results[0]);
  candidates.results[0].members.length = 0; // caller mutation cannot corrupt raw cache
  const resolved = await bundle.handlers.comps_rankings({ mention: first.compositionRef.compId });
  assert.equal(resolved.resolution.status, "resolved");
  assert.deepEqual(resolved.results[0].members, first.members);
  assert.deepEqual(resolved.results[0].stats, first.stats);
  assert.deepEqual(resolved.source, candidates.source);
  assert.equal(dataCalls, 1);
  assert.equal(statsCalls, 1);
  await bundle.handlers.comps_rankings({ days: 7 });
  await bundle.handlers.comps_rankings({ patch: "17.1" });
  await bundle.handlers.comps_rankings({ queue: "1160" });
  assert.equal(dataCalls, 4, "changed source scope is not reused");
  const secondRequest = await newBundle();
  await secondRequest.handlers.comps_rankings({});
  assert.equal(dataCalls, 5, "separate requests cannot share mutable snapshots");
  t.mock.timers.tick(30_000);
  await bundle.handlers.comps_rankings({});
  assert.equal(dataCalls, 6, "expired snapshot is downloaded again");
  runtime.reactCompositionSnapshotReuse = false;
  const legacy = await newBundle();
  await legacy.handlers.comps_rankings({});
  await legacy.handlers.comps_rankings({ mention: first.compositionRef.compId });
  assert.equal(dataCalls, 8, "default behavior remains unchanged");
});
