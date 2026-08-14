import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CURRENT_ITEM_LOCALIZATION,
  MemoryCacheStore,
  buildItemCatalogFromItemsResponse,
  buildUnitCatalogFromExplorerRows,
  createCatalog,
  SQLiteConversationBridgeStore
} from "../src/index.js";
import { createSmallWindowRuntime, startSmallWindowServer } from "../src/app/small-window-server.js";

const portArg = process.argv.find((value) => value.startsWith("--port="));
const bridgeArg = process.argv.find((value) => value.startsWith("--bridge="));
const port = Number(portArg?.slice("--port=".length) ?? 17329);
const acceptanceMode = process.argv.includes("--acceptance");
const karmaTwoOptionMode = process.argv.includes("--karma-two-options");
const missingItemMechanicsMode = process.argv.includes("--missing-item-mechanics");
const observedConclusionMode = process.argv.includes("--observed-conclusion");
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
  },
  {
    unit_builds: "TFT17_Karma&TFT_Item_SpearOfShojin|TFT_Item_JeweledGauntlet|TFT_Item_ArchangelsStaff",
    placement_count: [180, 150, 120, 100, 80, 60, 40, 20]
  },
  {
    unit_builds: "TFT17_Karma&TFT_Item_SpearOfShojin|TFT_Item_Morellonomicon|TFT_Item_ArchangelsStaff",
    placement_count: [120, 110, 100, 90, 70, 50, 35, 25]
  },
  {
    unit_builds: "TFT17_Karma&TFT_Item_BlueBuff|TFT_Item_JeweledGauntlet|TFT_Item_PowerGauntlet",
    placement_count: [90, 85, 80, 70, 60, 50, 40, 25]
  }
];
const visualCompId = "TFT17_Aatrox&TFT17_Xayah|TFT17_Stargazer_1&TFT17_Stargazer_Serpent_1";

let clockTick = 0;
const remoteCallsByDays = new Map();
const cacheStore = new MemoryCacheStore({
  now: () => Date.parse("2026-07-12T10:00:00+08:00") + (clockTick += 100),
  ttlMs: { query: 1, defaultContext: 60_000, session: 60_000 }
});

const conversationBridgeStore = acceptanceMode
  ? await SQLiteConversationBridgeStore.open({
      filePath: resolve(bridgeArg?.slice("--bridge=".length)
        ?? process.env.TFT_AGENT_CONVERSATION_BRIDGE_PATH
        ?? ".artifacts/acceptance-fixture/conversation-bridge.sqlite")
    })
  : null;

