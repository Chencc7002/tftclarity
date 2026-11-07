import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentPatchNote, getPatchNoteTimeline } from "../src/app/small-window-ui/patch-notes.js";
import { getOfficialPatchFacts } from "../src/data/official-patch-facts.js";
import { buildOfficialPatchSemanticDocuments } from "../src/knowledge/official-patch-knowledge.js";

test("18.6 appends a China-sourced release without removing historical revisions", () => {
  const patch = getCurrentPatchNote();
  const timeline = getPatchNoteTimeline();
  const old = getPatchNoteTimeline("18.5");
  assert.equal(patch.version, "18.6");
  assert.equal(timeline.history.length, old.history.length + 1);
  assert.deepEqual(timeline.history.slice(0, -1), old.history);
  assert.equal(timeline.history.at(-1).parentId, old.history.at(-1).id);
  assert.equal(patch.sourceUrl, "https://lol.qq.com/gicp/news/662/37101298.html");
});

test("18.6 facts use China endpoints and keep explicitly pending changes out of effective claims", () => {
  const f = getOfficialPatchFacts({ patch: "18.6" });
  assert.equal(f.summary.changeCount, 21);
  assert.equal(f.summary.buffs, 16);
  assert.equal(f.summary.nerfs, 5);
  const changes = f.revisions.flatMap((r) => r.changes);
  const byStat = new Map(changes.map((c) => [c.stat, c]));
  assert.deepEqual([byStat.get("murkwolf-empowered-attack").before, byStat.get("murkwolf-empowered-attack").after], ["65/100/160 AD", "65/100/180 AD"]);
  assert.deepEqual([byStat.get("malphite-damage").before, byStat.get("malphite-damage").after], ["40/60/2000 AP", "100/150/2000 AP"]);
  assert.equal(byStat.get("nidalee-ad-heal").after, "325/550/2000 AP");
  assert.equal(byStat.get("middle-path-upgrade-cost").after, "4g");
  assert.ok(changes.every((c) => !c.entityApiNames.includes("DA_18_Sprykin")));
  assert.match(f.revisions[0].summary, /暂未生效/);
  assert.match(f.revisions[0].summary, /15\/28\/33% → 15\/30\/38%/);
  assert.match(f.revisions[0].summary, /分批/);
  assert.equal(changes.length, new Set(changes.map((c) => c.id)).size);
});

test("18.6 knowledge has bounded entity sections covering every effective change exactly once", () => {
  const documents = buildOfficialPatchSemanticDocuments({ seasonContextId: "set18-live", versions: ["18.6"] });
  const facts = getOfficialPatchFacts({ patch: "18.6" });
  assert.ok(documents.length > 1);
  assert.ok(documents.every((d) => d.patch === "18.6" && d.seasonContextId === "set18-live"));
  const sections = documents.filter((d) => d.id.includes(":section:"));
  const covered = sections.flatMap((d) => d.metadata.rawData.changes.map((c) => c.id));
  assert.equal(covered.length, facts.summary.changeCount);
  assert.deepEqual(covered.sort(), facts.revisions.flatMap((r) => r.changes.map((c) => c.id)).sort());
  assert.ok(sections.every((d) => d.content.length < 800));
  assert.ok(documents.some((d) => d.content.includes("暂未生效")));
});
