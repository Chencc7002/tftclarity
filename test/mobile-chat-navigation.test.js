import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readUi = (name) => readFileSync(new URL(`../src/app/small-window-ui/${name}`, import.meta.url), "utf8");

test("mobile web uses mutually exclusive chat and result views", () => {
  const html = readUi("index.html");
  const css = readUi("styles.css");
  const app = readUi("app.js");

  assert.match(html, /id="mobile-result-back"/u);
  assert.match(css, /\.shell\[data-mobile-view="chat"\] \.result-pane \{ display: none; \}/u);
  assert.match(css, /\.shell\[data-mobile-view="result"\] \.conversation-pane \{ display: none; \}/u);
  assert.match(app, /history\.pushState/u);
  assert.match(app, /window\.addEventListener\("popstate"/u);
  assert.match(app, /data-view-result[\s\S]*openMobileResult/u);
});

test("mobile web requests fast results and consumes independent conclusion stream", () => {
  const app = readUi("app.js");
  assert.match(app, /deferConclusion:\s*true/u);
  assert.match(app, /application\/x-ndjson/u);
  assert.match(app, /response\.body\.getReader/u);
  assert.match(app, /pollConclusionStatus/u);
  assert.match(app, /event\.type === "delta"/u);
});