const runtime = createSmallWindowRuntime({
  catalog: visualCatalog,
  cacheStore,
  fetchItems: false,
  semanticConfig: { enabled: true, provider: "visual-fixture", locale: "zh-CN" },
  semanticRetriever: {
    async search(query, options = {}) {
      if ((options.documentTypes ?? []).includes("mechanism_knowledge") && /M17|启动|首次施法/iu.test(String(query))) {
        return [{
          id: "acceptance:s17:mechanism:M17",
          seasonContextId: options.seasonContextId ?? "set17-live",
          documentType: "mechanism_knowledge",
          score: 1,
          patch: "16.14",
          locale: "zh-CN",
          source: "acceptance_fixture",
          text: "验收标记 M17：启动装备会影响首次施法等待。本条仅用于验收语义检索，不代表实时强度结论。",
          updatedAt: "2026-08-06T00:00:00.000Z",
          metadata: {
            source: "acceptance_fixture",
            sourceId: "M17",
            claimType: "mechanism",
            season: "17",
            patch: "16.14",
            locale: "zh-CN",
            topics: ["启动", "施法循环"],
            namespace: "mechanism_knowledge"
          }
        }];
      }
      if (!(options.documentTypes ?? []).includes("video_guide")) return [];
      return [{
        id: "youtube:abc123xyz00:item_priority:1",
        seasonContextId: options.seasonContextId ?? "set17-live",
        documentType: "video_guide",
        score: 0.94,
        patch: options.patch ?? "17.7",
        locale: "zh-CN",
        source: "youtube",
        metadata: {
          source: "youtube",
          sourceId: "abc123xyz00",
          sourceTitle: "霞完整攻略：装备、过渡与站位",
          author: "测试攻略频道",
          publishedAt: "2026-07-20",
          season: options.seasonContextId ?? "set17-live",
          patch: options.patch ?? "17.7",
          timestampStart: 332,
          timestampEnd: 351,
          claimType: "creator_advice",
          content: "作者建议在没有其他稳定攻速来源时优先保证羊刀；如果装备散件不支持，则先做可立即提升战力的成装。",
          conditions: ["没有其他稳定攻速来源", "散件允许优先合成羊刀"],
          topics: ["霞", "羊刀", "装备"],
          sourceUrl: "https://www.youtube.com/watch?v=abc123xyz00",
          namespace: "video_guides",
          videoVersion: "version-001",
          transcriptHash: "transcript-hash-001",
          segmentId: "version-001:0000:segment",
          segmentIndex: 0,
          segmentStatus: "success",
          ingestionStatus: "success",
          aiGenerated: true,
          contentOrigin: "ai_generated_transcript_summary",
          reviewStatus: "ai_generated_unreviewed",
          contentDisclosure: "AI-generated from the transcript; not human-reviewed.",
          extractionModel: "visual-fixture-model",
          isCurrentVersion: true
        }
      }];
    }
  },
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
    const conclusion = {
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
    if (observedConclusionMode) {
      conclusion.summary = "观察模式测试：红霸符前四率为99.9%。";
    }
    return conclusion;
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
  }], ...[
    ["TFT_Item_JeweledGauntlet", "珠光护手", "携带者的技能可以暴击，并提供法术强度与暴击属性。"],
    ["TFT_Item_Morellonomicon", "莫雷洛秘典", "携带者造成魔法或真实伤害时施加灼烧与重伤，降低目标受到的治疗。"],
    ["TFT_Item_SpearOfShojin", "朔极之矛", "携带者的攻击提供额外法力值，帮助更快再次施放技能。"],
    ["TFT_Item_BlueBuff", "蓝霸符", "携带者获得法力值，并强化技能循环相关的法力供给。"],
    ["TFT_Item_ArchangelsStaff", "大天使之杖", "战斗中随时间获得法术强度。"],
    ["TFT_Item_PowerGauntlet", "破防者", "对带有护盾的目标造成伤害后获得持续伤害增益。"]
  ].filter(([apiName]) => !(missingItemMechanicsMode && apiName === "TFT_Item_Morellonomicon"))
    .map(([apiName, name, effect]) => [apiName, {
      apiName,
      name,
      effect,
      attributes: [],
      recipe: [],
      craftable: true,
      source: {
        url: "https://game.gtimg.cn/images/lol/act/img/tft/equip.js",
        updatedAt: "2026-08-06T00:00:00.000Z"
      },
      sourceUrl: "https://game.gtimg.cn/images/lol/act/img/tft/equip.js"
    }])]),
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
      const requestedUnit = String(plan?.pathUnit ?? plan?.params?.unit ?? "");
      const calls = (remoteCallsByDays.get(days) ?? 0) + 1;
      remoteCallsByDays.set(days, calls);
      if (days === 30 && calls > 1) {
        throw new Error(`离线视觉 fixture 模拟 ${days} 天数据源失败`);
      }
      const selectedRows = requestedUnit
        ? rows.filter((row) => String(row.unit_builds).startsWith(`${requestedUnit}&`))
        : rows;
      const acceptanceRows = karmaTwoOptionMode && requestedUnit === "TFT17_Karma"
        ? selectedRows.map((row, index) => index === 2
          ? { ...row, placement_count: [40, 35, 30, 25, 20, 15, 10, 5] }
          : row)
        : selectedRows;
      return {
        data: acceptanceRows,
        capture: { capturedAt: "2026-07-12T10:00:00+08:00" }
      };
    }
  },
  compsClient: {
    async getCompsData() {
      return compPageFixture.compsData;
    },
    async getCompsStats() {
      return compPageFixture.compsStats;
    }
  },
  ...(acceptanceMode ? {
    acceptanceMode: true,
    reactChatMode: "on",
    conversationBridgeMode: "on",
    conversationBridgeStore,
    reactDecisionProvider: async (request) => {
      const question = String(request.state?.question ?? "");
      const evidence = request.state?.evidence ?? [];
      if (evidence.length) {
        const historicalEvidence = evidence.find((entry) => entry.temporalStatus === "historical");
        if (historicalEvidence) {
          return {
            schemaVersion: "react-action.v1",
            type: "finish",
            answer: "我记得刚才快捷工具的目的和结果；以下只复述历史记录。",
            evidenceIds: [historicalEvidence.evidenceId],
            reasonCode: "sufficient_evidence"
          };
        }
        const usedM17 = evidence.some((entry) => entry.toolName === "semantic_search");
        const buildEvidence = evidence.find((entry) => (
          entry.toolName === "unit_builds_batch"
          && entry.value?.results?.some((result) => result.buildOptions?.length)
        ));
        const buildOptions = buildEvidence?.value?.results?.[0]?.buildOptions ?? [];
        const mechanismPlan = buildEvidence?.value?.results?.[0]?.mechanismQueryPlan;
        const itemBatchEvidence = evidence.find((entry) => entry.toolName === "item_details_batch");
        if (buildEvidence && mechanismPlan?.apiNames?.length && !itemBatchEvidence) {
          return {
            schemaVersion: "react-action.v1",
            type: "call_tool",
            tool: "item_details_batch",
            arguments: {
              apiNames: mechanismPlan.apiNames,
              seasonContextId: request.state?.seasonContextId ?? "set17-live",
              locale: "zh-CN"
            },
            purposeCode: "retrieve_entity_details"
          };
        }
        const itemEvidenceByApiName = new Map((itemBatchEvidence?.value?.items ?? []).map((item) => [item.apiName, item]));
        const mechanismAvailable = itemBatchEvidence?.value?.mechanismStatus === "available";
        return {
          schemaVersion: "react-action.v1",
          type: "finish",
          answer: usedM17
            ? "M17 验收知识命中：启动装备会影响首次施法等待；这不是实时强度结论。"
            : "已根据捕获的 Set17 卡尔玛出装样本返回当前验收结果。",
          evidenceIds: evidence.map((entry) => entry.evidenceId),
          reasonCode: "sufficient_evidence",
          narrative: buildEvidence ? {
            schemaVersion: "grounded-build-narrative.v1",
            summary: {
              text: "当前数据支持多套有效构筑，第一套的样本覆盖与综合稳定性最好。",
              evidenceIds: [buildEvidence.evidenceId]
            },
            options: buildOptions.map((option) => ({
              optionId: option.optionId,
              statisticalBasis: {
                text: option.rank === 1
                  ? "这套由确定性稳健排序列为当前首选，样本覆盖与综合稳定性最高。"
                  : "这套是确定性排序中的备选，数据表现与样本量低于稳定方案。",
                evidenceIds: [buildEvidence.evidenceId]
              },
              mechanismDifference: (() => {
                const comparison = mechanismPlan?.comparisons?.find((entry) => entry.optionId === option.optionId);
                const apiNames = (comparison?.selectedPairs ?? []).flatMap((pair) => (
                  [pair.removedApiName, pair.addedApiName].filter(Boolean)
                ));
                const items = apiNames.map((apiName) => itemEvidenceByApiName.get(apiName)).filter(Boolean);
                if (!mechanismAvailable || !apiNames.length || items.length !== apiNames.length) return null;
                return {
                  text: items.map((item) => `${item.displayName ?? item.apiName}：${item.facts.effect}`).join("；"),
                  comparedItemApiNames: apiNames,
                  evidenceRefs: items.map((item) => ({
                    evidenceId: itemBatchEvidence.evidenceId,
                    claimId: item.claimId
                  }))
                };
              })(),
              tradeoffs: [],
              risks: mechanismAvailable
                ? (option.role === "best_available" ? ["当前没有方案达到稳定门槛。"] : [])
                : ["缺少当前赛季装备机制证据，暂不做适用场景推断。"],
              suitableWhen: (() => {
                const comparison = mechanismPlan?.comparisons?.find((entry) => entry.optionId === option.optionId);
                const apiNames = (comparison?.selectedPairs ?? []).flatMap((pair) => (
                  [pair.removedApiName, pair.addedApiName].filter(Boolean)
                ));
                const items = apiNames.map((apiName) => itemEvidenceByApiName.get(apiName)).filter(Boolean);
                if (!mechanismAvailable || !items.length) return [];
                const hasWound = items.some((item) => /重伤|治疗|回复/u.test(String(item.facts?.effect ?? "")));
                return [{
                  text: hasWound
                    ? "当对方回复能力较高，或己方缺少限制回复手段时，可以考虑这套备选。"
                    : "当更需要这组差异装备提供的技能循环或功能机制时，可以考虑该方案。",
                  inferenceType: "mechanism_based_advice",
                  evidenceRefs: items.map((item) => ({
                    evidenceId: itemBatchEvidence.evidenceId,
                    claimId: item.claimId
                  }))
                }];
              })()
            }))
          } : null
        };
      }
      if (/M17|启动装备|首次施法/iu.test(question)) {
        return {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: "semantic_search",
          arguments: { query: question.slice(0, 240), documentTypes: ["mechanism_knowledge"], patch: "16.14", topK: 4 },
          purposeCode: "retrieve_supporting_knowledge"
        };
      }
      if (/卡尔玛|Karma/iu.test(question) && /出装|装备|build/iu.test(question)) {
        return {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: "unit_builds_batch",
          arguments: { entities: [{ apiName: "TFT17_Karma", name: "卡尔玛" }], minSamples: karmaTwoOptionMode ? 200 : 0 },
          purposeCode: "retrieve_current_statistics"
        };
      }
      if (/现在|当前|最新|胜率|前四率/iu.test(question)) {
        const referencedChampion = request.state?.bridgeContext?.records?.[0]?.normalizedArguments?.champion;
        if (/卡尔玛|Karma/iu.test(String(referencedChampion ?? ""))) {
          return {
            schemaVersion: "react-action.v1",
            type: "call_tool",
            tool: "unit_builds_batch",
            arguments: { entities: [{ apiName: "TFT17_Karma", name: "卡尔玛" }], minSamples: karmaTwoOptionMode ? 200 : 0 },
            purposeCode: "retrieve_current_statistics"
          };
        }
      }
      const historical = request.state?.bridgeContext?.records?.[0];
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: historical
          ? `我记得刚才快捷工具的目的和结果：${historical.displaySummary || historical.operation}。`
          : "这是普通聊天路径，当前没有执行快捷工具。",
        evidenceIds: [],
        reasonCode: "direct_answer"
      };
    }
  } : {})
});

const started = await startSmallWindowServer({
  host: "127.0.0.1",
  port,
  runtime,
  prewarmCatalog: false
});

console.log(`visual fixture server ${started.url}`);

const shutdown = () => started.server.close(() => {
  conversationBridgeStore?.close();
  process.exit(0);
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
