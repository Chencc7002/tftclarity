import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SQLiteCacheStore } from "../src/data/sqlite-cache-store.js";

const source = resolve(process.argv[2] ?? process.env.TFT_AGENT_CACHE_PATH ?? ".cache/tft-agent.sqlite");
const output = resolve(process.argv[3] ?? "docs/reports/storage-phase0-baseline.json");
const store = await SQLiteCacheStore.open({ filePath: source });
const tables = ["user_preferences","entity_aliases","item_catalog","units","traits","query_events","feedback_events","admin_audit_events","comp_profiles","comp_profile_bindings","comp_trend_history","session_state","query_cache","default_context_cache"];
const report = { schemaVersion: "storage_phase0_baseline.v1", generatedAt: new Date().toISOString(), source: source.replace(process.cwd(), "."), semanticIndexInScope: false, tables: {} };
for (const table of tables) {
  const columns = store.database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  const row = store.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  report.tables[table] = { rows: Number(row.count), columns, schemaFingerprint: createHash("sha256").update(columns.join("|")).digest("hex") };
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(output);
