import { randomUUID } from "node:crypto";
import { normalizeSeasonContextId } from "../../season/season-context.js";
import { withTransaction } from "./client.js";

const iso = (value) => value ? new Date(value).toISOString() : null;
const season = (options = {}) => normalizeSeasonContextId(options.seasonContextId ?? options.season_context_id);
const providerContext = (options = {}) => ({
  provider: String(options.provider ?? "metatft"),
  providerVersion: String(options.providerVersion ?? options.provider_version ?? "metatft-live.v1"),
  effectivePatch: String(options.effectivePatch ?? options.effective_patch ?? options.patch ?? "current"),
  region: options.region ?? options.regionOrPlatform ?? null,
  queue: String(options.queue ?? "1100"),
  fetchedAt: options.fetchedAt ?? new Date().toISOString()
});
const normalizedAlias = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/gu, "");
const limit = (value, fallback = 100) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

function resultEntry(value, updatedAt, expiresAt = null) {
  return { value, updatedAt: iso(updatedAt), expiresAt, expired: false };
}

function aliasRow(row) {
  if (!row) return null;
  return { id: Number(row.id), seasonContextId: row.season_context_id, alias: row.alias, normalizedAlias: row.normalized_alias,
    entityType: row.entity_type, apiName: row.api_name, confidence: Number(row.confidence), source: row.source,
    patch: row.effective_patch, enabled: row.enabled, updatedBy: row.updated_by, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function queryRow(row) {
  if (!row) return null;
  return { queryId: row.query_id, runId: row.run_id, seasonContextId: row.season_context_id, visitorScope: row.visitor_scope,
    conversationId: row.conversation_id, input: row.input, resultType: row.result_type, query: row.query_json,
    response: row.response_json, patch: row.effective_patch, cacheHit: row.cache_hit, cacheStale: row.cache_stale,
    llmUsed: row.llm_used, llmModel: row.llm_model, durationMs: row.duration_ms, createdAt: iso(row.created_at) };
}

function feedbackRow(row) {
  if (!row) return null;
  return { id: Number(row.id), seasonContextId: row.season_context_id, feedbackId: row.feedback_id, queryId: row.query_id,
    visitorScope: row.visitor_scope, feedbackTarget: row.feedback_target, feedbackType: row.feedback_type, rating: row.rating,
    cardIndex: row.card_index, reason: row.reason, payload: row.payload_json, status: row.status,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function profileRow(row) {
  if (!row) return null;
  return { seasonContextId: row.season_context_id, profileKey: row.profile_key, difficulty: row.difficulty,
    beginnerFriendly: row.beginner_friendly, pivotDifficulty: row.pivot_difficulty, positionDifficulty: row.position_difficulty,
    contestTolerance: row.contest_tolerance, econDifficulty: row.econ_difficulty, notes: row.notes_json ?? [], enabled: row.enabled,
    source: row.source, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function bindingRow(row) {
  if (!row) return null;
  return { seasonContextId: row.season_context_id, profileKey: row.profile_key, provider: row.provider,
    providerVersion: row.provider_version, clusterId: row.cluster_id, lineupSignature: row.lineup_signature,
    signatureVersion: row.signature_version, strategyOverride: row.strategy_override, matchConfidence: Number(row.match_confidence),
    matchStatus: row.match_status, lastVerifiedAt: iso(row.last_verified_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

export class PostgresStore {
  constructor(options = {}) {
    if (!options.pool) throw new Error("PostgresStore requires a pool");
    this.pool = options.pool;
    this.now = options.now ?? (() => Date.now());
  }

  async getUserPreference(key) {
    const { rows } = await this.pool.query("SELECT value_json, updated_at FROM user_preferences WHERE preference_key = $1", [key]);
    return rows[0] ? resultEntry(rows[0].value_json, rows[0].updated_at) : null;
  }
  async setUserPreference(key, value) {
    const { rows } = await this.pool.query(`INSERT INTO user_preferences(preference_key,value_json) VALUES($1,$2)
      ON CONFLICT(preference_key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=now() RETURNING value_json,updated_at`, [key, value]);
    return resultEntry(rows[0].value_json, rows[0].updated_at);
  }
  async deleteUserPreference(key) { return (await this.pool.query("DELETE FROM user_preferences WHERE preference_key=$1", [key])).rowCount > 0; }

  async getItemCatalog(patch = "current", options = {}) {
    const context = providerContext({ ...options, effectivePatch: patch });
    const { rows } = await this.pool.query(`SELECT * FROM item_catalog WHERE season_context_id=$1 AND provider=$2 AND effective_patch=$3 ORDER BY external_id`,
      [season(options), context.provider, context.effectivePatch]);
    if (!rows.length) return null;
    const items = rows.map((row) => ({ ...(row.provider_metadata ?? {}), apiName: row.external_id, zhName: row.zh_name,
      category: row.category, current: row.current, obtainable: row.obtainable, patch: row.effective_patch, aliases: row.aliases ?? [] }));
    return resultEntry({ seasonContextId: season(options), patch: context.effectivePatch, items }, rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, rows[0].updated_at));
  }
  async setItemCatalog(patch = "current", items = [], options = {}) {
    const seasonContextId = season(options); const context = providerContext({ ...options, effectivePatch: patch });
    await withTransaction(this.pool, async (client) => {
      for (const item of items) await client.query(`INSERT INTO item_catalog(id,season_context_id,provider,provider_version,external_id,effective_patch,region_or_platform,queue,zh_name,category,current,obtainable,aliases,provider_metadata,fetched_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(season_context_id,provider,external_id) DO UPDATE SET provider_version=EXCLUDED.provider_version,effective_patch=EXCLUDED.effective_patch,
        region_or_platform=EXCLUDED.region_or_platform,queue=EXCLUDED.queue,zh_name=EXCLUDED.zh_name,category=EXCLUDED.category,current=EXCLUDED.current,
        obtainable=EXCLUDED.obtainable,aliases=EXCLUDED.aliases,provider_metadata=EXCLUDED.provider_metadata,fetched_at=EXCLUDED.fetched_at,updated_at=now()`,
      [randomUUID(),seasonContextId,context.provider,context.providerVersion,String(item.apiName),context.effectivePatch,context.region,context.queue,
        item.zhName ?? null,String(item.category ?? "unknown"),item.current !== false,item.obtainable !== false,item.aliases ?? [],item,context.fetchedAt]);
    });
    return resultEntry({ seasonContextId, patch: context.effectivePatch, items }, new Date());
  }
  async clearItemCatalog(patch, options = {}) {
    const values = [season(options), providerContext(options).provider];
    let sql = "DELETE FROM item_catalog WHERE season_context_id=$1 AND provider=$2";
    if (patch !== undefined && patch !== null) { values.push(String(patch)); sql += " AND effective_patch=$3"; }
    return (await this.pool.query(sql, values)).rowCount;
  }

  async getDomainCatalog(patch = "current", options = {}) {
    const context = providerContext({ ...options, effectivePatch: patch }); const values = [season(options), context.provider, context.effectivePatch];
    const [unitResult, traitResult] = await Promise.all([
      this.pool.query("SELECT * FROM units WHERE season_context_id=$1 AND provider=$2 AND effective_patch=$3 ORDER BY external_id", values),
      this.pool.query("SELECT * FROM traits WHERE season_context_id=$1 AND provider=$2 AND effective_patch=$3 ORDER BY filter_id", values)
    ]);
    if (!unitResult.rows.length && !traitResult.rows.length) return null;
    const units = unitResult.rows.map((row) => ({ ...(row.provider_metadata ?? {}), apiName: row.external_id, zhName: row.zh_name, aliases: row.aliases ?? [], current: row.current, patch: row.effective_patch }));
    const traits = traitResult.rows.map((row) => ({ ...(row.provider_metadata ?? {}), filterId: row.filter_id, apiName: row.external_id, zhName: row.zh_name, displayName: row.display_name, aliases: row.aliases ?? [], current: row.current, patch: row.effective_patch }));
    const all = [...unitResult.rows, ...traitResult.rows];
    return resultEntry({ seasonContextId: season(options), patch: context.effectivePatch, units, traits }, all[0]?.updated_at ?? new Date());
  }
  async setDomainCatalog(patch = "current", value = {}, options = {}) {
    const seasonContextId = season(options); const context = providerContext({ ...options, effectivePatch: patch });
    await withTransaction(this.pool, async (client) => {
      for (const unit of value.units ?? []) await client.query(`INSERT INTO units(id,season_context_id,provider,provider_version,external_id,effective_patch,region_or_platform,queue,zh_name,aliases,current,provider_metadata,fetched_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(season_context_id,provider,external_id) DO UPDATE SET provider_version=EXCLUDED.provider_version,
        effective_patch=EXCLUDED.effective_patch,region_or_platform=EXCLUDED.region_or_platform,queue=EXCLUDED.queue,zh_name=EXCLUDED.zh_name,aliases=EXCLUDED.aliases,current=EXCLUDED.current,provider_metadata=EXCLUDED.provider_metadata,fetched_at=EXCLUDED.fetched_at,updated_at=now()`,
      [randomUUID(),seasonContextId,context.provider,context.providerVersion,String(unit.apiName),context.effectivePatch,context.region,context.queue,unit.zhName ?? null,unit.aliases ?? [],unit.current !== false,unit,context.fetchedAt]);
      for (const trait of value.traits ?? []) await client.query(`INSERT INTO traits(id,season_context_id,provider,provider_version,external_id,filter_id,effective_patch,region_or_platform,queue,zh_name,display_name,aliases,current,provider_metadata,fetched_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(season_context_id,provider,external_id) DO UPDATE SET filter_id=EXCLUDED.filter_id,
        provider_version=EXCLUDED.provider_version,effective_patch=EXCLUDED.effective_patch,region_or_platform=EXCLUDED.region_or_platform,queue=EXCLUDED.queue,zh_name=EXCLUDED.zh_name,
        display_name=EXCLUDED.display_name,aliases=EXCLUDED.aliases,current=EXCLUDED.current,provider_metadata=EXCLUDED.provider_metadata,fetched_at=EXCLUDED.fetched_at,updated_at=now()`,
      [randomUUID(),seasonContextId,context.provider,context.providerVersion,String(trait.apiName ?? trait.filterId),String(trait.filterId ?? trait.apiName),context.effectivePatch,context.region,context.queue,trait.zhName ?? null,trait.displayName ?? null,trait.aliases ?? [],trait.current !== false,trait,context.fetchedAt]);
    });
    return resultEntry({ seasonContextId, patch: context.effectivePatch, units: value.units ?? [], traits: value.traits ?? [] }, new Date());
  }
  async clearDomainCatalog(patch, options = {}) {
    const values = [season(options), providerContext(options).provider]; let clause = "season_context_id=$1 AND provider=$2";
    if (patch !== undefined && patch !== null) { values.push(String(patch)); clause += " AND effective_patch=$3"; }
    return withTransaction(this.pool, async (client) => ({ units: (await client.query(`DELETE FROM units WHERE ${clause}`, values)).rowCount,
      traits: (await client.query(`DELETE FROM traits WHERE ${clause}`, values)).rowCount }));
  }

  async addEntityAlias(record = {}) {
    const alias = String(record.alias ?? "").trim(), entityType = String(record.entityType ?? record.entity_type ?? "").trim(), apiName = String(record.apiName ?? record.api_name ?? "").trim();
    if (!alias || !entityType || !apiName) throw new Error("addEntityAlias requires alias, entityType, and apiName");
    const { rows } = await this.pool.query(`INSERT INTO entity_aliases(season_context_id,alias,normalized_alias,entity_type,api_name,confidence,source,effective_patch,enabled,updated_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,now()),COALESCE($12,now())) RETURNING *`, [season(record),alias,record.normalizedAlias ?? normalizedAlias(alias),entityType,apiName,
      Number(record.confidence ?? 0.5),String(record.source ?? "candidate"),record.patch ?? null,record.enabled !== false,String(record.updatedBy ?? "system"),record.createdAt ?? null,record.updatedAt ?? null]);
    return aliasRow(rows[0]);
  }
  async getEntityAlias(id, options = {}) { return aliasRow((await this.pool.query("SELECT * FROM entity_aliases WHERE id=$1 AND season_context_id=$2", [id,season(options)])).rows[0]); }
  async updateEntityAlias(id, changes = {}, options = {}) {
    const current = await this.getEntityAlias(id, options); if (!current) return null;
    const next = { ...current, ...changes }; const alias = String(next.alias).trim();
    const { rows } = await this.pool.query(`UPDATE entity_aliases SET alias=$3,normalized_alias=$4,entity_type=$5,api_name=$6,confidence=$7,source=$8,effective_patch=$9,enabled=$10,updated_by=$11,updated_at=now()
      WHERE id=$1 AND season_context_id=$2 RETURNING *`,[id,season(options),alias,normalizedAlias(alias),next.entityType,next.apiName,Number(next.confidence),next.source,next.patch ?? null,next.enabled !== false,String(changes.updatedBy ?? options.updatedBy ?? "admin")]);
    return aliasRow(rows[0]);
  }
  setEntityAliasEnabled(id, enabled, options = {}) { return this.updateEntityAlias(id, { enabled }, options); }
  async deleteEntityAlias(id, options = {}) { return aliasRow((await this.pool.query("DELETE FROM entity_aliases WHERE id=$1 AND season_context_id=$2 RETURNING *",[id,season(options)])).rows[0]); }
  async listEntityAliases(options = {}) {
    const values=[season(options)]; const clauses=["season_context_id=$1"];
    const add=(sql,value)=>{values.push(value);clauses.push(sql.replace("?",`$${values.length}`));};
    if(options.entityType)add("entity_type=?",options.entityType); if(options.apiName)add("api_name=?",options.apiName); if(options.source)add("source=?",options.source);
    if(options.patch)add("effective_patch=?",options.patch); if(options.enabled!==undefined)add("enabled=?",Boolean(options.enabled)); if(options.minConfidence!==undefined)add("confidence>=?",Number(options.minConfidence));
    if(options.normalizedAlias)add("normalized_alias=?",options.normalizedAlias);
    if(options.query){values.push(`%${options.query}%`);const position=`$${values.length}`;clauses.push(`(alias ILIKE ${position} OR api_name ILIKE ${position} OR entity_type ILIKE ${position} OR source ILIKE ${position})`);}
    values.push(limit(options.limit,100),Math.max(0,Number(options.offset)||0));
    const { rows }=await this.pool.query(`SELECT * FROM entity_aliases WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    return rows.map(aliasRow);
  }
  findEntityAliases(alias, options = {}) { return this.listEntityAliases({ ...options, normalizedAlias: normalizedAlias(alias), enabled: options.enabled ?? true }); }
  async clearEntityAliases(options = {}) { const values=[season(options)]; let sql="DELETE FROM entity_aliases WHERE season_context_id=$1"; if(options.enabled!==undefined){values.push(Boolean(options.enabled));sql+=" AND enabled=$2";} return (await this.pool.query(sql,values)).rowCount; }

  async addQueryEvent(record = {}) {
    const context=providerContext(record); const { rows }=await this.pool.query(`INSERT INTO query_events(query_id,run_id,season_context_id,visitor_scope,conversation_id,input,result_type,query_json,response_json,provider,provider_version,effective_patch,region_or_platform,queue,fetched_at,cache_hit,cache_stale,llm_used,llm_model,duration_ms,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,COALESCE($21,now())) ON CONFLICT(query_id) DO UPDATE SET response_json=EXCLUDED.response_json,updated_at=now() RETURNING *`,
    [record.queryId,record.runId??null,season(record),record.visitorScope,record.conversationId??null,record.input,record.resultType??null,record.query??null,record.response??null,context.provider,context.providerVersion,
      record.patch??context.effectivePatch,context.region,context.queue,context.fetchedAt,Boolean(record.cacheHit),Boolean(record.cacheStale),Boolean(record.llmUsed),record.llmModel??null,record.durationMs??null,record.createdAt??null]); return queryRow(rows[0]);
  }
  async getQueryEvent(queryId) { return queryRow((await this.pool.query("SELECT * FROM query_events WHERE query_id=$1",[queryId])).rows[0]); }
  async updateQueryEventConclusion(queryId, conclusion) {
    const { rows }=await this.pool.query(`UPDATE query_events SET response_json=jsonb_set(COALESCE(response_json,'{}'::jsonb),'{answer,generatedConclusion}',$2::jsonb,true),llm_used=$3,llm_model=COALESCE($4,llm_model),updated_at=now() WHERE query_id=$1 RETURNING *`,
      [queryId,JSON.stringify(conclusion??null),conclusion?.status==="generated",conclusion?.model??null]); return queryRow(rows[0]);
  }
  async pruneQueryEventsBefore(createdBefore) { return (await this.pool.query("DELETE FROM query_events WHERE created_at<$1",[createdBefore])).rowCount; }

  async addFeedbackEvent(feedbackType,payload={},options={}) {
    const feedbackId=String(options.feedbackId??payload.feedbackId??"").trim(); if(!feedbackId)throw new Error("PostgreSQL feedback requires feedbackId");
    return withTransaction(this.pool,async(client)=>{ const existing=feedbackRow((await client.query("SELECT * FROM feedback_events WHERE feedback_id=$1",[feedbackId])).rows[0]); if(existing)return{...existing,duplicate:true};
      const { rows }=await client.query(`INSERT INTO feedback_events(feedback_id,season_context_id,query_id,visitor_scope,feedback_target,feedback_type,rating,card_index,reason,payload_json,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),COALESCE($13,now())) RETURNING *`,[feedbackId,season(options.seasonContextId?options:payload),options.queryId??null,options.visitorScope??null,options.feedbackTarget??null,String(feedbackType),options.rating??null,Number.isInteger(options.cardIndex)?options.cardIndex:null,options.reason??null,payload,String(options.status??"pending"),options.createdAt??null,options.updatedAt??null]); return feedbackRow(rows[0]); });
  }
  async findFeedbackEventByFeedbackId(id){return feedbackRow((await this.pool.query("SELECT * FROM feedback_events WHERE feedback_id=$1",[id])).rows[0]);}
  async listFeedbackEvents(options={}){const values=[];const clauses=[];const add=(sql,val)=>{values.push(val);clauses.push(`${sql}$${values.length}`)};if(options.seasonContextId)add("season_context_id=",season(options));if(options.feedbackType)add("feedback_type=",options.feedbackType);if(options.status)add("status=",options.status);values.push(limit(options.limit,100));const {rows}=await this.pool.query(`SELECT * FROM feedback_events ${clauses.length?`WHERE ${clauses.join(" AND ")}`:""} ORDER BY id DESC LIMIT $${values.length}`,values);return rows.map(feedbackRow);}
  async clearFeedbackEvents(options={}){const values=[];const clauses=[];const add=(column,val)=>{values.push(val);clauses.push(`${column}=$${values.length}`)};if(options.seasonContextId)add("season_context_id",season(options));if(options.feedbackType)add("feedback_type",options.feedbackType);if(options.status)add("status",options.status);if(!clauses.length)throw new Error("clearFeedbackEvents requires a filter");return(await this.pool.query(`DELETE FROM feedback_events WHERE ${clauses.join(" AND ")}`,values)).rowCount;}

  async addAdminAudit(record={}){const {rows}=await this.pool.query(`INSERT INTO admin_audit_events(season_context_id,action,entity_type,entity_id,before_json,after_json,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now())) RETURNING *`,[season(record),record.action,record.entityType??record.entity_type,record.entityId??null,record.before??null,record.after??null,String(record.actor??"admin"),record.createdAt??null]);const r=rows[0];return{id:Number(r.id),seasonContextId:r.season_context_id,action:r.action,entityType:r.entity_type,entityId:r.entity_id,before:r.before_json,after:r.after_json,actor:r.actor,createdAt:iso(r.created_at)};}
  async listAdminAudits(options={}){const {rows}=await this.pool.query("SELECT * FROM admin_audit_events WHERE season_context_id=$1 ORDER BY id DESC LIMIT $2",[season(options),limit(options.limit,100)]);return rows.map(r=>({id:Number(r.id),seasonContextId:r.season_context_id,action:r.action,entityType:r.entity_type,entityId:r.entity_id,before:r.before_json,after:r.after_json,actor:r.actor,createdAt:iso(r.created_at)}));}

  async upsertCompProfile(record={}){const {rows}=await this.pool.query(`INSERT INTO comp_profiles(season_context_id,profile_key,difficulty,beginner_friendly,pivot_difficulty,position_difficulty,contest_tolerance,econ_difficulty,notes_json,enabled,source,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),COALESCE($13,now())) ON CONFLICT(season_context_id,profile_key) DO UPDATE SET difficulty=EXCLUDED.difficulty,beginner_friendly=EXCLUDED.beginner_friendly,pivot_difficulty=EXCLUDED.pivot_difficulty,position_difficulty=EXCLUDED.position_difficulty,contest_tolerance=EXCLUDED.contest_tolerance,econ_difficulty=EXCLUDED.econ_difficulty,notes_json=EXCLUDED.notes_json,enabled=EXCLUDED.enabled,source=EXCLUDED.source,updated_at=now() RETURNING *`,
    [season(record),record.profileKey,record.difficulty??null,record.beginnerFriendly??null,record.pivotDifficulty??null,record.positionDifficulty??null,record.contestTolerance??null,record.econDifficulty??null,record.notes??[],record.enabled!==false,String(record.source??"admin"),record.createdAt??null,record.updatedAt??null]);return profileRow(rows[0]);}
  async getCompProfile(profileKey,options={}){return profileRow((await this.pool.query("SELECT * FROM comp_profiles WHERE season_context_id=$1 AND profile_key=$2",[season(options),profileKey])).rows[0]);}
  async listCompProfiles(options={}){const values=[season(options)];let sql="SELECT * FROM comp_profiles WHERE season_context_id=$1";if(options.enabled!==undefined){values.push(Boolean(options.enabled));sql+=" AND enabled=$2";}sql+=" ORDER BY profile_key";return(await this.pool.query(sql,values)).rows.map(profileRow);}
  async deleteCompProfile(profileKey,options={}){return profileRow((await this.pool.query("DELETE FROM comp_profiles WHERE season_context_id=$1 AND profile_key=$2 RETURNING *",[season(options),profileKey])).rows[0]);}
  async upsertCompProfileBinding(record={}){const {rows}=await this.pool.query(`INSERT INTO comp_profile_bindings(season_context_id,profile_key,provider,provider_version,cluster_id,lineup_signature,signature_version,strategy_override,match_confidence,match_status,last_verified_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),COALESCE($13,now())) ON CONFLICT(season_context_id,profile_key,provider) DO UPDATE SET provider_version=EXCLUDED.provider_version,cluster_id=EXCLUDED.cluster_id,lineup_signature=EXCLUDED.lineup_signature,signature_version=EXCLUDED.signature_version,strategy_override=EXCLUDED.strategy_override,match_confidence=EXCLUDED.match_confidence,match_status=EXCLUDED.match_status,last_verified_at=EXCLUDED.last_verified_at,updated_at=now() RETURNING *`,
    [season(record),record.profileKey,record.provider,record.providerVersion??"unknown",record.clusterId,record.lineupSignature,record.signatureVersion??"lineup-signature-v1",record.strategyOverride??null,Number(record.matchConfidence??1),record.matchStatus??"verified",record.lastVerifiedAt??new Date(),record.createdAt??null,record.updatedAt??null]);return bindingRow(rows[0]);}
  async listCompProfileBindings(options={}){const values=[season(options)];const clauses=["season_context_id=$1"];for(const[column,key]of[["profile_key","profileKey"],["provider","provider"],["cluster_id","clusterId"],["match_status","matchStatus"]])if(options[key]){values.push(options[key]);clauses.push(`${column}=$${values.length}`)}return(await this.pool.query(`SELECT * FROM comp_profile_bindings WHERE ${clauses.join(" AND ")} ORDER BY profile_key`,values)).rows.map(bindingRow);}
  async deleteCompProfileBinding(profileKey,provider,options={}){return bindingRow((await this.pool.query("DELETE FROM comp_profile_bindings WHERE season_context_id=$1 AND profile_key=$2 AND provider=$3 RETURNING *",[season(options),profileKey,provider])).rows[0]);}

  async getCompTrendHistory(key,options={}){const {rows}=await this.pool.query("SELECT * FROM comp_trend_history WHERE season_context_id=$1 AND history_key=$2",[season(options),key]);return rows[0]?resultEntry(rows[0].value_json,rows[0].updated_at):null;}
  async setCompTrendHistory(key,value,options={}){const c=providerContext(options);const {rows}=await this.pool.query(`INSERT INTO comp_trend_history(season_context_id,history_key,provider,provider_version,effective_patch,region_or_platform,queue,value_json,fetched_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(season_context_id,history_key) DO UPDATE SET provider=EXCLUDED.provider,provider_version=EXCLUDED.provider_version,effective_patch=EXCLUDED.effective_patch,region_or_platform=EXCLUDED.region_or_platform,queue=EXCLUDED.queue,value_json=EXCLUDED.value_json,fetched_at=EXCLUDED.fetched_at,updated_at=now() RETURNING *`,[season(options),key,c.provider,c.providerVersion,c.effectivePatch,c.region,c.queue,value,c.fetchedAt]);return resultEntry(rows[0].value_json,rows[0].updated_at);}

  async healthCheck(){const {rows}=await this.pool.query("SELECT current_database() AS database, now() AS checked_at, to_regclass('public.schema_migrations') AS migrations");return{ok:Boolean(rows[0].migrations),type:"postgres",database:rows[0].database,checkedAt:iso(rows[0].checked_at),schemaReady:Boolean(rows[0].migrations)};}
  async close(){await this.pool.end();}
}
