import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const ui = (name) => readFileSync(new URL(`../src/app/small-window-ui/${name}`, import.meta.url), "utf8");
const indexHtml = ui("index.html");
const appJs = ui("app.js");
const styles = ui("styles.css");
const i18n = ui("i18n.js");
const appShell = ui("app-shell.js");
const conversation = ui("conversation-pane.js");
const resultPane = ui("result-pane.js");
const patchNotes = ui("patch-notes.js");
const wallpaperController = ui("wallpaper-controller.js");
const wallpaperCatalog = ui("wallpaper-catalog.js");
const privacyHtml = ui("privacy.html");
const termsHtml = ui("terms.html");
const legalCss = ui("legal.css");
const opggPanel = ui("opgg-panel.js");

test("desktop UI exposes the responsive AppShell structure", () => {
  assert.match(indexHtml, /<title>TFTClarity｜云顶数据智答<\/title>/);
  assert.match(indexHtml, /<meta name="description" content="tftclarity 是面向云顶之弈的对话式数据助手/);
  assert.match(indexHtml, /<link rel="icon" type="image\/png" href="\/favicon\.png\?v=20260727">/);
  assert.ok(statSync(new URL("../src/app/small-window-ui/favicon.png", import.meta.url)).size > 0);
  assert.doesNotMatch(indexHtml, />TFTAgent</);
  assert.match(indexHtml, /id="app-shell"/);
  assert.match(indexHtml, /id="title-bar"/);
  assert.match(indexHtml, /id="conversation-pane"/);
  assert.match(indexHtml, /class="conversation" id="result"/);
  assert.match(indexHtml, /id="result-pane"/);
  assert.match(indexHtml, /id="result-content"/);
  assert.doesNotMatch(indexHtml, /id="column-resizer"/);
  assert.match(indexHtml, /id="settings-panel"/);
  assert.match(indexHtml, /class="resize-grip"/);
  assert.match(appJs, /AppShell/);
  assert.match(appJs, /TitleBar/);
  assert.match(appJs, /ConversationPane/);
  assert.match(appJs, /Composer/);
  assert.match(appJs, /ResultPane/);
  assert.match(resultPane, /class RecommendationResult/);
  assert.match(resultPane, /class ItemRankingResult/);
  assert.match(resultPane, /class CompRankingResult/);
  assert.match(conversation, /class ConversationPane/);
  assert.match(conversation, /class Composer/);
});

test("season switching is server-validated, conversation-isolated, and theme-driven", () => {
  assert.match(indexHtml, /id="season-context-select"/);
  assert.match(indexHtml, /id="season-context-summary"/);
  assert.match(indexHtml, /data-season-subtitle-separator/);
  assert.match(appJs, /seasonSubtitleForSummary/);
  assert.match(styles, /\.season-context-control/);
  assert.match(appJs, /fetch\("\/api\/season-contexts"\)/);
  assert.match(appJs, /fetch\("\/api\/season-contexts\/select"/);
  assert.match(appJs, /seasonContextId: state\.seasonContextId/);
  assert.match(appJs, /resetConversation\(\{ previousSeasonContextId/);
  assert.match(appJs, /seasonContextId: previousSeasonContextId/);
  assert.doesNotMatch(appJs, /document\.title\s*=/);
  assert.match(indexHtml, /<title>TFTClarity｜云顶数据智答<\/title>/);
  assert.match(appJs, /wallpaperController\.setSeason/);
  assert.match(appJs, /shellEl\.dataset\.seasonTheme = context\.themeId/);
  assert.match(appJs, /context\.selectable \|\| context\.themePreview/);
  assert.match(appJs, /!requested\?\.selectable && !requested\?\.themePreview/);
  assert.match(appJs, /option\.disabled = !context\.selectable/);
  assert.match(appJs, /theme\?\.patchNoteVersion/);
  assert.match(wallpaperController, /setSeason\(seasonId, defaultWallpaperId/);
  assert.match(wallpaperController, /localStorage\.setItem\(`\$\{WALLPAPER_ID_STORAGE_KEY\}\.\$\{this\.seasonId\}`/);
  assert.match(wallpaperCatalog, /"set-18-pbe"/);
  assert.match(wallpaperCatalog, /set18-verdant-realm/);
  assert.match(styles, /\.shell\[data-season-theme="set18"\]/);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-18/verdant-realm.jpg", import.meta.url)).size > 100_000);
  assert.match(i18n, /seasonComingSoonStatus/);
  assert.match(i18n, /seasonArchivedStatus/);
  assert.match(i18n, /seasonRevivalStatus/);
  assert.match(indexHtml, /id="season-context-notice-close"/);
  assert.match(appJs, /sessionStorage\.setItem\(`\$\{SEASON_NOTICE_DISMISSED_STORAGE_KEY\}\.\$\{seasonContextId\}`/);
  assert.match(appJs, /seasonContextNoticeClose\?\.addEventListener\("click"/);
  assert.match(i18n, /closeSeasonNotice/);
});

test("welcome view exposes categorized, localized, actionable quick tasks", () => {
  assert.match(indexHtml, /class="quick-tasks"/);
  assert.equal((indexHtml.match(/class="quick-category-card/g) ?? []).length, 4);
  assert.match(indexHtml, /data-quick-category="equipment"/);
  assert.match(indexHtml, /data-quick-category="comps"/);
  assert.match(indexHtml, /data-quick-category="library"/);
  assert.match(indexHtml, /data-quick-category="news"/);
  assert.match(appJs, /const QUICK_TASK_CATEGORIES/);
  assert.match(appJs, /const QUICK_TASKS/);
  assert.equal((appJs.match(/category: "comps"/g) ?? []).length, 3);
  assert.match(appJs, /id: "comp-rankings"/);
  assert.match(appJs, /id: "comp-trends"/);
  assert.match(appJs, /id: "hero-comps"/);
  assert.match(appJs, /formFields: \["champion"\]/);
  assert.match(appJs, /queryTemplateKey: "quickTaskBuildTemplate"/);
  assert.match(appJs, /formFields: \["champion", "item1", "item2Optional"\]/);
  assert.match(appJs, /optionalQueryTemplateKey: "quickTaskCompletionWithSecondTemplate"/);
  assert.match(appJs, /formFields: \["champion", "itemCategory"\]/);
  assert.match(i18n, /quickTaskPerformanceTitle: "单装备排行榜"/);
  assert.match(i18n, /quickFieldItemCategoryPlaceholder: "输入神器、普通或纹章"/);
  assert.match(appJs, /formFields: \["champion", "comparisonItem1", "item2"\]/);
  assert.match(appJs, /queryTemplateKey: "quickTaskCarriersTemplate"/);
  assert.match(indexHtml, /id="quick-task-form"/);
  assert.match(indexHtml, /id="quick-task-fields"/);
  assert.doesNotMatch(indexHtml, /quick-task-supplemental/);
  assert.doesNotMatch(appJs, /quickTaskSupplemental/);
  assert.doesNotMatch(i18n, /quickFieldSupplemental/);
  assert.match(appJs, /function openQuickTaskForm\(task\)/);
  assert.match(appJs, /function submitQuickTaskForm\(\)/);
  assert.match(appJs, /startNewTask: true/);
  assert.doesNotMatch(appJs, /unresolvedQuickTaskPlaceholder/);
  assert.doesNotMatch(i18n, /【英雄名称】|\[champion name\]/);
  assert.match(i18n, /quickTaskCompletionTitle: "条件查询"/);
  assert.match(i18n, /quickTaskCarriersTitle: "神器\/装备定阵"/);
  assert.doesNotMatch(i18n, /霞|Xayah/);
  assert.match(appJs, /quickTasksHtml/);
  assert.match(appJs, /button\[data-quick-category\]/);
  assert.match(appJs, /button\[data-quick-task\]/);
  assert.doesNotMatch(appJs, /collapseQuickTaskCategories\(quickTaskButton\.closest\("\.quick-tasks"\)\)/);
  assert.doesNotMatch(indexHtml, /class="composer-feature-shortcuts"/);
  assert.match(appJs, /const NATURAL_LANGUAGE_QUICK_TASK_RULES/);
  assert.match(appJs, /function naturalLanguageQuickTaskId\(input\)/);
  assert.match(appJs, /async function routeNaturalLanguageQuickTask\(input\)/);
  assert.match(appJs, /routeNaturalLanguageQuickTask\(queryInput\.value\)/);
  assert.match(appJs, /id: "opgg-personal-review"[\s\S]*\\u6211\\u8981/);
  assert.match(appJs, /id: "opgg-pro-trends"[\s\S]*\\u804c\\u4e1a\\u9635\\u5bb9\\u8d8b\\u52bf/);
  assert.match(appJs, /id: "opgg-pro-teaching"[\s\S]*\\u804c\\u4e1a\\u9009\\u624b/);
  assert.match(appJs, /id: "patch-notes"[\s\S]*\\u66f4\\u65b0\\u516c\\u544a/);
  assert.match(appJs, /async function launchQuickTask\(quickTaskTarget\)/);
  assert.match(appJs, /QUICK_TASKS\.find/);
  assert.match(appJs, /queryInput\.value = quickTask\.query/);
  assert.match(appJs, /structuredQuickTask\(quickTask\)/);
  assert.match(appJs, /schemaVersion: "quick-task\.v1"/);
  assert.match(appJs, /operation: "unit_build_rankings"/);
  assert.match(appJs, /quickTask: state\.lastQuickTask/);
  assert.match(i18n, /快捷查询可跳过语义理解，通常返回更快/);
  assert.match(appJs, /startNewTask: true/);
  assert.match(appJs, /state\.lastDisplayInput/);
  assert.match(appJs, /renderPatchNote/);
  assert.match(patchNotes, /CURRENT_PATCH_VERSION = "17\.8"/);
  assert.match(patchNotes, /publishedAt: "2026-07-28T18:00:00\.000Z"/);
  assert.match(patchNotes, /teamfight-tactics-patch-17-8/);
  assert.match(patchNotes, /teamfighttactics\.leagueoflegends\.com/);
  assert.match(styles, /\.patch-note-grid/);
  assert.match(styles, /\.patch-note-source/);
  assert.match(styles, /\.quick-category-grid/);
  assert.match(styles, /\.quick-category-card/);
  assert.match(styles, /\.quick-task-panel/);
  assert.match(styles, /\.quick-task-card/);
  assert.match(styles, /\.quick-task-form/);
  assert.match(styles, /min-height: 54px/);
  assert.match(styles, /var\(--wallpaper-accent\)/);
  assert.match(styles, /\.composer-actions \.send-button[\s\S]*var\(--wallpaper-accent\)[\s\S]*var\(--wallpaper-accent-secondary\)/);
  assert.match(styles, /\.conversation-pane[\s\S]*border-right: 1px solid color-mix\(in srgb, var\(--wallpaper-accent\) 18%, transparent\)/);
  assert.match(styles, /\.topbar[\s\S]*color-mix\(in srgb, var\(--wallpaper-accent\)[\s\S]*var\(--wallpaper-accent-secondary\)/);
  assert.match(wallpaperCatalog, /accentSecondary/);
  assert.match(wallpaperController, /--wallpaper-accent-secondary/);
});

test("feature-flagged chat routing keeps quick tools on recommend and normal chat on ReAct", () => {
  assert.match(appJs, /state\.runtimeStatus\?\.routing\?\.reactChatEnabled/);
  assert.match(appJs, /state\.lastQuickTask \|\| !reactChatEnabled/);
  assert.match(appJs, /"\/api\/recommend\/stream"/);
  assert.match(appJs, /"\/api\/react-chat\/stream"/);
  assert.match(appJs, /conversationId: state\.conversationId/);
  assert.match(appJs, /seasonContextId: state\.seasonContextId/);
  assert.match(appJs, /messages: reactChatMessages\(\)/);
  assert.match(appJs, /event\.type === "diagnostic"/);
});

test("OP.GG review views use the result pane and preserve navigation context", () => {
  assert.match(opggPanel, /const resultEl = el\("result-content"\)/u);
  assert.doesNotMatch(opggPanel, /const resultEl = el\("result"\)/u);
  assert.match(opggPanel, /backLink\("返回选手", "player", \{ player: state\.playerId \}\)/u);
  assert.match(opggPanel, /unit\.displayName \?\? unit\.characterId/u);
  assert.match(opggPanel, /unit\.cost \?\? "\?"/u);
  assert.match(opggPanel, /itemDisplayNames/u);
  assert.doesNotMatch(opggPanel, /<option value="kr">/u);
  assert.doesNotMatch(opggPanel, /OP\.GG 风格评论/u);
  assert.match(opggPanel, /AI 正在分析对局风格/u);
  assert.match(opggPanel, /AI 智能复盘/u);
  assert.match(opggPanel, /unitBoardHtml/u);
  assert.match(opggPanel, /observedEighthRate/u);
  assert.match(opggPanel, /pool: PERSONAL_POOL/u);
  assert.match(opggPanel, /cancel-teaching/u);
});

test("assistant messages use the Tangyuan penguin brand mark", () => {
  assert.match(indexHtml, /class="assistant-avatar"[^>]*><img src="\/favicon\.png\?v=20260727"/u);
  assert.match(conversation, /class="assistant-avatar"[^>]*><img src="\/favicon\.png\?v=20260727"/u);
  assert.match(styles, /\.assistant-avatar img \{/u);
});

test("mobile result toolbar uses one consistent control system", () => {
  assert.match(indexHtml, /class="result-heading-main"/u);
  assert.match(styles, /\.language-toggle\.top-language-toggle \{ display: none; \}/u);
  assert.match(styles, /\.mobile-result-back, \.result-heading \.subtle-button \{[^}]*height: 38px[^}]*border-radius: 11px/u);
});

test("composer keeps one refresh action and a distinct accessible clear action", () => {
  assert.doesNotMatch(indexHtml, /id="retry-button"/u);
  assert.match(indexHtml, /id="refresh-button"[^>]*data-i18n-aria="refreshTitle"[\s\S]*?<svg class="compact-action-icon"/u);
  assert.match(indexHtml, /id="clear-button"[^>]*data-i18n-aria="clearTitle"[\s\S]*?<svg class="compact-action-icon"/u);
  assert.doesNotMatch(appJs, /querySelector\("#retry-button"\)/u);
  assert.doesNotMatch(indexHtml, /id="clear-button"[^>]*>[\s\S]*?⌫/u);
  assert.match(styles, /\.compact-action-icon \{[^}]*stroke-width: 2/u);
  assert.match(styles, /#refresh-button:not\(:disabled\)/u);
  assert.match(styles, /#clear-button \{/u);
});

test("mobile special-item questions receive a query-specific chat conclusion", () => {
  assert.match(appJs, /function isSpecialItemRanking\(data\)/u);
  assert.match(appJs, /function specialItemRankingConclusionText\(data\)/u);
  assert.match(appJs, /chatCoreConclusionText\(data\)/u);
  assert.match(i18n, /chatSpecialRankingWithItems/u);
  assert.match(i18n, /特殊装备按样本等级与表现分展示/u);
});

test("public UI exposes a visible, localized Riot fan-project notice", () => {
  assert.match(indexHtml, /class="site-legal-footer"/);
  assert.match(indexHtml, /class="settings-section legal-notice"/);
  assert.match(indexHtml, /tftclarity isn't endorsed by Riot Games/);
  assert.match(indexHtml, /https:\/\/www\.riotgames\.com\/en\/legal/);
  assert.match(indexHtml, /https:\/\/developer\.riotgames\.com\/policies\/general/);
  assert.match(i18n, /legalNoticeSummary/);
  assert.match(i18n, /legalFooterSummary/);
  assert.match(styles, /\.site-legal-footer/);
  assert.match(styles, /\.legal-notice/);
});

test("public legal pages and persistent Riot notice are visible and linked", () => {
  assert.match(indexHtml, /class="site-legal-footer"/);
  assert.match(indexHtml, /href="\/privacy"/);
  assert.match(indexHtml, /href="\/terms"/);
  assert.match(indexHtml, /tftclarity isn't endorsed by Riot Games/);
  assert.match(privacyHtml, /<h1>Privacy Policy<\/h1>/);
  assert.match(privacyHtml, /tft_visitor/);
  assert.match(privacyHtml, /up to 30 days/);
  assert.match(privacyHtml, /mailto:tftclarity@outlook\.com/);
  assert.match(termsHtml, /<h1>Terms of Service<\/h1>/);
  assert.match(termsHtml, /Game-integrity boundaries/);
  assert.match(termsHtml, /does not use Riot Sign On/);
  assert.match(termsHtml, /mailto:tftclarity@outlook\.com/);
  assert.doesNotMatch(`${privacyHtml}\n${termsHtml}`, /longyuyanchen@(qq|gmail)\.com/);
  assert.match(legalCss, /@media \(max-width: 620px\)/);
});

test("small-window maintenance exposes a separate filterable item catalog audit", () => {
  assert.match(indexHtml, /id="open-item-audit-button"/);
  assert.match(indexHtml, /id="item-audit-panel"/);
  assert.match(indexHtml, /id="item-audit-query"/);
  assert.match(indexHtml, /id="item-audit-patch"/);
  assert.match(indexHtml, /id="item-audit-source"/);
  assert.match(indexHtml, /id="item-audit-category"/);
  assert.match(indexHtml, /id="item-audit-status"/);
  assert.match(indexHtml, /id="item-audit-availability"/);
  assert.match(indexHtml, /id="item-audit-issues"/);
  assert.match(indexHtml, /id="item-audit-export-json"/);
  assert.match(indexHtml, /id="item-audit-export-csv"/);
  assert.match(appJs, /\/api\/item-catalog-audit/);
  assert.match(appJs, /loadItemAudit\(\{ refresh: true \}\)/);
  assert.match(appJs, /appShell\.settings\.setOpen\(false\)/);
  assert.doesNotMatch(appJs, /setSettingsOpen\(/);
  assert.match(appJs, /metric\(t\("winShort"\)/);
  assert.match(appJs, /renderItemAudit/);
  assert.match(appJs, /downloadText/);
  assert.match(styles, /\.maintenance-panel/);
  assert.match(styles, /\.audit-row/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /@media \(max-width: 400px\)/);
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

test("system interactions render inline without a details button or evidence panel", () => {
  assert.match(appJs, /function systemInteractionAnswerHtml\(data\)/);
  assert.match(appJs, /data\?\.type === "system_interaction"/);
  assert.match(appJs, /function renderSystemInteractionResult\(data\)/);
  assert.match(appJs, /if \(data\.type === "system_interaction"\) renderSystemInteractionResult\(data\)/);
  assert.match(styles, /\.system-interaction-answer/);
  assert.match(styles, /\.system-interaction-card/);
  assert.match(appJs, /if \(!evidence\.length\) return ""/);
});

test("responsive layout supports three, two, single, and compact modes without a 460px cap", () => {
  assert.doesNotMatch(styles, /width:\s*min\(100%,\s*460px\)/);
  assert.match(styles, /grid-template-columns:\s*clamp\(320px, var\(--conversation-width\), 520px\) minmax\(360px, 1fr\)/);
  assert.match(styles, /@media \(max-width: 1099px\)/);
  assert.match(styles, /@media \(max-width: 759px\)/);
  assert.match(styles, /@media \(max-width: 519px\)/);
  assert.match(styles, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /overflow-x:\s*hidden/);
  assert.doesNotMatch(appShell, /ColumnResizer/);
  assert.doesNotMatch(styles, /\.column-resizer/);
  assert.match(styles, /\.result-empty \.state-orbit \{[^}]*background: transparent/);
});

test("language switching uses independent dictionaries and does not issue API requests", () => {
  assert.match(indexHtml, /data-locale="zh-CN"/);
  assert.match(indexHtml, /data-locale="en-US"/);
  assert.match(i18n, /"zh-CN"/);
  assert.match(i18n, /"en-US"/);
  assert.match(i18n, /tftagent\.locale/);
  assert.match(i18n, /localizedName/);
  assert.match(i18n, /Intl\.NumberFormat/);
  assert.doesNotMatch(i18n, /fetch\(/);
  assert.match(appJs, /setLocale\(locale\)/);
  assert.match(appJs, /rerenderLocalizedState/);
  assert.doesNotMatch(appJs, /[\u4e00-\u9fff]/);
});

test("small-window cards render the sample-risk marker", () => {
  assert.match(appJs, /card\.lowSample/);
  assert.match(appJs, /query\.excludedItemNames/);
  assert.match(appJs, /excludedSummary/);
  assert.match(styles, /\.risk/);
});

test("small-window defaults to an explained performance-role recommendation", () => {
  assert.match(indexHtml, /value="robust_first"[^>]*selected/);
  assert.match(appJs, /sort: "robust_first"/);
  assert.match(appJs, /card\.ranking\?\.method === "performance_role_v4"/);
  assert.match(appJs, /applicabilityRecommendation/);
  assert.match(i18n, /主流方案/);
  assert.match(i18n, /表现分/);
  assert.match(styles, /\.ranking-insight-badges/);
  assert.match(styles, /\.ranking-rationale/);
});

test("UI-07 renders deterministic build options independently from grounded narrative", () => {
  assert.match(appJs, /entry\.buildOptions/);
  assert.match(appJs, /grounded-build-narrative\.v1/);
  assert.match(appJs, /data-build-option-id/);
  assert.match(appJs, /index === 0 \? "open"/);
  assert.match(appJs, /buildOptionsShortage/);
  assert.match(appJs, /narrativeByOption\.get\(option\.optionId\)/);
  assert.match(appJs, /item_details_batch/);
  assert.match(appJs, /mechanismDifference/);
  assert.match(appJs, /mechanism_based_advice/);
  assert.match(appJs, /currentSeasonMechanismMissing/);
  assert.match(appJs, /data-build-core-items/);
  assert.match(appJs, /coreItemSummary/);
  assert.match(appJs, /buildNarrativeNotProvided/);
  assert.match(appJs, /data-build-narrative-warning/);
  assert.match(appJs, /buildNarrativeWarningText/);
  assert.match(appJs, /buildRecommendationOverview/);
  assert.match(appJs, /buildRecommendationDecisionSummary/);
  assert.match(appJs, /buildRecommendationMetricLead/);
  assert.match(appJs, /buildRecommendationSampleTradeoff/);
  assert.match(appJs, /buildItemCopies/);
  assert.match(appJs, /data-build-knowledge-signal/);
  assert.match(appJs, /buildKnowledgeSummary/);
  assert.match(appJs, /"season_context", "patch", "queue", "star_level"/);
  assert.match(appJs, /conditionEditHint/);
  assert.match(appJs, /queryInput\.value = t\("editCondition"[\s\S]*setMobileView\("chat"\)/);
  assert.match(appJs, /resultHeader\(t\("recommendation"\), buildOverviewText, t\("recommendation"\)\)[\s\S]*conditionPanel\(data\)[\s\S]*build-options-ranking/);
  assert.match(appJs, /resultHeader\(t\("recommendation"\), buildOverviewText, t\("recommendation"\)\)/);
  assert.match(appJs, /build-narrative-technical/);
  assert.match(appJs, /build-model-summary/);
  assert.match(appJs, /maximumFractionDigits: 1/);
  assert.match(appJs, /t\("updated"\)/);
  assert.doesNotMatch(appJs, /buildNarrativeUnavailable/);
  assert.match(styles, /\.build-option-card/);
  assert.match(styles, /\.build-core-items/);
  assert.match(styles, /\.mechanism-inference-badge/);
  assert.match(styles, /\.build-option-card:not\(\[open\]\)/);
  assert.match(styles, /\.build-narrative-technical/);
  assert.match(styles, /\.build-model-summary/);
  assert.match(styles, /\.condition-panel-head/);
  assert.match(i18n, /仅有 \{value\} 套满足当前样本门槛/);
  assert.match(i18n, /Only \{value\} builds meet the current sample threshold/);
  assert.match(i18n, /基于装备机制推断/);
  assert.match(i18n, /缺少当前赛季装备机制证据/);
});

test("ReAct build metrics wrap inside their card instead of overflowing the result pane", () => {
  assert.match(styles, /\.build-option-card \{[^}]*min-width: 0;[^}]*max-width: 100%/);
  assert.match(styles, /\.build-option-summary \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.build-option-detail \.stats \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(150px, 100%\), 1fr\)\)/);
});

test("small-window comparison cards distinguish winners and compared items", () => {
  assert.match(appJs, /card\.winner/);
  assert.match(appJs, /item\.compared/);
  assert.match(styles, /\.item\.compared/);
});

test("small-window renders dedicated responsive item comparison evidence", () => {
  assert.match(appJs, /data\.type === "unit_item_comparison"/);
  assert.match(appJs, /renderItemComparison/);
  assert.match(appJs, /comparison\.primaryMetric/);
  assert.match(appJs, /comparisonOverlap/);
  assert.match(appJs, /commonFullBuild/);
  assert.match(styles, /\.comparison-grid-two/);
  assert.match(styles, /@media \(min-width: 401px\) and \(max-width: 520px\)/);
  assert.match(styles, /@media \(max-width: 400px\)/);
  assert.match(styles, /grid-template-columns: 1fr/);
});

test("LLM static evidence used by a conclusion is expandable in the UI", () => {
  assert.match(appJs, /conclusion\.supportingEvidence/);
  assert.match(appJs, /conclusion-supporting-evidence/);
  assert.match(appJs, /t\("staticEvidence"\)/);
  assert.match(styles, /\.conclusion-supporting-evidence/);
  assert.match(i18n, /可展开的静态证据/);
  assert.match(i18n, /Expandable static evidence/);
});

test("small-window renders unit and trait encyclopedia result types", () => {
  assert.match(appJs, /function renderUnitDetails/);
  assert.match(appJs, /function renderTraitDetails/);
  assert.match(appJs, /data\.type === "unit_details"/);
  assert.match(appJs, /data\.type === "trait_details"/);
  assert.match(appJs, /stableItemRecommendations/);
  assert.match(styles, /\.entity-stat-grid/);
  assert.match(styles, /\.ability-card/);
  assert.match(styles, /\.stable-item-grid/);
  assert.match(styles, /\.trait-level-list/);
  assert.match(i18n, /recommendationMethod/);
});

test("mechanism cards expand to source text and disclose unresolved model omissions", () => {
  assert.match(appJs, /<details class="knowledge-card mechanism-classification-card"/u);
  assert.match(appJs, /entry\.originalDescription/u);
  assert.match(appJs, /entry\.originalLevels/u);
  assert.match(appJs, /classificationMeta\?\.incompleteEntities/u);
  assert.match(appJs, /mechanismIncomplete/u);
  assert.match(styles, /\.mechanism-original-text/u);
  assert.match(styles, /\.mechanism-incomplete-warning/u);
});

test("season wallpapers are catalogued, switchable, glass-backed, and idle-aware", () => {
  assert.match(indexHtml, /id="wallpaper-toggle"/);
  assert.match(indexHtml, /role="switch"/);
  assert.match(indexHtml, /id="wallpaper-select"/);
  assert.match(indexHtml, /id="wallpaper-mobile-button"/);
  assert.match(indexHtml, /id="wallpaper-mobile-menu"/);
  assert.match(indexHtml, /id="wallpaper-mobile-options"/);
  assert.match(indexHtml, /id="particle-layer"/);
  assert.match(indexHtml, /id="topbar-starfield"/);
  assert.match(appJs, /WallpaperController/);
  assert.match(wallpaperCatalog, /"set-17"/);
  assert.match(wallpaperCatalog, /cosmic-court\.jpg/);
  assert.match(wallpaperCatalog, /stargazer-convergence\.[a-f0-9]{12}\.webp/);
  assert.match(wallpaperCatalog, /yasuo\.[a-f0-9]{12}\.webp/);
  assert.match(wallpaperCatalog, /soraka\.jpg/);
  assert.match(wallpaperCatalog, /thumbUrl/);
  assert.match(wallpaperCatalog, /focusSize: "cover"/);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/cosmic-court.jpg", import.meta.url)).size > 100_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/stargazer-convergence.png", import.meta.url)).size > 100_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/yasuo.png", import.meta.url)).size > 100_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/soraka.jpg", import.meta.url)).size > 100_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/stargazer-convergence.d9a32361f3ae.webp", import.meta.url)).size < 500_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/yasuo.ae30569d178b.webp", import.meta.url)).size < 300_000);
  for (const thumbnail of [
    "cosmic-court.thumb.f8bac1dea835.webp",
    "stargazer-convergence.thumb.d7b5ce4d3531.webp",
    "yasuo.thumb.15fb81e7d07a.webp",
    "soraka.thumb.f4d7362f79f0.webp"
  ]) {
    assert.ok(statSync(new URL(`../src/app/small-window-ui/assets/wallpapers/set-17/${thumbnail}`, import.meta.url)).size < 100_000);
  }
  assert.match(wallpaperController, /tftagent\.wallpaperEnabled/);
  assert.match(wallpaperController, /tftagent\.wallpaperId/);
  assert.match(wallpaperController, /populateMobileOptions/);
  assert.match(wallpaperController, /loadMobileThumbnails/);
  assert.match(wallpaperController, /dataset\.wallpaperThumb/);
  assert.match(wallpaperController, /setMobileMenuOpen/);
  assert.match(wallpaperController, /data-wallpaper-id/);
  assert.match(wallpaperController, /mobileToggle\.setAttribute\("aria-checked"/);
  assert.match(wallpaperController, /WALLPAPER_IDLE_MS = 7000/);
  assert.match(wallpaperController, /document\.addEventListener\("keydown"/);
  assert.match(wallpaperController, /document\.addEventListener\("mousemove"/);
  assert.match(wallpaperController, /document\.addEventListener\("click"/);
  assert.match(wallpaperController, /setTimeout\(\(\) => this\.enterIdleMode\(\), this\.idleMs\)/);
  assert.match(wallpaperController, /requestAnimationFrame/);
  assert.match(wallpaperController, /Math\.min\(130/);
  assert.match(wallpaperController, /globalCompositeOperation = "lighter"/);
  assert.match(styles, /\.shell\.wallpaper-enabled \.wallpaper-layer/);
  assert.match(styles, /\.shell\.wallpaper-enabled \.topbar-starfield/);
  assert.match(styles, /@keyframes topbar-stars-drift/);
  assert.match(styles, /@keyframes topbar-stars-twinkle/);
  assert.match(appJs, /target-star-badge/);
  assert.match(appJs, /data-fallback-src/);
  assert.match(styles, /\.target-star-badge/);
  assert.match(styles, /var\(--wallpaper-focus-size, cover\)/);
  assert.doesNotMatch(styles, /\.wallpaper-layer::after/);
  assert.doesNotMatch(wallpaperController, /wallpaper-focus-opacity/);
  assert.match(styles, /opacity: \.94/);
  assert.match(styles, /background: rgba\(248,250,255,\.12\)/);
  assert.match(styles, /backdrop-filter: none/);
  assert.match(styles, /backdrop-filter: blur\(4px\)/);
  assert.match(styles, /\.shell\.wallpaper-enabled \.assistant-message \.message-body/);
  assert.match(styles, /\.shell\.wallpaper-enabled \.result-card/);
  assert.match(styles, /\.shell\.wallpaper-enabled \.result-empty strong/);
  assert.match(styles, /\.shell\.wallpaper-enabled \.message-meta time/);
  assert.match(styles, /\.wallpaper-mobile-menu/);
  assert.match(styles, /\.wallpaper-mobile-options/);
  assert.match(styles, /\.wallpaper-mobile-option\.active/);
  assert.match(styles, /@media \(max-width: 1099px\) \{[\s\S]*\.wallpaper-toggle, \.wallpaper-select \{ display: none; \}/);
  assert.match(styles, /font-variant-numeric: tabular-nums/);
  assert.match(styles, /text-shadow: 0 1px 2px rgba\(255,255,255,1\), 0 0 4px rgba\(255,255,255,\.96\)/);
  assert.doesNotMatch(indexHtml, /class="window-controls"/);
});

test("all existing real interactions and endpoints remain wired", () => {
  for (const endpoint of [
    "/api/recommend", "/api/preferences", "/api/runtime", "/api/feedback",
    "/api/entity-aliases", "/api/entity-aliases/review", "/api/entity-aliases/review-batch",
    "/api/entity-memory/clear", "/api/cache/clear", "/api/session/clear"
  ]) assert.ok(appJs.includes(endpoint), `missing ${endpoint}`);
  assert.match(appJs, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(appJs, /state\.currentController\?\.abort/);
  assert.match(appJs, /conversationId/);
  assert.match(appJs, /data-result-feedback="good"/);
  assert.match(appJs, /data-result-feedback="bad"/);
  assert.match(appJs, /data-candidate-action="query"/);
  assert.match(appJs, /data-candidate-action="save"/);
  assert.match(appJs, /data-condition-key/);
});

test("request lifecycle isolates refreshes, retries, clears, and stale abort completions", () => {
  assert.match(appJs, /const reuseLastInput = refresh \|\| normalizedRequestOptions\.reuseLastInput === true/);
  assert.match(appJs, /const input = reuseLastInput \? state\.lastInput : queryInput\.value\.trim\(\)/);
  assert.match(appJs, /if \(!reuseLastInput\) composer\.clear\(\)/);
  assert.match(appJs, /requestRecommendation\(false, null, \{ reuseLastInput: true \}\)/);
  assert.match(appJs, /const requestId = \+\+state\.requestSerial/);
  assert.match(appJs, /if \(requestId !== state\.requestSerial\) return/);
  assert.match(appJs, /state\.requestSerial \+= 1/);
  assert.match(appJs, /state\.currentController\?\.abort\(\)/);
  assert.match(appJs, /renderEmptyResult\(\)/);
});

test("localized view state and historical clarification actions keep stable response context", () => {
  assert.match(appJs, /resultView: \{ type: "empty" \}/);
  assert.match(appJs, /state\.resultView\.type === "loading"/);
  assert.match(appJs, /activeResponseEl\.innerHTML = recommendationProgressHtml/);
  assert.match(appJs, /data-response-id=/);
  assert.match(appJs, /state\.responsesById\.get\(candidateButton\.dataset\.responseId\)/);
  assert.match(appJs, /state\.responsesById\.get\(suggestionButton\.dataset\.responseId\)/);
  assert.match(appJs, /t\("editCondition"/);
  assert.match(i18n, /completedItems:/);
  assert.match(i18n, /noStableCompLine:/);
});

test("result templates cover recommendations, item rankings, comps, risks, and explicit states", () => {
  assert.match(appJs, /function renderRecommendationResult/);
  assert.match(appJs, /function renderItemRankings/);
  assert.match(appJs, /const ITEM_RANKING_DISPLAY_LIMIT = 10/);
  assert.match(appJs, /const MIXED_ITEM_RANKING_DISPLAY_LIMIT = 30/);
  assert.match(appJs, /rankings\.slice\(0, itemRankingDisplayLimit\(data\)\)/);
  assert.match(appJs, /data-item-ranking-mix-toggle/);
  assert.match(appJs, /MIXED_ITEM_CATEGORY_QUERY_VALUE = "\\u666e\\u901a/);
  assert.match(styles, /\.performance-tier-high/);
  assert.match(styles, /\.performance-tier-low/);
  assert.match(styles, /\.item-ranking-mode-control/);
  assert.match(appJs, /function renderCompRankings/);
  assert.match(appJs, /renderCompCards\(rising, "trend"\)/);
  assert.match(appJs, /data-comp-metric=/);
  assert.match(appJs, /renderCompCards\(falling, "trendDown"\)/);
  assert.match(appJs, /class="contested-label"/);
  assert.match(appJs, /winShareHighest/);
  assert.match(appJs, /class="best-label"/);
  assert.match(appJs, /class="alternatives"/);
  assert.match(appJs, /card\.lowSample/);
  assert.match(appJs, /item\.locked/);
  assert.match(appJs, /item\.compared/);
  assert.match(appJs, /card\.difference/);
  assert.match(appJs, /class="source-risk"/);
  assert.match(appJs, /class="condition-panel"/);
  assert.match(appJs, /class="clarification-state"/);
  assert.match(appJs, /class="empty-state"/);
  assert.match(appJs, /data-state="error"/);
  assert.match(appJs, /data-state="loading"/);
  assert.match(appJs, /<details class="comp-card"/);
  assert.match(styles, /\.result-card\.best/);
  assert.match(styles, /\.low-sample-section/);
  assert.match(styles, /\.comp-metric-switch/);
  assert.match(styles, /\.falling-section/);
  assert.match(styles, /\.unit-row \{ padding-top: 7px; align-items: flex-start; \}/);
  assert.match(styles, /\.full-unit-grid \.comp-unit\.has-star-target \{ margin-top: 7px; \}/);
});

test("comp units are keyboard-accessible shortcuts for explicit high-sample build queries", () => {
  assert.match(appJs, /const COMP_UNIT_QUERY_MIN_SAMPLES = 500/);
  assert.match(appJs, /function compSignature\(comp\)/);
  assert.match(appJs, /data-comp-signature=/);
  assert.match(appJs, /data-comp-unit-query/);
  assert.match(appJs, /role="button"/);
  assert.match(appJs, /targetStarLevel === 3 \? 3 : 2/);
  assert.match(appJs, /Comp: \$\{signature\}/);
  assert.match(appJs, /\\u4e09\\u4ef6\\u666e\\u901a\\u88c5\\u5907, \\u6837\\u672c>=\$\{COMP_UNIT_QUERY_MIN_SAMPLES\}/);
  assert.match(appJs, /requestCompUnitRecommendation/);
  assert.match(appJs, /\["Enter", " "\]/);
  assert.match(styles, /\.comp-unit-query:hover/);
  assert.match(styles, /\.comp-unit-query:focus-visible/);
  assert.match(i18n, /compUnitQueryDisplay/);
});

test("small-window exposes current-set entity catalogs with direct detail navigation", () => {
  assert.match(appJs, /id: "unit-catalog"/);
  assert.match(appJs, /id: "trait-catalog"/);
  assert.match(appJs, /task\.query \|\| task\.queryKey \|\| task\.view \|\| task\.formFields/);
  assert.match(appJs, /data-entity-catalog/);
  assert.match(appJs, /data-entity-detail/);
  assert.match(appJs, /\/api\/entity-details/);
  assert.match(appJs, /function restorePreviousCatalogResult\(\)/);
  assert.match(appJs, /data-return-catalog/);
  assert.match(styles, /\.entity-catalog-grid/);
  assert.match(styles, /\.entity-catalog-card/);
  assert.match(styles, /\.entity-catalog-empty\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(styles, /\.sr-only\s*\{[\s\S]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  assert.match(appJs, /class="entity-catalog-control entity-catalog-search"/);
  assert.match(appJs, /class="entity-catalog-control entity-catalog-filter"/);
  assert.match(styles, /\.entity-catalog-controls select\s*\{[\s\S]*appearance:\s*none/);
  assert.match(i18n, /unitCatalog:/);
  assert.match(i18n, /traitCatalog:/);
  assert.match(i18n, /backToCatalog:/);
});

test("comp cards lazy-load verified formation and augment details", () => {
  assert.match(appJs, /function compDetailDescriptor\(comp\)/);
  assert.ok(appJs.includes('.filter((apiName) => /^(?:TFT|DA_)[\\w-]+$/i.test(apiName))'));
  assert.match(appJs, /comp: descriptor\.compId/);
  assert.match(appJs, /clusterId: descriptor\.dataClusterId/);
  assert.match(appJs, /units: descriptor\.units\.join\(","\)/);
  assert.match(appJs, /units\.join\(","\)\]\.join\("\|"\)/);
  assert.match(appJs, /const detailDataAttribute = detailDescriptor \? `data-comp-detail-key=/);
  assert.match(appJs, /<details class="comp-card"[\s\S]*?\$\{detailDataAttribute\}/);
  assert.match(appJs, /\[data-comp-detail\]\[data-comp-detail-key\]/);
  assert.match(appJs, /function positionedFormationUnits/);
  assert.match(appJs, /const metaTftCellIndex/);
  assert.match(appJs, /\(3 - Math\.floor\(\(number - 1\) \/ 7\)\) \* 7 \+ \(\(number - 1\) % 7\)/);
  const metaTftVisualCell = (number) => (3 - Math.floor((number - 1) / 7)) * 7 + ((number - 1) % 7);
  assert.deepEqual([1, 7, 8, 22, 28].map(metaTftVisualCell), [21, 27, 14, 0, 6]);
  assert.match(appJs, /Array\.from\(\{ length: 28 \}/);
  assert.match(appJs, /resultContentEl\.addEventListener\("toggle"/);
  assert.match(appJs, /let firstCompCard = true/);
  assert.match(appJs, /const initiallyOpen = firstCompCard/);
  assert.match(appJs, /compDetailRequests: new Map\(\)/);
  assert.match(appJs, /function clearCompDetailState/);
  assert.match(appJs, /state\.compDetailCache\.clear\(\)/);
  assert.match(appJs, /state\.compDetailRequests\.clear\(\)/);
  assert.match(appJs, /function augmentCompatibilityTier/);
  assert.match(appJs, /\^\[SABCD\]\$/);
  assert.match(appJs, /function augmentRarity\(entry\)/);
  assert.match(appJs, /const DISPLAYED_COMP_AUGMENT_RARITIES = new Set\(\["gold", "prismatic"\]\)/);
  assert.match(appJs, /const DISPLAYED_COMP_AUGMENT_LIMIT = 6/);
  assert.match(appJs, /DISPLAYED_COMP_AUGMENT_RARITIES\.has\(augmentRarity\(entry\)\)/);
  assert.match(appJs, /entry\.enName \?\? entry\.name \?\? localizedName\(entry, entry\.apiName\)/);
  assert.match(styles, /\.comp-hex-board/);
  assert.match(styles, /\.comp-hex-cell/);
  assert.match(styles, /\.comp-augment-chip/);
  assert.match(styles, /\.comp-augment-list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.comp-augment-tier\[data-tier="S"\]/);
  assert.match(styles, /\.comp-augment-tier\[data-tier="D"\]/);
  assert.match(i18n, /compDetailLoading:/);
  assert.match(i18n, /compFormation:/);
  assert.match(i18n, /augmentCompatibilityTier:/);
  assert.match(appJs, /data\.type === "composition_tactical_details"/);
  assert.match(appJs, /react-comp-tactical-detail/);
  assert.match(appJs, /"composition_tactical_details"/);
  assert.doesNotMatch(appJs, /tactical-result-header/);
});

test("comp unit drill-down preserves and restores the previous comp result", () => {
  assert.match(appJs, /resultNavigation: \[\]/);
  assert.match(appJs, /function captureCompNavigationSnapshot\(compName\)/);
  assert.match(appJs, /openCompKeys/);
  assert.match(appJs, /scrollTop: resultContentEl\.scrollTop/);
  assert.match(appJs, /state\.resultNavigation\.push\(navigationSnapshot\)/);
  assert.match(appJs, /function restorePreviousCompResult\(\)/);
  assert.match(appJs, /data-return-comp/);
  assert.match(appJs, /state\.compRankingMetric = snapshot\.compRankingMetric/);
  assert.match(appJs, /resultContentEl\.scrollTop = snapshot\.scrollTop/);
  assert.match(styles, /\.result-navigation/);
  assert.match(i18n, /backToComp:/);
  assert.match(i18n, /compResultPreserved:/);
  assert.match(i18n, /statusReturnedToComp:/);
});

test("settings retain preferences, runtime details, alias review, export, clear, and reset controls", () => {
  for (const id of [
    "sample-control", "policy-control", "sort-select", "days-select",
    "structured-parser-mode-select", "rank-control", "cache-status", "llm-status", "runtime-detail",
    "alias-list", "export-aliases-button", "download-aliases-button", "reload-aliases-button",
    "clear-entity-memory-button", "alias-state-filter", "alias-type-filter", "alias-query-filter",
    "alias-select-all", "enable-selected-aliases-button", "disable-selected-aliases-button",
    "alias-prev-button", "alias-next-button", "clear-cache-button", "reset-preferences-button"
  ]) assert.match(indexHtml, new RegExp(`id="${id}"`));
  assert.doesNotMatch(indexHtml, /context-strategy-select/);
  assert.match(indexHtml, /data-value="0" data-i18n="noThreshold"/);
  assert.match(appJs, /structuredParserMode: state\.structuredParserMode/);
  assert.match(appJs, /rankFilter: state\.rankFilter/);
  assert.match(appJs, /window\.confirm/);
  assert.match(appJs, /downloadAliasDraft/);
});
