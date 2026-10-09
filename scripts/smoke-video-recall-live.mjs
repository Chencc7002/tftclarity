import assert from 'node:assert/strict';
import { createSmallWindowRuntimeAsync, createDefaultReactToolHandlerBundle } from '../src/app/small-window-server.js';
import { classifyStrategyVideoDomain } from '../services/bilibili/domain-filter.mjs';

const report={kind:'video-recall-live-comparison',at:new Date().toISOString(),cases:[],passed:false};
try {
  const runtime=await createSmallWindowRuntimeAsync();
  const service=runtime.strategyVideoSearchService;
  assert.ok(service?.adapter,'configured video adapter required');
  const bundle=await createDefaultReactToolHandlerBundle({runtime,request:{input:'视频检索验收',seasonContextId:'set18-live',locale:'zh-CN'}});
  const catalog=await bundle.handlers.entity_catalog_query({entityType:'unit',filters:{names:['狮子狗','雷恩加尔','螳螂','狼人','豹女']}});
  report.aliasResolution=catalog.resolution;
  assert.ok(catalog.resolution.requests.every(row=>row.status==='resolved'),'shared catalog aliases must resolve');
  const search=service.adapter.searchVideos.bind(service.adapter),detail=service.adapter.getVideoDetail.bind(service.adapter);
  const searches=new Map(),details=new Map();
  service.adapter.searchVideos=(input,context)=>{
    const key=JSON.stringify(input);
    if(!searches.has(key))searches.set(key,search(input,context));
    return searches.get(key);
  };
  service.adapter.getVideoDetail=(input,context)=>{
    const key=JSON.stringify(input);
    if(!details.has(key))details.set(key,detail(input,context));
    return details.get(key);
  };
  const at=Date.now(); service.now=()=>at; service.config.entityMatchMode='enforce';
  for(const query of ['狮子狗攻略','雷恩加尔攻略','剑圣带羊刀攻略','羊刀攻略','斗士剑圣阵容攻略','螳螂攻略']) {
    service.config.entityRecallMode='off';
    const old=await bundle.handlers.strategy_video_search({query,ecosystem:'tft_pc'});
    service.config.entityRecallMode='shadow';
    const shadow=await bundle.handlers.strategy_video_search({query,ecosystem:'tft_pc'});
    assert.deepEqual(shadow.videos,old.videos,'shadow must not change videos or their evidence');
    service.config.entityRecallMode='enforce';
    const start=Date.now();
    const current=await bundle.handlers.strategy_video_search({query,ecosystem:'tft_pc'});
    const row={query,durationMs:Date.now()-start,oldTitles:old.videos.map(v=>v.title),titles:current.videos.map(v=>v.title),
      status:current.status,filter:current.entityFilter,domain:current.domainFilter,warnings:current.warnings,
      videos:current.videos.map(v=>({id:v.videoId,title:v.title,url:v.url,evidence:v.evidence}))};
    report.cases.push(row);
    console.log(JSON.stringify({case:query,old:old.videos.length,current:current.videos.length,status:current.status,ms:row.durationMs}));
    assert.equal(current.entityFilter?.status,'resolved',query);
    assert.equal(current.entityFilter.policy,'balanced');
    assert.ok(current.entityFilter.recallAttempts.length<=3);
    assert.equal(current.entityFilter.returnedOutsideScope.length,0);
    assert.ok(current.videos.every(v=>v.evidence.titleEntityMatch.accepted));
    assert.ok(current.videos.every(v=>classifyStrategyVideoDomain(v,query,'tft_pc',{cosmeticFilter:true}).domainStatus!=='rejected'));
    if(['狮子狗攻略','雷恩加尔攻略'].includes(query))assert.ok(current.videos.length>0,query+' must yield a relevant video');
  }
  report.networkSearches=searches.size;
  report.passed=true;
  console.log(JSON.stringify(report));process.exit(0);
} catch(error) {
  report.error=error.message; console.log(JSON.stringify(report));process.exit(1);
}
