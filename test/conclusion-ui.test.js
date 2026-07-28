import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../src/app/small-window-ui/${name}`, import.meta.url), "utf8");

test("small-window exposes conclusion controls, status, card, and independent feedback", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("styles.css");
  assert.match(html, /id="conclusion-mode-select"/u);
  assert.match(app, /answer\?\.generatedConclusion/u);
  assert.match(app, /data-conclusion-status/u);
  assert.match(app, /target: "explanation"/u);
  assert.match(app, /rating: sentiment === "good" \? "helpful" : "unhelpful"/u);
  assert.match(app, /data-feedback-reason-submit/u);
  assert.match(app, /explanation_incorrect/u);
  assert.match(app, /\.\.\.\(reason \? \{ reason \} : \{\}\)/u);
  assert.match(css, /\.generated-conclusion/u);
  assert.match(css, /\.feedback-reasons\[hidden\]/u);
  assert.match(css, /@media \(max-width: 519px\)[\s\S]*\.conclusion-footer/u);
});

test("equipment conclusions render three ordered responsive sections without a data-notice card", () => {
  const app = read("app.js");
  const css = read("styles.css");
  const i18n = read("i18n.js");
  assert.match(app, /equipmentConclusionViewModel/u);
  assert.match(app, /recommendation[\s\S]*core-items[\s\S]*candidate-analysis/u);
  assert.doesNotMatch(app, /key: "data-notice"/u);
  assert.match(app, /unit_build_completion/u);
  assert.match(app, /itemDifferentiation\?\.hasClearLeader/u);
  assert.match(css, /\.equipment-conclusion-sections/u);
  assert.match(css, /@media \(max-width: 519px\)[\s\S]*\.equipment-conclusion-sections/u);
  for (const key of [
    "conclusionRecommendation",
    "conclusionCoreItems",
    "conclusionPrioritize",
    "conclusionCandidateAnalysis"
  ]) {
    assert.equal((i18n.match(new RegExp(`${key}:`, "gu")) ?? []).length, 2);
  }
});

