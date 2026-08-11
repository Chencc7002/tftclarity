import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { SQLiteCacheStore } from "../src/data/sqlite-cache-store.js";
import { resolveStorageConfig } from "../src/storage/config.js";
import { createPostgresPool, withTransaction } from "../src/storage/postgres/client.js";
import { runMigrations } from "../src/storage/postgres/migration-runner.js";

loadLocalEnvironment();
const sourcePath = resolve(process.argv[2] ?? process.env.TFT_AGENT_CACHE_PATH ?? ".cache/tft-agent.sqlite");
const sourceFingerprint = await new Promise((resolveHash, rejectHash) => {
  const digest = createHash("sha256");
  createReadStream(sourcePath).on("data", (chunk) => digest.update(chunk)).once("error", rejectHash).once("end", () => resolveHash(digest.digest("hex")));
});
const source = await SQLiteCacheStore.open({ filePath: sourcePath });
const pool = createPostgresPool(resolveStorageConfig({ persistentStore: "postgres" }));
const json = (value, fallback = null) => {
  let parsed;
  try {
    parsed = value == null ? fallback : JSON.parse(value);
  } catch {
    parsed = fallback;
  }
  return parsed == null ? null : JSON.stringify(parsed);
};
const rows = (table) => source.database.prepare(`SELECT * FROM ${table}`).all();
const context = (row) => ({ provider: row.source?.startsWith?.("riot") ? "riot" : "metatft", providerVersion: "metatft-live.v1", patch: row.patch || "current", fetchedAt: row.updated_at || new Date().toISOString() });
const report = { schemaVersion: "sqlite_postgres_migration.v1", sourcePath: sourcePath.replace(process.cwd(), "."), sourceFingerprint, startedAt: new Date().toISOString(), tables: {} };

