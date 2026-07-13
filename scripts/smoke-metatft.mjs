import {
  buildItemCatalogFromItemsResponse,
  createCatalog,
  DEFAULT_QUERY_OPTIONS,
  MetaTFTClient,
  CompsContextClient,
  normalizeCompOptionsResponse,
  normalizeItemRows,
  normalizeLatestClusterInfoResponse,
  normalizeUnitBuildRows,
  planQuery,
  recommendForInput,
  selectDefaultContextForUnit
} from "../src/index.js";

const baseUrl = process.env.METATFT_BASE_URL ?? "https://api-hc.metatft.com";
const query = process.env.SMOKE_QUERY ?? "2星霞，3观星，携带哪三件普通装备最好？";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 30000);
const contextTimeoutMs = Number(process.env.SMOKE_CONTEXT_TIMEOUT_MS ?? Math.min(timeoutMs, 2200));
const minSamples = Number(process.env.SMOKE_MIN_SAMPLES ?? 100);
const requireContext = /^(1|true|yes)$/i.test(process.env.SMOKE_REQUIRE_CONTEXT ?? "");
const remoteTargetMs = Number(process.env.SMOKE_REMOTE_TARGET_MS ?? 2000);
const requireRemoteLatency = /^(1|true|yes)$/i.test(process.env.SMOKE_REQUIRE_REMOTE_LATENCY ?? "");
const latencies = {};

function assertSmoke(condition, message) {
  if (!condition) {
    throw new Error(`Smoke check failed: ${message}`);
  }
}

function printSection(title, value) {
  console.log(`\n## ${title}`);
  console.log(value);
}

async function timed(name, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    latencies[name] = Math.round(performance.now() - startedAt);
  }
}

const explorerClient = new MetaTFTClient({ baseUrl, timeoutMs });
const compsClient = new CompsContextClient({ baseUrl, timeoutMs: contextTimeoutMs });

const baseParams = {
  formatnoarray: "true",
  compact: "true",
  queue: DEFAULT_QUERY_OPTIONS.queue,
  patch: DEFAULT_QUERY_OPTIONS.patch
};

console.log(`MetaTFT smoke baseUrl=${baseUrl}`);
console.log(`query=${query}`);

console.log("Fetching Explorer items...");
const itemsResponse = await timed("items", () => explorerClient.getItems(baseParams));
const itemRows = normalizeItemRows(itemsResponse);
assertSmoke(itemRows.length > 0, "items endpoint returned no rows");

const generatedItems = buildItemCatalogFromItemsResponse(itemsResponse);
const catalog = createCatalog({ items: generatedItems });
assertSmoke(catalog.itemByApiName.has("TFT_Item_GuinsoosRageblade"), "generated catalog is missing Guinsoo");
assertSmoke(catalog.itemByApiName.get("TFT_Item_RunaansHurricane")?.category === "ordinary_completed", "generated catalog did not keep current Kraken as ordinary");
assertSmoke(catalog.itemByApiName.get("TFT_Item_RunaansHurricane")?.zhName === "海妖之怒", "generated catalog lost current Kraken canonical name");
printSection("Items", `rows=${itemRows.length}, generatedCatalogItems=${generatedItems.length}, durationMs=${latencies.items}`);

const planned = planQuery(query, { catalog });
assertSmoke(planned.validation.valid, planned.validation.errors.join("; "));
assertSmoke(planned.plan, "query planner did not produce a MetaTFT plan");

console.log("Fetching Explorer unit_builds...");
const unitBuildsResponse = await timed("unitBuilds", () => explorerClient.getUnitBuilds(planned.plan));
const unitRows = normalizeUnitBuildRows(unitBuildsResponse);
assertSmoke(unitRows.length > 0, "unit_builds endpoint returned no rows");
if (latencies.unitBuilds > remoteTargetMs) {
  const message = `unit_builds exceeded ${remoteTargetMs}ms target: ${latencies.unitBuilds}ms`;
  if (requireRemoteLatency) assertSmoke(false, message);
  console.warn(`warning=${message}`);
}
printSection("Unit Builds", `rows=${unitRows.length}, unit=${planned.query.unit}, durationMs=${latencies.unitBuilds}`);

const recommendation = await recommendForInput(query, {
  catalog,
  response: unitBuildsResponse,
  preferences: {
    minSamples
  }
});
assertSmoke(recommendation.rankedBuilds.length > 0, "recommendation produced no ranked builds");
if (recommendation.rankedBuilds[0].items.includes("TFT_Item_RunaansHurricane")) {
  assertSmoke(catalog.itemByApiName.get("TFT_Item_RunaansHurricane")?.shortName === "海妖之怒", "current Runaan result did not use the verified display name");
}
assertSmoke(recommendation.query.catalogVersion !== undefined, "recommendation did not use the generated current catalog");
printSection("Recommendation", recommendation.text);

console.log("Fetching /comps context...");
try {
  const [latestClusterInfoResponse, compOptionsResponse] = await timed("comps", () => Promise.all([
    compsClient.getLatestClusterInfo({
      queue: DEFAULT_QUERY_OPTIONS.queue,
      patch: DEFAULT_QUERY_OPTIONS.patch
    }),
    compsClient.getCompOptions({
      queue: DEFAULT_QUERY_OPTIONS.queue,
      patch: DEFAULT_QUERY_OPTIONS.patch
    })
  ]));
  const clusterInfo = normalizeLatestClusterInfoResponse(latestClusterInfoResponse);
  const compOptions = normalizeCompOptionsResponse(compOptionsResponse);
  assertSmoke(clusterInfo.length > 0, "latest_cluster_info returned no clusters");
  assertSmoke(compOptions.length > 0, "comp_options returned no options");

  const defaultContext = selectDefaultContextForUnit(planned.query.unit, {
    clusterInfo,
    compOptions
  }, {
    minClusterSamples: Number(process.env.SMOKE_CONTEXT_MIN_SAMPLES ?? 10)
  });
  assertSmoke(defaultContext.found, `no default context found for ${planned.query.unit}`);
  assertSmoke(defaultContext.units.includes(planned.query.unit), "default context does not include target unit");
  printSection("Default Context", JSON.stringify({
    clusterId: defaultContext.clusterId,
    compName: defaultContext.compName,
    count: defaultContext.count,
    score: defaultContext.score,
    avg: defaultContext.avg,
    durationMs: latencies.comps,
    traits: defaultContext.traits?.slice(0, 8)
  }, null, 2));
} catch (error) {
  if (requireContext) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  printSection("Default Context", [
    `warning=${message}`,
    "context check skipped; set SMOKE_REQUIRE_CONTEXT=1 to make this fatal"
  ].join("\n"));
}

printSection("Latency", JSON.stringify({
  ...latencies,
  unitBuildsTargetMs: remoteTargetMs,
  unitBuildsWithinTarget: latencies.unitBuilds <= remoteTargetMs
}, null, 2));
console.log("\nSmoke checks passed.");
