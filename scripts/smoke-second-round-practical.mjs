import { readFileSync } from "node:fs";
import {
  CURRENT_ITEM_LOCALIZATION,
  MemoryCacheStore,
  buildItemCatalogFromItemsResponse,
  buildTraitCatalogFromExplorerRows,
  buildUnitCatalogFromExplorerRows,
  createCatalog
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

const unitIds = ["TFT17_Xayah", "TFT17_Kaisa", "TFT17_Ornn"];
const stargazerEffects = ["Medallion", "Shield", "Huntress", "Fountain", "Mountain", "Serpent", "Wolf"];
const units = buildUnitCatalogFromExplorerRows({
  data: unitIds.map((apiName) => ({
    units_unique: `${apiName}-1`,
    placement_count: [20, 18, 16, 14, 12, 10, 8, 6]
  }))
}, { patch: "current" });
const traits = buildTraitCatalogFromExplorerRows({
  data: [
    { traits: "TFT17_Stargazer_1", placement_count: [20, 18, 16, 14, 12, 10, 8, 6] },
    ...stargazerEffects.map((effect) => ({
      traits: `TFT17_Stargazer_${effect}_1`,
      placement_count: [20, 18, 16, 14, 12, 10, 8, 6]
    }))
  ]
}, { patch: "current" });
const items = buildItemCatalogFromItemsResponse({
  data: CURRENT_ITEM_LOCALIZATION.items.map((item) => ({ items: item.apiName }))
}, { patch: "current" });
const catalog = createCatalog({ units, traits, items });

const NAVORI = "TFT_Item_Artifact_NavoriFlickerblades";
const HYDRA = "TFT_Item_Artifact_TitanicHydra";
const DEFIANCE = "TFT4_Item_OrnnDeathsDefiance";
const RAGEBLADE = "TFT_Item_GuinsoosRageblade";
const INFINITY_EDGE = "TFT_Item_InfinityEdge";
const GIANT_SLAYER = "TFT_Item_GiantSlayer";
const STARGAZER_EMBLEM = "TFT17_Item_StargazerEmblemItem";
const JUSTICE = "TFT_Item_UnstableConcoction";

function placement(first, total = 520) {
  const rest = Math.max(0, total - first);
  return [
    first,
    Math.floor(rest * 0.28),
    Math.floor(rest * 0.22),
    Math.floor(rest * 0.18),
    Math.floor(rest * 0.12),
    Math.floor(rest * 0.09),
    Math.floor(rest * 0.06),
    Math.floor(rest * 0.05)
  ];
}

const unitRows = [
  { unit_builds: `TFT17_Xayah&${NAVORI}|${RAGEBLADE}|${INFINITY_EDGE}`, placement_count: placement(190, 520) },
  { unit_builds: `TFT17_Xayah&${HYDRA}|${RAGEBLADE}|${INFINITY_EDGE}`, placement_count: placement(150, 480) },
  { unit_builds: `TFT17_Xayah&${DEFIANCE}|${RAGEBLADE}|${INFINITY_EDGE}`, placement_count: placement(130, 450) },
  { unit_builds: `TFT17_Xayah&${NAVORI}|${HYDRA}|${RAGEBLADE}`, placement_count: placement(90, 300) },
  { unit_builds: `TFT17_Xayah&${STARGAZER_EMBLEM}|${RAGEBLADE}|${INFINITY_EDGE}`, placement_count: placement(100, 350) },
  { unit_builds: `TFT17_Xayah&TFT5_Item_GuinsoosRagebladeRadiant|${INFINITY_EDGE}|${GIANT_SLAYER}`, placement_count: placement(20, 60) },
  { unit_builds: `TFT17_Xayah&TFT5_Item_InfinityEdgeRadiant|${RAGEBLADE}|${GIANT_SLAYER}`, placement_count: placement(15, 50) },
  { unit_builds: `TFT17_Kaisa&${NAVORI}|${RAGEBLADE}|${INFINITY_EDGE}`, placement_count: placement(180, 500) },
  { unit_builds: `TFT17_Kaisa&${HYDRA}|${RAGEBLADE}|${INFINITY_EDGE}`, placement_count: placement(140, 460) }
];

const compFixture = JSON.parse(readFileSync(
  new URL("../test/fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));

const officialItemDetails = new Map([
  [STARGAZER_EMBLEM, {
    apiName: STARGAZER_EMBLEM,
    name: "观星者纹章",
    effect: "携带者获得观星者羁绊。",
    attributes: [],
    recipe: [],
    craftable: false,
    iconUrl: "https://example.test/items/stargazer-emblem.png",
    sourceUrl: "https://game.gtimg.cn/images/lol/act/img/tft/equip.js"
  }],
  [JUSTICE, {
    apiName: JUSTICE,
    name: "正义之手",
    effect: "获得伤害增幅和全能吸血。",
    attributes: [],
    recipe: [
      { apiName: "TFT_Item_TearOfTheGoddess", name: "女神之泪", iconUrl: null },
      { apiName: "TFT_Item_SparringGloves", name: "拳套", iconUrl: null }
    ],
    craftable: true,
    iconUrl: "https://example.test/items/justice.png",
    sourceUrl: "https://game.gtimg.cn/images/lol/act/img/tft/equip.js"
  }]
]);

let structuredParserCalls = 0;
const runtime = createSmallWindowRuntime({
  catalog,
  cacheStore: new MemoryCacheStore(),
  fetchItems: false,
  officialItemDetails,
  structuredParserConfig: {
    enabled: true,
    provider: "offline_fixture",
    mode: "auto",
    endpoint: "fixture://structured-parser",
    apiKey: "configured",
    model: "fixture-model"
  },
  structuredParser: async () => {
    structuredParserCalls += 1;
    return {
      intent: "unit_item_comparison",
      entities: {
        unit_mentions: ["霞"],
        item_mentions: ["烁刃", "巨九"]
      },
      constraints: {
        locked_items: [],
        comparison_items: ["烁刃", "巨九"],
        excluded_items: [],
        comparison_mode: "exclusive_presence",
        primary_metric: "top4Rate"
      },
      needs_clarification: false,
      clarification_question: null
    };
  },
  useStructuredParser: "auto",
  metaTFTClient: {
    async getUnitBuilds() {
      return { data: unitRows };
    }
  },
  compsClient: {
    async getCompsData() {
      return compFixture.compsData;
    },
    async getCompsStats() {
      return compFixture.compsStats;
    }
  }
});

function assertCase(id, condition, message) {
  if (!condition) throw new Error(`${id}: ${message}`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  return payload;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const evidence = {};
const portArgument = process.argv.find((value) => value.startsWith("--port="));
const serverPort = Number(portArgument?.slice("--port=".length) ?? 0);
const started = await startSmallWindowServer({ host: "127.0.0.1", port: serverPort, runtime });

if (process.argv.includes("--serve")) {
  console.log(`Practical fixture server ${started.url}`);
  const shutdown = () => started.server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}

try {
  const baseUrl = started.url.replace(/\/$/, "");
  const recommend = (id, input, options = {}) => requestJson(`${baseUrl}/api/recommend`, {
    method: "POST",
    body: JSON.stringify({
      input,
      conversationId: options.conversationId ?? `practical-${id}`,
      preferences: {
        structuredParserMode: "never",
        ...(options.preferences ?? {})
      }
    })
  });

  const runtimeStatus = await requestJson(`${baseUrl}/api/runtime`);
  assertCase("ENV", runtimeStatus.runtime.structuredParser.enabled === true, "structured parser fixture is not enabled");

  const sm01a = await recommend("SM-01", "推荐当前版本热门阵容", { conversationId: "practical-sm01" });
  const sm01b = await recommend("SM-01", "大师以上呢？", { conversationId: "practical-sm01" });
  assertCase("SM-01", sm01a.type === "comp_rankings" && sm01b.type === "comp_rankings", "intent was not retained");
  assertCase("SM-01", sm01b.query.rankFilter.join(",") === "CHALLENGER,GRANDMASTER,MASTER", "rank was not replaced");
  evidence["SM-01"] = { type: sm01b.type, rankFilter: sm01b.query.rankFilter, session: sm01b.query.sessionContext };

  const sm02 = await recommend("SM-02", "霞用烁刃好还是巨九好？");
  assertCase("SM-02", sm02.type === "unit_item_comparison", "not a comparison");
  assertCase("SM-02", sm02.query.comparison.itemApiNames.join(",") === `${NAVORI},${HYDRA}`, "candidate set is wrong");
  assertCase("SM-02", sm02.query.lockedItems.length === 0 && sm02.overlap.games > 0, "candidates were locked or overlap was lost");
  evidence["SM-02"] = { candidates: sm02.query.comparison.itemApiNames, overlap: sm02.overlap, metric: sm02.decision.primaryMetric };

  const sm03 = await recommend("SM-03", "霞已经有羊刀，烁刃好还是巨九好？");
  assertCase("SM-03", sm03.query.lockedItems.join(",") === RAGEBLADE, "owned item was not locked");
  assertCase("SM-03", sm03.query.comparison.itemApiNames.length === 2, "comparison candidates were lost");
  evidence["SM-03"] = { lockedItems: sm03.query.lockedItems, candidates: sm03.query.comparison.itemApiNames };

  const sm04 = await recommend("SM-04", "观星者纹章有什么效果？");
  assertCase("SM-04", sm04.type === "item_details" && sm04.item.apiName === STARGAZER_EMBLEM, "emblem did not use item details");
  assertCase("SM-04", sm04.item.name === "观星者纹章", "item encyclopedia did not use the official canonical name");
  assertCase("SM-04", sm04.item.effect && sm04.item.category === "emblem" && sm04.item.provenance.details, "official fields are incomplete");
  evidence["SM-04"] = { item: sm04.item };

  const sm05 = await recommend("SM-05", "霞加入纹章");
  assertCase("SM-05", sm05.clarification.reason === "missing_specific_emblem", "generic emblem was not clarified");
  evidence["SM-05"] = { clarification: sm05.clarification };

  const sm06 = await recommend("SM-06", "霞加入观星者纹章，剩下两件怎么带？");
  assertCase("SM-06", sm06.query.lockedItems.join(",") === STARGAZER_EMBLEM, "emblem was not locked");
  assertCase("SM-06", sm06.query.itemPolicy === "include_special" && sm06.query.minSamples === 0, "special policy or threshold is wrong");
  evidence["SM-06"] = { lockedItems: sm06.query.lockedItems, itemPolicy: sm06.query.itemPolicy, minSamples: sm06.query.minSamples };

  for (const [id, input, suffix, label] of [
    ["SM-07", "霞用秀山观星怎么出装？", "Mountain", "秀山观星"],
    ["SM-08", "霞用野猪观星怎么出装？", "Wolf", "野猪观星"]
  ]) {
    const payload = await recommend(id, input);
    assertCase(id, payload.query.traitFilters.some((value) => value.includes(`Stargazer_${suffix}_`)), "wrong Stargazer API suffix");
    assertCase(id, payload.query.traitNames.includes(label), "verified display name is missing");
    assertCase(id, payload.query.constraints.trait_filters.source === "current_input", "trait source is not current input");
    evidence[id] = { traitFilters: payload.query.traitFilters, traitNames: payload.query.traitNames, source: payload.query.constraints.trait_filters };
  }

  const sm09 = await recommend("SM-09", "正义之手有什么效果？");
  assertCase("SM-09", sm09.item.apiName === JUSTICE && sm09.item.name === "正义", "current display canonical is wrong");
  assertCase("SM-09", sm09.item.officialName === "正义之手" && sm09.item.effect, "official detail provenance was lost");
  evidence["SM-09"] = { apiName: sm09.item.apiName, name: sm09.item.name, officialName: sm09.item.officialName };

  const sm10 = await recommend("SM-10", "合剂怎么合成？");
  assertCase("SM-10", sm10.item.apiName === JUSTICE && sm10.item.name === "正义", "historical alias did not resolve to current display");
  assertCase("SM-10", sm10.item.recipe.length === 2, "official recipe was not returned");
  evidence["SM-10"] = { apiName: sm10.item.apiName, name: sm10.item.name, recipe: sm10.item.recipe.map((item) => item.name) };

  const sm11 = await requestJson(`${baseUrl}/api/item-catalog-audit?query=${encodeURIComponent("观星者纹章")}&category=emblem&format=json`);
  const exported = JSON.parse(sm11.export.content);
  assertCase("SM-11", sm11.report.records.length === 1 && exported.records.length === 1, "filter and export counts differ");
  assertCase("SM-11", sm11.report.records[0].apiName === STARGAZER_EMBLEM, "wrong audit record");
  evidence["SM-11"] = { returned: sm11.summary.returned, apiName: sm11.report.records[0].apiName, exportFormat: sm11.export.format };

  const sm12 = await recommend("SM-12", "我神器铁砧出了烁刃跟巨九，霞拿哪个比较划算？", {
    preferences: { structuredParserMode: "always" }
  });
  assertCase("SM-12", structuredParserCalls > 0, `structured parser was not invoked (calls=${structuredParserCalls})`);
  assertCase("SM-12", sm12.type === "unit_item_comparison", "LLM-assisted input was not a comparison");
  assertCase("SM-12", sm12.query.comparison.itemApiNames.join(",") === `${NAVORI},${HYDRA}`, "local candidate validation changed");
  evidence["SM-12"] = { calls: structuredParserCalls, candidates: sm12.query.comparison.itemApiNames };

  const noTarget = await recommend("MEM-06", "大师以上呢？");
  assertCase("MEM-06", noTarget.clarification.reason === "missing_query_target", "new session inherited a target");
  evidence["MEM-06"] = { clarification: noTarget.clarification };

  const unknownStar = await recommend("STAR-11", "霞用火龙观星怎么出装？");
  assertCase("STAR-11", unknownStar.clarification.reason === "unknown_stargazer_effect", "unknown child effect was accepted");
  evidence["STAR-11"] = { clarification: unknownStar.clarification };

  const genericStar = await recommend("STAR-10", "霞观星怎么出装？");
  assertCase("STAR-10", !genericStar.query.traitFilters.some((value) => /Stargazer_(?:Medallion|Shield|Huntress|Fountain|Mountain|Serpent|Wolf)_/.test(value)), "generic Stargazer silently selected a child effect");
  assertCase("STAR-10", genericStar.query.comp === null, "generic Stargazer synthesized a Comp");
  evidence["STAR-10"] = { traitFilters: genericStar.query.traitFilters, comp: genericStar.query.comp };

  const allEmblems = await recommend("ITEM-10", "霞把所有纹章都考虑进去");
  assertCase("ITEM-10", allEmblems.clarification.reason === "missing_specific_emblem", "all emblems were silently enabled");
  evidence["ITEM-10"] = { clarification: allEmblems.clarification };

  const excludedEmblem = await recommend("ITEM-11", "霞不要观星者纹章怎么出装？");
  assertCase("ITEM-11", excludedEmblem.query.excludedItems.join(",") === STARGAZER_EMBLEM, "specific emblem was not excluded");
  assertCase("ITEM-11", excludedEmblem.query.ownedItems.length === 0, "excluded emblem became locked");
  evidence["ITEM-11"] = { excludedItems: excludedEmblem.query.excludedItems, ownedItems: excludedEmblem.query.ownedItems };

  const unknownItem = await recommend("ITEM-06", "量子神剑有什么效果？");
  assertCase("ITEM-06", unknownItem.clarification.reason === "unknown_item_details", "unknown item was not blocked by the details route");
  evidence["ITEM-06"] = { clarification: unknownItem.clarification };

  const comparisonConversation = "practical-comparison-followups";
  await recommend("CMP-01", "霞用烁刃还是巨九？", { conversationId: comparisonConversation });
  for (const [id, input, metric] of [
    ["CMP-05", "哪个更稳？", "top4Rate"],
    ["CMP-06", "哪个吃鸡上限高？", "winRate"],
    ["CMP-07", "平均名次呢？", "avgPlacement"],
    ["CMP-08", "哪个样本更多？", "games"]
  ]) {
    const payload = await recommend(id, input, { conversationId: comparisonConversation });
    assertCase(id, payload.type === "unit_item_comparison" && payload.query.comparison.itemApiNames.length === 2, "comparison context was lost");
    assertCase(id, payload.query.primaryMetric === metric, "primary metric was not replaced");
    evidence[id] = { candidates: payload.query.comparison.itemApiNames, primaryMetric: payload.query.primaryMetric };
  }
  const appended = await recommend("CMP-09", "再加死亡之蔑呢？", { conversationId: comparisonConversation });
  assertCase("CMP-09", appended.query.comparison.itemApiNames.length === 3, "third candidate was not appended");
  evidence["CMP-09"] = { candidates: appended.query.comparison.itemApiNames };
  const kaisa = await recommend("CMP-12", "那卡莎呢？", { conversationId: comparisonConversation });
  assertCase("CMP-12", kaisa.query.unit === "TFT17_Kaisa" && kaisa.query.comparison.itemApiNames.length === 3, "hero replacement lost comparison state");
  assertCase("CMP-12", kaisa.query.constraints.unit.source === "current_input", "replacement hero source is wrong");
  evidence["CMP-12"] = { unit: kaisa.query.unit, candidates: kaisa.query.comparison.itemApiNames, unitSource: kaisa.query.constraints.unit };

  const sampleConversation = "practical-sample-threshold";
  await recommend("SAMPLE-01", "霞什么装备最好？", { conversationId: sampleConversation, preferences: { minSamples: 100 } });
  const zeroThreshold = await recommend("SAMPLE-02", "移除样本下限", { conversationId: sampleConversation, preferences: { minSamples: 100 } });
  assertCase("SAMPLE-02", zeroThreshold.query.minSamples === 0 && zeroThreshold.query.constraints.min_samples.source === "current_input", "explicit zero threshold was not retained");
  evidence["SAMPLE-02"] = { minSamples: zeroThreshold.query.minSamples, source: zeroThreshold.query.constraints.min_samples };

  const radiant = await recommend("SPECIAL-01", "霞的光明装备哪个最好？", { preferences: { minSamples: 100 } });
  const emblem = await recommend("SPECIAL-02", "霞的纹章哪个最好？", { preferences: { minSamples: 100 } });
  assertCase("SPECIAL-01", radiant.query.minSamples === 0 && radiant.query.itemCategories.join(",") === "radiant", "radiant single-item ranking is not unified");
  assertCase("SPECIAL-02", emblem.query.minSamples === 0 && emblem.query.itemCategories.join(",") === "emblem", "emblem single-item ranking is not unified");
  evidence["SPECIAL-01"] = { minSamples: radiant.query.minSamples, categories: radiant.query.itemCategories };
  evidence["SPECIAL-02"] = { minSamples: emblem.query.minSamples, categories: emblem.query.itemCategories };

  const noCompletion = await recommend("NO-COMP", "霞什么装备最好？");
  assertCase("NO-COMP", noCompletion.query.comp === null && noCompletion.query.traitFilters.length === 0, "unit query synthesized Comp or trait constraints");
  evidence["NO-COMP"] = { comp: noCompletion.query.comp, traitFilters: noCompletion.query.traitFilters };

  console.log(JSON.stringify({
    ok: true,
    url: started.url,
    transport: "HTTP /api/recommend and /api/item-catalog-audit",
    cases: evidence
  }, null, 2));
} finally {
  await closeServer(started.server);
}