try {
  await runMigrations(pool);
  const prior = await pool.query("SELECT status,report_json FROM data_migration_batches WHERE source_type='sqlite' AND source_fingerprint=$1", [sourceFingerprint]);
  if (prior.rows[0]?.status === "complete") {
    console.log(JSON.stringify({ ...prior.rows[0].report_json, idempotentReplay: true }, null, 2));
    process.exit(0);
  }
  const batchId = randomUUID();
  await pool.query(`INSERT INTO data_migration_batches(batch_id,source_type,source_fingerprint,status) VALUES($1,'sqlite',$2,'running')
    ON CONFLICT(source_type,source_fingerprint) DO UPDATE SET status='running',started_at=now(),finished_at=NULL`, [batchId, sourceFingerprint]);

  await withTransaction(pool, async (client) => {
    const track = async (table, input, operation) => { for (const row of input) await operation(row); report.tables[table] = { sourceRows: input.length }; };
    await track("user_preferences", rows("user_preferences"), (r) => client.query(`INSERT INTO user_preferences(preference_key,value_json,updated_at) VALUES($1,$2,$3)
      ON CONFLICT(preference_key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=EXCLUDED.updated_at`, [r.key,json(r.value_json,{}),r.updated_at]));
    await track("entity_aliases", rows("entity_aliases"), (r) => client.query(`INSERT INTO entity_aliases(id,season_context_id,alias,normalized_alias,entity_type,api_name,confidence,source,effective_patch,enabled,updated_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET alias=EXCLUDED.alias,normalized_alias=EXCLUDED.normalized_alias,entity_type=EXCLUDED.entity_type,api_name=EXCLUDED.api_name,confidence=EXCLUDED.confidence,source=EXCLUDED.source,effective_patch=EXCLUDED.effective_patch,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
      [r.id,r.season_context_id,r.alias,r.normalized_alias,r.entity_type,r.api_name,r.confidence,r.source,r.patch,Boolean(r.enabled),r.updated_by||"legacy_migration",r.created_at||r.updated_at,r.updated_at]));
    await track("item_catalog", rows("item_catalog"), (r) => { const c=context(r); return client.query(`INSERT INTO item_catalog(id,season_context_id,provider,provider_version,external_id,effective_patch,zh_name,category,current,obtainable,aliases,provider_metadata,fetched_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(season_context_id,provider,external_id) DO UPDATE SET provider_version=EXCLUDED.provider_version,effective_patch=EXCLUDED.effective_patch,zh_name=EXCLUDED.zh_name,category=EXCLUDED.category,current=EXCLUDED.current,obtainable=EXCLUDED.obtainable,aliases=EXCLUDED.aliases,provider_metadata=EXCLUDED.provider_metadata,fetched_at=EXCLUDED.fetched_at,updated_at=EXCLUDED.updated_at`,
      [randomUUID(),r.season_context_id,c.provider,c.providerVersion,r.api_name,c.patch,r.zh_name,r.category,Boolean(r.current),Boolean(r.obtainable),json(r.aliases_json,[]),json(r.raw_json,{}),c.fetchedAt,r.updated_at]); });
    await track("units", rows("units"), (r) => { const c=context(r); return client.query(`INSERT INTO units(id,season_context_id,provider,provider_version,external_id,effective_patch,zh_name,aliases,current,provider_metadata,fetched_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(season_context_id,provider,external_id) DO UPDATE SET provider_version=EXCLUDED.provider_version,effective_patch=EXCLUDED.effective_patch,zh_name=EXCLUDED.zh_name,aliases=EXCLUDED.aliases,current=EXCLUDED.current,provider_metadata=EXCLUDED.provider_metadata,fetched_at=EXCLUDED.fetched_at,updated_at=EXCLUDED.updated_at`,
      [randomUUID(),r.season_context_id,c.provider,c.providerVersion,r.api_name,c.patch,r.zh_name,json(r.aliases_json,[]),Boolean(r.current),json(r.raw_json,{}),c.fetchedAt,r.updated_at]); });
    await track("traits", rows("traits"), (r) => { const c=context(r); return client.query(`INSERT INTO traits(id,season_context_id,provider,provider_version,external_id,filter_id,effective_patch,zh_name,display_name,aliases,current,provider_metadata,fetched_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(season_context_id,provider,external_id) DO UPDATE SET filter_id=EXCLUDED.filter_id,provider_version=EXCLUDED.provider_version,effective_patch=EXCLUDED.effective_patch,zh_name=EXCLUDED.zh_name,display_name=EXCLUDED.display_name,aliases=EXCLUDED.aliases,current=EXCLUDED.current,provider_metadata=EXCLUDED.provider_metadata,fetched_at=EXCLUDED.fetched_at,updated_at=EXCLUDED.updated_at`,
      [randomUUID(),r.season_context_id,c.provider,c.providerVersion,r.api_name,r.filter_id,c.patch,r.zh_name,r.display_name,json(r.aliases_json,[]),Boolean(r.current),json(r.raw_json,{}),c.fetchedAt,r.updated_at]); });
    await track("query_events", rows("query_events"), (r) => client.query(`INSERT INTO query_events(query_id,run_id,season_context_id,visitor_scope,conversation_id,input,result_type,query_json,response_json,provider,provider_version,effective_patch,cache_hit,cache_stale,llm_used,llm_model,duration_ms,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'metatft','metatft-live.v1',$10,$11,$12,$13,$14,$15,$16,$16) ON CONFLICT(query_id) DO UPDATE SET response_json=EXCLUDED.response_json,llm_used=EXCLUDED.llm_used,llm_model=EXCLUDED.llm_model,updated_at=EXCLUDED.updated_at`,
      [r.query_id,r.run_id,r.season_context_id,r.visitor_scope,r.conversation_id,r.input,r.result_type,json(r.query_json),json(r.response_json),r.patch||"current",Boolean(r.cache_hit),Boolean(r.cache_stale),Boolean(r.llm_used),r.llm_model,r.duration_ms,r.created_at]));
    await track("feedback_events", rows("feedback_events"), (r) => client.query(`INSERT INTO feedback_events(id,feedback_id,season_context_id,query_id,visitor_scope,feedback_target,feedback_type,rating,card_index,reason,payload_json,status,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(feedback_id) DO UPDATE SET status=EXCLUDED.status,payload_json=EXCLUDED.payload_json,updated_at=EXCLUDED.updated_at`,
      [r.id,r.feedback_id,r.season_context_id,r.query_id,r.visitor_scope,r.feedback_target,r.feedback_type,r.rating,r.card_index,r.reason,json(r.payload_json,{}),r.status,r.created_at,r.updated_at||r.created_at]));
    await track("admin_audit_events", rows("admin_audit_events"), (r) => client.query(`INSERT INTO admin_audit_events(id,season_context_id,action,entity_type,entity_id,before_json,after_json,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
      [r.id,r.season_context_id,r.action,r.entity_type,r.entity_id,json(r.before_json),json(r.after_json),r.actor,r.created_at]));
    await track("comp_profiles", rows("comp_profiles"), (r) => client.query(`INSERT INTO comp_profiles(season_context_id,profile_key,difficulty,beginner_friendly,pivot_difficulty,position_difficulty,contest_tolerance,econ_difficulty,notes_json,enabled,source,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(season_context_id,profile_key) DO UPDATE SET difficulty=EXCLUDED.difficulty,beginner_friendly=EXCLUDED.beginner_friendly,pivot_difficulty=EXCLUDED.pivot_difficulty,position_difficulty=EXCLUDED.position_difficulty,contest_tolerance=EXCLUDED.contest_tolerance,econ_difficulty=EXCLUDED.econ_difficulty,notes_json=EXCLUDED.notes_json,enabled=EXCLUDED.enabled,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
      [r.season_context_id,r.profile_key,r.difficulty,r.beginner_friendly,r.pivot_difficulty,r.position_difficulty,r.contest_tolerance,r.econ_difficulty,json(r.notes_json,[]),Boolean(r.enabled),r.source,r.created_at,r.updated_at]));
    await track("comp_profile_bindings", rows("comp_profile_bindings"), (r) => client.query(`INSERT INTO comp_profile_bindings(season_context_id,profile_key,provider,provider_version,cluster_id,lineup_signature,signature_version,strategy_override,match_confidence,match_status,last_verified_at,created_at,updated_at)
      VALUES($1,$2,$3,'metatft-live.v1',$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(season_context_id,profile_key,provider) DO UPDATE SET cluster_id=EXCLUDED.cluster_id,lineup_signature=EXCLUDED.lineup_signature,signature_version=EXCLUDED.signature_version,strategy_override=EXCLUDED.strategy_override,match_confidence=EXCLUDED.match_confidence,match_status=EXCLUDED.match_status,last_verified_at=EXCLUDED.last_verified_at,updated_at=EXCLUDED.updated_at`,
      [r.season_context_id,r.profile_key,r.provider,r.cluster_id,r.lineup_signature,r.signature_version||"lineup-signature-v1",r.strategy_override,r.match_confidence,r.match_status,r.last_verified_at,r.created_at,r.updated_at]));
    await track("comp_trend_history", rows("comp_trend_history"), (r) => client.query(`INSERT INTO comp_trend_history(season_context_id,history_key,provider,provider_version,effective_patch,value_json,fetched_at,updated_at) VALUES($1,$2,'metatft','metatft-live.v1','current',$3,$4,$4)
      ON CONFLICT(season_context_id,history_key) DO UPDATE SET value_json=EXCLUDED.value_json,fetched_at=EXCLUDED.fetched_at,updated_at=EXCLUDED.updated_at`, [r.season_context_id,r.history_key,json(r.value_json,{}),r.updated_at]));
    for (const table of ["entity_aliases", "feedback_events", "admin_audit_events"]) {
      await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), EXISTS(SELECT 1 FROM ${table}))`, [table]);
    }
  });
  report.finishedAt = new Date().toISOString(); report.status = "complete";
  await pool.query("UPDATE data_migration_batches SET status='complete',report_json=$2,finished_at=now() WHERE source_type='sqlite' AND source_fingerprint=$1", [sourceFingerprint, report]);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await pool.query("UPDATE data_migration_batches SET status='failed',report_json=$2,finished_at=now() WHERE source_type='sqlite' AND source_fingerprint=$1", [sourceFingerprint, { ...report, error: error.message }]).catch(() => {});
  throw error;
} finally { await pool.end(); }
