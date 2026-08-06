import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveStorageConfig } from "../src/storage/config.js";
import { createPostgresPool } from "../src/storage/postgres/client.js";
import { migrationStatus } from "../src/storage/postgres/migration-runner.js";

loadLocalEnvironment();
const pool = createPostgresPool(resolveStorageConfig({
  persistentStore: "postgres",
  databaseUrl: process.env.TFT_AGENT_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
}));
try {
  const status = await migrationStatus(pool);
  console.table(status);
  if (status.some((row) => row.status !== "applied")) process.exitCode = 1;
} finally {
  await pool.end();
}
