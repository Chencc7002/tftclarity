import assert from 'node:assert/strict';
import test from 'node:test';
import {getCurrentPatchNote,getPatchNoteTimeline} from '../src/app/small-window-ui/patch-notes.js';
import {PATCH_18_3_REVISION,PATCH_18_3_HOTFIX} from '../src/app/small-window-ui/patch-18-3.js';
import {getOfficialPatchFacts} from '../src/data/official-patch-facts.js';
import {buildOfficialPatchKnowledgeDocuments} from '../src/knowledge/official-patch-knowledge.js';
test('October 4 catch-up retains history and all thirteen verified numeric changes',()=>{
 const p=getCurrentPatchNote(),timeline=getPatchNoteTimeline();
 assert.equal(p.updatedAt,'2026-09-28');assert.equal(p.version,'18.3');
 assert.deepEqual(p.history.map(r=>r.id),['18.3-release-2026-09-23','18.3-hotfix-2026-09-24','18.3-hotfix-2026-09-28']);
 assert.deepEqual(timeline.history.slice(0,3),getPatchNoteTimeline('18.2').history);
 assert.equal(PATCH_18_3_REVISION.groups.flatMap(g=>g.changes).length,74);
 const actual=PATCH_18_3_HOTFIX.groups.flatMap(g=>g.changes).map(c=>[c.id,c.before,c.after]);
 assert.deepEqual(actual,[['blackthorn-ap-amp','14%','12%'],['khazix-base','285/400/580%','265/370/535%'],['khazix-isolation','310/445/660%','285/410/605%'],['camille-damage','160/240/410/700%','150/225/375/640%'],['leblanc-clone','10/15/40%','10/15/30%'],['teemo-small-shroom','60/90/135%','55/82/130%'],['ashe-trail-duration','4s','3s'],['ashe-dot-damage','5/8%','9/14%'],['draven-four-cost-casts','5','6'],['draven-eight-casts-rerolls','10','6'],['draven-five-cost-attacks','50','60'],['draven-seven-gold-damage','8000','10000'],['draven-twelve-gold-kills','6','8']]);
 assert.equal(p.history.at(-1).groups.length,0,'no fabricated values for a disable');
 assert.match(p.history.at(-1).summary,/Major Polymorph.*Greater Polymorph/);
 for(const locale of ['zh-CN','en-US']){
  const facts=getOfficialPatchFacts({patch:'18.3',locale});
  assert.equal(facts.summary.changeCount,87);assert.equal(facts.revisions.length,3);
  assert.equal(facts.updatedAt,'2026-09-28');assert.match(facts.revisions[1].summary,/Dark Ritual/);
  assert.match(facts.revisions[2].summary,/Major Polymorph/);
  assert.match(facts.source.sourceUrl,/en-us/);
 }
 const [doc]=buildOfficialPatchKnowledgeDocuments({versions:['18.3'],seasonContextId:'set18-live'});
 assert.match(doc.text.slice(0,800),/Major Polymorph/);
 assert.match(doc.text.slice(0,800),/Challenger’s Grace/);
 assert.equal(doc.metadata.generatedAt,'2026-09-28');
});
