import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createCatalog, MemoryCacheStore, buildOfficialTftItemDetailsCatalog } from "../src/index.js";
import { createSmallWindowRuntime, createDefaultReactToolHandlerBundle, handleReactChatRequest, handleRecommendRequest } from "../src/app/small-window-server.js";
import { queryEmblemRankings } from "../src/core/emblem-rankings.js";
import { validateFinishAction } from "../src/react/termination-policy.js";

const A = "DA_18_EmblemBrawler", B = "DA_18_EmblemFae", U = "DA_18_Ahri";
const catalog = createCatalog({ units: [{ apiName: U, zhName: "阿狸", enName: "Ahri", aliases: ["阿狸"] }],
  items: [{ apiName: A, zhName: "斗士纹章", aliases: ["斗士纹章"], category: "emblem", current: true, obtainable: true },
    { apiName: B, zhName: "花仙子纹章", aliases: ["花仙子纹章"], category: "emblem", current: true, obtainable: true }] });
const details = buildOfficialTftItemDetailsCatalog([
  { equipId: "1", englishName: "DA_Component_FryingPan", name: "金锅锅" },
  { equipId: "2", englishName: "DA_Component_GiantsBelt", name: "巨人腰带" },
  { equipId: "3", englishName: A, name: "斗士纹章", formula: "1,2" },
  { equipId: "4", englishName: "DA_Component_Spatula", name: "金铲铲" },
  { equipId: "5", englishName: B, name: "花仙子纹章", formula: "4,2" }
]);
const response = { data: [{ items: A, placement_count: [100,200,300,400,300,200,100,100] },
  { items: B, placement_count: [200,200,200,200,100,100,100,100] }] };
function runtime(options = {}) {
  return createSmallWindowRuntime({ catalog, cacheStore: new MemoryCacheStore(), fetchItems: false,
    officialItemDetails: details, fetchOfficialItemDetails: async () => details,
    metaTFTClient: { getItems: async () => response,
      getItemCarrierBuilds: async () => ({ data: [{ unit_builds: `${U}&${A}`, placement_count: [0,0,0,0,200,100,0,0] }] }) },
    compsClient: { getUnitItemsProcessed: async () => ({ units: { [U]: { avg: 4 } } }) },
    reactEmblemRankings: true, reactGroundingMode: "strict", ...options });
}
const request = { input: "金锅锅能合什么转职，比较一下数据", seasonContextId: "set18-live", locale: "zh-CN" };
const call = (tool, args) => ({ schemaVersion: "react-action.v1", type: "call_tool", tool, arguments: args, purposeCode: "retrieve_current_statistics" });
const finish = (evidence, answer) => ({ schemaVersion: "react-action.v1", type: "finish", answer,
  evidenceIds: evidence.map(entry => entry.evidenceId), reasonCode: "sufficient_evidence" });

