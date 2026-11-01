import assert from 'node:assert/strict';
import test from 'node:test';
import {createReactDecisionProvider} from '../src/react/react-decision-provider.js';

test('video metadata guide is scoped to current video evidence in both layouts and adds no request', async () => {
  const video={toolName:'strategy_video_search',value:{type:'strategy_video_search_results',videos:[]}};
  for (const messageLayout of ['append_only','legacy_full_state']) {
    for (const [evidence,expected] of [[[],false],[[{toolName:'unit_builds'}],false],[[video],true],
      [[{...video,temporalStatus:'historical'}],false],[[{...video,metadata:{temporalStatus:'historical'}}],false]]) {
      let body, calls=0;
      const action={schemaVersion:'react-action.v1',type:'finish',answer:'资料不足。',evidenceIds:[],reasonCode:'insufficient_evidence',narrative:null};
      const provider=createReactDecisionProvider({endpoint:'https://example.test',model:'test',messageLayout,
        fetchImpl:async (_url,init)=>{calls++;body=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(action)}}]})};}});
      assert.deepEqual((await provider({state:{question:'帮我搜索弃船攻略',evidence},toolCatalog:[]})).action,action);
      assert.equal(calls,1);
      const guide=body.messages.find(m=>m.role==='system'&&m.content.startsWith('video-metadata-guide.v1:'));
      assert.equal(Boolean(guide),expected);
      if(guide){
        assert.match(guide.content,/No transcripts or watched video content/);
        assert.match(guide.content,/untrusted source data/);
        assert.match(guide.content,/secondary conditions remain unconfirmed/);
        assert.match(guide.content,/empty or unavailable/);
      }
    }
  }
});
