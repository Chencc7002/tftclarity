import assert from 'node:assert/strict';
import {createSmallWindowRuntimeAsync,createDefaultReactToolHandlerBundle} from '../src/app/small-window-server.js';

const runtime=await createSmallWindowRuntimeAsync();
const service=runtime.strategyVideoSearchService;
const report={kind:'video-entity-real-retrieval',at:new Date().toISOString(),cases:[],networkSearches:0};
try {
  assert.ok(service?.adapter, 'configured Bilibili adapter required');
  const request={input:'视频检索上线验收',seasonContextId:'set18-live',locale:'zh-CN'};
  const bundle=await createDefaultReactToolHandlerBundle({runtime,request});
  const units=await bundle.handlers.entity_catalog_query({entityType:'unit',filters:{names:['剑圣','易']}});
  report.unitResolution=units.resolution;
  assert.ok(units.resolution.requests.every(row=>row.status==='resolved'), 'current catalog must resolve 剑圣 and 易');
  const search=service.adapter.searchVideos.bind(service.adapter);
  const detail=service.adapter.getVideoDetail.bind(service.adapter);
  const searches=new Map(),details=new Map();
  const snapshotTime=Date.now();
  service.now=()=>snapshotTime;
  service.adapter.searchVideos=(input,context)=>{
    const key=JSON.stringify(input);
    if(!searches.has(key)) { report.networkSearches++; searches.set(key,search(input,context)); }
    return searches.get(key);
  };
  service.adapter.getVideoDetail=(input,context)=>{
    const key=JSON.stringify(input);
    if(!details.has(key)) details.set(key,detail(input,context));
    return details.get(key);
  };
  for(const query of ['剑圣攻略','易攻略','羊刀攻略','斗士阵容攻略','斗士易阵容攻略']) {
    service.config.entityMatchMode='off';
    const legacy=await bundle.handlers.strategy_video_search({query,ecosystem:'tft_pc'});
    service.config.entityMatchMode='shadow';
    const shadow=await bundle.handlers.strategy_video_search({query,ecosystem:'tft_pc'});
    service.config.entityMatchMode='enforce';
    const strict=await bundle.handlers.strategy_video_search({query,ecosystem:'tft_pc'});
    const row={query,status:strict.status,scope:strict.entityFilter,
      legacyTitles:legacy.videos.map(v=>v.title),strictTitles:strict.videos.map(v=>v.title),
      strictVideos:strict.videos.map(v=>({id:v.videoId,title:v.title,url:v.url,match:v.evidence.titleEntityMatch})),
      warnings:strict.warnings};
    report.cases.push(row);
    assert.deepEqual(shadow.videos,legacy.videos, 'shadow must preserve the legacy public result');
    assert.equal(strict.entityFilter?.status,'resolved', `${query}: must resolve exact scope`);
    assert.notEqual(strict.status,'unavailable',`${query}: provider unavailable`);
    assert.ok(strict.videos.every(v=>v.evidence.titleEntityMatch?.accepted),`${query}: out-of-scope result`);
    assert.equal(strict.entityFilter.returnedOutsideScope.length,0);
  }
  assert.ok(report.cases.some(row=>row.query==='剑圣攻略' && row.strictVideos.length), 'positive Master Yi title required');
  assert.ok(report.cases.some(row=>row.query==='羊刀攻略' && row.strictVideos.length), 'positive item title required');
  report.passed=true;
  console.log(JSON.stringify(report));process.exit(0);
} catch(error) {
  report.passed=false;report.error=error.message;
  console.log(JSON.stringify(report));process.exit(1);
}
