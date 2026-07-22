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

test("desktop UI exposes the responsive AppShell structure", () => {
  assert.match(indexHtml, /<title>tftclarity · Set 17<\/title>/);
  assert.match(indexHtml, /<link rel="icon" type="image\/png" href="\/favicon\.png">/);
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
  assert.match(styles, /\.season-context-control/);
  assert.match(appJs, /fetch\("\/api\/season-contexts"\)/);
  assert.match(appJs, /fetch\("\/api\/season-contexts\/select"/);
  assert.match(appJs, /seasonContextId: state\.seasonContextId/);
  assert.match(appJs, /resetConversation\(\{ previousSeasonContextId/);
  assert.match(appJs, /seasonContextId: previousSeasonContextId/);
  assert.match(appJs, /document\.title = theme\.documentTitle/);
  assert.match(appJs, /wallpaperController\.setSeason/);
  assert.match(appJs, /option\.disabled = !context\.selectable/);
  assert.match(appJs, /theme\?\.patchNoteVersion/);
  assert.match(wallpaperController, /setSeason\(seasonId, defaultWallpaperId/);
  assert.match(wallpaperController, /localStorage\.setItem\(`\$\{WALLPAPER_ID_STORAGE_KEY\}\.\$\{this\.seasonId\}`/);
  assert.match(wallpaperCatalog, /"set-18-pbe"/);
  assert.match(i18n, /seasonComingSoonStatus/);
  assert.match(i18n, /seasonArchivedStatus/);
  assert.match(i18n, /seasonRevivalStatus/);
});

test("welcome view exposes localized, actionable quick tasks", () => {
  assert.match(indexHtml, /class="quick-tasks"/);
  assert.equal((indexHtml.match(/class="quick-task-card/g) ?? []).length, 4);
  assert.match(indexHtml, /data-quick-task="comp-rankings"/);
  assert.match(indexHtml, /data-quick-task="comp-trends"/);
  assert.match(indexHtml, /data-quick-task="patch-notes"/);
  assert.match(appJs, /const QUICK_TASKS/);
  assert.match(appJs, /inputTemplateKey: "quickTaskBuildTemplate"/);
  assert.match(appJs, /queryInput\.setSelectionRange/);
  assert.match(appJs, /queryInput\.reportValidity/);
  assert.match(i18n, /enterChampion/);
  assert.doesNotMatch(i18n, /霞|Xayah/);
  assert.match(appJs, /quickTasksHtml/);
  assert.match(appJs, /button\[data-quick-task\]/);
  assert.match(appJs, /QUICK_TASKS\.find/);
  assert.match(appJs, /queryInput\.value = quickTask\.query/);
  assert.match(appJs, /requestRecommendation\(false, t\(quickTask\.promptKey\)\)/);
  assert.match(appJs, /state\.lastDisplayInput/);
  assert.match(appJs, /renderPatchNote/);
  assert.match(patchNotes, /CURRENT_PATCH_VERSION = "17\.7"/);
  assert.match(patchNotes, /teamfighttactics\.leagueoflegends\.com/);
  assert.match(styles, /\.patch-note-grid/);
  assert.match(styles, /\.patch-note-source/);
  assert.match(styles, /\.quick-task-grid/);
  assert.match(styles, /\.quick-task-card/);
  assert.match(styles, /min-height: 54px/);
  assert.match(styles, /var\(--wallpaper-accent\)/);
  assert.match(styles, /\.composer-actions \.send-button[\s\S]*var\(--wallpaper-accent\)[\s\S]*var\(--wallpaper-accent-secondary\)/);
  assert.match(styles, /\.conversation-pane[\s\S]*border-right: 1px solid color-mix\(in srgb, var\(--wallpaper-accent\) 18%, transparent\)/);
  assert.match(styles, /\.topbar[\s\S]*color-mix\(in srgb, var\(--wallpaper-accent\)[\s\S]*var\(--wallpaper-accent-secondary\)/);
  assert.match(wallpaperCatalog, /accentSecondary/);
  assert.match(wallpaperController, /--wallpaper-accent-secondary/);
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
  assert.match(i18n, /低于同类最高样本 2%/u);
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

test("small-window defaults to an explained robust applicability recommendation", () => {
  assert.match(indexHtml, /value="robust_first"[^>]*selected/);
  assert.match(appJs, /sort: "robust_first"/);
  assert.match(appJs, /card\.ranking\?\.method === "robust_applicability_v1"/);
  assert.match(appJs, /applicabilityRecommendation/);
  assert.match(i18n, /普适推荐/);
  assert.match(styles, /\.ranking-rationale/);
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
  assert.match(wallpaperCatalog, /stargazer-convergence\.png/);
  assert.match(wallpaperCatalog, /yasuo\.png/);
  assert.match(wallpaperCatalog, /soraka\.jpg/);
  assert.match(wallpaperCatalog, /focusSize: "cover"/);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/cosmic-court.jpg", import.meta.url)).size > 100_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/stargazer-convergence.png", import.meta.url)).size > 100_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/yasuo.png", import.meta.url)).size > 100_000);
  assert.ok(statSync(new URL("../src/app/small-window-ui/assets/wallpapers/set-17/soraka.jpg", import.meta.url)).size > 100_000);
  assert.match(wallpaperController, /tftagent\.wallpaperEnabled/);
  assert.match(wallpaperController, /tftagent\.wallpaperId/);
  assert.match(wallpaperController, /populateMobileOptions/);
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

test("request lifecycle isolates refreshes, clears, and stale abort completions", () => {
  assert.match(appJs, /const input = refresh \? state\.lastInput : queryInput\.value\.trim\(\)/);
  assert.match(appJs, /if \(!refresh\) composer\.clear\(\)/);
  assert.match(appJs, /const requestId = \+\+state\.requestSerial/);
  assert.match(appJs, /if \(requestId !== state\.requestSerial\) return/);
  assert.match(appJs, /state\.requestSerial \+= 1/);
  assert.match(appJs, /state\.currentController\?\.abort\(\)/);
  assert.match(appJs, /renderEmptyResult\(\)/);
});

test("localized view state and historical clarification actions keep stable response context", () => {
  assert.match(appJs, /resultView: \{ type: "empty" \}/);
  assert.match(appJs, /state\.resultView\.type === "loading"/);
  assert.match(appJs, /activeResponseEl\.innerHTML = progressStepsHtml/);
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
  assert.match(appJs, /function renderCompRankings/);
  assert.match(appJs, /renderCompCard\(comp, "trend", index\)/);
  assert.match(appJs, /data-comp-metric=/);
  assert.match(appJs, /renderCompCard\(comp, "trendDown", index\)/);
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
