import assert from "node:assert/strict";
import test from "node:test";
import { PATCH_18_4_REVISION } from "../src/app/small-window-ui/patch-18-4.js";
import {
  PATCH_18_5_B_PATCH,
  PATCH_18_5_OCTOBER_27_HOTFIX,
  PATCH_18_5_REVISION
} from "../src/app/small-window-ui/patch-18-5.js";
import { getCurrentPatchNote, getPatchNoteTimeline } from "../src/app/small-window-ui/patch-notes.js";
import { unitDisplayOverrideByApiName } from "../src/data/entity-display-overrides.js";
import { associateOfficialPatchChanges } from "../src/data/official-patch-evidence.js";
import { getOfficialPatchFacts } from "../src/data/official-patch-facts.js";
import { createTftToolHandlers } from "../src/domain/tft/tool-handler-factory.js";
import { buildOfficialPatchSemanticDocuments } from "../src/knowledge/official-patch-knowledge.js";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";

const flatten = (revision) => revision.groups.flatMap((group) => group.changes);

test("18.5 appends release and both mid-patch revisions while retaining prior history", () => {
  const current = getCurrentPatchNote();
  const timeline = getPatchNoteTimeline();
  assert.equal(current.version, "18.5");
  assert.equal(current.publishedAt, "2026-10-20T18:00:00.000Z");
  assert.equal(current.updatedAt, "2026-10-27");
  assert.deepEqual(current.history.map((revision) => revision.id), [
    "18.5-release-2026-10-21",
    "18.5-hotfix-2026-10-22",
    "18.5-hotfix-2026-10-27"
  ]);
  assert.deepEqual(timeline.history.slice(0, 8), getPatchNoteTimeline("18.4").history);
  assert.equal(timeline.history.length, 11);
  assert.equal(timeline.history[8].parentId, "18.4-hotfix-2026-10-07");
  assert.equal(timeline.history[9].parentId, "18.5-release-2026-10-21");
  assert.equal(timeline.history[10].parentId, "18.5-hotfix-2026-10-22");
  assert.equal(flatten(PATCH_18_5_REVISION).length, 71);
  assert.equal(flatten(PATCH_18_5_B_PATCH).length, 7);
  assert.equal(flatten(PATCH_18_5_OCTOBER_27_HOTFIX).length, 6);
  assert.equal(timeline.history.flatMap((r) => r.groups.flatMap((g) => g.changes)).length, 476);
});

test("18.5 facts preserve exact endpoints and non-numeric status", () => {
  const facts = getOfficialPatchFacts({ patch: "18.5" });
  assert.deepEqual(facts.summary, { revisionCount: 3, changeCount: 84, buffs: 38, nerfs: 46 });
  assert.equal(facts.updatedAt, "2026-10-27");
  assert.match(facts.source.sourceUrl, /patch-18-5\/$/u);
  assert.match(facts.revisions[0].summary, /钢铁之心/u);
  assert.match(facts.revisions[0].summary, /71/u);
  assert.match(facts.revisions[1].summary, /7 项/u);
  assert.match(facts.revisions[1].summary, /不得|不重复叠加/u);
  assert.match(facts.revisions[2].summary, /英文官方公告/u);

  const changes = facts.revisions[0].changes;
  const bySuffix = (id) => changes.find((change) => change.id.endsWith(`-${id}`));
  assert.deepEqual([bySuffix("fae-heal").before, bySuffix("fae-heal").after], ["2.5/4%", "3/5%"]);
  assert.equal(bySuffix("master-yi-ap-damage").after, "135/200/320 AP");
  assert.equal(bySuffix("soraka-additional-star").after, "110/165 AP");
  assert.equal(bySuffix("hand-of-baron-stats").after, "22/33 HP + 2/3% stats");

  const october22 = facts.revisions[1].changes;
  const october27 = facts.revisions[2].changes;
  const byRevisionSuffix = (changes, id) => changes.find((change) => change.id.endsWith(`-${id}`));
  assert.deepEqual(
    [byRevisionSuffix(october22, "brambleback-heal").before, byRevisionSuffix(october22, "brambleback-heal").after],
    ["5%", "4%"]
  );
  assert.equal(byRevisionSuffix(october22, "hireling-base-cost").after, "5g");
  assert.deepEqual(
    [byRevisionSuffix(october27, "khazix-base-damage").before, byRevisionSuffix(october27, "khazix-base-damage").after],
    ["250/345/500 AP", "230/310/450 AP"]
  );
  assert.deepEqual(
    [byRevisionSuffix(october27, "brambleback-armor-ignore-ap").after, byRevisionSuffix(october27, "brambleback-armor-ignore-base").after],
    ["10%", "30%"]
  );
  assert.deepEqual(
    [byRevisionSuffix(october27, "hand-of-justice-omnivamp").after, byRevisionSuffix(october27, "radiant-hand-of-justice-omnivamp").after],
    ["12%", "25%"]
  );
  assert.match(facts.revisions[2].sourceUrl, /en-us/u);
});

