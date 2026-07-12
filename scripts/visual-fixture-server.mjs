import { MemoryCacheStore, createCatalog } from "../src/index.js";
import { createSmallWindowRuntime, startSmallWindowServer } from "../src/app/small-window-server.js";

const portArg = process.argv.find((value) => value.startsWith("--port="));
const port = Number(portArg?.slice("--port=".length) ?? 17329);
const rows = [
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
  catalog: createCatalog(),
  cacheStore,
  fetchItems: false,
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
  compsClient: {}
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
