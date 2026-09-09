import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { conclusionDisplayText, conclusionRichTextHtml } from "../src/app/small-window-ui/conclusion-rich-text.js";

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

test("interrupted queries show partial-completion notice, not a false validation rejection", () => {
  const html = render(data, "");
  assert.match(html, /systemConclusionPartial/u);
  assert.doesNotMatch(html, /systemConclusionFallback/u);
  assert.ok(html.indexOf("36.7%") < html.indexOf("还缺什么"));
  assert.match(render({ ...data, terminationReason: "deadline_exceeded" }, ""), /systemConclusionDeadline/u);
});

test("rejected model prose is collapsed after the evidence-backed result", () => {
  const html = render({ ...data, modelConclusion: { status: "rejected", answer: "unsupported model prose", validationErrors: ["unverified"] } }, "");
  assert.match(html, /systemConclusionFallback/u);
  assert.ok(html.indexOf("36.7%") < html.indexOf("data-chat-rejected-model-conclusion"));
  assert.match(html, /<details class="chat-model-conclusion rejected" data-chat-rejected-model-conclusion>/u);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/u);
});
