import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentPatchNote, getPatchNoteTimeline } from "../src/app/small-window-ui/patch-notes.js";
import { getOfficialPatchFacts } from "../src/data/official-patch-facts.js";
import { buildOfficialPatchSemanticDocuments } from "../src/knowledge/official-patch-knowledge.js";

test("18.7 preserves the full historical announcement chain", () => {
  const patch = getCurrentPatchNote();
  const old = getPatchNoteTimeline("18.6");
  const current = getPatchNoteTimeline();
  assert.equal(patch.version, "18.7");
  assert.deepEqual(current.history.slice(0, -1), old.history);
  assert.equal(current.history.at(-1).parentId, old.history.at(-1).id);
  assert.equal(current.history.length, 13);
});

test("18.7 uses national source endpoints and deduplicates the repeated Inferno line", () => {
  const facts = getOfficialPatchFacts({ patch: "18.7" });
  assert.equal(facts.status, "found");
  assert.equal(facts.summary.changeCount, 38);
  assert.equal(facts.summary.buffs, 24);
  assert.equal(facts.summary.nerfs, 14);
  assert.equal(facts.source.sourceUrl, "https://lol.qq.com/gicp/news/662/37102796.html");
  const changes = facts.revisions.flatMap((r) => r.changes);
  const byStat = new Map(changes.map((c) => [c.stat, c]));
  assert.equal(byStat.get("kobuko-damage").after, "80/120/180/300 AP");
  assert.equal(byStat.get("electrocharge-two-damage").after, "35–120");
  assert.equal(changes.filter((c) => c.stat === "inferno-burn").length, 1);
  assert.ok(changes.every((c) => !c.entityApiNames.some((id) => /Malphite|Nidalee/u.test(id))));
  assert.match(facts.revisions[0].summary, /暂未生效/);
  assert.match(facts.revisions[0].summary, /15% 最大生命值/);
});

test("18.7 searchable entity sections cover all 38 numeric changes once", () => {
  const docs = buildOfficialPatchSemanticDocuments({ seasonContextId: "set18-live", versions: ["18.7"] });
  const sections = docs.filter((d) => d.id.includes(":section:"));
  const ids = sections.flatMap((d) => d.metadata.rawData.changes.map((c) => c.id));
  assert.equal(ids.length, 38);
  assert.equal(new Set(ids).size, 38);
  assert.ok(sections.every((d) => d.content.length < 800));
  assert.ok(docs.every((d) => d.patch === "18.7" && d.seasonContextId === "set18-live"));
});