test("simplified-Chinese patch labels distinguish four-cost Brambleback from five-cost Maokai", () => {
  assert.equal(unitDisplayOverrideByApiName.get("DA_Brambleback18")?.zhName, "绯红印记树怪");
  assert.equal(unitDisplayOverrideByApiName.get("DA_18_Maokai")?.zhName, "茂凯");
  assert.ok(unitDisplayOverrideByApiName.get("DA_Brambleback18")?.aliases.includes("树精长老"));
  assert.ok(unitDisplayOverrideByApiName.get("DA_18_Maokai")?.aliases.includes("大树"));
  assert.equal(unitDisplayOverrideByApiName.get("DA_Brambleback18")?.cost, 4);
  assert.equal(unitDisplayOverrideByApiName.get("DA_18_Maokai")?.cost, 5);

  const tierFour = PATCH_18_5_REVISION.groups.find((group) => group.title["zh-CN"] === "四费弈子");
  const brambleback = tierFour.changes.filter((change) => change.entityApiNames.includes("DA_Brambleback18"));
  assert.equal(brambleback.length, 2);
  assert.ok(brambleback.every((change) => change.text["zh-CN"].startsWith("绯红印记树怪（Brambleback）")));
  assert.deepEqual(brambleback.map(({ before, after }) => [before, after]), [
    ["4%", "5%"],
    ["20% + 25% AP", "25% + 25% AP"]
  ]);

  const recentLabels = [PATCH_18_4_REVISION, PATCH_18_5_REVISION]
    .flatMap(flatten)
    .map((change) => change.text["zh-CN"]);
  assert.ok(recentLabels.every((label) => !label.includes("树精长老")));
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
  assert.equal((await handlers.patch_facts({})).summary.changeCount, 84);
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
  assert.match(payload.answer, /84 项/u);
  assert.match(payload.answer, /增强 38 项、削弱 46 项/u);
  assert.match(payload.answer, /卡兹克/u);
  assert.match(payload.answer, /正义之手/u);
  assert.match(payload.answer, /Riot Games 官方更新公告/u);
  assert.doesNotMatch(payload.answer, /30000\/70000/u);
  assert.deepEqual(payload.evidence.map((entry) => entry.toolName), ["patch_facts"]);
  assert.equal(payload.modelConclusion.status, "rejected");
  assert.ok(payload.warnings.includes("patch_summary_validation_fallback"));
});

test("cross-patch summaries retain every cited patch after numeric grounding fallback", async () => {
  const runtime = createSmallWindowRuntime({
    patchNumericSeriesGroundingMode: "enforce",
    reactDecisionProvider: async (request) => {
      const patchEvidence = request.state.evidence.filter((entry) => entry.toolName === "patch_facts");
      const missingPatch = ["18.3", "18.5"].find((patch) => (
        !patchEvidence.some((entry) => entry.value?.patch === patch)
      ));
      if (missingPatch) {
        return {
          schemaVersion: "react-action.v1",
          type: "call_tool",
          tool: "patch_facts",
          arguments: { patch: missingPatch, locale: "zh-CN" },
          purposeCode: "retrieve_supporting_knowledge"
        };
      }
      return {
        schemaVersion: "react-action.v1",
        type: "finish",
        answer: "两个版本的门槛都是 30000/70000/110000→25000/60000/100000。",
        evidenceIds: patchEvidence.map((entry) => entry.evidenceId),
        reasonCode: "sufficient_evidence"
      };
    }
  });

  const { statusCode, payload } = await handleReactChatRequest({
    input: "对比一下 18.5 和 18.3 的版本更新，分别有多少项数值调整，主要改了什么？",
    seasonContextId: "set18-live",
    locale: "zh-CN",
    conversationId: "patch-18-5-vs-18-3-summary-fallback"
  }, runtime);

  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed_with_warning");
  assert.equal(payload.terminationReason, "finish_validation_fallback");
  assert.equal(payload.answerOrigin, "system_patch_summary_fallback");
  assert.match(payload.answer, /18\.5 与 18\.3 版本更新对比/u);
  assert.match(payload.answer, /18\.3 比 18\.5 多 3 项/u);
  assert.match(payload.answer, /版本 18\.5[\s\S]*84 项/u);
  assert.match(payload.answer, /版本 18\.3[\s\S]*87 项/u);
  assert.match(payload.answer, /卡兹克/u);
  assert.match(payload.answer, /大型变形术/u);
  assert.doesNotMatch(payload.answer, /30000\/70000/u);
  const patchByEvidenceId = new Map(payload.evidence.map((entry) => [entry.evidenceId, entry.value.patch]));
  assert.deepEqual(payload.evidenceIds.map((evidenceId) => patchByEvidenceId.get(evidenceId)), ["18.5", "18.3"]);
  assert.equal(payload.modelConclusion.status, "rejected");
  assert.ok(payload.warnings.includes("patch_summary_validation_fallback"));
});
