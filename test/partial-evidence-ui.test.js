import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { conclusionDisplayText, conclusionRichTextHtml } from "../src/app/small-window-ui/conclusion-rich-text.js";
import { denseEquipmentAnswer } from "./fixtures/dense-equipment-answer.js";

// Exercise the actual card renderer without bootstrapping networked app state.
const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("function reactModelConclusionHtml("), app.indexOf("function rankingTierLabel("));
const render = runInNewContext(`${source}\nreactModelConclusionHtml`, {
  state: { explanationFeedback: null }, t: (key) => key,
  escapeHtml: (value) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  conclusionDisplayText, conclusionRichTextHtml, chatCoreItemsHtml: () => ""
});
const data = { answerOrigin: "system_evidence_fallback", terminationReason: "no_progress",
  reactAnswer: "### 已确认的信息\n- 测试阵容的前四率 36.7%。\n### 还缺什么 / 结论边界\n- 站位尚未取得。" };

test("queries without model prose keep available facts and limitations, without annotation headers", () => {
  const html = render(data, "");
  assert.doesNotMatch(html, /systemConclusion|systemEvidenceConclusion|<header>/u);
  assert.ok(html.indexOf("36.7%") < html.indexOf("还缺什么"));
  assert.match(render({ ...data, terminationReason: "deadline_exceeded" }, ""), /36.7%/u);
});

test("model original body is displayed exactly once, without the system duplicate or validation annotations", () => {
  const html = render({ ...data, modelConclusion: { status: "rejected", answer: "结论：上升最快的是测试阵容。", validationErrors: ["unverified"] } }, "");
  assert.equal((html.match(/上升最快的是测试阵容/g) ?? []).length, 1);
  assert.doesNotMatch(html, /36.7%|unverified|<details|<header>|系统证据结论|模型原始结论|结论：/u);
});

test("empty model original falls back to available body and source HTML is escaped", () => {
  assert.match(render({ ...data, modelConclusion: { answer: "  " } }, ""), /36.7%/u);
  const html = render({ ...data, modelConclusion: { answer: '<img src=x onerror="alert(1)">' } }, "");
  assert.match(html, /&lt;img/u);
  assert.doesNotMatch(html, /<img/u);
});

test("the actual ReAct card formats dense post-confirmation equipment answers", () => {
  for (const payload of [{ reactAnswer: denseEquipmentAnswer }, { modelConclusion: { answer: denseEquipmentAnswer } }]) {
    const html = render(payload, "");
    assert.equal((html.match(/<h3 /gu) ?? []).length, 3);
    assert.equal((html.match(/<li>/gu) ?? []).length, 3);
    assert.equal((html.match(/2103场/gu) ?? []).length, 1);
    assert.doesNotMatch(html, /assistant-rich-text__summary|<header>/u);
  }
});
