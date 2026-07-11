import { readFile } from "node:fs/promises";
import {
  MemoryCacheStore,
  buildTraitCatalogFromCompsData,
  buildUnitCatalogFromCompsData,
  createCatalog,
  recommendForInput
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  startSmallWindowServer
} from "../src/app/small-window-server.js";
import { ITEM_ALIAS_OVERRIDES } from "../src/data/item-alias-overrides.js";

const fixture = JSON.parse(await readFile(new URL("../test/fixtures/comp-rankings/exact-units-traits2-minimal.json", import.meta.url), "utf8"));
let exactCalls = 0;
let unitBuildCalls = 0;
const compsData = {
  clusterInfo: fixture.clusters,
  compBuilds: [{
    clusterId: "409002",
    unitApiName: "TFT17_Nunu",
    items: ["TFT_Item_WarmogsArmor", "TFT_Item_GargoyleStoneplate", "TFT_Item_DragonsClaw"],
    games: 900
  }]
};
const catalog = createCatalog({
  units: buildUnitCatalogFromCompsData(compsData),
  traits: buildTraitCatalogFromCompsData(compsData),
  items: ITEM_ALIAS_OVERRIDES
});
const options = {
  catalog,
  cacheStore: new MemoryCacheStore(),
  compsData,
  metaTFTClient: {
    async getExactUnitsTraits2() {
      exactCalls += 1;
      return fixture;
    },
    async getUnitBuilds() {
      unitBuildCalls += 1;
      throw new Error("unit_builds must not run for comp rankings");
    }
  }
};

function check(condition, message) {
  if (!condition) throw new Error(`Comp smoke failed: ${message}`);
}

const first = await recommendForInput("当前版本最强阵容有哪些？", options);
const second = await recommendForInput("当前版本最强阵容有哪些？", options);
check(first.type === "comp_rankings", "wrong response type");
check(first.rankings.top4Rate.length > 0, "top4 ranking is empty");
check(first.rankings.winRate.length > 0, "win ranking is empty");
check(first.rankings.top4Rate[0].compId !== first.rankings.winRate[0].compId, "metric lists did not sort independently");
check(first.rankings.winRate[0].units.some((unit) => unit.iconUrl), "unit icons are missing");
check(first.rankings.winRate[0].units.every((unit) => unit.name && !unit.name.startsWith("TFT17_")), "localized unit display names are missing");
check(first.rankings.winRate.some((comp) => comp.units.some((unit) => unit.items.length === 3
  && unit.items.every((item) => !item.name.startsWith("TFT_Item_")))), "localized core item names are missing");
check(first.diagnostics.rejected.some((entry) => entry.reason === "special_or_abnormal_board"), "abnormal boards were not filtered");
check(second.cache.query.hit === true, "second query did not hit cache");
check(exactCalls === 1, `expected one exact endpoint call, got ${exactCalls}`);
check(unitBuildCalls === 0, `unexpected unit_builds calls: ${unitBuildCalls}`);

const runtime = createSmallWindowRuntime({
  catalog: options.catalog,
  cacheStore: options.cacheStore,
  fetchItems: false,
  metaTFTClient: options.metaTFTClient,
  compsClient: {},
  recommendForInputImpl: (input, runtimeOptions) => recommendForInput(input, {
    ...runtimeOptions,
    compsData: options.compsData
  })
});
const started = await startSmallWindowServer({ host: "127.0.0.1", port: 0, runtime });
try {
  const response = await fetch(`${started.url}api/recommend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "当前版本最强阵容有哪些？" })
  });
  const payload = await response.json();
  check(response.ok && payload.ok, "small-window comp request failed");
  check(payload.type === "comp_rankings", "small-window response lost comp type");
  check(payload.rankings.top4Rate.length > 0, "small-window top4 ranking is empty");
  check(payload.rankings.winRate.length > 0, "small-window win ranking is empty");
  check(payload.rankings.winRate.some((comp) => comp.units.some((unit) => unit.core && unit.items.length === 3)), "small-window response lost core item ownership");
  check(JSON.stringify(payload).includes("placement_count") === false, "small-window response leaked raw placement buckets");
} finally {
  await new Promise((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
}

console.log("Offline comp-ranking smoke checks passed.");
console.log(`top4=${first.rankings.top4Rate[0].name}`);
console.log(`win=${first.rankings.winRate[0].name}`);
console.log(`accepted=${first.diagnostics.acceptedGroups}, rejected=${first.diagnostics.rejected.length}`);