test("shadow equivalence: Quick Task and ReAct share ranking population and statistics", async () => {
  const app = runtime();
  const quick = await handleRecommendRequest({ input: "查询转职强度", preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", id: "emblem-rankings", operation: "emblem_rankings", requestId: "parity", arguments: {} } }, app);
  const bundle = await createDefaultReactToolHandlerBundle({ runtime: app, request });
  const chat = await bundle.handlers.emblem_rankings({});
  assert.equal(quick.statusCode, 200);
  assert.deepEqual(chat.rows, quick.payload.rows);
  assert.deepEqual(chat.analysis, quick.payload.analysis);
  assert.equal(chat.scope.seasonContextId, "set18-live");
  assert.equal(chat.query.queue, "1100");
  assert.equal(app.toolRegistry.get("emblem_rankings").inputSchema.additionalProperties, false);
  for (const key of ["patch", "queue", "seasonContextId", "url"]) assert.equal(app.toolRegistry.get("emblem_rankings").inputSchema.properties[key], undefined);
});

test("ReAct receives filtered evidence, analyses it, and uses the existing carrier serializer", async () => {
  let step = 0;
  const app = runtime({ reactDecisionProvider: async ({ state, toolCatalog }) => {
    assert.ok(toolCatalog.some(tool => tool.name === "emblem_rankings"));
    if (step++ === 0) return call("emblem_rankings", { recipeBase: "pan", primaryMetric: "games" });
    if (step === 2) {
      assert.deepEqual(state.evidence[0].value.rows.map(row => row.item.apiName), [A]);
      assert.equal(state.evidence[0].value.analysis.leaders.games.apiName, A);
      return call("emblem_carriers", { item: A });
    }
    const carriers = state.evidence.find(entry => entry.toolName === "emblem_carriers").value;
    assert.equal(carriers.type, "item_carrier_rankings");
    assert.equal(carriers.item.name, "斗士纹章");
    assert.equal(carriers.query.positiveOnly, false);
    assert.equal(carriers.carriers[0].stats.games, 300);
    assert.ok(carriers.carriers[0].placementUplift < 0);
    return finish(state.evidence, "斗士纹章样本数 1700；常见携带者阿狸样本数 300。常见不等于最优。");
  } });
  const result = await handleReactChatRequest({ ...request, input: "斗士纹章最常见的携带英雄是谁？按携带样本数说，不需要装备效果解释。" }, app);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.terminationReason, "completed", JSON.stringify(result.payload));
  assert.deepEqual(result.payload.evidence.map(entry => entry.toolName), ["emblem_rankings", "emblem_carriers"]);
});

test("global comparisons are deterministic descriptive differences and keep missing IDs explicit", async () => {
  const result = await queryEmblemRankings({ client: { getItems: async () => response }, catalog, itemDetails: details,
    query: { queue: "1100", patch: "current", days: 3, apiNames: [A, B], recipeBase: "all" } });
  const [left, right] = result.rows;
  const difference = result.analysis.comparisons[0];
  assert.equal(difference.left, left.item.apiName);
  assert.equal(difference.avgPlacementDifference, Number((left.stats.avgPlacement - right.stats.avgPlacement).toFixed(4)));
  assert.match(result.analysis.statementPolicy, /may overlap/);
  assert.equal(result.analysis.population, "global_item_presence_in_games_with_at_least_one_emblem");
  const filtered = await queryEmblemRankings({ client: { getItems: async () => response }, catalog, itemDetails: details,
    query: { queue: "1100", patch: "current", days: 3, apiNames: [B], recipeBase: "pan" } });
  assert.equal(filtered.status, "not_found");
  assert.deepEqual(filtered.missingApiNames, [B]);
});

test("rollback hides new tools and ungrounded carrier IDs cannot retrieve facts", async () => {
  const disabled = await createDefaultReactToolHandlerBundle({ runtime: runtime({ reactEmblemRankings: false }), request });
  assert.equal(disabled.handlers.emblem_rankings, undefined);
  let calls = 0;
  const app = runtime({ metaTFTClient: { getItemCarrierBuilds: async () => { calls++; } },
    reactDecisionProvider: async () => call("emblem_carriers", { item: A }) });
  const result = await handleReactChatRequest(request, app);
  assert.equal(calls, 0);
  assert.notEqual(result.payload.terminationReason, "completed");
});

test("emblem tool schemas reject model scope overrides and unbounded filters before handlers", async () => {
  const app = runtime();
  let calls = 0;
  for (const args of [{ patch: "18.0" }, { queue: "1160" }, { seasonContextId: "set17-live" },
    { recipeBase: "unknown" }, { days: 999 }, { limit: 999 }, { minSamples: -1 }, { rank: ["platinum_plus"] }]) {
    await assert.rejects(app.toolExecutor.execute("emblem_rankings", args,
      { source: "metatft", handler: async () => { calls++; } }), error => error.code === "invalid_tool_input");
  }
  assert.equal(calls, 0);
});

test("invented numerical analysis and historical-only ranking claims fail existing evidence checks", async () => {
  const value = await queryEmblemRankings({ client: { getItems: async () => response }, catalog, itemDetails: details,
    query: { queue: "1100", patch: "current", days: 3 } });
  const entry = { evidenceId: "ev-emblem", toolName: "emblem_rankings", value };
  const ledger = { resolve: () => [entry], snapshot: () => ({ entries: [entry] }) };
  assert.equal(validateFinishAction(finish([entry], "斗士纹章样本数 1700。"), ledger).valid, true);
  assert.equal(validateFinishAction(finish([entry], "斗士纹章胜率 99.987%。"), ledger).valid, false);
  entry.temporalStatus = "historical";
  assert.equal(validateFinishAction(finish([entry], "当前斗士纹章样本数 1700。"), ledger).valid, false);
});

test("chat native result adapter reuses the emblem ranking view and preserves the model analysis", () => {
  const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
  const context = vm.createContext({ conclusionDisplayText: String, collectCompositionResultGroups: () => [], normalizeReactCompositionRankings: value => value, t: String });
  vm.runInContext(app.slice(app.indexOf("function normalizeEndpointPayload("), app.indexOf("function reactChatMessages(")), context);
  const result = context.normalizeEndpointPayload({ type: "react_chat_result", status: "completed", answer: "数据分析",
    evidenceIds: ["ev"], evidence: [{ evidenceId: "ev", value: { type: "emblem_rankings", rows: [], query: { recipeBase: "pan" } } }] });
  assert.equal(result.type, "emblem_rankings");
  assert.equal(result.query.recipeBase, "pan");
  assert.equal(result.reactAnswer, "数据分析");
});
