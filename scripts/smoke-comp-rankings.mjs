import { readFile } from "node:fs/promises";
import {
  MemoryCacheStore,
  createCatalog,
  recommendForInput
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  startSmallWindowServer
} from "../src/app/small-window-server.js";
import { ITEM_ALIAS_OVERRIDES } from "../src/data/item-alias-overrides.js";

const fixture = JSON.parse(await readFile(
  new URL("../test/fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url),
  "utf8"
));
let dataCalls = 0;
let statsCalls = 0;
let unitBuildCalls = 0;
const catalog = createCatalog({ items: ITEM_ALIAS_OVERRIDES });
const compsClient = {
  async getCompsData() {
    dataCalls += 1;
    return fixture.compsData;
  },
  async getCompsStats() {
    statsCalls += 1;
    return fixture.compsStats;
  }
};
const options = {
  catalog,
  cacheStore: new MemoryCacheStore(),
  compsClient,
  preferences: { minSamples: 1 },
  metaTFTClient: {
    async getUnitBuilds() {
      unitBuildCalls += 1;
      throw new Error("unit_builds must not run for comp rankings");
    }
  }
};
const smokeInput = "当前版本前四率和登顶率最高的阵容有哪些？";

function check(condition, message) {
  if (!condition) throw new Error(`Comp smoke failed: ${message}`);
}

const first = await recommendForInput(smokeInput, { ...options, sessionKey: "comp-smoke:first" });
const second = await recommendForInput(smokeInput, { ...options, sessionKey: "comp-smoke:second" });
check(first.type === "comp_rankings", "wrong response type");
check(first.rankings.top4Rate.length > 0, "top4 ranking is empty");
check(first.rankings.winRate.length > 0, "win ranking is empty");
check(first.rankings.top4Rate[0].source.clusterId === fixture.expected.top4Rate[0], "top4 order diverged from page fixture");
check(first.rankings.winRate[0].source.clusterId === fixture.expected.winRate[0], "win order diverged from page fixture");
check(first.rankings.winRate[0].units.some((unit) => unit.iconUrl), "unit icons are missing");
check(first.rankings.winRate[0].units.every((unit) => unit.name && !unit.name.startsWith("TFT17_")), "localized unit display names are missing");
check([first.rankings.top4Rate, first.rankings.winRate].flat()
  .some((comp) => comp.units.some((unit) => unit.items.length === 3)), "core item ownership is missing");
check(first.diagnostics.rejected.some((entry) => entry.reason === "hidden_situational"), "page visibility filtering was not applied");
check(second.cache.query.hit === true || (dataCalls === 1 && statsCalls === 1),
  `second query did not reuse the paired response: data=${dataCalls} stats=${statsCalls} firstKey=${first.cache?.query?.key} secondKey=${second.cache?.query?.key}`);
check(dataCalls === 1 && statsCalls === 1, `expected one paired page request, got data=${dataCalls}, stats=${statsCalls}`);
check(unitBuildCalls === 0, `unexpected unit_builds calls: ${unitBuildCalls}`);

const runtime = createSmallWindowRuntime({
  catalog,
  cacheStore: options.cacheStore,
  fetchItems: false,
  metaTFTClient: options.metaTFTClient,
  compsClient
});
const started = await startSmallWindowServer({ host: "127.0.0.1", port: 0, runtime });
try {
  const response = await fetch(`${started.url}api/recommend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: smokeInput, preferences: { minSamples: 1 } })
  });
  const payload = await response.json();
  check(response.ok && payload.ok, "small-window comp request failed");
  check(payload.type === "comp_rankings", "small-window response lost comp type");
  check(payload.source.endpoint === "/tft-comps-api/comps_stats", "small-window exposed the wrong source endpoint");
  check(payload.rankings.top4Rate.length > 0, "small-window top4 ranking is empty");
  check(JSON.stringify(payload).includes("placement_count") === false, "small-window response leaked raw placement buckets");
} finally {
  await new Promise((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
}

console.log("Offline MetaTFT /comps parity smoke checks passed.");
console.log(`avg=${first.rankings.avgPlacement[0]?.name ?? "not requested"}`);
console.log(`top4=${first.rankings.top4Rate[0].name}`);
console.log(`win=${first.rankings.winRate[0].name}`);
