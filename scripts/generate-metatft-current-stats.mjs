import { resolve } from "node:path";

import "dotenv/config";

import {
  DEFAULT_QUERY_OPTIONS,
  SQLiteSemanticDocumentStore,
  createEmbeddingProviderFromConfig,
  fetchMetaTftCurrentStats,
  resolveCurrentStatsSemanticConfig,
  resolveEmbeddingProviderConfig,
  runMetaTftCurrentStatsPipeline
} from "../src/index.js";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function flag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function optionalPositiveNumber(value) {
  if (value === null || value === undefined || value === "" || String(value).toLowerCase() === "all") {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError("comp-limit must be a positive number or all");
  return number;
}

function utcDayStart(value = Date.now()) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

const generatedAt = argument(
  "generated-at",
  process.env.CURRENT_STATS_GENERATED_AT ?? utcDayStart()
);
const ttlHours = Number(argument(
  "ttl-hours",
  process.env.CURRENT_STATS_TTL_HOURS ?? "48"
));
const rankFilter = String(argument(
  "rank",
  process.env.CURRENT_STATS_RANK ?? DEFAULT_QUERY_OPTIONS.rankFilter.join(",")
))
  .split(",").map((value) => value.trim()).filter(Boolean);
const scope = {
  season: argument("season", process.env.CURRENT_STATS_SEASON ?? "set17-live"),
  patch: argument("patch", process.env.CURRENT_STATS_PATCH ?? "17.8"),
  rank: rankFilter,
  days: Number(argument(
    "days",
    process.env.CURRENT_STATS_DAYS ?? String(DEFAULT_QUERY_OPTIONS.days)
  )),
  region: argument("region", process.env.CURRENT_STATS_REGION ?? "global"),
  locale: argument("locale", process.env.CURRENT_STATS_LOCALE ?? "zh-CN"),
  generatedAt,
  expiresAt: new Date(Date.parse(generatedAt) + ttlHours * 60 * 60 * 1000).toISOString()
};
const indexPath = resolve(argument(
  "index",
  process.env.CURRENT_STATS_INDEX_PATH ?? ".cache/semantic-index.sqlite"
));
const semanticConfig = resolveCurrentStatsSemanticConfig({
  avgPlacementDecimals: argument("avg-placement-decimals"),
  ratePercentageDecimals: argument("rate-percentage-decimals"),
  rankingChangeThreshold: argument("rank-change-threshold"),
  criticalRankBoundaries: argument("critical-rank-boundaries")
});
const embeddingConfig = resolveEmbeddingProviderConfig({
  indexPath
});
const embeddingProvider = flag("no-embeddings")
  ? null
  : createEmbeddingProviderFromConfig(embeddingConfig);
const store = await SQLiteSemanticDocumentStore.open({ filePath: indexPath });

try {
  const generated = await fetchMetaTftCurrentStats({
    scope,
    providerPatch: argument(
      "provider-patch",
      process.env.CURRENT_STATS_PROVIDER_PATCH ?? "current"
    ),
    queue: argument(
      "queue",
      process.env.CURRENT_STATS_QUEUE ?? DEFAULT_QUERY_OPTIONS.queue
    ),
    compLimit: optionalPositiveNumber(argument(
      "comp-limit",
      process.env.CURRENT_STATS_COMP_LIMIT ?? "all"
    )),
    minSamples: Number(argument(
      "min-samples",
      process.env.CURRENT_STATS_MIN_SAMPLES ?? "0"
    )),
    semanticConfig,
    timeoutMs: Number(argument(
      "timeout-ms",
      process.env.CURRENT_STATS_TIMEOUT_MS ?? "30000"
    ))
  });
  const result = await runMetaTftCurrentStatsPipeline({
    store,
    generated,
    embeddingProvider,
    semanticConfig
  });
  console.log(JSON.stringify({
    ok: true,
    indexPath,
    fetch: result.fetch,
    countsByType: result.countsByType,
    index: result.index
  }, null, 2));
} finally {
  store.close();
}
