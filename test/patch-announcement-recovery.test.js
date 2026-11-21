import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { MemoryCacheStore } from "../src/data/cache-store.js";
import { createSmallWindowRuntime, handleReactChatRequest } from "../src/app/small-window-server.js";
import { buildPatchAnnouncementRecovery } from "../src/react/patch-summary-answer.js";
import { getOfficialPatchFacts } from "../src/data/official-patch-facts.js";
import { validateFinishAction } from "../src/react/termination-policy.js";

async function run({ mode = "enforce", input = "那18.6的公告呢？", citation = "valid", patch = "18.6" } = {}) {
  const cacheStore = new MemoryCacheStore();
  const events = [];
  const runtime = createSmallWindowRuntime({
    cacheStore, patchSummaryRecoveryMode: mode,
    reactDecisionProvider: async ({ state }) => {
      const evidence = state.evidence.find((e) => e.toolName === "patch_facts");
      return evidence ? {
        schemaVersion: "react-action.v1", type: "finish",
        answer: "本版本共 888888888 项改动。",
        reasonCode: "sufficient_evidence",
        evidenceIds: citation === "missing" ? [] : [citation === "unknown" ? "not-a-real-id" : evidence.evidenceId]
      } : {
        schemaVersion: "react-action.v1", type: "call_tool", tool: "patch_facts",
        arguments: { patch, locale: "zh-CN" }, purposeCode: "retrieve_supporting_knowledge"
      };
    }
  });
  const response = await handleReactChatRequest({ input, locale: "zh-CN", seasonContextId: "set18-live", conversationId: "announcement-recovery" }, runtime, { onProgress: (event) => events.push(event) });
  return { ...response, events, cacheStore };
}

test("short announcement follow-up replaces unsupported prose using one registered tool call", async () => {
  const { payload, statusCode, events } = await run();
  assert.equal(statusCode, 200);
  assert.equal(payload.status, "completed_with_warning");
  assert.equal(payload.answerOrigin, "system_patch_summary_fallback");
  assert.match(payload.answer, /21 项/u);
  assert.match(payload.answer, /18\.6/u);
  assert.doesNotMatch(payload.answer, /888888888/u);
  assert.equal(payload.safetyMetrics.actualToolCalls, 1);
  assert.equal(payload.modelConclusion.status, "rejected");
  assert.ok(events.some((e) => e.type === "patch_summary_recovery_observed" && e.data.applied));
});

for (const citation of ["missing", "unknown"]) {
  test(`announcement recovery rebuilds ${citation} citations from valid matching current evidence`, async () => {
    const { payload } = await run({ citation });
    assert.equal(payload.answerOrigin, "system_patch_summary_fallback");
    assert.equal(payload.evidenceIds.length, 1);
    assert.equal(payload.evidenceIds[0], payload.evidence[0].evidenceId);
    assert.equal(payload.safetyMetrics.actualToolCalls, 1);
  });
}

test("shadow observes a validated candidate while preserving the legacy failure and recording it", async () => {
  const { payload, events, cacheStore } = await run({ mode: "shadow" });
  assert.equal(payload.status, "failed");
  assert.equal(payload.answer, null);
  assert.ok(events.some((e) => e.type === "patch_summary_recovery_observed" && e.data.eligible && !e.data.applied));
  const records = [...cacheStore.queryEvents.values()];
  assert.equal(records.length, 1);
  assert.equal(records[0].input, "那18.6的公告呢？");
  assert.equal(records[0].runId, payload.run.runId);
  assert.ok(records[0].response.modelConclusion.validationErrors.length);
  assert.equal(records[0].response.evidence[0].toolName, "patch_facts");
});

test("off retains the legacy path without candidate events", async () => {
  const { payload, events } = await run({ mode: "off" });
  assert.equal(payload.status, "failed");
  assert.ok(!events.some((e) => e.type === "patch_summary_recovery_observed"));
});

test("a different patch cannot replace the requested announcement", async () => {
  const { payload } = await run({ patch: "18.7" });
  assert.equal(payload.status, "failed");
  assert.equal(payload.answerOrigin, null);
});

