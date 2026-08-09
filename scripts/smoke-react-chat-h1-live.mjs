import { createCatalog } from "../src/data/static-data.js";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import {
  createSmallWindowRuntimeAsync,
  createSmallWindowServer
} from "../src/app/small-window-server.js";

loadLocalEnvironment();

const UPDATED_AT = "2026-08-06T00:00:00.000Z";
const catalog = createCatalog({
  units: [{
    apiName: "TFT17_Karma",
    zhName: "卡尔玛",
    aliases: ["卡尔玛", "Karma"],
    cost: 4,
    current: true,
    traits: ["TFT17_DarkStar"]
  }],
  items: [{
    apiName: "TFT_Item_GuinsoosRageblade",
    zhName: "鬼索的狂暴之刃",
    shortName: "羊刀",
    aliases: ["羊刀", "鬼索"],
    category: "ordinary_completed",
    current: true,
    obtainable: true
  }],
  traits: [{
    apiName: "TFT17_DarkStar",
    filterId: "TFT17_DarkStar_1",
    zhName: "暗星",
    displayName: "暗星",
    aliases: ["暗星"],
    current: true
  }]
});
const officialEntityDetails = {
  units: new Map([["TFT17_Karma", {
    apiName: "TFT17_Karma",
    name: "卡尔玛",
    cost: 4,
    traitNames: ["暗星"],
    ability: { name: "星能绽放", description: "对目标造成魔法伤害。" },
    stats: { mana: 40, attackRange: 4 },
    source: { url: "fixture:official-chess", updatedAt: UPDATED_AT }
  }]]),
  traits: new Map([["TFT17_DarkStar", {
    apiName: "TFT17_DarkStar",
    name: "暗星",
    description: "暗星弈子获得增益。",
    levels: [{ units: 2, effect: "获得基础增益。" }],
    source: { url: "fixture:official-trait", updatedAt: UPDATED_AT }
  }]]),
  meta: { updatedAt: UPDATED_AT, sources: ["fixture:official-entity"] }
};
const officialItemDetails = new Map([["TFT_Item_GuinsoosRageblade", {
  apiName: "TFT_Item_GuinsoosRageblade",
  name: "鬼索的狂暴之刃",
  effect: "攻击提供可叠加的攻击速度。",
  recipe: [
    { apiName: "TFT_Item_RecurveBow", name: "反曲之弓" },
    { apiName: "TFT_Item_NeedlesslyLargeRod", name: "无用大棒" }
  ],
  sourceUrl: "fixture:official-item"
}]]);
officialItemDetails.meta = { updatedAt: UPDATED_AT, sourceUrl: "fixture:official-item" };

const semanticCalls = [];
const semanticRetriever = {
  async search(query, options = {}) {
    semanticCalls.push({ query, options: structuredClone(options) });
    if (!options.documentTypes?.includes("video_guide")) return [];
    return [{
      id: "local-video-guide-1",
      documentType: "video_guide",
      patch: options.patch,
      locale: options.locale,
      score: 0.92,
      text: "作者建议在中期根据来牌灵活转入暗星体系。",
      updatedAt: UPDATED_AT,
      metadata: {
        source: "local_video_index",
        sourceId: "local-video-1",
        sourceTitle: "暗星运营攻略",
        sourceUrl: "https://www.youtube.com/watch?v=local-video-1",
        author: "本地攻略作者",
        publishedAt: "2026-08-01T00:00:00.000Z",
        patch: options.patch,
        locale: options.locale,
        timestampStart: 42,
        timestampEnd: 68,
        claimType: "creator_advice",
        content: "作者建议在中期根据来牌灵活转入暗星体系。",
        videoVersion: "v1",
        ingestionStatus: "success",
        isCurrentVersion: true
      }
    }];
  }
};

