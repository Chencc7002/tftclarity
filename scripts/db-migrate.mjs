import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveStorageConfig } from "../src/storage/config.js";
import { createPostgresPool } from "../src/storage/postgres/client.js";
import { runMigrations } from "../src/storage/postgres/migration-runner.js";

loadLocalEnvironment();
const pool = createPostgresPool(resolveStorageConfig({
  persistentStore: "postgres",
  databaseUrl: process.env.TFT_AGENT_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
}));
try {
  const result = await runMigrations(pool);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
