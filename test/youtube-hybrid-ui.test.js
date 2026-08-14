import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(
  new URL(`../src/app/small-window-ui/${name}`, import.meta.url),
  "utf8"
);

const app = read("app.js");
const html = read("index.html");
const styles = read("styles.css");
const i18n = read("i18n.js");

test("result pane exposes query, statistics, and video evidence", () => {
  assert.match(html, /data-i18n="resultEyebrow">查询与证据</);
  assert.match(app, /data\?\.assistantResponse\?\.text/);
  assert.match(app, /if \(data\?\.clarification\?\.needsClarification\)/);
  assert.match(app, /function renderKnowledgeEvidence/);
  assert.match(app, /record\.sourceTitle/);
  assert.match(app, /record\.publishedAt/);
  assert.match(app, /record\.timestampStart/);
  assert.match(app, /record\.conditions/);
  assert.match(app, /record\.rank/);
  assert.match(app, /record\.timeWindow/);
  assert.match(app, /record\.region/);
  assert.match(app, /record\.generatedAt/);
  assert.match(app, /record\.aiGenerated === true/);
  assert.match(app, /record\.reviewStatus === "human_reviewed"/);
  assert.match(app, /knowledge-ai-badge/);
  assert.match(app, /knowledge-ai-disclosure/);
  assert.match(app, /value === null \|\| value === undefined \|\| value === ""/);
  assert.match(app, /target="_blank" rel="noopener noreferrer"/);
  assert.match(app, /data\.type === "coach_answer"/);
  assert.match(styles, /\.knowledge-evidence/);
  assert.match(styles, /\.knowledge-card/);
  assert.match(i18n, /knowledgeAuthorityNote/);
  assert.match(i18n, /MetaTFT structured statistics remain authoritative/);
  assert.match(i18n, /currentStatsSource/);
  assert.match(i18n, /AI 生成 · 未经人工复核/);
  assert.match(i18n, /AI-generated · Not human-reviewed/);
});
