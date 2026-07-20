import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("mini program registers separate chat and result pages", () => {
  const project = JSON.parse(read("project.config.json"));
  const app = JSON.parse(read("miniprogram/app.json"));
  assert.equal(project.miniprogramRoot, "miniprogram/");
  assert.deepEqual(app.pages.slice(0, 2), ["pages/chat/chat", "pages/result/result"]);
  assert.equal(app.window.navigationStyle, "custom");
});

test("mini program chat exposes TFT quick tasks and result navigation", () => {
  const template = read("miniprogram/pages/chat/chat.wxml");
  const script = read("miniprogram/pages/chat/chat.js");
  for (const task of ["comps", "trends", "build", "patch"]) {
    assert.match(template, new RegExp(`data-task="${task}"`, "u"));
  }
  assert.match(script, /wx\.navigateTo/u);
  assert.match(script, /【英雄名称】/u);
  assert.doesNotMatch(script, /查询霞的当前版本最稳三件装备/u);
});

test("mini program result page has explicit back navigation and persistent lookup", () => {
  const template = read("miniprogram/pages/result/result.wxml");
  const script = read("miniprogram/pages/result/result.js");
  assert.match(template, /bindtap="goBack"/u);
  assert.match(script, /wx\.navigateBack/u);
  assert.match(script, /store\.getResult/u);
  assert.match(script, /store\.saveResult/u);
});

test("mini program API asks for fast results and supports chunk/poll conclusion fallback", () => {
  const script = read("miniprogram/utils/api.js");
  assert.match(script, /deferConclusion:\s*true/u);
  assert.match(script, /enableChunked:\s*true/u);
  assert.match(script, /onChunkReceived/u);
  assert.match(script, /pending\.statusUrl/u);
});

test("mini program UTF-8 decoder preserves a Chinese character split across chunks", () => {
  const { createUtf8Decoder } = require("../miniprogram/utils/utf8-stream.js");
  const bytes = new TextEncoder().encode("星神");
  const decoder = createUtf8Decoder();
  const first = decoder.decode(bytes.slice(0, 2).buffer, false);
  const second = decoder.decode(bytes.slice(2).buffer, true);
  assert.equal(first + second, "星神");
});

test("mini program result view normalizes recommendation cards", () => {
  const { buildResultView } = require("../miniprogram/utils/result-view.js");
  const view = buildResultView({
    type: "recommendation",
    answer: { summary: "测试推荐" },
    cards: [{
      title: "最佳方案",
      winner: true,
      items: [{ name: "羊刀" }, { name: "无尽" }, { name: "巨杀" }],
      stats: { top4: 56.7, games: 2842 }
    }]
  });
  assert.equal(view.summary, "测试推荐");
  assert.equal(view.cards[0].items.length, 3);
  assert.deepEqual(view.cards[0].stats[0], { label: "前四率", value: "56.7%" });
});
