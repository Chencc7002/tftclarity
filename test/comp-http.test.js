import test from "node:test";
import assert from "node:assert/strict";

import { createCatalog, MemoryCacheStore } from "../src/index.js";
import {
  createSmallWindowRuntime,
  handleRecommendRequest
} from "../src/app/small-window-server.js";

const compId = "TFT17_Aatrox&TFT17_Xayah|TFT17_Stargazer_1&TFT17_Stargazer_Serpent_1";
const rows = [{
  unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
  placement_count: [300, 250, 220, 180, 120, 90, 60, 30]
}];

function runtimeFor(candidatePlacementCount) {
  return createSmallWindowRuntime({
    catalog: createCatalog(),
    cacheStore: new MemoryCacheStore(),
    fetchItems: false,
    compsClient: {},
    metaTFTClient: {
      async getCompCandidates() {
        return {
          data: [{
            units_traits: compId,
            comp_name: "观星霞",
            placement_count: candidatePlacementCount
          }],
          filter_adjustment: { sample_size: 98765 }
        };
      },
      async getUnitBuilds() {
        return { data: rows, capture: { capturedAt: "2026-07-12T03:25:28.773Z" } };
      }
    }
  });
}

test("HTTP schema exposes applied Comp, source, sample, actual endpoints, and cache risk", async () => {
  const { payload } = await handleRecommendRequest({
    input: "霞什么三件装备最强？",
    conversationId: "http-auto-comp",
    preferences: { minSamples: 100 }
  }, runtimeFor([220, 190, 160, 130, 80, 50, 30, 20]));

  assert.equal(payload.query.comp.status, "applied");
  assert.equal(payload.query.comp.source, "system_default");
  assert.equal(payload.query.comp.value.selection, "automatic");
  assert.equal(payload.query.comp.value.sampleCount, 880);
  assert.equal(payload.source.endpoint, "/tft-explorer-api/unit_builds/TFT17_Xayah");
  assert.equal(payload.source.compCandidates.endpoint, "/tft-explorer-api/exact_units_traits2");
  assert.equal(payload.source.compCandidates.stale, false);
  assert.equal(payload.source.requestParams["sf[0][and][0][unit_unique]"], "TFT17_Aatrox-1");
  assert.match(payload.answer.summary, /系统补全，样本 880/);
});

test("HTTP schema exposes not_available and an unrestricted final request", async () => {
  const { payload } = await handleRecommendRequest({
    input: "霞什么三件装备最强？",
    conversationId: "http-no-comp",
    preferences: { minSamples: 100 }
  }, runtimeFor([1, 1, 1, 1, 1, 1, 1, 1]));

  assert.equal(payload.query.comp.status, "not_available");
  assert.equal(payload.query.comp.value, null);
  assert.equal(payload.query.constraints.comp.status, "not_available");
  assert.equal(Object.keys(payload.source.requestParams).some((key) => key.startsWith("sf[")), false);
  assert.equal(payload.source.requestParams.trait, undefined);
  assert.match(payload.answer.summary, /未找到稳定 Comp，以下结果未限制 Comp/);
});
