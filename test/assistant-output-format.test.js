import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSISTANT_OUTPUT_SCHEMA_VERSION,
  conclusionRichTextHtml
} from "../src/app/small-window-ui/conclusion-rich-text.js";

test("assistant output turns a long one-paragraph answer into a scannable conclusion and list", () => {
  const html = conclusionRichTextHtml(
    "优先使用当前样本更稳定的方案。它的前四表现更稳。第二套可以在缺少核心散件时使用。低样本方案只作为备选。"
  );

  assert.match(html, new RegExp(`data-assistant-output-schema="${ASSISTANT_OUTPUT_SCHEMA_VERSION}"`, "u"));
  assert.match(html, /assistant-rich-text__summary"><strong>结论<\/strong><span>优先使用当前样本更稳定的方案。<\/span>/u);
  assert.equal((html.match(/<li>/gu) ?? []).length, 3);
  assert.match(html, /<li>它的前四表现更稳。<\/li>/u);
  assert.match(html, /<li>低样本方案只作为备选。<\/li>/u);
});

test("assistant output expands a labeled single-line conclusion without duplicating its label", () => {
  const html = conclusionRichTextHtml("结论：优先选择第一套。原因是样本更稳定。风险是差距较小。");

  assert.equal((html.match(/<strong>结论<\/strong>/gu) ?? []).length, 1);
  assert.equal((html.match(/<li>/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /结论：结论/u);
});

test("assistant output preserves explicit sections and escapes unsafe markup", () => {
  const html = conclusionRichTextHtml("## 建议\n- **霞**放在后排\n- <script>alert(1)</script>");

  assert.match(html, /assistant-rich-text__section-title/u);
  assert.equal((html.match(/<li>/gu) ?? []).length, 2);
  assert.match(html, /assistant-rich-text__strong">霞<\/strong>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>/u);
});

test("assistant output keeps a short answer compact", () => {
  const html = conclusionRichTextHtml("当前证据不足，暂时无法可靠判断。");

  assert.match(html, /assistant-rich-text__paragraph/u);
  assert.doesNotMatch(html, /assistant-rich-text__summary/u);
  assert.doesNotMatch(html, /<li>/u);
});

test("assistant output uses an English summary label for long English prose", () => {
  const html = conclusionRichTextHtml(
    "Use the first option for the most stable sample. It has the clearest current evidence. Keep the second option for a conditional alternative. Treat the low-sample result cautiously."
  );

  assert.match(html, /<strong>Summary<\/strong>/u);
  assert.equal((html.match(/<li>/gu) ?? []).length, 3);
});
