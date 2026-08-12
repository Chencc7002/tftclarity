import { resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { SQLiteCacheStore } from "../src/data/sqlite-cache-store.js";
import { resolveStorageConfig } from "../src/storage/config.js";
import { createPostgresPool } from "../src/storage/postgres/client.js";

loadLocalEnvironment();

const source = await SQLiteCacheStore.open({
  filePath: resolve(process.argv[2] ?? process.env.TFT_AGENT_CACHE_PATH ?? ".cache/tft-agent.sqlite")
});
const pool = createPostgresPool(resolveStorageConfig({ persistentStore: "postgres" }));

const tableSpecs = {
  user_preferences: { keys: ["key"], targetKeys: ["preference_key"], json: ["value_json"] },
  entity_aliases: { keys: ["id"] },
  item_catalog: { keys: ["season_context_id", "api_name"], targetKeys: ["season_context_id", "external_id"], json: ["aliases_json", "raw_json"] },
  units: { keys: ["season_context_id", "api_name"], targetKeys: ["season_context_id", "external_id"], json: ["aliases_json", "raw_json"] },
  traits: { keys: ["season_context_id", "api_name"], targetKeys: ["season_context_id", "external_id"], json: ["aliases_json", "raw_json"] },
  query_events: { keys: ["query_id"], json: ["query_json", "response_json"] },
  feedback_events: { keys: ["feedback_id"], json: ["payload_json"] },
  admin_audit_events: { keys: ["id"], json: ["before_json", "after_json"] },
  comp_profiles: { keys: ["season_context_id", "profile_key"], json: ["notes_json"] },
  comp_profile_bindings: { keys: ["season_context_id", "profile_key", "provider"] },
  comp_trend_history: { keys: ["season_context_id", "history_key"], json: ["value_json"] }
};

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const fingerprint = (row, keys) => JSON.stringify(keys.map((key) => row[key]));
const sampleRows = (rows) => rows.length <= 3
  ? rows
  : [rows[0], rows[Math.floor(rows.length / 2)], rows.at(-1)];

const report = {
  schemaVersion: "storage_migration_verification.v2",
  generatedAt: new Date().toISOString(),
  ok: true,
  tables: {}
};

try {
  for (const [table, spec] of Object.entries(tableSpecs)) {
    const sourceRows = source.database.prepare(`SELECT * FROM ${quote(table)}`).all();
    const targetKeys = spec.targetKeys ?? spec.keys;
    const targetCount = Number((await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${quote(table)}`)).rows[0].count);
    const sourceUniqueCount = new Set(sourceRows.map((row) => fingerprint(row, spec.keys))).size;
    const targetUniqueExpression = targetKeys.length === 1
      ? quote(targetKeys[0])
      : `(${targetKeys.map(quote).join(",")})`;
    const targetUniqueCount = Number((await pool.query(
      `SELECT COUNT(DISTINCT ${targetUniqueExpression})::bigint AS count FROM ${quote(table)}`
    )).rows[0].count);

    const invalidSourceJson = [];
    for (const row of sourceRows) {
      for (const column of spec.json ?? []) {
        if (row[column] == null) continue;
        try { JSON.parse(row[column]); }
        catch { invalidSourceJson.push({ column, key: fingerprint(row, spec.keys) }); }
      }
    }

    const samples = [];
    for (const row of sampleRows(sourceRows)) {
      const values = spec.keys.map((key) => row[key]);
      const clauses = targetKeys.map((key, index) => `${quote(key)} IS NOT DISTINCT FROM $${index + 1}`);
      const found = Number((await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${quote(table)} WHERE ${clauses.join(" AND ")}`,
        values
      )).rows[0].count) === 1;
      samples.push({ key: fingerprint(row, spec.keys), found });
    }

    const jsonbColumns = (await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND data_type='jsonb' ORDER BY ordinal_position",
      [table]
    )).rows.map((row) => row.column_name);
    const ok = targetCount >= sourceUniqueCount
      && targetUniqueCount >= sourceUniqueCount
      && invalidSourceJson.length === 0
      && samples.every((sample) => sample.found);

    report.tables[table] = {
      sourceRows: sourceRows.length,
      targetRows: targetCount,
      sourceUniqueKeys: sourceUniqueCount,
      targetUniqueKeys: targetUniqueCount,
      invalidSourceJson,
      jsonbColumns,
      samples,
      ok
    };
    report.ok &&= ok;
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await pool.end();
}
