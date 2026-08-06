import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");
const checksum = (sql) => createHash("sha256").update(sql).digest("hex");

export async function loadMigrations(directory = DEFAULT_MIGRATIONS_DIR) {
  const names = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/u.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(resolve(directory, name), "utf8");
    return { version: name.replace(/\.sql$/u, ""), name, sql, checksum: checksum(sql) };
  }));
}

export async function migrationStatus(pool, options = {}) {
  const migrations = await loadMigrations(options.directory);
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await pool.query("SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version")).rows.map((row) => [row.version, row]));
  return migrations.map((migration) => ({
    version: migration.version,
    checksum: migration.checksum,
    status: !applied.has(migration.version) ? "pending" : applied.get(migration.version).checksum === migration.checksum ? "applied" : "checksum_mismatch",
    appliedAt: applied.get(migration.version)?.applied_at?.toISOString?.() ?? null
  }));
}

export async function runMigrations(pool, options = {}) {
  const migrations = await loadMigrations(options.directory);
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await pool.query("SELECT version,checksum FROM schema_migrations")).rows.map((row) => [row.version, row.checksum]));
  const executed = [];
  for (const migration of migrations) {
    const prior = applied.get(migration.version);
    if (prior && prior !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.version}`);
    if (prior) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", [migration.version, migration.checksum]);
      await client.query("COMMIT");
      executed.push(migration.version);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return { executed, status: await migrationStatus(pool, options) };
}
