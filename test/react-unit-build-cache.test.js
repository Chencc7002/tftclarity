import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCacheStore } from "../src/index.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import {
  REACT_UNIT_BUILD_CACHE_TTL_MS,
  queryUnitBuildsBatchStatistics
} from "../src/app/small-window-server.js";

test("ReAct unit-build batch uses fresh cache and same-patch stale-if-error", async () => {
  let now = Date.parse("2026-08-07T00:00:00.000Z");
  let liveCalls = 0;
  let failLive = false;
  const runtime = {
    cacheStore: new MemoryCacheStore({ now: () => now }),
    requestTimeouts: { explorerTimeoutMs: 2200 },
    patchState: { currentPatch: "17.8" },
    metaTFTClient: {
      async getUnitBuilds() {
        liveCalls += 1;
        if (failLive) throw new Error("MetaTFT timed out");
        return { data: [], provenance: { fetchedAt: new Date(now).toISOString() } };
      }
    }
  };
  const input = { entities: [{ apiName: "TFT17_Xayah", name: "霞" }] };
  const options = {
    seasonContext: { id: "set17-live", currentPatch: "17.8", effectivePatch: "current" },
    now: () => now
  };

  const live = await queryUnitBuildsBatchStatistics(input, {}, runtime, options);
  assert.equal(live.source.cache, "live");
  assert.equal(liveCalls, 1);

  const fresh = await queryUnitBuildsBatchStatistics(input, {}, runtime, options);
  assert.equal(fresh.source.cache, "cache");
  assert.equal(liveCalls, 1);

  now += REACT_UNIT_BUILD_CACHE_TTL_MS + 1;
  failLive = true;
  const stale = await queryUnitBuildsBatchStatistics(input, {}, runtime, options);
  assert.equal(stale.source.cache, "stale");
  assert.equal(liveCalls, 2);
  assert.match(stale.source.risks.join(" "), /same-season same-patch cache/u);
  assert.equal(stale.updatedAt, "2026-08-07T00:00:00.000Z");
});

test("ReAct unit-build batch rejects stale cache from an older patch", async () => {
  let now = Date.parse("2026-08-07T00:00:00.000Z");
  let failLive = false;
  const runtime = {
    cacheStore: new MemoryCacheStore({ now: () => now }),
    requestTimeouts: { explorerTimeoutMs: 2200 },
    patchState: { currentPatch: "17.8" },
    metaTFTClient: {
      async getUnitBuilds() {
        if (failLive) throw new Error("MetaTFT timed out");
        return { data: [], provenance: { fetchedAt: new Date(now).toISOString() } };
      }
    }
  };
  const input = { entities: [{ apiName: "TFT17_Xayah", name: "霞" }] };
  await queryUnitBuildsBatchStatistics(input, {}, runtime, {
    seasonContext: { id: "set17-live", currentPatch: "17.8" },
    now: () => now
  });

  now += REACT_UNIT_BUILD_CACHE_TTL_MS + 1;
  failLive = true;
  runtime.patchState.currentPatch = "17.9";
  const result = await queryUnitBuildsBatchStatistics(input, {}, runtime, {
    seasonContext: { id: "set17-live", currentPatch: "17.9" },
    now: () => now
  });
  assert.equal(result.source.cache, "live");
  assert.equal(result.results[0].available, false);
  assert.match(result.source.risks.join(" "), /MetaTFT timed out/u);
  assert.doesNotMatch(result.source.risks.join(" "), /same-season same-patch cache/u);
});

test("unit_builds_batch exposes nested query-affecting constraint schema", () => {
  const definition = createStructuredToolDefinitions()
    .find((entry) => entry.name === "unit_builds_batch");
  assert.ok(definition);
  assert.deepEqual(Object.keys(definition.inputSchema.properties.constraints.properties), [
    "lockedItems",
    "excludedItems"
  ]);
  assert.equal(definition.inputSchema.properties.constraints.additionalProperties, false);
  assert.deepEqual(definition.inputSchema.properties.starLevel.items, {
    type: "integer",
    minimum: 1,
    maximum: 3
  });
});

test("unit_builds_batch reuses fixed-query default stars and echoes editable provenance", async () => {
  const requests = [];
  const catalog = {
    unitByApiName: new Map([["TFT17_Zoe", { apiName: "TFT17_Zoe", name: "佐伊", cost: 2 }]]),
    itemByApiName: new Map()
  };
  const runtime = {
    cacheStore: new MemoryCacheStore(),
    requestTimeouts: { explorerTimeoutMs: 2200 },
    patchState: { currentPatch: "17.8" },
    metaTFTClient: {
      async getUnitBuilds(plan) {
        requests.push(plan);
        return { data: [], provenance: { fetchedAt: "2026-08-09T00:00:00.000Z" } };
      }
    }
  };
  const options = {
    seasonContext: { id: "set17-live", currentPatch: "17.8", effectivePatch: "current" },
    preferences: { days: 3, rankFilter: ["PLATINUM"] }
  };
  const defaultResult = await queryUnitBuildsBatchStatistics({
    entities: [{ apiName: "TFT17_Zoe", name: "佐伊" }]
  }, catalog, runtime, options);
  const explicitResult = await queryUnitBuildsBatchStatistics({
    entities: [{ apiName: "TFT17_Zoe", name: "佐伊" }],
    starLevel: [2]
  }, catalog, runtime, options);

  assert.deepEqual(defaultResult.query.starLevel, [3]);
  assert.deepEqual(defaultResult.results[0].starLevel, [3]);
  assert.equal(defaultResult.query.constraints.star_level.source, "system_default");
  assert.equal(defaultResult.query.constraints.patch.value, "17.8");
  assert.equal(defaultResult.query.effectivePatch, "17.8");
  assert.equal(defaultResult.query.constraints.days.source, "preference");
  assert.equal(defaultResult.query.constraints.rank_filter.source, "preference");
  assert.deepEqual(explicitResult.query.starLevel, [2]);
  assert.equal(explicitResult.query.constraints.star_level.source, "current_input");
  assert.match(requests[0].params.unit_tier_numitems_unique, /TFT17_Zoe-1_3_3/u);
  assert.match(requests[1].params.unit_tier_numitems_unique, /TFT17_Zoe-1_2_3/u);
});

