import test from "node:test";
import assert from "node:assert/strict";
import { runSemanticShadow } from "../src/understanding/semantic-shadow.js";
import { recommendForInput } from "../src/core/recommendation-service.js";
import { createCatalog } from "../src/data/static-data.js";

test("semantic shadow records sanitized differences without changing legacy output", async () => {
  const events = [];
  const legacy = {
    intent: "unit_item_comparison",
    parser: { entityMatches: [{ alias: "霞", apiName: "TFT17_Xayah" }] }
  };
  const legacySnapshot = structuredClone(legacy);
  const result = await runSemanticShadow("霞的炼刀和巨九选哪个？", legacy, {
    agentRun: {
      budget: { maxSteps: 12, maxToolCalls: 12 },
      emit: (event) => events.push(event)
    }
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(legacy, legacySnapshot);
  assert.equal(events[0].type, "semantic_shadow_completed");
  assert.equal(JSON.stringify(events[0]).includes("霞的炼刀"), false);
  assert.equal(events[0].data.usage.cachedInputTokens > 0, true);
  assert.equal(events[0].data.difference.semantic.action, "compare");
});

test("semantic shadow failure is isolated from the legacy chain", async () => {
  const events = [];
  const result = await runSemanticShadow("霞怎么出装", { intent: "unit_build_rankings" }, {
    parser: async () => {
      throw Object.assign(new Error("provider unavailable"), { code: "provider_unavailable" });
    },
    agentRun: { emit: (event) => events.push(event) }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "provider_unavailable");
  assert.equal(events[0].type, "semantic_shadow_failed");
});

test("production recommendation path runs semantic shadow without changing the legacy result", async () => {
  const catalog = createCatalog();
  const baseline = await recommendForInput("羊刀现在加什么属性？", {
    catalog,
    useSession: false,
    semanticShadow: false
  });
  const events = [];
  const shadowed = await recommendForInput("羊刀现在加什么属性？", {
    catalog,
    useSession: false,
    agentRun: {
      budget: { maxSteps: 12, maxToolCalls: 12 },
      emit: (event) => events.push(event)
    }
  });

  assert.deepEqual(shadowed, baseline);
  assert.equal(events.some((event) => event.type === "semantic_shadow_completed"), true);
});
