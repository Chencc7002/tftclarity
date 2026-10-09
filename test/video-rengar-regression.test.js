import assert from 'node:assert/strict';
import test from 'node:test';
import { S18_UNIT_DISPLAY_OVERRIDES, unitDisplayOverrideByApiName } from '../src/data/entity-display-overrides.js';
import { createVideoEntityScope } from '../src/domain/tft/video-entity-scope.js';
import { classifyStrategyVideoDomain } from '../services/bilibili/domain-filter.mjs';
import { BilibiliStrategyVideoService, resolveBilibiliMcpConfig } from '../services/bilibili/service.mjs';
const resources={catalog:{units:S18_UNIT_DISPLAY_OVERRIDES}};
const cosmetic='霸天战士 雷恩加尔 星啸天火 臻彩原画载入界面及特效 英雄联盟皮肤';

test('all Rengar names share one title identity in the actual season catalog',()=>{
  for(const query of ['狮子狗','雷恩加尔','傲之追猎者','Rengar']) {
    const match=createVideoEntityScope(query,resources,{policy:'balanced'});
    assert.equal(match.scope.status,'resolved',query);
    assert.equal(match.scope.entities.length,1);
    for(const title of ['狮子狗还是太好玩了','雷恩加尔阵容教学','傲之追猎者出装','TFT Rengar build']) assert.equal(match.matchTitle(title).accepted,true,title);
    for(const title of ['裁决螳螂阵容','剑圣攻略']) assert.equal(match.matchTitle(title).accepted,false,title);
  }
});

test('common season nicknames resolve uniquely without promoting fuzzy aliases',()=>{
  for(const [id,name] of [['DA_18_Rengar','狮子狗'],['DA_18_KhaZix','螳螂'],['DA_18_Warwick','狼人'],
    ['DA_Nidalee18_AP','豹女'],['DA_18_Malphite','石头人'],['DA_18_Azir','沙皇'],['DA_18_Alistar','牛头']]) {
    const matcher=createVideoEntityScope(name,resources);
    assert.equal(matcher.scope.status,'resolved',name);
    assert.deepEqual(matcher.scope.entities.map(e=>e.id),[`unit:${id}`]);
    assert.equal(matcher.matchTitle(unitDisplayOverrideByApiName.get(id).zhName+'阵容教学').accepted,true);
  }
  assert.equal(createVideoEntityScope('月男',resources).scope.status,'unscoped');
});

test('cosmetic filtering rejects actual leaked result even with noisy TFT tutorial tags',()=>{
  for(const title of [cosmetic,'雷恩加尔皮肤获取攻略','狮子狗特效展示','Rengar skin spotlight','雷恩加尔炫彩预览']) {
    assert.equal(classifyStrategyVideoDomain({title,tags:'云顶之弈 攻略 教学'},'雷恩加尔','tft_pc',{cosmeticFilter:true}).reason,'cosmetic_showcase',title);
  }
  for(const title of ['新皮肤狮子狗阵容教学','狮子狗出装运营攻略','雷恩加尔皮肤特效下的站位教学']) {
    assert.notEqual(classifyStrategyVideoDomain({title,tags:'云顶之弈'},'狮子狗','tft_pc',{cosmeticFilter:true}).domainStatus,'rejected',title);
  }
  assert.equal(classifyStrategyVideoDomain({title:cosmetic,tags:'云顶之弈'},'雷恩加尔').domainStatus,'confirmed','legacy remains intact');
});

test('real leaked titles are removed; alias-only titles remain and changed detail domains are rechecked',async()=>{
  const rows=[['good','狮子狗还是太好玩了'],['bad','裁决螳螂新晋版本T0'],['skin',cosmetic],['changed','雷恩加尔阵容教学']]
    .map(([videoId,title])=>({videoId,title,url:`https://www.bilibili.com/video/${videoId}`,tags:'云顶之弈',publishedAt:'2026-10-05'}));
  const details=[];
  const service=new BilibiliStrategyVideoService({config:resolveBilibiliMcpConfig({entityMatchMode:'enforce',entityRecallMode:'enforce'},{}),
    adapter:{async searchVideos(){return {videos:rows,warnings:[]};},async getVideoDetail({videoId}){details.push(videoId);return {video:videoId==='changed'?{title:cosmetic}:{},warnings:[]};}}});
  const result=await service.search({query:'雷恩加尔攻略'},resources);
  assert.deepEqual(result.videos.map(v=>v.videoId),['good']);
  assert.deepEqual(details.sort(),['changed','good']);
  assert.equal(result.domainFilter.rejectionCounts.cosmetic_showcase,1);
  assert.equal(result.entityFilter.detailDomainRejected,1);
  assert.equal(result.entityFilter.detailTitleRejected,0);
});
