import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSemanticShadow } from "../src/understanding/semantic-shadow.js";
import { recommendForInput } from "../src/core/recommendation-service.js";
import { createCatalog } from "../src/data/static-data.js";
import {
  ExecutionPlanExecutor,
  ToolExecutor,
  ToolRegistry,
  createStructuredToolDefinitions
} from "../src/agent/index.js";
import {
  TFT_COMP_PREFERENCE_RESULT_POLICY_ID,
  createTftResultPolicyExecutor
} from "../src/domain/tft/result-policy.js";

const COMP_PAGE_FIXTURE = JSON.parse(readFileSync(
  new URL("./fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

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
  assert.equal(result.capabilityMatch.status, "understood_and_supported");
  assert.equal(result.taskPlanning.validation.valid, true);
  assert.equal(events[0].data.taskPlan.planVersion, "task-plan.v1");
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

  const routed = await recommendForInput("霞怎么出装", {
    catalog,
    useSession: false,
    response: []
  });
  assert.ok(routed.agentRouting);
  assert.ok(routed.agentTrace);
  assert.equal(routed.agentRouting.route, "semantic");
  assert.equal(Object.keys(routed).includes("agentRouting"), false);
});

test("live single-item recommendations attach a retrieval timestamp before evidence validation", async () => {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry: toolRegistry });
  const executionPlanExecutor = new ExecutionPlanExecutor({
    registry: toolRegistry,
    toolExecutor
  });
  const result = await recommendForInput("霞单件装备排行", {
    catalog: createCatalog(),
    useSession: false,
    bypassQueryCache: true,
    executionPlanSovereignty: true,
    metaTFTClient: {
      async getUnitBuilds() {
        return { data: [] };
      }
    },
    toolRegistry,
    toolExecutor,
    executionPlanExecutor,
    now: () => Date.parse("2026-07-31T02:31:00.000Z")
  });

  assert.equal(result.type, "unit_item_rankings");
  assert.ok(result.executionTrace);
  assert.equal(result.executionTrace.status, "completed");
  assert.equal(result.executionTrace.evidenceStatus, "sufficient");
  assert.equal(result.sourceUpdatedAt, "2026-07-31T02:31:00.000Z");
});

test("ExecutionPlan reports evidence validation instead of an unknown failure stage", async () => {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry: toolRegistry });
  const executionPlanExecutor = new ExecutionPlanExecutor({
    registry: toolRegistry,
    toolExecutor
  });

  await assert.rejects(
    recommendForInput("霞单件装备排行", {
      catalog: createCatalog(),
      useSession: false,
      bypassQueryCache: true,
      executionPlanSovereignty: true,
      metaTFTClient: {
        async getUnitBuilds() {
          return null;
        }
      },
      toolRegistry,
      toolExecutor,
      executionPlanExecutor
    }),
    (error) => {
      assert.equal(error.code, "execution_evidence_invalid");
      assert.match(error.message, /evidence_validation/u);
      assert.doesNotMatch(error.message, /unknown/u);
      return true;
    }
  );
});

test("production path routes 九五 through semantic correction and structured comp statistics", async () => {
  const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
  const toolExecutor = new ToolExecutor({ registry: toolRegistry });
  const executionPlanExecutor = new ExecutionPlanExecutor({
    registry: toolRegistry,
    toolExecutor,
    resultPolicyExecutor: createTftResultPolicyExecutor()
  });
  const result = await recommendForInput("给我推荐九五阵容", {
    catalog: createCatalog(),
    useSession: false,
    compResponse: COMP_PAGE_FIXTURE,
    toolRegistry,
    toolExecutor,
    executionPlanExecutor,
    semanticTakeoverKey: "phase65-fast9"
  });
  assert.equal(result.agentRouting.route, "semantic_correction");
  assert.equal(result.agentRouting.executionPath, "semantic_correction");
  assert.equal(result.agentRouting.semanticDifference.kind, "trusted_correction");
  assert.deepEqual(result.agentRouting.plannedTools, ["comps_rankings"]);
  assert.equal(result.query.preferenceRequested, true);
  assert.equal(result.executionPlan.resultPolicy.type, "registered");
  assert.equal(
    result.executionPlan.resultPolicy.policyId,
    TFT_COMP_PREFERENCE_RESULT_POLICY_ID
  );
  assert.equal(result.executionTrace.resultPolicy.status, "applied");
  assert.equal(result.executionTrace.source, "execution_plan_cache");
  assert.equal(result.retrievalPlan.structuredQueries[0].operation, "comps_rankings");
  assert.equal(result.agentRouting.shadowComparison.resultComparisonStatus, "compared");
  assert.equal(result.agentRouting.shadowComparison.publicResultComparison.equivalent, true);
});
