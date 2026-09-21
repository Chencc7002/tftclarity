import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { selectedEntityConfirmation } from "../src/react/entity-confirmation.js";
import { createReactDecisionProvider } from "../src/react/react-decision-provider.js";

const candidates = [{ apiName: "First", name: "娜美" }, { apiName: "Second", name: "卡尔玛" }];
const bridge = { pendingClarification: { confirmationContext: { type: "entity_candidate", entityType: "unit",
  inputName: "扇子姐姐", originalInput: "扇子姐姐已有羊刀，剩下两件只要普通装备", candidates } } };

test("only a unique pending name or an affirmative single candidate selects an entity", () => {
  assert.equal(selectedEntityConfirmation("卡尔玛", bridge).candidates[0].apiName, "Second");
  assert.equal(selectedEntityConfirmation("卡尔玛", { view: bridge }).candidates[0].apiName, "Second");
  for (const input of ["是的", "不是", "未知", "Second", "卡尔玛和娜美", "卡尔玛怎么玩"]) {
    assert.equal(selectedEntityConfirmation(input, bridge), null);
  }
  assert.equal(selectedEntityConfirmation("卡尔玛", null), null);
  assert.equal(bridge.pendingClarification.confirmationContext.candidates.length, 2);
  const single = structuredClone(bridge);
  single.pendingClarification.confirmationContext.candidates = [candidates[1]];
  assert.equal(selectedEntityConfirmation("是的", single).candidates[0].apiName, "Second");
  single.pendingClarification.confirmationContext.candidates.push({ apiName: "Third", name: "卡尔玛" });
  assert.equal(selectedEntityConfirmation("卡尔玛", single), null);
});

test("name selection carries the original request and equipment constraints in both prompt layouts", async () => {
  for (const messageLayout of ["append_only", "legacy_full_state"]) {
    let body;
    const provider = createReactDecisionProvider({ endpoint: "https://example.test", model: "test", messageLayout,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
          schemaVersion: "react-action.v1", type: "finish", answer: "当前资料不足。", evidenceIds: [], reasonCode: "insufficient_evidence"
        }) } }] }) };
      } });
    await provider({ state: { question: "卡尔玛", bridgeContext: bridge }, toolCatalog: [] });
    const guidance = body.messages.find(message => message.content.includes("entity-confirmation-guidance.v1"));
    assert.match(guidance.content, /卡尔玛 \(Second\)/u);
    assert.ok(guidance.content.includes(bridge.pendingClarification.confirmationContext.originalInput));
    assert.ok(body.messages.some(message => message.content.includes('"itemPolicy":"ordinary_only"')));
  }
});

function uiHarness() {
  const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
  const submitted = [], labels = [];
  const state = { responseRecords: [], responsesById: new Map(), conversationId: "chat", seasonContextId: "set18-live", requestSerial: 1 };
  const context = vm.createContext({ state, queryInput: { value: "", focus() {} },
    escapeHtml: text => String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    conclusionDisplayText: value => value, collectCompositionResultGroups: () => [], t: value => value,
    setMobileView: () => {}, requestRecommendation: async (_refresh, displayInput) => {
      submitted.push(context.queryInput.value); labels.push(displayInput); state.requestInFlight = true;
    }
  });
  for (const [start, end] of [
    ["function entityTypeLabel(", "function summaryLines("],
    ["function normalizeReactCompositionRankings(", "function reactChatMessages("],
    ["function isCurrentEntityConfirmation(", "async function requestRecommendation("],
    ["async function handleResultClick(", 'resultEl.addEventListener("click", handleResultClick)']
  ]) vm.runInContext(app.slice(app.indexOf(start), app.indexOf(end)), context);
  const payload = { type: "react_chat_result", status: "clarification_required", question: "请选择英雄", evidence: [],
    clarificationContext: bridge.pendingClarification.confirmationContext };
  const data = context.normalizeEndpointPayload(payload);
  const record = { id: "response-1", data, conversationId: state.conversationId, seasonContextId: state.seasonContextId, requestSerial: 1 };
  state.responsesById.set(record.id, record);
  state.responseRecords.push(record);
  return { state, context, data, submitted, labels, record, click: (index = 1) => context.handleResultClick({ target: {
    closest: selector => selector === "button[data-candidate-action]" ? { dataset: { candidateAction: "confirm", candidateIndex: String(index), responseId: record.id } } : null
  } }) };
}

test("candidate names render as escaped buttons and one click submits without a composer action", async () => {
  const h = uiHarness();
  const html = h.context.renderEntityCandidates(h.data.clarification.entityCandidates, h.record.id);
  assert.match(html, /data-candidate-action="confirm"[^>]*>卡尔玛<\/button>/u);
  assert.doesNotMatch(html, /candidate-action="save"|0%|Second/u);
  const escaped = h.context.renderEntityCandidates([{ confirmation: true, label: '<img src="bad">' }], '"bad');
  assert.ok(!escaped.includes("<img"));
  await h.click();
  await h.click();
  assert.deepEqual(h.submitted, ["卡尔玛已有羊刀，剩下两件只要普通装备"]);
  assert.deepEqual(h.labels, ["卡尔玛"]);
});

test("old, cross-season, cross-conversation and busy candidate clicks cannot submit", async () => {
  for (const change of [
    h => { h.state.requestInFlight = true; },
    h => { h.state.seasonContextId = "other-season"; },
    h => { h.state.conversationId = "other-chat"; },
    h => { h.state.requestSerial = 2; },
    h => { h.state.responseRecords.push({ id: "later" }); }
  ]) {
    const h = uiHarness(); change(h); await h.click(); assert.equal(h.submitted.length, 0);
  }
});

test("coach-style clarification in the result panel keeps clickable candidate names", () => {
  const h = uiHarness();
  let html = "";
  h.context.setResponseHtml = value => { html = value; };
  h.context.resultHeader = () => "";
  h.context.state.currentResponseId = h.record.id;
  const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
  vm.runInContext(app.slice(app.indexOf("function renderCoachAnswerResult("), app.indexOf("function renderSystemInteractionResult(")), h.context);
  h.context.renderCoachAnswerResult(h.data);
  assert.match(html, /data-candidate-action="confirm"[^>]*data-response-id="response-1"[^>]*>卡尔玛<\/button>/u);
  assert.match(html, />娜美<\/button>/u);
});