test("unit_builds_batch applies exclusions to source rows before ranking and isolates cache keys", async () => {
  const excludedItem = "TFT_Item_A";
  const allItems = ["A", "B", "C", "D", "E", "F", "G", "H", "I"]
    .map((suffix) => `TFT_Item_${suffix}`);
  const catalog = {
    itemByApiName: new Map(allItems.map((apiName) => [apiName, {
      apiName,
      name: apiName,
      current: true,
      obtainable: true,
      category: "ordinary_completed"
    }]))
  };
  let liveCalls = 0;
  const rows = [
    ["TFT_Item_A", "TFT_Item_B", "TFT_Item_C"],
    ["TFT_Item_A", "TFT_Item_D", "TFT_Item_E"],
    ["TFT_Item_F", "TFT_Item_G", "TFT_Item_H"],
    ["TFT_Item_B", "TFT_Item_F", "TFT_Item_I"]
  ].map((itemApiNames, index) => ({
    unitApiName: "TFT17_TestUnit",
    itemApiNames,
    placementCounts: [40 - index, 30, 20, 10, 8, 6, 4, 2]
  }));
  const runtime = {
    cacheStore: new MemoryCacheStore(),
    requestTimeouts: { explorerTimeoutMs: 2200 },
    patchState: { currentPatch: "17.8" },
    metaTFTClient: {
      async getUnitBuilds() {
        liveCalls += 1;
        return {
          data: rows,
          provenance: { fetchedAt: "2026-08-08T00:00:00.000Z" }
        };
      }
    }
  };
  const baseInput = {
    entities: [{ apiName: "TFT17_TestUnit", name: "Test Unit" }],
    optionsPerUnit: 3
  };
  const options = {
    seasonContext: { id: "set17-live", currentPatch: "17.8", effectivePatch: "current" }
  };

  const baseline = await queryUnitBuildsBatchStatistics(baseInput, catalog, runtime, options);
  const constrained = await queryUnitBuildsBatchStatistics({
    ...baseInput,
    constraints: { excludedItems: [excludedItem] }
  }, catalog, runtime, options);
  const cachedConstrained = await queryUnitBuildsBatchStatistics({
    ...baseInput,
    constraints: { excludedItems: [excludedItem] }
  }, catalog, runtime, options);

  assert.equal(liveCalls, 2, "baseline and constrained queries must not share a cache key");
  assert.equal(cachedConstrained.source.cache, "cache");
  assert.notEqual(baseline.constraintQueryFingerprint, constrained.constraintQueryFingerprint);
  assert.deepEqual(constrained.query.constraints.excludedItems, [excludedItem]);
  assert.equal(constrained.source.constraintApplication, "deterministic_source_row_filter_before_ranking");
  assert.equal(constrained.results[0].constraintAudit.sourceRowCount, 4);
  assert.equal(constrained.results[0].constraintAudit.eligibleBeforeConstraints, 4);
  assert.equal(constrained.results[0].constraintAudit.eligibleAfterConstraints, 2);
  assert.equal(constrained.results[0].constraintAudit.changedEligibleRowSet, true);
  assert.ok(constrained.results[0].buildOptions.length >= 1);
  assert.equal(constrained.results[0].buildOptions.some((option) => (
    option.items.some((item) => item.apiName === excludedItem)
  )), false);
});

test("unit_builds_batch rejects conflicting or unknown constraint items", async () => {
  const runtime = {
    metaTFTClient: { async getUnitBuilds() { return { data: [] }; } }
  };
  const catalog = {
    itemByApiName: new Map([["TFT_Item_A", { apiName: "TFT_Item_A" }]])
  };
  const options = { seasonContext: { id: "set17-live", currentPatch: "17.8" } };
  await assert.rejects(
    queryUnitBuildsBatchStatistics({
      entities: [{ apiName: "TFT17_TestUnit" }],
      constraints: { lockedItems: ["TFT_Item_A"], excludedItems: ["TFT_Item_A"] }
    }, catalog, runtime, options),
    (error) => error.code === "conflicting_batch_constraints"
  );
  await assert.rejects(
    queryUnitBuildsBatchStatistics({
      entities: [{ apiName: "TFT17_TestUnit" }],
      constraints: { excludedItems: ["TFT_Item_Unknown"] }
    }, catalog, runtime, options),
    (error) => error.code === "unknown_batch_constraint_item"
  );
});
