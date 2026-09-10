import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry, ToolExecutor, createStructuredToolDefinitions, createTftToolHandlers, getOfficialPatchFacts, buildOfficialPatchKnowledgeDocuments, buildOfficialPatchSemanticDocuments, MemorySemanticDocumentStore, createTfidfSemanticRetriever, KnowledgeRetriever, validateKnowledgeDocument } from '../src/index.js';
import { getPatchNote, CURRENT_PATCH_VERSION } from '../src/app/small-window-ui/patch-notes.js';
import { associateOfficialPatchChanges } from '../src/data/official-patch-evidence.js';
import { createSmallWindowRuntime, handleReactChatRequest } from '../src/app/small-window-server.js';

test('every displayed current patch is registered with identical official numeric facts', () => {
 for (const locale of ['zh-CN', 'en-US']) {
  const page=getPatchNote(CURRENT_PATCH_VERSION,locale);
  const facts=getOfficialPatchFacts({patch:CURRENT_PATCH_VERSION,locale});
  assert.equal(facts.status,'found');
  const expected=page.history.flatMap(r=>r.groups.flatMap(g=>g.changes));
  assert.deepEqual(facts.revisions.flatMap(r=>r.changes).map(({id,label,direction,before,after,entityApiNames})=>({id,body:label,direction,before,after,entityApiNames})),expected.map(({id,body,direction,before,after,entityApiNames})=>({id,body,direction,before,after,entityApiNames})));
  assert.equal(facts.summary.changeCount,157);
  assert.equal(facts.publishedAt,'2026-09-09T18:00:00.000Z');
  assert.match(facts.source.sourceUrl,/patch-18-2\/$/);
  assert.ok(facts.revisions[0].changes.filter(c=>['unit','trait','item'].includes(c.entityType)).every(c=>c.entityApiNames.length));
 }
 const changes=associateOfficialPatchChanges({units:[{apiName:'DA_18_Ahri'}]},'18.2');
 assert.deepEqual(changes.map(({direction,before,after})=>({direction,before,after})),[{direction:'buff',before:'425/640%',after:'455/685%'},{direction:'nerf',before:'20%',after:'21%'}]);
 const old=getOfficialPatchFacts({patch:'18.1'});
 assert.equal(old.summary.changeCount,15);
 assert.equal(old.revisions[0].changes.find(c=>c.entityApiNames.includes('DA_18_Ahri')).after,'425/640%');
 assert.equal(getOfficialPatchFacts({patch:'99.1'}).status,'not_found');
});

test('registered tool defaults to server patch 18.2 and retains explicit historical scope',async()=>{
 const registry=new ToolRegistry(createStructuredToolDefinitions());
 const bundle=createTftToolHandlers({registry,patchState:{currentPatch:'18.2'},seasonContext:{currentPatch:'18.1'},locale:'zh-CN'});
 for(const [args,version,count] of [[{},'18.2',157],[{patch:'18.1'},'18.1',15]]){
  const result=await new ToolExecutor({registry}).execute('patch_facts',args,{handler:bundle.handlers.patch_facts});
  assert.equal(result.status,'completed');assert.equal(result.value.patch,version);assert.equal(result.value.summary.changeCount,count);
  assert.equal(result.metadata.source,'riot_patch_notes');assert.equal(result.metadata.evidenceType,'official_patch_facts');
 }
});

test('18.2 source-linked knowledge is searchable without substituting 18.1',async()=>{
 const docs=buildOfficialPatchKnowledgeDocuments({seasonContextId:'set18-live',versions:['18.2']});
 assert.equal(docs.length,1);assert.equal(validateKnowledgeDocument(docs[0],{normalize:false}).valid,true);
 assert.equal(docs[0].metadata.claimType,'official_fact');
 assert.equal(docs[0].text.split('425/640% → 455/685%').length-1,1);
 const store=new MemorySemanticDocumentStore(buildOfficialPatchSemanticDocuments({seasonContextId:'set18-live'}));
 const retriever=new KnowledgeRetriever({retriever:createTfidfSemanticRetriever({store})});
 for(const query of ['18.2 阿狸改了什么','18.2 升级经验调整','18.2 灵火价格改动']){
  const hits=await retriever.searchEvidence(query,{seasonContextId:'set18-live',patch:'18.2',locale:'zh-CN',documentTypes:['patch_note']});
  assert.ok(hits.length,query);assert.ok(hits.every(h=>h.patch==='18.2'));
  assert.match(hits[0].claim,/455\/685%/);assert.match(hits[0].claim,/20% → 21%/);
 }
});

test('ReAct completes an Ahri answer with validated 18.2 evidence and both directions',async()=>{
 const runtime=createSmallWindowRuntime({reactDecisionProvider:async request=>{
  const e=request.state.evidence.find(x=>x.toolName==='patch_facts');
  if(!e)return {schemaVersion:'react-action.v1',type:'call_tool',tool:'patch_facts',arguments:{patch:'18.2',locale:'zh-CN'},purposeCode:'retrieve_supporting_knowledge'};
  assert.equal(e.value.status,'found');
  const rows=e.value.revisions.flatMap(r=>r.changes).filter(c=>c.entityApiNames.includes('DA_18_Ahri'));
  assert.equal(rows.length,2);
  return {schemaVersion:'react-action.v1',type:'finish',answer:'18.2 阿狸技能法强倍率由 425/640% 提高至 455/685%；每格伤害衰减由 20% 提高至 21%，这项是削弱。',evidenceIds:[e.evidenceId],reasonCode:'sufficient_evidence'};
 }});
 const {statusCode,payload}=await handleReactChatRequest({input:'18.2 阿狸改了什么？',seasonContextId:'set18-live',locale:'zh-CN',conversationId:'patch-18-2-contract'},runtime);
 assert.equal(statusCode,200);assert.equal(payload.terminationReason,'completed');
 assert.match(payload.answer,/455\/685%/);assert.match(payload.answer,/21%/);
 assert.deepEqual(payload.evidence.map(e=>e.toolName),['patch_facts']);
 assert.equal(payload.evidence[0].value.patch,'18.2');
});
