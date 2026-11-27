import assert from "node:assert/strict";
import test from "node:test";
import { denseEquipmentAnswer } from "./fixtures/dense-equipment-answer.js";

import {
  conclusionDisplayText,
  conclusionRichTextHtml
} from "../src/app/small-window-ui/conclusion-rich-text.js";

test("body-only rendering removes annotation headings without dropping facts or adding summary labels", () => {
  for (const title of ["结论：", "### 结论\n", "**结论**：", "### 模型原始结论（未通过校验）\n", "## Conclusion\n"]) {
    const html = conclusionRichTextHtml(`${title}最有潜力的是甲。\n\n**下降阵容**\n- 乙有所下滑。`, { bodyOnly: true });
    assert.match(html, /最有潜力的是甲/u);
    assert.match(html, /下降阵容/u);
    assert.match(html, /乙有所下滑/u);
    assert.doesNotMatch(html, /未通过校验|模型原始|结论|Conclusion|assistant-rich-text__summary/u);
  }
});

test("tactical conclusions hide provider cell ids and become readable sections", () => {
  const source = "站位（来自MetaTFT当前数据）：千珏放角落（cell_1），易放第二排右侧（cell_22），卑尔维斯和厄加特在第二排左侧（cell_15、cell_16）。推荐强化符文（S级，金色）：秘传奥义（3-2/4-2）、飞升（3-2/4-2）。";
  const text = conclusionDisplayText(source);
  const html = conclusionRichTextHtml(source);

  assert.doesNotMatch(text, /cell_/iu);
  assert.match(text, /^\*\*阵容站位（当前数据）\*\*/u);
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

test("inline equipment rankings keep each number with its item and emphasize item names", () => {
  const source = "厄斐琉斯（2星）单装备排行榜（含神器）：1. 羊刀 平均名次4.16 前四57.1% 吃鸡10.5% 样本62738；2. 海妖之怒 4.10 58.5% 10.9% 45339；3. 杀人剑 4.07 59.4% 10.5% 40046。";
  const html = conclusionRichTextHtml(source);

  assert.match(html, /<aside class="assistant-rich-text__summary"><strong>结论<\/strong>/u);
  assert.match(html, /<ol class="assistant-rich-text__list">/u);
  assert.equal((html.match(/<li>/gu) ?? []).length, 3);
  assert.doesNotMatch(html, /<li>\s*\d+[.)]\s*<\/li>/u);
  assert.match(html, /<li><strong class="assistant-rich-text__strong">羊刀<\/strong> 平均名次4\.16/u);
  assert.match(html, /<li><strong class="assistant-rich-text__strong">海妖之怒<\/strong> 4\.10/u);
});

test("unnumbered equipment rankings become a readable list with emphasized item names", () => {
  const html = conclusionRichTextHtml(
    "厄斐琉斯单装备排行榜（含神器，按前四率排序）：金币收集者前四率63%、吃鸡率14.8%、均名3.87、样本1745；杀人剑前四率60.3%、吃鸡率10.3%、均名4.07、样本2951；鱼骨头前四率60.4%、吃鸡率11.7%、均名4.01、样本1504。"
  );

  assert.match(html, /<ol class="assistant-rich-text__list">/u);
  assert.match(html, /<strong class="assistant-rich-text__strong">金币收集者<\/strong>/u);
  assert.match(html, /<strong class="assistant-rich-text__strong">杀人剑<\/strong>/u);
  assert.match(html, /<strong class="assistant-rich-text__strong">鱼骨头<\/strong>/u);
});

test("body-only dense equipment answers have sections and complete builds without changing facts", () => {
  for (const bodyOnly of [false, true]) {
    const html = conclusionRichTextHtml(denseEquipmentAnswer, { bodyOnly });
    assert.equal((html.match(/<h3 /gu) ?? []).length, 3);
    assert.equal((html.match(/<li>/gu) ?? []).length, 3);
    assert.match(html, /<li>蓝buff\+血手\+密银（727场）、<\/li>/u);
    assert.match(html, /密银（2103场，前四73\.9%、登顶16\.7%、均名3\.31）/u);
    assert.equal(html.replace(/<[^>]*>/gu, "").replace(/\s/gu, ""), denseEquipmentAnswer.replace(/\s/gu, ""));
    if (bodyOnly) assert.doesNotMatch(html, /assistant-rich-text__summary/u);
  }
});

test("body-only restores automatic paragraph layout without adding annotation headings", () => {
  const html = conclusionRichTextHtml("结论：第一条保留。第二条保留。第三条保留。", { bodyOnly: true });
  assert.equal((html.match(/<li>/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /结论|assistant-rich-text__summary/u);
});

test("equipment sections preserve nested metrics, decimal numbers and thousands separators", () => {
  const input = "主流出装：甲+乙+丙（1,234场；均名3.31）、甲+乙+丁（211场）。核心装备：甲（说明【备选、观察】；前四73.9%）。";
  const html = conclusionRichTextHtml(input, { bodyOnly: true });
  assert.equal((html.match(/<li>/gu) ?? []).length, 2);
  assert.match(html, /甲\+乙\+丙（1,234场；均名3\.31）、<\/li>/u);
  assert.equal(html.replace(/<[^>]*>/gu, "").replace(/\s/gu, ""), input);
});

test("explicit Markdown, short answers and quoted labels keep their existing structure", () => {
  const markdown = "### 主流出装\n- **甲**+乙+丙（727场）\n### 核心装备\n甲。";
  const html = conclusionRichTextHtml(markdown, { bodyOnly: true });
  assert.equal((html.match(/<h3 /gu) ?? []).length, 2);
  assert.equal((html.match(/<li>/gu) ?? []).length, 1);
  assert.equal((conclusionRichTextHtml("暂无数据。", { bodyOnly: true }).match(/<p /gu) ?? []).length, 1);
  const nested = conclusionRichTextHtml("说明（主流出装：甲；核心装备：乙）。", { bodyOnly: true });
  assert.doesNotMatch(nested, /<h3 /u);
});
test("rankings render a chart and sortable table from the same values, including spaced Markdown rows", () => {
  const input = ["比赛结果", "| 阵容 | 平均名次 | 前四率 | 场次 |", "| :--- | ---: | ---: | ---: |",
    "| **心之钢** | 3.55 | 68.0% | 6,536 |", "| 天才 | 3.73 | — | 1,343 |", "下一段说明。"].join("\n\n");
  const html = conclusionRichTextHtml(input, { bodyOnly: true });
  assert.match(html, /class="answer-comparison" data-view="chart"/u);
  assert.match(html, /value="1" data-direction="asc">平均名次/u);
  assert.match(html, /value="2" data-direction="desc">前四率/u);
  assert.match(html, /data-number="6536"/u);
  assert.match(html, /max="8" value="3.55"/u);
  assert.match(html, /max="100" value="68"/u);
  assert.match(html, />6,536</u);
  assert.match(html, /下一段说明/u);
  assert.doesNotMatch(html, /:---/u);
});

test("text tables, unsafe cells, escaped pipes, fenced examples and adjacent tables preserve content", () => {
  const text = "Name | Detail\n---|---\nA\\|B | <img onerror=x>\n\nName | Note\n---|---\nX | Y";
  const html = conclusionRichTextHtml(text);
  assert.equal((html.match(/<table>/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /<img|data-sort-field/u);
  assert.match(html, /A\|B/u);
  assert.match(html, /&lt;img onerror=x&gt;/u);
  assert.doesNotMatch(conclusionRichTextHtml("~~~\n" + text + "\n~~~"), /<table>/u);
  assert.doesNotMatch(conclusionRichTextHtml("A | B\njust text"), /<table>/u);
});
import { namedChartItem, namedChartUnit } from "../src/app/small-window-ui/answer-comparison.js";

test("item tables identify gear by header, render single rows and keep icons in build order", () => {
  const table = ["｜档位｜装备组合｜前四率｜场次｜", "｜-｜-｜-｜-｜", "｜A｜羊刀 + 无尽｜59.7%｜14,919｜"].join("\n\n");
  for (const answer of [table, "```markdown\n" + table + "\n```"]) {
    const html = conclusionRichTextHtml(answer, { bodyOnly: true });
    assert.match(html, /data-view="chart"/u);
    assert.match(html, /data-item-portrait="羊刀".*data-item-portrait="无尽"/u);
    assert.match(html, /data-number="14919"/u);
    assert.doesNotMatch(html, /[｜`]/u);
  }
  const ordinary = { apiName: "rageblade", name: "鬼索的狂暴之刃", aliases: ["羊刀"] };
  const radiant = { apiName: "radiant", name: "光明羊刀", aliases: ["光明鬼索"] };
  assert.equal(namedChartItem("羊刀", [ordinary, radiant]), ordinary);
  assert.equal(namedChartItem("光明鬼索", [ordinary, radiant]), radiant);
  assert.equal(namedChartItem("羊刀", [ordinary, { ...radiant, aliases: ["羊刀"] }]), null);
});

test("composition charts bind the named carry, including season-specific forms", () => {
  const ez = { name: "伊泽瑞尔", enName: "Ezreal19" };
  const kda = { name: "阿卡丽", traitNames: ["K/DA"] }, td = { name: "阿卡丽", traitNames: ["真实伤害"] };
  const roster = [ez, kda, td];
  assert.equal(namedChartUnit("心之钢 · 伊泽瑞尔", roster), ez);
  assert.equal(namedChartUnit("Heartsteel · EZ", roster), ez);
  assert.equal(namedChartUnit("真伤 · 阿卡丽", roster), td);
  assert.equal(namedChartUnit("K/DA · 阿卡丽", roster), kda);
  assert.equal(namedChartUnit("阿卡丽", roster), null);
  const html = conclusionRichTextHtml("| 阵容 | 前四率 |\n|---|---|\n| 心之钢 · 伊泽瑞尔 | 68.0% |\n| 真伤 · 阿卡丽 | 54% |");
  assert.match(html, /data-comp-portrait="心之钢 · 伊泽瑞尔"/u);
  assert.doesNotMatch(html, /data-view-button/u);
});
