import "dotenv/config";

import { CompsContextClient } from "../src/data/metatft-client.js";
import { runDailyCompSnapshot } from "../src/metatft-snapshot/daily-comp-snapshot.js";
import { PostgresSnapshotStore } from "../src/metatft-snapshot/postgres-snapshot-store.js";
import { SEASON_CONTEXTS } from "../src/season/season-context.js";
import { createPostgresPool } from "../src/storage/postgres/client.js";
import { runMigrations } from "../src/storage/postgres/migration-runner.js";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function streamReport(report, key) {
  const value = report.streams[key];
  return {
    Status: value?.status ?? "FAILED",
    Fetched: value?.fetched ?? 0,
    Inserted: value?.inserted ?? 0,
    Duplicates: value?.duplicates ?? 0,
    Invalid: value?.invalid ?? 0,
    PreviousCount: value?.previousCount ?? 0,
    CurrentCount: value?.currentCount ?? 0,
    Delta: value?.delta ?? null,
    Warnings: value?.warnings ?? [],
    Failures: value?.failures ?? []
  };
}

function printableReport(report, storage) {
  return {
    Title: report.title,
    CapturedAt: report.capturedAt,
    SnapshotBatch: report.snapshotBatchId,
    Database: storage,
    Window: "Last 1 Day",
    OverallStatus: report.overallStatus,
    Live: {
      BelowDiamond: streamReport(report, "LIVE:BELOW_DIAMOND"),
      DiamondPlus: streamReport(report, "LIVE:DIAMOND_PLUS"),
      MasterPlus: streamReport(report, "LIVE:MASTER_PLUS")
    },
    PBE: {
      NoRankFilter: streamReport(report, "PBE:ALL_RANKS")
    },
    Validation: report.validation,
    CrossCohort: report.crossCohort,
    Totals: report.totals
  };
}

const databaseUrl = argument("database-url", process.env.SNAPSHOT_DATABASE_URL ?? process.env.DATABASE_URL ?? null);
if (!databaseUrl) {
  throw new Error("MetaTFT daily snapshot requires SNAPSHOT_DATABASE_URL or DATABASE_URL; SQLite fallback is intentionally disabled");
}
const migrationDatabaseUrl = argument(
  "migration-database-url",
  process.env.TFT_AGENT_MIGRATION_DATABASE_URL ?? databaseUrl
);
const timeoutMs = Number(argument("timeout-ms", process.env.METATFT_SNAPSHOT_TIMEOUT_MS ?? "30000"));
const liveContext = SEASON_CONTEXTS.find((context) => context.id === "set17-live");
const livePatch = argument("live-patch", liveContext?.source?.currentPatch ?? null);
const client = new CompsContextClient({ timeoutMs, rankingsTimeoutMs: timeoutMs });
let store;
let pool;
let migrationPool;
const storage = "postgresql";

try {
  migrationPool = createPostgresPool({
    databaseUrl: migrationDatabaseUrl,
    databaseSsl: process.env.TFT_AGENT_DATABASE_SSL ?? "disable",
    databaseConnectTimeoutMs: Number(process.env.TFT_AGENT_DATABASE_CONNECT_TIMEOUT_MS ?? 5000),
    databaseStatementTimeoutMs: Number(process.env.TFT_AGENT_DATABASE_STATEMENT_TIMEOUT_MS ?? 30000),
    applicationName: "tftclarity-metatft-snapshot-migrate"
  });
  await runMigrations(migrationPool);
  await migrationPool.end();
  migrationPool = null;
  pool = createPostgresPool({
    databaseUrl,
    databaseSsl: process.env.TFT_AGENT_DATABASE_SSL ?? "disable",
    databaseConnectTimeoutMs: Number(process.env.TFT_AGENT_DATABASE_CONNECT_TIMEOUT_MS ?? 5000),
    databaseStatementTimeoutMs: Number(process.env.TFT_AGENT_DATABASE_STATEMENT_TIMEOUT_MS ?? 30000),
    applicationName: "tftclarity-metatft-snapshot"
  });
  store = new PostgresSnapshotStore(pool);
  const report = await runDailyCompSnapshot({
    store,
    compsClient: client,
    livePatch,
    minimumCount: Number(argument("minimum-count", process.env.METATFT_SNAPSHOT_MINIMUM_COUNT ?? "20")),
    maximumDropRatio: Number(argument("maximum-drop-ratio", process.env.METATFT_SNAPSHOT_MAXIMUM_DROP_RATIO ?? "0.5"))
  });
  process.stdout.write(`${JSON.stringify(printableReport(report, storage), null, 2)}\n`);
  if (report.overallStatus === "FAILED") process.exitCode = 1;
} finally {
  store?.close?.();
  await migrationPool?.end?.();
  await pool?.end?.();
}
