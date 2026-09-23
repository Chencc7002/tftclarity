import assert from 'node:assert/strict';
import {createSmallWindowRuntimeAsync, primeSeasonPatch, createDefaultReactToolHandlerBundle, handleReactChatRequest} from '../src/app/small-window-server.js';

// Run explicitly against the configured real provider. No fixture or injected answer.
if (!process.argv.includes('--live')) throw new Error('Pass --live to run real-model acceptance queries.');
const report={kind:'patch-18-3-agent-live',at:new Date().toISOString(),cases:[]};
try {
 const runtime=await createSmallWindowRuntimeAsync();
 assert.equal(typeof runtime.reactDecisionProvider,'function');
 await primeSeasonPatch(runtime);
 report.patch=runtime.patchState?.currentPatch;
 assert.equal(report.patch,'18.3','real server patch resolution must be 18.3');
 const bundle=await createDefaultReactToolHandlerBundle({runtime,request:{input:'18.3 公告验收',seasonContextId:'set18-live',locale:'zh-CN'}});
 const facts=await bundle.handlers.patch_facts({});
 assert.equal(facts.patch,'18.3');assert.equal(facts.summary.changeCount,74);
 const semantic=await bundle.handlers.semantic_search({query:'18.3 沃里克改了什么',documentTypes:['patch_note'],topK:2});
 report.semantic=semantic;
 assert.ok(JSON.stringify(semantic).includes('230/345/535%'),'real configured semantic index must contain the new facts');
 for (const [input,patch,values] of [
  ['这个版本沃里克改了什么？请给出前后具体数值。','18.3',['215','325','500','230','345','535','20','25']],
  ['18.3 神器金币收集者、永恒契约和斯塔缇克电刃有什么改动？','18.3',['40','35','15','10','25']],
  ['18.2 热补丁升 9、10 级经验和茂凯法力值怎么改？','18.2',['64','68','30','90','100']],
  ['18.1 热补丁阿狸改了什么？','18.1',['450','675','425','640']]
 ]) {
  const started=Date.now();
  const {statusCode,payload}=await handleReactChatRequest({input,seasonContextId:'set18-live',locale:'zh-CN',conversationId:`patch-agent-${crypto.randomUUID()}`},runtime);
  const evidence=payload.evidence?.find(e=>e.toolName==='patch_facts' && e.value?.patch===patch && payload.evidenceIds?.includes(e.evidenceId));
  const row={input,statusCode,durationMs:Date.now()-started,termination:payload.terminationReason,answer:payload.answer,evidence:payload.evidence?.map(e=>({evidenceId:e.evidenceId,toolName:e.toolName,patch:e.value?.patch})),citedEvidenceIds:payload.evidenceIds};
  report.cases.push(row);console.log(JSON.stringify({input,statusCode,durationMs:row.durationMs,termination:row.termination,answer:row.answer,tools:payload.evidence?.map(e=>e.toolName)}));
  assert.equal(statusCode,200);assert.equal(payload.terminationReason,'completed');
  assert.equal(evidence?.value?.patch,patch);assert.equal(evidence?.value?.status,'found');
  for(const v of values)assert.ok(payload.answer.includes(v),`missing value ${v}`);
 }
 report.passed=true;console.log(JSON.stringify(report));process.exit(0);
} catch(error) {
 report.passed=false;report.error=error.message;console.log(JSON.stringify(report));process.exit(1);
}
