import assert from "node:assert/strict";
import test from "node:test";

import {
  conclusionDisplayText,
  conclusionRichTextHtml
} from "../src/app/small-window-ui/conclusion-rich-text.js";

test("tactical conclusions hide provider cell ids and become readable sections", () => {
  const source = "站位（来自MetaTFT当前数据）：千珏放角落（cell_1），易放第二排右侧（cell_22），卑尔维斯和厄加特在第二排左侧（cell_15、cell_16）。推荐强化符文（S级，金色）：秘传奥义（3-2/4-2）、飞升（3-2/4-2）。";
  const text = conclusionDisplayText(source);
  const html = conclusionRichTextHtml(source);

  assert.doesNotMatch(text, /cell_/iu);
  assert.match(text, /^\*\*阵容站位（MetaTFT 当前数据）\*\*/u);
  assert.match(text, /- \*\*千珏\*\*放角落/u);
  assert.match(text, /\*\*推荐强化符文（S级，金色）\*\*/u);
  assert.match(text, /- \*\*秘传奥义\*\*（3-2\/4-2）/u);
  assert.match(html, /assistant-rich-text__section-title/u);
  assert.match(html, /assistant-rich-text__list/u);
});

test("Markdown headings render as section titles without visible hash marks", () => {
  const html = conclusionRichTextHtml("## 站位\n- **易**：第二排右侧");

  assert.match(html, /<h3 class="assistant-rich-text__section-title">站位<\/h3>/u);
  assert.doesNotMatch(html, />## 站位</u);
});

test("conclusion rich text turns Markdown sections, bullets, and summary into visual blocks", () => {
  const html = conclusionRichTextHtml(`**加入前（7 名成员）**
- 新星特攻队：2 人，激活 1 档

**加入后（8 名成员）**
- 新星特攻队：2→3，未升档

**变化汇总**：新星特攻队 2→3；狂战士 0→1，未激活。`);

  assert.doesNotMatch(html, /\*\*/u);
  assert.match(html, /<h3 class="assistant-rich-text__section-title">加入前/u);
  assert.match(html, /<ul class="assistant-rich-text__list"><li>/u);
  assert.match(html, /<aside class="assistant-rich-text__summary"><strong>变化汇总<\/strong>/u);
  assert.match(html, /<mark class="assistant-rich-text__emphasis">2→3<\/mark>/u);
  assert.match(html, /<mark class="assistant-rich-text__emphasis">未激活<\/mark>/u);
});

test("conclusion rich text escapes model-provided HTML", () => {
  const html = conclusionRichTextHtml("**结论**：<img src=x onerror=alert(1)>");

  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
});

test("conclusion rich text formats numbered changes and transitions with units", () => {
  const html = conclusionRichTextHtml(`1. 新星特攻队：2人 → 3人（+1），档位未变
2. 狂战士：0人 → 1人（+1），未激活`);

  assert.match(html, /<ol class="assistant-rich-text__list">/u);
  assert.match(html, /<mark class="assistant-rich-text__emphasis">2人 → 3人<\/mark>/u);
  assert.match(html, /<mark class="assistant-rich-text__emphasis">档位未变<\/mark>/u);
});

test("conclusion rich text emphasizes natural-language count changes", () => {
  const html = conclusionRichTextHtml("新星特攻队：人数从2增至3，未达到5人档位；其他羁绊人数不变。");

  assert.match(html, /<mark class="assistant-rich-text__emphasis">从2增至3<\/mark>/u);
  assert.match(html, /<mark class="assistant-rich-text__emphasis">未达到<\/mark>/u);
  assert.match(html, /<mark class="assistant-rich-text__emphasis">人数不变<\/mark>/u);
});
