import assert from "node:assert/strict";
import test from "node:test";
import { PATCH_18_5_REVISION } from "../src/app/small-window-ui/patch-18-5.js";
import { getCurrentPatchNote, getPatchNoteTimeline } from "../src/app/small-window-ui/patch-notes.js";
import { associateOfficialPatchChanges } from "../src/data/official-patch-evidence.js";
import { getOfficialPatchFacts } from "../src/data/official-patch-facts.js";
import { createTftToolHandlers } from "../src/domain/tft/tool-handler-factory.js";
import { buildOfficialPatchSemanticDocuments } from "../src/knowledge/official-patch-knowledge.js";

const flatten = (revision) => revision.groups.flatMap((group) => group.changes);

test("18.5 appends one verified release while retaining all prior history", () => {
  const current = getCurrentPatchNote();
  const timeline = getPatchNoteTimeline();
  assert.equal(current.version, "18.5");
  assert.equal(current.publishedAt, "2026-10-20T18:00:00.000Z");
  assert.equal(current.updatedAt, "2026-10-21");
  assert.deepEqual(current.history.map((revision) => revision.id), ["18.5-release-2026-10-21"]);
  assert.deepEqual(timeline.history.slice(0, 8), getPatchNoteTimeline("18.4").history);
  assert.equal(timeline.history.length, 9);
  assert.equal(timeline.history[8].parentId, "18.4-hotfix-2026-10-07");
  assert.equal(flatten(PATCH_18_5_REVISION).length, 71);
  assert.equal(timeline.history.flatMap((r) => r.groups.flatMap((g) => g.changes)).length, 463);
});

test("18.5 facts preserve exact endpoints and non-numeric status", () => {
  const facts = getOfficialPatchFacts({ patch: "18.5" });
  assert.deepEqual(facts.summary, { revisionCount: 1, changeCount: 71, buffs: 33, nerfs: 38 });
  assert.equal(facts.updatedAt, "2026-10-21");
  assert.match(facts.source.sourceUrl, /patch-18-5\/$/u);
  assert.match(facts.revisions[0].summary, /钢铁之心/u);
  assert.match(facts.revisions[0].summary, /71/u);

  const changes = facts.revisions[0].changes;
  const bySuffix = (id) => changes.find((change) => change.id.endsWith(`-${id}`));
  assert.deepEqual([bySuffix("fae-heal").before, bySuffix("fae-heal").after], ["2.5/4%", "3/5%"]);
  assert.equal(bySuffix("master-yi-ap-damage").after, "135/200/320 AP");
  assert.equal(bySuffix("soraka-additional-star").after, "110/165 AP");
  assert.equal(bySuffix("hand-of-baron-stats").after, "22/33 HP + 2/3% stats");
});

test("18.5 entity evidence and semantic documents are available to the Agent", async () => {
  const soraka = associateOfficialPatchChanges({ units: ["DA_18_Soraka"] }, "18.5");
  assert.equal(soraka.length, 2);
  assert.ok(soraka.every((change) => change.sourceUrl.endsWith("patch-18-5/")));
  assert.ok(soraka.every((change) => change.publishedAt === "2026-10-21"));

  const documents = buildOfficialPatchSemanticDocuments({
    seasonContextId: "set18-live",
    versions: ["18.5"]
  });
  const sections = documents.filter((document) => document.id.includes(":section:"));
  assert.ok(sections.length > 0);
  assert.ok(sections.every((document) => document.patch === "18.5" && document.content.length <= 800));
  assert.deepEqual(
    sections.flatMap((document) => document.metadata.rawData.changes.map((change) => change.id)).sort(),
    getOfficialPatchFacts({ patch: "18.5" }).revisions.flatMap((revision) => revision.changes).map((change) => change.id).sort()
  );

  const { handlers } = createTftToolHandlers({
    patchState: { currentPatch: "18.5" },
    seasonContext: { currentPatch: "18.1" },
    locale: "zh-CN"
  });
  assert.equal((await handlers.patch_facts({})).summary.changeCount, 71);
  assert.equal((await handlers.patch_facts({ patch: "18.4" })).summary.changeCount, 119);
});
