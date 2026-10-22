import assert from "node:assert/strict";
import test from "node:test";
import { PATCH_18_5_REVISION } from "../src/app/small-window-ui/patch-18-5.js";
import { getCurrentPatchNote, getPatchNoteTimeline } from "../src/app/small-window-ui/patch-notes.js";
import { associateOfficialPatchChanges } from "../src/data/official-patch-evidence.js";
import { getOfficialPatchFacts } from "../src/data/official-patch-facts.js";
import { createTftToolHandlers } from "../src/domain/tft/tool-handler-factory.js";
import { buildOfficialPatchSemanticDocuments } from "../src/knowledge/official-patch-knowledge.js";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";

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

test("generic patch summaries recover deterministically when compressed model series fail grounding", async () => {
  const runtime = createSmallWindowRuntime({
    patchNumericSeriesGroundingMode: "enforce",
    reactDecisionProvider: async (request) => {
      const evidence = request.state.evidence.find((entry) => entry.toolName === "patch_facts");
      if (!evidence) {
        return {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: "patch_facts",
          arguments: { patch: "18.5", locale: "zh-CN" },
          purposeCode: "retrieve_supporting_knowledge"
        };
      }
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "妖精门槛 30000/70000/110000→25000/60000/100000。",
        evidenceIds: [evidence.evidenceId],
        reasonCode: "sufficient_evidence"
      };
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "简述版本更新",
    seasonContextId: "set18-live",
    locale: "zh-CN",
    conversationId: "patch-18-5-summary-fallback"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "completed_with_warning");
  assert.equal(payload.terminationReason, "finish_validation_fallback");
  assert.equal(payload.answerOrigin, "system_patch_summary_fallback");
  assert.match(payload.answer, /71 项/u);
  assert.match(payload.answer, /增强 33 项、削弱 38 项/u);
  assert.match(payload.answer, /钢铁之心/u);
  assert.match(payload.answer, /Riot Games 官方更新公告/u);
  assert.doesNotMatch(payload.answer, /30000\/70000/u);
  assert.deepEqual(payload.evidence.map((entry) => entry.toolName), ["patch_facts"]);
  assert.equal(payload.modelConclusion.status, "rejected");
  assert.ok(payload.warnings.includes("patch_summary_validation_fallback"));
});
