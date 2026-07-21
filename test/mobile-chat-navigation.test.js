import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readUi = (name) => readFileSync(new URL(`../src/app/small-window-ui/${name}`, import.meta.url), "utf8");

test("mobile web uses mutually exclusive chat and result views", () => {
  const html = readUi("index.html");
  const css = readUi("styles.css");
  const app = readUi("app.js");

  assert.match(html, /id="mobile-result-back"[^>]*data-common-result-navigation/u);
  assert.match(html, /id="result-pane"[\s\S]*id="mobile-result-back"[\s\S]*id="result-content"/u);
  assert.match(css, /\.shell\[data-mobile-view="chat"\] \.result-pane \{ display: none; \}/u);
  assert.match(css, /\.shell\[data-mobile-view="result"\] \.conversation-pane \{ display: none; \}/u);
  assert.match(app, /history\.pushState/u);
  assert.match(app, /window\.addEventListener\("popstate"/u);
  assert.match(app, /data-view-result[\s\S]*openMobileResult/u);
});

test("mobile web respects narrow viewports and display safe areas", () => {
  const html = readUi("index.html");
  const css = readUi("styles.css");

  assert.match(html, /viewport-fit=cover/u);
  assert.match(css, /body \{[^}]*min-width: 0/u);
  assert.match(css, /height: 100dvh/u);
  assert.match(css, /--title-height: calc\(var\(--title-content-height\) \+ env\(safe-area-inset-top, 0px\)\)/u);
  assert.match(css, /min-height: var\(--title-height\)/u);
  assert.match(css, /max\(10px, env\(safe-area-inset-right, 0px\)\)/u);
  assert.match(css, /max\(10px, env\(safe-area-inset-left, 0px\)\)/u);
});

test("mobile web requests fast results and consumes independent conclusion stream", () => {
  const app = readUi("app.js");
  const css = readUi("styles.css");
  assert.match(app, /deferConclusion:\s*true/u);
  assert.match(app, /application\/x-ndjson/u);
  assert.match(app, /response\.body\.getReader/u);
  assert.match(app, /pollConclusionStatus/u);
  assert.match(app, /event\.type === "delta"/u);
  assert.match(app, /data-chat-core-conclusion/u);
  assert.match(app, /data-chat-conclusion-stream/u);
  assert.match(app, /EQUIPMENT_CORE_RESULT_TYPES\.has\(data\.type\)[\s\S]*streamGeneratedConclusion/u);
  assert.match(app, /streamAssistantCoreConclusion/u);
  assert.match(css, /@media \(max-width: 759px\)[\s\S]*\.chat-core-conclusion \{/u);
});
