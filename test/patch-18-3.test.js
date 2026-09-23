import assert from 'node:assert/strict';
import test from 'node:test';
import { getCurrentPatchNote, getPatchNoteTimeline } from '../src/app/small-window-ui/patch-notes.js';
import { getOfficialPatchFacts } from '../src/data/official-patch-facts.js';
import { associateOfficialPatchChanges } from '../src/data/official-patch-evidence.js';
import { buildOfficialPatchSemanticDocuments } from '../src/knowledge/official-patch-knowledge.js';
import { createTftToolHandlers } from '../src/domain/tft/tool-handler-factory.js';
import { validateFinishAction } from '../src/react/termination-policy.js';

test('Artifact category labels in patch facts are not mistaken for statistical rankings', () => {
 const entry={evidenceId:'patch-18-3',toolName:'patch_facts',type:'official_patch_facts',value:getOfficialPatchFacts({patch:'18.3'})};
 const ledger={resolve:ids=>ids.includes(entry.evidenceId)?[entry]:[],snapshot:()=>({entries:[entry]})};
 const check=answer=>validateFinishAction({reasonCode:'sufficient_evidence',evidenceIds:[entry.evidenceId],answer},ledger);
 for (const answer of ['斯塔缇克电刃（神器）：基础法强 15% → 25%。','**斯塔缇克电刃(神器)**：基础法强 15% → 25%。']) {
  assert.equal(check(answer).valid,true,JSON.stringify(check(answer)));
 }
 for (const answer of ['神器：斯塔缇克电刃。','斯塔缇克电刃（神器）排名最高。','推荐神器：斯塔缇克电刃。','神器排名：斯塔缇克电刃。']) {
  assert.ok(check(answer).errors.some(e=>e.includes('artifact scope')),answer);
 }
 assert.equal(check('斯塔缇克电刃（神器）：基础法强 999% → 9999%。').valid,false);
});

test('18.3 appends a fourth revision without changing previous patch history', () => {
 const timeline=getPatchNoteTimeline();
 assert.equal(timeline.version,'18.3');
 assert.deepEqual(timeline.history.slice(0,-1),getPatchNoteTimeline('18.2').history);
 assert.equal(timeline.history.length,4);
 assert.equal(timeline.history.at(-1).parentId,'18.2-hotfix-2026-09-14');
 assert.equal(timeline.history.flatMap(r=>r.groups.flatMap(g=>g.changes)).length,260);
 assert.equal(getCurrentPatchNote().publishedAt,'2026-09-22T18:00:00.000Z');
 assert.equal(getCurrentPatchNote().updatedAt,'2026-09-23');
});

test('18.3 numeric facts distinguish forms, enhanced Wisps, and ambiguous official wording', () => {
 const facts=getOfficialPatchFacts({patch:'18.3'});
 assert.equal(facts.summary.changeCount,74);assert.match(facts.source.sourceUrl,/patch-18-3\/$/);
 const changes=facts.revisions[0].changes;
 const byId=id=>changes.find(c=>c.id.endsWith('-'+id));
 assert.deepEqual(['215/325/500%','230/345/535%'],[byId('warwick-damage').before,byId('warwick-damage').after]);
 assert.equal(byId('warwick-healing').after,'25%');
 assert.equal(byId('blossom-combust').before,'22%');
 assert.equal(byId('blossom-combust').after,'18%');
 assert.equal(changes.find(c=>c.id==='18.3-release-2026-09-23-combust-damage').after,'15%');
 assert.deepEqual(byId('gromp-ad').entityApiNames,['DA_Gromp18_AD']);
 assert.deepEqual(byId('gromp-ap-dot').entityApiNames,['DA_Gromp18_AP']);
 assert.deepEqual(byId('statikk-ap').entityApiNames,['TFT_Item_Artifact_StatikkShiv']);
 assert.equal(byId('blossom-sinister-health').direction,'buff');
 assert.equal(changes.some(c=>c.id.includes('penetration')),false);
 assert.match(facts.revisions[0].summary,/穿透.*矛盾/);
 const nidalee=associateOfficialPatchChanges({units:['DA_Nidalee18_AD']},'18.3');
 assert.equal(nidalee.length,1);assert.equal(nidalee[0].after,'210/315%');
 assert.match(nidalee[0].sourceUrl,/patch-18-3\/$/);
 assert.equal(nidalee[0].publishedAt,'2026-09-23');
});

test('all 18.3 semantic sections carry current bounded source evidence', () => {
 const docs=buildOfficialPatchSemanticDocuments({seasonContextId:'set18-live',versions:['18.3']});
 const sections=docs.filter(d=>d.id.includes(':section:'));
 assert.ok(sections.every(d=>d.content.length<=800 && d.patch==='18.3' && d.metadata.publishedAt==='2026-09-23' && d.metadata.sourceUrl.endsWith('patch-18-3/')));
 const actual=sections.flatMap(d=>d.metadata.rawData.changes.map(c=>c.id)).sort();
 const expected=getOfficialPatchFacts({patch:'18.3'}).revisions[0].changes.map(c=>c.id).sort();
 assert.deepEqual(actual,expected);
 assert.match(sections.find(d=>d.content.includes('沃里克')).content,/230\/345\/535%/);
});

test('registered patch facts use current 18.3 while retaining explicit 18.2 requests', async () => {
 const {handlers}=createTftToolHandlers({patchState:{currentPatch:'18.3'},seasonContext:{currentPatch:'18.1'},locale:'zh-CN'});
 assert.equal((await handlers.patch_facts({})).summary.changeCount,74);
 assert.equal((await handlers.patch_facts({patch:'18.2'})).summary.changeCount,171);
});
