import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MemoryCacheStore,
  createCatalog,
  recommendForInput
} from "../src/index.js";
import {
  createSmallWindowRuntime,
  startSmallWindowServer
} from "../src/app/small-window-server.js";

const fixture = JSON.parse(await readFile(new URL("../test/fixtures/comp-rankings/metatft-comps-page-minimal.json", import.meta.url), "utf8"));
const contextFixture = JSON.parse(await readFile(new URL("../test/fixtures/comp-rankings/exact-units-traits2-minimal.json", import.meta.url), "utf8"));
const equipmentRows = [{
  unit_builds: "TFT17_Xayah&TFT_Item_GuinsoosRageblade|TFT_Item_InfinityEdge|TFT_Item_GiantSlayer",
  placement_count: [120, 100, 90, 80, 60, 40, 30, 20]
}];
const staleMarker = resolve(".cache/visual-force-stale");
const emptyMarker = resolve(".cache/visual-force-empty");
const runtime = createSmallWindowRuntime({
  catalog: createCatalog(),
  cacheStore: new MemoryCacheStore({
    now: () => Date.now() + (existsSync(staleMarker) ? 6 * 60 * 1000 : 0)
  }),
  fetchItems: false,
  metaTFTClient: {
    async getUnitBuilds() { return { data: equipmentRows }; },
  },
  compsClient: {
    async getCompsData() {
      if (existsSync(staleMarker)) throw new Error("visual stale-cache probe");
      if (existsSync(emptyMarker)) return { results: { data: { cluster_id: 409, cluster_details: {} } } };
      return fixture.compsData;
    },
    async getCompsStats() {
      if (existsSync(emptyMarker)) return { cluster_id: 409, results: [{ cluster: "", places: [0] }] };
      return fixture.compsStats;
    }
  },
  recommendForInputImpl: (input, options) => recommendForInput(input, {
    ...options,
    compsData: {
      clusterInfo: contextFixture.clusters,
      compBuilds: [{
        clusterId: "409002",
        unitApiName: "TFT17_Nunu",
        items: ["TFT_Item_WarmogsArmor", "TFT_Item_GargoyleStoneplate", "TFT_Item_DragonsClaw"],
        games: 900
      }]
    }
  })
});

const started = await startSmallWindowServer({
  host: "127.0.0.1",
  port: Number(process.argv[2] ?? process.env.TFT_VISUAL_PORT ?? 17329),
  runtime
});
console.log(started.url);

const close = () => started.server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
