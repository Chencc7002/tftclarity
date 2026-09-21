import { mkdir, writeFile } from "node:fs/promises";
import { MetaTFTClient, CompsContextClient } from "../src/data/metatft-client.js";
import { fetchOfficialTftItemDetails } from "../src/data/official-item-details.js";
import { buildItemCatalogFromItemsResponse } from "../src/data/item-catalog.js";
import { buildUnitCatalogFromExplorerRows } from "../src/data/domain-catalog.js";
import { createCatalog, MemoryCacheStore } from "../src/index.js";
import { createSmallWindowRuntime, createSmallWindowRuntimeAsync, startSmallWindowServer, handleRecommendRequest } from "../src/app/small-window-server.js";
import { loadLocalEnvironment } from "../src/config/load-env.js";

const chatEnabled = process.argv.includes("--chat");
if (chatEnabled) loadLocalEnvironment();

const client = new MetaTFTClient({ timeoutMs: 15000, maxRetries: 0 });
const compsClient = new CompsContextClient({ timeoutMs: 15000, maxRetries: 0 });
const params = { queue: "1100", patch: "current", days: 3 };
const [items, units, details] = await Promise.all([client.getItems(params), client.getUnitsUnique(params), fetchOfficialTftItemDetails()]);
const catalog = createCatalog({ items: buildItemCatalogFromItemsResponse(items, { patch: "current", season: 18 }),
  units: buildUnitCatalogFromExplorerRows(units, { patch: "current", includeSeeds: false }) });
const runtime = await (chatEnabled ? createSmallWindowRuntimeAsync : createSmallWindowRuntime)({ catalog, cacheStore: new MemoryCacheStore(), fetchItems: false,
  officialItemDetails: details, fetchOfficialItemDetails: async () => details, metaTFTClient: client, compsClient,
  publicMode: false, reactChatMode: chatEnabled ? "on" : "off", conversationBridgeMode: "off", reactGroundingMode: "strict",
  toolTimeoutByTool: { emblem_rankings: 20000, emblem_carriers: 20000 } });
if (process.argv.includes("--smoke")) {
  const rank = await handleRecommendRequest({ input: "查询可合成转职强度排行", preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "live-emblem-rankings", id: "emblem-rankings", operation: "emblem_rankings", arguments: {} } }, runtime);
  const item = rank.payload.rows?.find(row => row.recipeBase)?.item.apiName;
  if (rank.statusCode !== 200 || !item) throw new Error(JSON.stringify(rank));
  const carriers = await handleRecommendRequest({ input: "常见携带英雄", preferences: { conclusionMode: "off" },
    quickTask: { schemaVersion: "quick-task.v1", requestId: "live-emblem-carriers", id: "emblem-carriers", operation: "emblem_carriers", arguments: { item } } }, runtime);
  await mkdir(".cache/emblem-integration-20260907", { recursive: true });
  await writeFile(".cache/emblem-integration-20260907/live-smoke.json", JSON.stringify({ rank, carriers }, null, 2));
  console.log(JSON.stringify({ rankStatus: rank.statusCode, count: rank.payload.rows.length,
    craftable: rank.payload.rows.filter(row => row.recipeBase).length, item, carrierStatus: carriers.statusCode,
    carriers: carriers.payload.carriers?.map(row => ({ unit: row.unit, games: row.stats.games })) }));
  if (carriers.statusCode !== 200 || !carriers.payload.carriers?.length) process.exitCode = 1;
} else {
  const server = await startSmallWindowServer({ host: "127.0.0.1", port: chatEnabled ? 17342 : 17341, runtime, prewarmCatalog: false });
  console.log(server.url);
}