test("history, missing versions, detailed questions and unrelated validation failures do not recover", () => {
  const evidence = { evidenceId: "official", toolName: "patch_facts", value: getOfficialPatchFacts({ patch: "18.6" }) };
  const base = {
    request: { input: "那18.6的公告呢？" }, action: { reasonCode: "sufficient_evidence", evidenceIds: ["official"] },
    validation: { errors: ["answer statistic is not present in cited evidence: 888888888"] },
    ledger: { snapshot: () => ({ entries: [evidence] }), resolve: () => [evidence] }
  };
  assert.ok(buildPatchAnnouncementRecovery(base));
  assert.equal(buildPatchAnnouncementRecovery({ ...base, ledger: { snapshot: () => ({ entries: [{ ...evidence, temporalStatus: "historical" }] }) } }), null);
  for (const input of ["18.6公告中墨菲特技能伤害改了多少？", "比较18.6和18.7的公告"]) {
    assert.equal(buildPatchAnnouncementRecovery({ ...base, request: { input } }), null);
  }
  assert.equal(buildPatchAnnouncementRecovery({ ...base, validation: { errors: ["historical quick-tool evidence cannot support a current statistical or best-ranking claim"] } }), null);
  assert.equal(buildPatchAnnouncementRecovery({ ...base, ledger: { snapshot: () => ({ entries: [{ ...evidence, value: getOfficialPatchFacts({ patch: "99.9" }) }] }) } }), null);
});

const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
test("frontend distinguishes a rejected answer from absent evidence", () => {
  const source = app.slice(app.indexOf("function recommendationFailureMessage("), app.indexOf("async function readRecommendationStream("));
  const message = runInNewContext(`${source}\nrecommendationFailureMessage`, { t: () => "failed", getLocale: () => "zh-CN" });
  assert.match(message({ terminationReason: "missing_required_evidence", modelConclusion: { status: "rejected" }, evidence: [{ toolName: "patch_facts", value: getOfficialPatchFacts({ patch: "18.6" }) }] }), /已取得来源资料/u);
  assert.match(message({ terminationReason: "missing_required_evidence", evidence: [] }), /未取得/u);
});

test("frontend renders the verified patch fallback instead of rejected model numbers", () => {
  const source = app.slice(app.indexOf("function reactModelConclusionHtml("), app.indexOf("function rankingTierLabel("));
  const render = runInNewContext(`${source}\nreactModelConclusionHtml`, {
    state: {}, conclusionDisplayText: (s) => s, conclusionRichTextHtml: (s) => s
  });
  const html = render({ answerOrigin: "system_patch_summary_fallback", modelConclusion: { answer: "888888888" }, reactAnswer: "21 项" }, "");
  assert.match(html, /21 项/u);
  assert.doesNotMatch(html, /888888888/u);
});

test("official source URLs and unchanged pending paragraphs pass while invented numeric arrays still fail", () => {
  const facts = getOfficialPatchFacts({ patch: "18.6" });
  const entry = { evidenceId: "official", toolName: "patch_facts", value: facts };
  const ledger = { resolve: () => [entry], snapshot: () => ({ entries: [entry] }) };
  const check = (answer, mode = "enforce") => validateFinishAction({
    reasonCode: "sufficient_evidence", evidenceIds: [entry.evidenceId], answer
  }, ledger, { patchNumericSeriesGroundingMode: "enforce", patchSummaryRecoveryMode: mode });
  const quote = `${facts.revisions[0].summary}\n来源：${facts.source.sourceUrl}`;
  assert.equal(check(quote).valid, true);
  assert.equal(check(quote, "off").valid, false);
  assert.equal(check("远程加成现在为 15/30/38%。").valid, false);
  assert.equal(check(`${quote}\n额外伤害 65/100/180 → 100/150/2000。`).valid, false);
  assert.equal(check(`${quote}\n伤害为 65/150/180。`).valid, false);
});
