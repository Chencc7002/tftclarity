import pg from "pg";

export function createPostgresPool(config = {}) {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL storage");
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax ?? 10,
    idleTimeoutMillis: config.databaseIdleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs ?? 5_000,
    statement_timeout: config.databaseStatementTimeoutMs ?? 10_000,
    ssl: config.databaseSsl === "require" ? { rejectUnauthorized: true } : false,
    application_name: config.applicationName ?? "tftagent"
  });
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
