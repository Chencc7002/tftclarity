import { readFile } from "node:fs/promises";
import { createCatalog, MemoryCacheStore } from "../../src/index.js";
import { createSmallWindowRuntime, queryCompositionRankings, handleCompDetailRequest } from "../../src/app/small-window-server.js";
import { ToolRegistry } from "../../src/agent/tools/registry.js";
import { createStructuredToolDefinitions } from "../../src/agent/tools/definitions.js";
import { EvidenceLedger } from "../../src/react/evidence-ledger.js";
import { createLegacySeasonFixture } from "./season-context.js";

// Offline provider fixtures passed through the real ranking/detail adapters and
// Ledger. This tests presentation, not real-model behavior or retrieval quality.
export async function compositionCardPayload({ includeEquipment = false } = {}) {
  const now = Date.now();
  const raw = JSON.parse(await readFile(new URL("./comp-rankings/metatft-comps-page-minimal.json", import.meta.url), "utf8"));
  raw.compsData.updated = now;
  raw.compsStats.updated = now;
  const names = [...new Set(Object.values(raw.compsData.results.data.cluster_details).flatMap((row) => row.units_string.split(",").map((name) => name.trim())))];
  const catalog = createCatalog({ units: names.map((apiName) => ({ apiName, name: apiName, zhName: apiName, traits: [] })), items: [], traits: [] });
  const rankings = await queryCompositionRankings({ limit: 3 }, catalog, {
    compsClient: { getCompsData: async () => raw.compsData, getCompsStats: async () => raw.compsStats }
  }, { seasonContext: { id: "set17-live", currentPatch: "17.9", environment: "live", source: { queue: "1100" } }, details: { units: new Map() } });
  const plans = rankings.results.map((row) => row.tacticalDetailQueryPlan);
  const registry = new ToolRegistry(createStructuredToolDefinitions());
  let nextId = 0;
  const ledger = new EvidenceLedger({ createId: () => `card-evidence-${++nextId}` });
  const add = (toolName, value) => {
    const definition = registry.get(toolName);
    ledger.add({ definition, toolResult: { toolName, toolCallId: `card-call-${nextId}`, status: "completed", value,
      metadata: { source: definition.source, evidenceType: definition.evidenceType, updatedAt: value.source.updatedAt, modelGeneratedStatistics: false } },
    evidenceContract: { source: definition.source, type: definition.evidenceType, requiredFields: ["source", "updatedAt"], allowModelGeneratedStatistics: false } });
  };
  add("comps_rankings", rankings);
  for (const [index, plan] of plans.slice(0, 2).entries()) {
    const runtime = createSmallWindowRuntime({ catalog, cacheStore: new MemoryCacheStore(),
      seasonContextService: createLegacySeasonFixture(), compsClient: {
      getCompDetails: async () => ({ updated: now, results: { positioning: { units: Object.fromEntries(plan.units.map((apiName, offset) =>
        [apiName, { positions: [{ cell: offset + 1 + index * 7, count: 10 }] }])) } } }),
      getCompAugmentTiers: async () => ({ updated: now, results: {} })
    } });
    add("composition_tactical_details", { ...await handleCompDetailRequest({ compId: plan.compositionId, clusterId: plan.clusterId, units: plan.units, seasonContextId: plan.seasonContextId }, runtime),
      type: "composition_tactical_details", compositionRef: { compId: plan.compositionId, clusterId: plan.clusterId } });
  }
  if (includeEquipment) add("unit_builds", { type: "unit_build_rankings", unit: { apiName: plans[0].units[0], name: plans[0].units[0] },
    coreItemSummary: { recommendationCount: 1, requiredAppearances: 1, items: [] },
    cards: [{ title: "固定样本装备", items: [{ apiName: "TFT_Item_InfinityEdge", name: "无尽之刃" }], stats: { games: 100, avg: 4, top4: 0.5, win: 0.1 } }],
    query: { unit: plans[0].units[0], seasonContextId: "set17-live", patch: "17.9" }, source: { provider: "metatft", updatedAt: new Date(now).toISOString() } });
  const entries = ledger.snapshot().entries;
  return { ok: true, type: "react_chat_result", status: "completed", answerOrigin: "fixture",
    answer: "以下为离线样本：三张阵容卡片分别保留自己的成员和站位。前两张有站位数据，第三张明确标记暂无站位。",
    evidence: entries, evidenceIds: entries.map((entry) => entry.evidenceId), observations: [] };
}
