import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSmallWindowRuntimeAsync,primeSeasonPatch,handleReactChatRequest} from '../src/app/small-window-server.js';
const report={kind:'video-summary-live',at:new Date().toISOString(),passed:false,cases:[]};
try {
  const runtime=await createSmallWindowRuntimeAsync();
  assert.equal(runtime.reactDecisionProvider?.providerKind,'react_decision_llm');
  await primeSeasonPatch(runtime);
  for(const input of ['帮我搜索弃船攻略','帮我找云顶之弈狮子狗的视频攻略']) {
    const {statusCode,payload}=await handleReactChatRequest({input,seasonContextId:'set18-live',locale:'zh-CN',conversationId:'video-summary-check-'+randomUUID(),requestId:randomUUID()},runtime);
    const values=(payload.evidence??[]).filter(e=>e.toolName==='strategy_video_search').map(e=>e.value);
    report.cases.push({input,statusCode,status:payload.status,answer:payload.answer,results:values});
    assert.equal(statusCode,200);assert.equal(payload.status,'completed');assert.ok(values.length);
    assert.ok(payload.answer?.length>40,'must return explanatory prose');
    if(values.some(v=>v.videos?.length)) {
      assert.match(payload.answer,/标题|简介/,'must disclose metadata basis');
      const urls=values.flatMap(v=>(v.videos??[]).map(row=>row.url));
      assert.ok(urls.some(url=>payload.answer.includes(url)),'must reference a returned video');
    }
  }
  report.passed=true;console.log(JSON.stringify(report));process.exit(0);
}catch(error){report.error=error.message;console.log(JSON.stringify(report));process.exit(1);}
