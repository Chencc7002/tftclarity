import { readFileSync } from "node:fs";
import {
  CURRENT_ITEM_LOCALIZATION,
  MemoryCacheStore,
  buildItemCatalogFromItemsResponse,
  buildUnitCatalogFromExplorerRows,
  createCatalog
} from "../src/index.js";
import { createSmallWindowRuntime, startSmallWindowServer } from "../src/app/small-window-server.js";

const portArg = process.argv.find((value) => value.startsWith("--port="));
const port = Number(portArg?.slice("--port=".length) ?? 17329);
const NAVORI = "TFT_Item_Artifact_NavoriFlickerblades";
const HYDRA = "TFT_Item_Artifact_TitanicHydra";
const RAGEBLADE = "TFT_Item_GuinsoosRageblade";
const INFINITY_EDGE = "TFT_Item_InfinityEdge";
const STARGAZER_EMBLEM = "TFT17_Item_StargazerEmblemItem";
const compPageFixture = JSON.parse(readFileSync(
  new URL("../test/fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));
compPageFixture.compsData.results.data.comps = {
  "409002": { "Average Placement Change": -0.31 },
  "409003": { "Average Placement Change": 0.25 },
  "409019": { "Average Placement Change": -0.14 },
  "409092": { "Average Placement Change": 0.09 }
};
// Keep one deliberately crowded comp in the visual fixture so the 60%
// selection-rate badge remains covered by browser QA.
compPageFixture.compsStats.results[0].places[0] = 20000;
const visualUnitApiNames = [...new Set(Object.values(
  compPageFixture.compsData.results.data.cluster_details
).flatMap((comp) => String(comp.units_string ?? "").split(/,\s*/).filter(Boolean)))];
const visualCatalog = createCatalog({
  units: buildUnitCatalogFromExplorerRows({
    data: [...visualUnitApiNames, "TFT17_Xayah", "TFT17_Kaisa"].map((apiName) => ({
      units_unique: `${apiName}-1`,
      placement_count: [20, 18, 16, 14, 12, 10, 8, 6]
    }))
  }, { patch: "current" }),
  items: buildItemCatalogFromItemsResponse({
    data: CURRENT_ITEM_LOCALIZATION.items.map((item) => ({ items: item.apiName }))
  }, { patch: "current" })
});
const rows = [
  {
    unit_builds: `TFT17_Xayah&${NAVORI}|${RAGEBLADE}|${INFINITY_EDGE}`,
    placement_count: [190, 100, 80, 60, 40, 25, 15, 10]
  },
  {
    unit_builds: `TFT17_Xayah&${HYDRA}|${RAGEBLADE}|${INFINITY_EDGE}`,
    placement_count: [150, 100, 80, 60, 40, 25, 15, 10]
  },
  {
    unit_builds: `TFT17_Xayah&${NAVORI}|${HYDRA}|${RAGEBLADE}`,
    placement_count: [90, 70, 50, 40, 25, 15, 7, 3]
  },
  {
    unit_builds: `TFT17_Xayah&${STARGAZER_EMBLEM}|${RAGEBLADE}|${INFINITY_EDGE}`,
    placement_count: [100, 80, 60, 45, 30, 20, 10, 5]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_RapidFireCannon|TFT_Item_RunaansHurricane|TFT_Item_RunaansHurricane",
    placement_count: [150, 120, 90, 70, 40, 25, 15, 10]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
    placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_LastWhisper|TFT_Item_Deathblade",
    placement_count: [60, 55, 50, 50, 40, 30, 20, 10]
  },
  {
    unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_SpearOfShojin|TFT_Item_Deathblade",
    placement_count: [5, 4, 3, 2, 1, 1, 1, 1]
  }
];
const visualCompId = "TFT17_Aatrox&TFT17_Xayah|TFT17_Stargazer_1&TFT17_Stargazer_Serpent_1";

let clockTick = 0;
const remoteCallsByDays = new Map();
const cacheStore = new MemoryCacheStore({
  now: () => Date.parse("2026-07-12T10:00:00+08:00") + (clockTick += 100),
  ttlMs: { query: 1, defaultContext: 60_000, session: 60_000 }
});

const runtime = createSmallWindowRuntime({
  catalog: visualCatalog,
  cacheStore,
  fetchItems: false,
  conclusionProvider: async ({ evidence }) => {
    const primary = evidence.recommendations?.[0];
    const games = primary?.stats?.games ?? 0;
    const lowSample = evidence.recommendations?.some((entry) => entry.lowSample);
    const dimensions = evidence.questionContract.requiredAnswerDimensions;
    const lockedNames = (evidence.query?.lockedItems ?? [])
      .map((item) => item.name)
      .filter(Boolean);
    const lockedLabel = lockedNames.join("、");
    const dimensionText = {
      build_performance: `候选分析：当前首选方案覆盖${games}场样本，前四率、吃鸡率和平均名次均来自同一查询口径；其余可见方案按页面原有顺序保留，方便结合样本量继续比较。`,
      completion_options: `候选分析：当前首选补齐方案覆盖${games}场样本，前四率、吃鸡率和平均名次均来自同一查询口径；其余候选仍按页面原有顺序保留，方便结合样本量继续比较。`,
      core_item_tendency: "核心倾向：只统计前三个可见方案中的装备共现；出现次数达到既定门槛才列为共同倾向，若频次接近则不强行指定唯一核心装备。",
      locked_item_compatibility: `已携带${lockedLabel || "装备"}只作为查询前置条件，不参与补齐装备的频次统计；补齐建议仅比较剩余装备槽位，并保留原始三件套数据供核对。`,
      sample_risk: "数据提醒：当前结果包含低样本候选，名次与胜率更容易波动；建议同时查看样本量，并在刷新数据后再次确认。"
    };
    return {
      schemaVersion: "llm_conclusion.v2",
      contractId: evidence.questionContract.contractId,
      status: "ok",
      addressedDimensions: dimensions,
      missingDimensions: [],
      missingEvidence: [],
      headline: lockedLabel
        ? `推荐：在已携带${lockedLabel}的条件下，优先采用当前排名第一的补齐组合。`
        : "推荐：优先采用当前排名第一的三件套，并保留其余候选作为对照。",
      summary: "以下解读只组织已展示的统计事实，不改变本地排序与比较结果。",
      reasons: dimensions.map((dimension, index) => ({
        dimension,
        evidenceIds: [evidence.recommendations?.[Math.min(index, evidence.recommendations.length - 1)]?.evidenceId ?? primary.evidenceId],
        text: dimensionText[dimension] ?? `当前首条证据包含${games}场样本。`
      })),
      alternatives: [],
      nextAction: "先按结构化结果行动，再参考候选组合表现。",
      riskNotice: lowSample ? "其中包含低样本结果，仅供参考。" : null
    };
  },
  officialItemDetails: new Map([[STARGAZER_EMBLEM, {
    apiName: STARGAZER_EMBLEM,
    name: "观星者纹章",
    effect: "携带者获得观星者羁绊。",
    attributes: [],
    recipe: [],
    craftable: false,
    iconUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%235b6fe8'/%3E%3Cpath d='M32 8l6 18 18 6-18 6-6 18-6-18-18-6 18-6z' fill='white'/%3E%3C/svg%3E",
    sourceUrl: "https://game.gtimg.cn/images/lol/act/img/tft/equip.js"
  }]]),
  metaTFTClient: {
    async getCompCandidates(plan) {
      const days = Number(plan?.params?.days ?? 3);
      return {
        data: [{
          units_traits: visualCompId,
          comp_name: "观星霞",
          placement_count: days === 14
            ? [1, 1, 1, 1, 1, 1, 1, 1]
            : [220, 190, 160, 130, 80, 50, 30, 20]
        }],
        filter_adjustment: { sample_size: days === 14 ? 100 : 123456 }
      };
    },
    async getUnitBuilds(plan) {
      const days = Number(plan?.params?.days ?? 3);
      const calls = (remoteCallsByDays.get(days) ?? 0) + 1;
      remoteCallsByDays.set(days, calls);
      if (days === 30 && calls > 1) {
        throw new Error(`离线视觉 fixture 模拟 ${days} 天数据源失败`);
      }
      return { data: rows, capture: { capturedAt: "2026-07-12T10:00:00+08:00" } };
    }
  },
  compsClient: {
    async getCompsData() {
      return compPageFixture.compsData;
    },
    async getCompsStats() {
      return compPageFixture.compsStats;
    }
  }
});

const started = await startSmallWindowServer({
  host: "127.0.0.1",
  port,
  runtime,
  prewarmCatalog: false
});

console.log(`visual fixture server ${started.url}`);

const shutdown = () => started.server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
