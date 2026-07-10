import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexHtml = readFileSync(new URL("../src/app/small-window-ui/index.html", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/small-window-ui/styles.css", import.meta.url), "utf8");

test("small-window settings expose entity alias review controls", () => {
  assert.match(indexHtml, /id="alias-list"/);
  assert.match(indexHtml, /id="export-aliases-button"/);
  assert.match(indexHtml, /id="download-aliases-button"/);
  assert.match(indexHtml, /id="reload-aliases-button"/);
  assert.match(indexHtml, /id="clear-entity-memory-button"/);
  assert.match(indexHtml, /id="alias-state-filter"/);
  assert.match(indexHtml, /id="alias-type-filter"/);
  assert.match(indexHtml, /id="alias-query-filter"/);
  assert.match(indexHtml, /id="alias-select-all"/);
  assert.match(indexHtml, /id="enable-selected-aliases-button"/);
  assert.match(indexHtml, /id="disable-selected-aliases-button"/);
  assert.match(indexHtml, /id="alias-prev-button"/);
  assert.match(indexHtml, /id="alias-next-button"/);
  assert.match(indexHtml, /id="alias-page-label"/);
  assert.match(indexHtml, /id="cache-status"/);
  assert.match(indexHtml, /id="llm-status"/);
  assert.match(indexHtml, /id="runtime-detail"/);
  assert.match(indexHtml, /id="context-strategy-select"/);
  assert.match(indexHtml, /id="structured-parser-mode-select"/);
  assert.match(indexHtml, /value="inherit"/);
  assert.match(indexHtml, /value="never"/);
  assert.match(indexHtml, /value="always"/);
  assert.match(indexHtml, /value="popular"/);
  assert.match(indexHtml, /value="top4"/);
  assert.match(indexHtml, /value="score"/);
  assert.match(indexHtml, /value="avg"/);
  assert.match(appJs, /new URLSearchParams/);
  assert.match(appJs, /state\.aliasOffset/);
  assert.match(appJs, /state\.defaultContextStrategy/);
  assert.match(appJs, /state\.structuredParserMode/);
  assert.match(appJs, /contextStrategySelect/);
  assert.match(appJs, /structuredParserModeSelect/);
  assert.match(appJs, /defaultContextStrategy: state\.defaultContextStrategy/);
  assert.match(appJs, /structuredParserMode: state\.structuredParserMode/);
  assert.match(appJs, /contextStrategyLabel/);
  assert.match(appJs, /前四优先/);
  assert.match(appJs, /loadRuntimeStatus/);
  assert.match(appJs, /\/api\/runtime/);
  assert.match(appJs, /requests\.explorerTimeoutMs/);
  assert.match(appJs, /查询超时/);
  assert.match(appJs, /defaultContextLine/);
  assert.match(appJs, /defaultContextAlternativesLine/);
  assert.match(appJs, /defaultContextCompBuildLine/);
  assert.match(appJs, /formatCacheUpdatedAt/);
  assert.match(appJs, /queryCacheLine/);
  assert.match(appJs, /更新 \$\{updatedAt\}/);
  assert.match(appJs, /data\.cache\?\.query\?\.stale \? "过期缓存"/);
  assert.match(appJs, /defaultContextSummary/);
  assert.match(appJs, /默认阵容/);
  assert.match(appJs, /备选阵容/);
  assert.match(appJs, /阵容装备参考/);
  assert.match(appJs, /pieces\.map\(escapeHtml\)/);
  assert.match(appJs, /params\.set\("query"/);
  assert.match(appJs, /\/api\/entity-aliases\/export\?limit=1000/);
  assert.match(appJs, /\/api\/entity-aliases\/review/);
  assert.match(appJs, /\/api\/entity-aliases\/review-batch/);
  assert.match(appJs, /\/api\/entity-memory\/clear/);
  assert.match(appJs, /clearEntityMemory/);
  assert.match(appJs, /window\.confirm/);
  assert.match(appJs, /downloadAliasDraft/);
  assert.match(appJs, /selectedAliasIds/);
  assert.match(appJs, /escapeHtml/);
  assert.match(appJs, /detailsEl\.open = true/);
  assert.match(styles, /\.alias-row/);
  assert.match(styles, /\.alias-actions/);
  assert.match(styles, /\.alias-batch/);
  assert.match(styles, /\.alias-filters/);
  assert.match(styles, /\.alias-pagination/);
  assert.match(styles, /\.runtime-status/);
  assert.match(styles, /grid-template-columns: 18px 1fr 58px/);
});

test("small-window clarification renders actionable entity candidates", () => {
  assert.match(appJs, /renderEntityCandidates/);
  assert.match(appJs, /data-candidate-action="query"/);
  assert.match(appJs, /data-candidate-action="save"/);
  assert.match(appJs, /saveEntityCandidate/);
  assert.match(appJs, /\/api\/feedback/);
  assert.match(appJs, /feedbackType: "alias_candidate"/);
  assert.match(appJs, /state\.lastEntityCandidates/);
  assert.match(appJs, /escapeHtml\(data\.clarification\.question\)/);
  assert.match(styles, /\.entity-candidates/);
  assert.match(styles, /\.candidate-row/);
  assert.match(styles, /\.candidate-actions/);
});

test("small-window empty results retain the structured query summary", () => {
  assert.match(appJs, /if \(!data\.cards\?\.length\)/);
  assert.match(appJs, /data\.query \? `<div class="summary">\$\{summaryLines\(data\)\}<\/div>`/);
});

test("small-window cards render the sample-risk marker", () => {
  assert.match(appJs, /card\.lowSample \? '<div class="risk">低样本<\/div>'/);
  assert.match(appJs, /query\.excludedItemNames\?\.length/);
  assert.match(appJs, /已排除：\$\{query\.excludedItemNames\.join\(" \+ "\)\}/);
  assert.match(styles, /\.risk/);
});

test("small-window comparison cards distinguish winners and compared items", () => {
  assert.match(appJs, /card\.winner/);
  assert.match(appJs, /item\.compared/);
  assert.match(styles, /\.item\.compared/);
});

test("small-window result cards expose idempotent feedback controls", () => {
  assert.match(appJs, /data-result-feedback="good"/);
  assert.match(appJs, /data-result-feedback="bad"/);
  assert.match(appJs, /sendResultFeedback/);
  assert.match(appJs, /good_recommendation/);
  assert.match(appJs, /bad_recommendation/);
  assert.match(appJs, /state\.lastResultId/);
  assert.match(styles, /\.result-feedback/);
  assert.match(styles, /\.feedback-button/);
});
