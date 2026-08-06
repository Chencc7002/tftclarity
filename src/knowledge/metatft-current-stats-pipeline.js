import { buildCompRankings } from "../core/comp-ranking-service.js";
import { createCompsPageSnapshot } from "../data/comp-response-adapter.js";
import { CompsContextClient, MetaTFTClient } from "../data/metatft-client.js";
import { DEFAULT_QUERY_OPTIONS, createCatalog } from "../data/static-data.js";
import { CurrentStatsIndexManager } from "./current-stats-index-manager.js";
import {
  createCurrentStatsScope,
  generateCurrentStatsDocuments
} from "./metatft-document-generator.js";

function countRows(value) {
  const rows = value?.data ?? value?.results?.data ?? value;
  return Array.isArray(rows) ? rows.length : 0;
}

function statsParams(scope, options = {}) {
  return {
    formatnoarray: "true",
    compact: "true",
    queue: String(options.queue ?? DEFAULT_QUERY_OPTIONS.queue),
    patch: String(options.providerPatch ?? DEFAULT_QUERY_OPTIONS.patch),
    days: Number(String(scope.timeWindow).replace(/d$/iu, "")),
    rank: scope.rank,
    permit_filter_adjustment: "true"
  };
}

export async function fetchMetaTftCurrentStats(options = {}) {
  const scope = createCurrentStatsScope(options.scope);
  const baseUrl = options.baseUrl ?? process.env.METATFT_BASE_URL ?? "https://api-hc.metatft.com";
  const timeoutMs = Number(options.timeoutMs ?? 30000);
  const explorerClient = options.explorerClient ?? new MetaTFTClient({ baseUrl, timeoutMs });
  const compsClient = options.compsClient ?? new CompsContextClient({
    baseUrl,
    timeoutMs,
    rankingsTimeoutMs: timeoutMs
  });
  const params = statsParams(scope, options);
  const [totalResponse, unitsResponse, compsData] = await Promise.all([
    explorerClient.getTotal(params),
    explorerClient.getUnitsUnique(params),
    compsClient.getCompsData({ queue: params.queue })
  ]);
  const clusterId = compsData?.results?.data?.cluster_id
    ?? compsData?.data?.cluster_id
    ?? compsData?.cluster_id;
  if (!clusterId) throw new Error("MetaTFT comps_data did not return cluster_id");
  const compsStats = await compsClient.getCompsStats({
    queue: params.queue,
    patch: params.patch,
    days: params.days,
    rank: params.rank,
    permit_filter_adjustment: params.permit_filter_adjustment,
    cluster_id: clusterId
  });
  const catalog = options.catalog ?? createCatalog();
  const compRankingResult = buildCompRankings(
    createCompsPageSnapshot(compsData, compsStats),
    {
      query: {
        intent: "comp_rankings",
        metrics: ["top4_rate", "win_rate", "avg_placement", "popularity"],
        limit: Number.isFinite(Number(options.compLimit))
          ? Number(options.compLimit)
          : Number.MAX_SAFE_INTEGER,
        minSamples: Number(options.minSamples ?? 0),
        patch: scope.patch,
        queue: params.queue,
        rankFilter: scope.rank.split(","),
        days: params.days,
        specialMode: false
      },
      catalog
    }
  );
  const generated = generateCurrentStatsDocuments({
    totalResponse,
    unitsResponse,
    compRankingResult
  }, {
    scope,
    compLimit: options.compLimit,
    semanticConfig: options.semanticConfig,
    unitName: (apiName) => (
      catalog.unitByApiName?.get(apiName)?.zhName
      ?? catalog.unitByApiName?.get(apiName)?.displayName
      ?? apiName.replace(/^TFT\d+_/u, "")
    )
  });
  return {
    ...generated,
    fetch: {
      baseUrl,
      endpoints: [
        "/tft-explorer-api/total",
        "/tft-explorer-api/units_unique",
        "/tft-comps-api/comps_data",
        "/tft-comps-api/comps_stats"
      ],
      totalRows: countRows(totalResponse),
      unitRows: countRows(unitsResponse),
      compDefinitions: Number(compRankingResult.diagnostics?.definitions ?? 0),
      compCandidates: Number(compRankingResult.candidates?.length ?? 0),
      sampleSize: Number(compRankingResult.source?.sampleSize ?? 0),
      clusterId: String(compRankingResult.source?.clusterId ?? clusterId),
      upstreamUpdatedAt: compRankingResult.source?.updatedAt ?? null
    }
  };
}

export async function runMetaTftCurrentStatsPipeline(options = {}) {
  if (!options.store) throw new TypeError("Current stats pipeline requires a semantic document store");
  const generated = options.generated ?? await fetchMetaTftCurrentStats(options);
  const manager = options.manager ?? new CurrentStatsIndexManager({
    store: options.store,
    embeddingProvider: options.embeddingProvider,
    semanticConfig: options.semanticConfig
  });
  const index = await manager.indexBatch(generated, {
    scope: generated.scope,
    embeddingProvider: options.embeddingProvider,
    semanticConfig: options.semanticConfig
  });
  return {
    schemaVersion: "metatft_current_stats_pipeline.v1",
    fetch: generated.fetch ?? null,
    countsByType: generated.countsByType,
    index,
    documents: generated.documents
  };
}
