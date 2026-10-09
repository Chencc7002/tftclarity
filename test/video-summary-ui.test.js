import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {conclusionDisplayText,conclusionRichTextHtml} from '../src/app/small-window-ui/conclusion-rich-text.js';
const app=readFileSync(new URL('../src/app/small-window-ui/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function reactModelConclusionHtml('),app.indexOf('function rankingTierLabel('))
  + app.slice(app.indexOf('function strategyVideoChatSummary('),app.indexOf('function chatBuildPreview('));
const render=runInNewContext(source+'\nassistantResponseHtml',{
 state:{explanationFeedback:null},getLocale:()=> 'zh-CN',t:k=>k,
 escapeHtml:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
 renderUnderstandingPanel:()=>'',conclusionDisplayText,conclusionRichTextHtml,
 localBuildMetricViewHtml:()=>null,feedbackReasonPicker:()=>'',renderAgentSuggestedActions:()=>'<span>follow-up</span>'
});
const base={type:'strategy_video_search_results',status:'found',videos:[{title:'狮子狗阵容攻略'}]};
test('video chat renders the model metadata guide instead of replacing it with a count',()=>{
 const answer='根据标题和简介，这条视频侧重狮子狗阵容。\n\n[狮子狗阵容攻略](https://www.bilibili.com/video/BV1234567890) — 标题明确提到阵容。';
 const html=render({...base,modelConclusion:{status:'accepted',answer},reactAnswer:answer},'video-1');
 assert.equal((html.match(/根据标题和简介/g)??[]).length,1);
 assert.match(html,/https:\/\/www.bilibili.com\/video\/BV1234567890/);
 assert.doesNotMatch(html,/最新优先/);
 assert.match(html,/data-view-result data-response-id="video-1"/);
});
test('fallback prose and limitations survive empty model text',()=>{
 const html=render({...base,modelConclusion:{answer:' '},reactAnswer:'只找到旧版本视频，标题未确认羊刀。'});
 assert.match(html,/只找到旧版本视频/);assert.match(html,/标题未确认羊刀/);
});
test('without model prose the deterministic count, empty and unsupported states remain available',()=>{
 assert.match(render(base),/找到 1 个攻略视频/);
 assert.match(render({...base,status:'no_results',videos:[]}),/未找到攻略视频/);
 assert.match(render({...base,status:'unsupported_scope',videos:[]}),/仅支持云顶之弈/);
});
test('model HTML is escaped and results/follow-up controls remain reachable',()=>{
 const html=render({...base,reactAnswer:'简介包含 <script>alert(1)</script>',agentSuggestedActions:{actions:[{label:'更多'}],prompt:'继续'}},'video-2');
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script/);
 assert.match(html,/follow-up/);assert.match(html,/data-response-id="video-2"/);
});