const cases = [
  {
    id: "unit_details",
    input: "卡尔玛技能是什么？请只根据工具证据回答。",
    expectedTools: ["entity_catalog_query", "unit_details"],
    expectedEvidence: ["official_entity_catalog", "official_unit"]
  },
  {
    id: "item_details",
    input: "羊刀什么效果？请先解析装备名称，再根据官方详情回答。",
    expectedTools: ["entity_catalog_query", "item_details"],
    expectedEvidence: ["official_entity_catalog", "official_item"]
  },
  {
    id: "trait_details",
    input: "暗星羁绊是什么效果？请先解析羁绊名称，再根据官方详情回答。",
    expectedTools: ["entity_catalog_query", "trait_details"],
    expectedEvidence: ["official_entity_catalog", "official_trait"]
  },
  {
    id: "local_video_knowledge",
    input: "只检索本地 video_guide：攻略作者对暗星转型有什么建议？不要查询或推断当前胜率、排名和最优方案。",
    expectedTools: ["semantic_search"],
    expectedEvidence: ["semantic_candidates"]
  }
];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function close(server) {
  server.closeIdleConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function validate(testCase, report) {
  const errors = [];
  if (!report.httpOk) errors.push("HTTP request failed");
  if (!["completed", "completed_with_warning"].includes(report.status)) {
    errors.push(`unexpected status ${report.status}`);
  }
  if (JSON.stringify(report.tools) !== JSON.stringify(testCase.expectedTools)) {
    errors.push(`tool sequence ${JSON.stringify(report.tools)} != ${JSON.stringify(testCase.expectedTools)}`);
  }
  if (JSON.stringify(report.evidenceTypes) !== JSON.stringify(testCase.expectedEvidence)) {
    errors.push(`evidence sequence ${JSON.stringify(report.evidenceTypes)} != ${JSON.stringify(testCase.expectedEvidence)}`);
  }
  if (report.legacyCalls) errors.push("legacy recommendation chain invoked");
  if (report.toolCalls > 3) errors.push("tool budget exceeded");
  if (testCase.id.endsWith("_details")) {
    if (report.resolutionStatus !== "resolved") errors.push("name was not uniquely resolved");
    if (!report.detailStatus || report.detailStatus === "not_found") errors.push("detail entity was not found");
    if (report.actions[0]?.tool !== "entity_catalog_query") errors.push("model guessed apiName before catalog resolution");
  }
  if (testCase.id === "local_video_knowledge") {
    if (report.semanticCalls !== 1) errors.push(`expected one local semantic call, got ${report.semanticCalls}`);
    if (report.semanticDocumentTypes.join(",") !== "video_guide") errors.push("video_guide was not explicitly requested");
    if (report.videoAuthor !== "本地攻略作者") errors.push("local video provenance was not preserved");
  }
  return errors;
}

const modelLogs = [];
let legacyCalls = 0;
const runtime = await createSmallWindowRuntimeAsync({
  prewarmCatalog: false,
  fetchItems: false,
  catalog,
  officialEntityDetails,
  officialItemDetails,
  semanticRetriever,
  reactDecisionRequestLog: (event) => modelLogs.push(event),
  recommendForInputImpl: async () => {
    legacyCalls += 1;
    throw new Error("legacy recommendation chain invoked from H1 smoke");
  }
});
if (typeof runtime.reactDecisionProvider !== "function") {
  throw new Error("ReAct decision provider is unavailable; configure the live LLM environment first");
}

const server = createSmallWindowServer({ runtime });
const port = await listen(server);
const reports = [];
try {
  for (const testCase of cases) {
    const logStart = modelLogs.length;
    const legacyStart = legacyCalls;
    const semanticStart = semanticCalls.length;
    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/api/react-chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ input: testCase.input, conversationId: `h1-live-${testCase.id}` })
    });
    const lines = (await response.text()).trim().split(/\n+/u).filter(Boolean).map(JSON.parse);
    const events = lines.filter((line) => line.type === "event").map((line) => line.event);
    const complete = lines.find((line) => line.type === "complete");
    const actions = modelLogs.slice(logStart).filter((entry) => entry.status === "ok").map((entry) => entry.action);
    const evidence = complete?.payload?.evidence ?? [];
    const catalogEvidence = evidence.find((entry) => entry.type === "official_entity_catalog");
    const detailEvidence = evidence.find((entry) => ["official_unit", "official_item", "official_trait"].includes(entry.type));
    const semanticEvidence = evidence.find((entry) => entry.type === "semantic_candidates");
    const localCalls = semanticCalls.slice(semanticStart);
    const report = {
      id: testCase.id,
      model: runtime.reactDecisionProvider.model ?? null,
      httpOk: response.ok && complete?.statusCode === 200,
      status: complete?.payload?.status ?? null,
      terminationReason: complete?.payload?.terminationReason ?? null,
      actions,
      tools: actions.filter((action) => action.type === "call_tool").map((action) => action.tool),
      toolCalls: events.filter((event) => event.type === "tool_started").length,
      evidenceTypes: evidence.map((entry) => entry.type),
      resolutionStatus: catalogEvidence?.value?.resolution?.requests?.[0]?.status ?? null,
      detailStatus: detailEvidence?.value?.status ?? null,
      semanticCalls: localCalls.length,
      semanticDocumentTypes: localCalls[0]?.options?.documentTypes ?? [],
      videoAuthor: semanticEvidence?.value?.hits?.[0]?.author ?? null,
      legacyCalls: legacyCalls - legacyStart,
      latencyMs: Date.now() - startedAt
    };
    report.errors = validate(testCase, report);
    report.ok = report.errors.length === 0;
    reports.push(report);
  }
} finally {
  await close(server);
}

const summary = {
  schemaVersion: "react-chat-h1-live-smoke.v1",
  ok: reports.every((report) => report.ok),
  passed: reports.filter((report) => report.ok).length,
  total: reports.length,
  reports
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
