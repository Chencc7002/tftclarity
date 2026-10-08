import assert from "node:assert/strict";
import test from "node:test";
import { PATCH_18_4_HOTFIX, PATCH_18_4_REVISION } from "../src/app/small-window-ui/patch-18-4.js";
import { getCurrentPatchNote, getPatchNoteTimeline } from "../src/app/small-window-ui/patch-notes.js";
import { associateOfficialPatchChanges } from "../src/data/official-patch-evidence.js";
import { getOfficialPatchFacts } from "../src/data/official-patch-facts.js";
import { createTftToolHandlers } from "../src/domain/tft/tool-handler-factory.js";
import { buildOfficialPatchSemanticDocuments } from "../src/knowledge/official-patch-knowledge.js";

const flatten = (revision) => revision.groups.flatMap((group) => group.changes);

test("18.4 appends release and B-patch revisions while retaining all prior history", () => {
  const current = getCurrentPatchNote();
  const timeline = getPatchNoteTimeline();
  assert.equal(current.version, "18.4");
  assert.equal(current.publishedAt, "2026-10-06T18:00:00.000Z");
  assert.equal(current.updatedAt, "2026-10-07");
  assert.deepEqual(current.history.map((revision) => revision.id), [
    "18.4-release-2026-10-07",
    "18.4-hotfix-2026-10-07"
  ]);
  assert.deepEqual(timeline.history.slice(0, 6), getPatchNoteTimeline("18.3").history);
  assert.equal(timeline.history.length, 8);
  assert.equal(timeline.history[6].parentId, "18.3-hotfix-2026-09-28");
  assert.equal(timeline.history[7].parentId, "18.4-release-2026-10-07");
  assert.equal(flatten(PATCH_18_4_REVISION).length, 91);
  assert.equal(flatten(PATCH_18_4_HOTFIX).length, 28);
  assert.equal(timeline.history.flatMap((r) => r.groups.flatMap((g) => g.changes)).length, 392);
});

test("18.4 facts preserve exact endpoints and non-numeric rollout status", () => {
  const facts = getOfficialPatchFacts({ patch: "18.4" });
  assert.deepEqual(facts.summary, { revisionCount: 2, changeCount: 119, buffs: 72, nerfs: 46 });
  assert.equal(facts.updatedAt, "2026-10-07");
  assert.match(facts.source.sourceUrl, /patch-18-4\/$/u);
  assert.match(facts.revisions[1].summary, /PC/u);
  assert.match(facts.revisions[1].summary, /移动端/u);
  assert.match(facts.revisions[1].summary, /不得.*叠加/u);

  const release = facts.revisions[0].changes;
  const hotfix = facts.revisions[1].changes;
  const bySuffix = (changes, id) => changes.find((change) => change.id.endsWith(`-${id}`));
  assert.deepEqual(
    [bySuffix(release, "camille-damage").before, bySuffix(release, "camille-damage").after],
    ["150/225/375/640", "150/225/400/665"]
  );
  assert.deepEqual(
    [bySuffix(hotfix, "camille-damage").before, bySuffix(hotfix, "camille-damage").after],
    ["150/225/375 AD", "150/225/400 AD"]
  );
  assert.equal(bySuffix(hotfix, "gromp-ap-splash").after, "180/270/435 AP");
  assert.equal(bySuffix(hotfix, "spirit-of-redemption").after, "9%");
  assert.equal(release.some((change) => /refund|返还|solar/i.test(change.id)), false);
});

test("18.4 entity evidence and semantic documents are available to the Agent", async () => {
  const camille = associateOfficialPatchChanges({ units: ["DA_18_Camille"] }, "18.4");
  assert.equal(camille.length, 2);
  assert.ok(camille.every((change) => change.sourceUrl.endsWith("patch-18-4/")));
  assert.deepEqual(camille.map((change) => change.publishedAt), ["2026-10-07", "2026-10-07"]);

  const documents = buildOfficialPatchSemanticDocuments({
    seasonContextId: "set18-live",
    versions: ["18.4"]
  });
  const sections = documents.filter((document) => document.id.includes(":section:"));
  assert.ok(sections.length > 0);
  assert.ok(sections.every((document) => document.patch === "18.4" && document.content.length <= 800));
  assert.deepEqual(
    sections.flatMap((document) => document.metadata.rawData.changes.map((change) => change.id)).sort(),
    getOfficialPatchFacts({ patch: "18.4" }).revisions.flatMap((revision) => revision.changes).map((change) => change.id).sort()
  );

  const { handlers } = createTftToolHandlers({
    patchState: { currentPatch: "18.4" },
    seasonContext: { currentPatch: "18.1" },
    locale: "zh-CN"
  });
  assert.equal((await handlers.patch_facts({})).summary.changeCount, 119);
  assert.equal((await handlers.patch_facts({ patch: "18.3" })).summary.changeCount, 87);
});
