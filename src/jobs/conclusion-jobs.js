import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createCatalog } from "../data/static-data.js";
import { generateEvidenceBackedConclusion } from "../core/conclusion-service.js";
import { createConclusionProviderFromConfig, resolveConclusionProviderConfig } from "../llm/conclusion-provider.js";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const safeEqual = (left, right) => { const a=Buffer.from(String(left)); const b=Buffer.from(String(right)); return a.length===b.length&&timingSafeEqual(a,b); };

export function serializeConclusionPayload(options = {}) {
  const catalog = options.catalog ?? {};
  return {
    payloadVersion: "conclusion_job.v1",
    result: structuredClone(options.result),
    catalog: {
      items: [...(catalog.items ?? catalog.itemByApiName?.values?.() ?? [])],
      units: [...(catalog.units ?? catalog.unitByApiName?.values?.() ?? [])],
      traits: [...(catalog.traits ?? catalog.traitByApiName?.values?.() ?? [])]
    },
    input: String(options.input ?? ""),
    previousQuery: structuredClone(options.previousQuery ?? null),
    requestEnabled: options.requestEnabled !== false,
    bypassCache: Boolean(options.bypassCache),
    seasonContextId: options.seasonContextId,
    principalId: options.principalId,
    conversationId: options.conversationId,
    semanticEvidence: structuredClone(options.semanticEvidence ?? [])
  };
}

export class ConclusionJobCoordinator {
  constructor(options = {}) {
    if (!options.store) throw new Error("ConclusionJobCoordinator requires a job store");
    this.store = options.store; this.ttlMs = options.ttlMs ?? 1_800_000; this.model = options.model ?? null;
  }
  async create(payload, ownerScopeHash) {
    const jobId=randomUUID(), token=randomUUID();
    const job=await this.store.createConclusionJob({ jobId, ownerScopeHash:hash(ownerScopeHash??"local"), accessTokenHash:hash(token), status:"queued", payloadVersion:payload.payloadVersion, requestPayload:payload, model:this.model, attempts:0 },{ttlMs:this.ttlMs});
    await this.store.enqueueConclusionJob(jobId);
    return { ...job, id: jobId, token };
  }
  async getOwned(jobId, ownerScopeHash, token) {
    const job=await this.store.getConclusionJob(jobId); if(!job)return null;
    return hash(ownerScopeHash??"local")===job.ownerScopeHash||safeEqual(hash(token??""),job.accessTokenHash)?job:null;
  }
  async attachQuery(jobId, queryId) { return this.store.updateConclusionJob?.(jobId,{queryId})??null; }
}

export class ConclusionWorker {
  constructor(options = {}) {
    if (!options.store) throw new Error("ConclusionWorker requires a job store");
    this.store=options.store; this.persistentStore=options.persistentStore??null; this.workerId=options.workerId??randomUUID();
    this.attempts=Math.max(1,Number(options.attempts??2)); this.backoffMs=Math.max(1,Number(options.backoffMs??1000));
    this.concurrency=Math.max(1,Number(options.concurrency??1));
    this.providerConfig=options.providerConfig??resolveConclusionProviderConfig({},options.env??process.env);
    this.provider=options.provider??createConclusionProviderFromConfig(this.providerConfig,{fetchImpl:options.fetchImpl});
    this.running=false; this.timer=null;
  }
  async runOnce() {
    const jobId=await this.store.dequeueConclusionJob?.(0); if(!jobId)return false;
    const job=await this.store.claimConclusionJob(jobId,this.workerId);
    if(!job){await this.store.acknowledgeConclusionJob?.(jobId);return false;}
    let acknowledge=true;
    try {
      if(!this.provider)throw Object.assign(new Error("Conclusion provider is not configured"),{code:"provider_unavailable"});
      const p=job.requestPayload; const conclusion=await generateEvidenceBackedConclusion({ ...p, catalog:createCatalog(p.catalog), config:this.providerConfig, provider:this.provider, cacheStore:this.persistentStore });
      const status=conclusion?.status==="generated"?"complete":"fallback";
      await this.store.appendConclusionChunk(jobId,{type:"complete",conclusion});
      const completed=await this.store.completeConclusionJob(jobId,status,{result:conclusion,errorCode:null});
      if(completed?.queryId){try{await this.persistentStore?.updateQueryEventConclusion?.(completed.queryId,conclusion);}catch(error){await this.store.updateConclusionJob?.(jobId,{persistenceError:error.code??"query_event_update_failed"});}}
    } catch(error) {
      if(Number(job.attempts)<this.attempts){acknowledge=false;await this.store.completeConclusionJob(jobId,"retrying",{errorCode:error.code??"conclusion_job_failed"});setTimeout(()=>{void (async()=>{await this.store.completeConclusionJob(jobId,"queued",{});await this.store.enqueueConclusionJob(jobId);await this.store.acknowledgeConclusionJob?.(jobId);})().catch(()=>{});},this.backoffMs*2**Math.max(0,Number(job.attempts)-1));}
      else await this.store.completeConclusionJob(jobId,"failed",{errorCode:error.code??"conclusion_job_failed",error:{status:"fallback",content:null,reason:"provider_unavailable",model:job.model,error:error.code??"conclusion_job_failed"}});
    }
    if(acknowledge)await this.store.acknowledgeConclusionJob?.(jobId);
    return true;
  }
  start(pollMs=250){if(this.running)return;this.running=true;this.timers=[];void (async()=>{await this.store.recoverStalledConclusionJobs?.();for(let index=0;index<this.concurrency;index+=1){const tick=async()=>{if(!this.running)return;try{await this.runOnce();}finally{if(this.running)this.timers[index]=setTimeout(tick,pollMs);}};void tick();}})().catch(()=>{this.running=false;});}
  stop(){this.running=false;for(const timer of this.timers??[])if(timer)clearTimeout(timer);}
}
