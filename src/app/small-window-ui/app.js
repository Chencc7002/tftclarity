import { AppShell, TitleBar } from "./app-shell.js";
import { Composer, ConversationPane } from "./conversation-pane.js";
import { CompRankingResult, ItemRankingResult, RecommendationResult, ResultPane } from "./result-pane.js";
import { applyI18n, formatDate, formatNumber, getLocale, localizedName, setLocale, t } from "./i18n.js";
import { getPatchNote } from "./patch-notes.js";
import {
  cancelOpggRequests,
  renderOpggTrends,
  renderOpggPersonal,
  renderOpggProTeaching
} from "./opgg-panel.js";
import {
  formatProcessingDuration,
  formatDecisionAuditPayload,
  renderUnderstandingPanel
} from "./understanding-panel.js";
import { WallpaperController } from "./wallpaper-controller.js";
import { conclusionDisplayText, conclusionRichTextHtml } from "./conclusion-rich-text.js";
import {
  STREAM_TRANSPORT_MAX_RETRIES,
  shouldRetryStreamTransport,
  streamIncompleteError
} from "./stream-transport-retry.js";

const COMP_UNIT_QUERY_MIN_SAMPLES = 500;
const SEASON_CONTEXT_STORAGE_KEY = "tftagent.seasonContextId";
const SEASON_NOTICE_DISMISSED_STORAGE_KEY = "tftagent.dismissedSeasonNotice";

const state = {
  minSamples: 100,
  itemPolicy: "ordinary_only",
  sort: "robust_first",
  days: 3,
  structuredParserMode: "inherit",
  conclusionMode: "inherit",
  rankFilter: [],
  lastInput: "",
  lastDisplayInput: "",
  lastQuickTask: null,
  lastSupplementalText: "",
  lastResult: null,
  lastResultId: null,
  lastSuggestions: [],
  lastEntityCandidates: [],
  aliasLimit: 20,
  aliasOffset: 0,
  aliasHasMore: false,
  aliasQuery: "",
  aliasState: "",
  aliasType: "",
  itemAuditLoaded: false,
  conversationId: globalThis.crypto?.randomUUID?.() ?? `conversation-${Date.now()}`,
  currentController: null,
  currentConclusionController: null,
  requestInFlight: false,
  requestSerial: 0,
  progressIndex: 0,
  resultView: { type: "empty" },
  responseRecords: [],
  responsesById: new Map(),
  responseCounter: 0,
  currentResponseId: null,
  compRankingMetric: null,
  compDetailCache: new Map(),
  compDetailRequests: new Map(),
  compDetailDescriptors: new Map(),
  resultNavigation: [],
  feedbackByCard: {},
  explanationFeedback: null,
  itemRankingCategoryBeforeMixed: "ordinary_completed",
  mobileView: "chat",
  conclusionStreamText: "",
  seasonContextId: "set17-live",
  seasonContexts: [],
  seasonContext: null,
  activeAnalysisContext: null
};

const shellEl = document.querySelector("#app-shell");
const form = document.querySelector("#query-form");
const queryInput = document.querySelector("#query-input");
const quickTaskForm = document.querySelector("#quick-task-form");
const quickTaskFormTitle = document.querySelector("#quick-task-form-title");
const quickTaskFormClose = document.querySelector("#quick-task-form-close");
const quickTaskFields = document.querySelector("#quick-task-fields");
const refreshButton = document.querySelector("#refresh-button");
const clearButton = document.querySelector("#clear-button");
const stopButton = document.querySelector("#stop-button");
const settingsButton = document.querySelector("#settings-button");
const settingsPanel = document.querySelector("#settings-panel");
const settingsClose = document.querySelector("#settings-close");
const settingsDone = document.querySelector("#settings-done");
const clearCacheButton = document.querySelector("#clear-cache-button");
const resetPreferencesButton = document.querySelector("#reset-preferences-button");
const exportAliasesButton = document.querySelector("#export-aliases-button");
const downloadAliasesButton = document.querySelector("#download-aliases-button");
const reloadAliasesButton = document.querySelector("#reload-aliases-button");
const clearEntityMemoryButton = document.querySelector("#clear-entity-memory-button");
const aliasStateFilter = document.querySelector("#alias-state-filter");
const aliasTypeFilter = document.querySelector("#alias-type-filter");
const aliasQueryFilter = document.querySelector("#alias-query-filter");
const aliasSelectAll = document.querySelector("#alias-select-all");
const enableSelectedAliasesButton = document.querySelector("#enable-selected-aliases-button");
const disableSelectedAliasesButton = document.querySelector("#disable-selected-aliases-button");
const aliasPrevButton = document.querySelector("#alias-prev-button");
const aliasNextButton = document.querySelector("#alias-next-button");
const aliasPageLabel = document.querySelector("#alias-page-label");
const aliasList = document.querySelector("#alias-list");
const resultEl = document.querySelector("#result");
const resultContentEl = document.querySelector("#result-content");
const resultTitleEl = document.querySelector("#result-title");
const resultRefreshButton = document.querySelector("#result-refresh-button");
const mobileResultBackButton = document.querySelector("#mobile-result-back");
const statusEl = document.querySelector("#status");
const seasonContextSelect = document.querySelector("#season-context-select");
const seasonContextSummary = document.querySelector("#season-context-summary");
const seasonContextNotice = document.querySelector("#season-context-notice");
const seasonContextNoticeText = document.querySelector("[data-season-context-notice-text]");
const seasonContextNoticeClose = document.querySelector("#season-context-notice-close");
const seasonPreviewBanner = document.querySelector("#season-preview-banner");
const sendButton = form.querySelector(".send-button");
const aiQuotaEl = document.querySelector("#ai-quota");
const rawOutputEl = document.querySelector("#raw-output");
const detailsEl = document.querySelector("#details");
const sortSelect = document.querySelector("#sort-select");
const daysSelect = document.querySelector("#days-select");
const structuredParserModeSelect = document.querySelector("#structured-parser-mode-select");
const conclusionModeSelect = document.querySelector("#conclusion-mode-select");
const rankControl = document.querySelector("#rank-control");
const cacheStatusEl = document.querySelector("#cache-status");
const llmStatusEl = document.querySelector("#llm-status");
const runtimeDetailEl = document.querySelector("#runtime-detail");
const openItemAuditButton = document.querySelector("#open-item-audit-button");
const itemAuditPanel = document.querySelector("#item-audit-panel");
const itemAuditClose = document.querySelector("#item-audit-close");
const itemAuditMeta = document.querySelector("#item-audit-meta");
const itemAuditQuery = document.querySelector("#item-audit-query");
const itemAuditPatch = document.querySelector("#item-audit-patch");
const itemAuditSource = document.querySelector("#item-audit-source");
const itemAuditCategory = document.querySelector("#item-audit-category");
const itemAuditStatus = document.querySelector("#item-audit-status");
const itemAuditAvailability = document.querySelector("#item-audit-availability");
const itemAuditIssues = document.querySelector("#item-audit-issues");
const itemAuditSummary = document.querySelector("#item-audit-summary");
const itemAuditList = document.querySelector("#item-audit-list");
const itemAuditReload = document.querySelector("#item-audit-reload");
const itemAuditExportJson = document.querySelector("#item-audit-export-json");
const itemAuditExportCsv = document.querySelector("#item-audit-export-csv");
let saveTimer = null;
let itemAuditTimer = null;
let activeResponseEl = null;
let activeRecommendationProgress = null;
let activeQuickTask = null;

const conversationPane = new ConversationPane(resultEl);
const composer = new Composer({ form, input: queryInput });
const resultPane = new ResultPane({ root: resultContentEl, title: resultTitleEl });
const wallpaperController = new WallpaperController({
  shell: shellEl,
  canvas: document.querySelector("#particle-layer"),
  control: document.querySelector("#wallpaper-control"),
  toggle: document.querySelector("#wallpaper-toggle"),
  select: document.querySelector("#wallpaper-select")
});
const titleBar = new TitleBar({
  root: document.querySelector("#title-bar"),
  getLocale,
  onLocaleChange: (locale) => {
    setLocale(locale);
    applySeasonTheme(state.seasonContext, { refreshWallpaper: false });
    wallpaperController.refreshLocale();
    rerenderLocalizedState();
  }
});
const appShell = new AppShell({
  shell: document.querySelector("#app-shell"),
  panel: settingsPanel,
  backdrop: document.querySelector("#settings-backdrop"),
  settingsButton,
  settingsClose,
  settingsDone,
  onSettingsOpen: async () => {
    await loadRuntimeStatus();
    if (!state.runtimeStatus?.publicMode) await loadAliases();
  },
  titleBar
});

// Named modules are intentionally referenced here: AppShell/TitleBar own window layout,
// ConversationPane/Composer own chat entry, and ResultPane dispatches the three result templates.
void [RecommendationResult, ItemRankingResult, CompRankingResult, appShell, composer, wallpaperController];

function setResponseHtml(html) {
  resultPane.setHtml(`${renderResultNavigation()}${html}`);
}

function setDeveloperOutput(data) {
  rawOutputEl.textContent = formatDecisionAuditPayload(data)
    ?? data?.text
    ?? JSON.stringify(data, null, 2);
}

const mobileLayoutQuery = window.matchMedia("(max-width: 759px)");

function setMobileView(view, { pushHistory = false, replaceHistory = false } = {}) {
  const nextView = view === "result" ? "result" : "chat";
  state.mobileView = nextView;
  shellEl.dataset.mobileView = nextView;
  if (!mobileLayoutQuery.matches) return;
  const historyState = { ...(history.state ?? {}), tftclarityMobileView: nextView };
  if (pushHistory && history.state?.tftclarityMobileView !== nextView) {
    history.pushState(historyState, "");
  } else if (replaceHistory) {
    history.replaceState(historyState, "");
  }
  if (nextView === "result") resultContentEl.scrollTop = 0;
  else scrollConversation();
}

function openMobileResult() {
  setMobileView("result", { pushHistory: true });
  resultPane.focus();
  if (state.resultView.type === "result"
    && state.resultView.data === state.lastResult
    && state.lastResult?.answer?.generatedConclusion?.status === "pending"
    && !state.currentConclusionController) {
    void streamGeneratedConclusion(state.lastResult, state.requestSerial);
  }
}

function returnToMobileChat() {
  if (mobileLayoutQuery.matches && history.state?.tftclarityMobileView === "result") {
    history.back();
    return;
  }
  setMobileView("chat", { replaceHistory: true });
}

function isCompResult(data) {
  return data?.type === CompRankingResult.type || data?.type === "comp_trends" || data?.type === "comp_analysis";
}

function compCardNavigationKey(card) {
  return card?.dataset?.compSignature?.trim()
    || card?.dataset?.compName?.trim()
    || "";
}

function renderResultNavigation() {
  const snapshot = state.resultNavigation.at(-1);
  if (!snapshot) return "";
  if (snapshot.kind === "entity_catalog") {
    return `
      <nav class="result-navigation" aria-label="${escapeHtml(t("resultNavigation"))}">
        <button type="button" data-return-catalog ${state.requestInFlight ? "disabled" : ""}>
          <span aria-hidden="true">←</span>
          <span>${escapeHtml(t("backToCatalog", { name: snapshot.catalogName }))}</span>
        </button>
        <small>${escapeHtml(t("catalogResultPreserved"))}</small>
      </nav>`;
  }
  return `
    <nav class="result-navigation" aria-label="${escapeHtml(t("resultNavigation"))}">
      <button type="button" data-return-comp ${state.requestInFlight ? "disabled" : ""}>
        <span aria-hidden="true">←</span>
        <span>${escapeHtml(t("backToComp", { name: snapshot.compName }))}</span>
      </button>
      <small>${escapeHtml(t("compResultPreserved"))}</small>
    </nav>`;
}

function captureCompNavigationSnapshot(compName) {
  if (!isCompResult(state.lastResult)) return null;
  const openCompKeys = [...resultContentEl.querySelectorAll(".comp-card[open]")]
    .map(compCardNavigationKey)
    .filter(Boolean);
  return {
    compName,
    data: state.lastResult,
    lastInput: state.lastInput,
    lastDisplayInput: state.lastDisplayInput,
    lastQuickTask: state.lastQuickTask,
    lastResultId: state.lastResultId,
    lastSuggestions: state.lastSuggestions,
    lastEntityCandidates: state.lastEntityCandidates,
    currentResponseId: state.currentResponseId,
    compRankingMetric: state.compRankingMetric,
    feedbackByCard: { ...state.feedbackByCard },
    explanationFeedback: state.explanationFeedback,
    rawOutput: rawOutputEl.textContent,
    openCompKeys,
    scrollTop: resultContentEl.scrollTop
  };
}

function captureEntityCatalogNavigationSnapshot(catalogName) {
  if (state.lastResult?.type !== "entity_catalog") return null;
  return {
    kind: "entity_catalog",
    catalogName,
    data: state.lastResult,
    lastInput: state.lastInput,
    lastDisplayInput: state.lastDisplayInput,
    lastQuickTask: state.lastQuickTask,
    lastResultId: state.lastResultId,
    lastSuggestions: state.lastSuggestions,
    lastEntityCandidates: state.lastEntityCandidates,
    currentResponseId: state.currentResponseId,
    feedbackByCard: { ...state.feedbackByCard },
    explanationFeedback: state.explanationFeedback,
    rawOutput: rawOutputEl.textContent,
    scrollTop: resultContentEl.scrollTop
  };
}

function restorePreviousCatalogResult() {
  if (state.requestInFlight) return;
  const snapshot = state.resultNavigation.at(-1);
  if (snapshot?.kind !== "entity_catalog") return;
  state.resultNavigation.pop();
  state.lastInput = snapshot.lastInput;
  state.lastDisplayInput = snapshot.lastDisplayInput;
  state.lastQuickTask = snapshot.lastQuickTask ?? null;
  state.lastResult = snapshot.data;
  state.lastResultId = snapshot.lastResultId;
  state.lastSuggestions = snapshot.lastSuggestions;
  state.lastEntityCandidates = snapshot.lastEntityCandidates;
  state.currentResponseId = snapshot.currentResponseId;
  state.feedbackByCard = { ...snapshot.feedbackByCard };
  state.explanationFeedback = snapshot.explanationFeedback;
  state.resultView = { type: "result", data: snapshot.data };
  rawOutputEl.textContent = snapshot.rawOutput;
  resultTitleEl.textContent = t("resultTitle");
  renderCurrentResult(snapshot.data);
  resultContentEl.scrollTop = snapshot.scrollTop;
  resultRefreshButton.disabled = !state.lastInput;
  setStatusKey("statusReady", "ready");
  resultPane.focus();
}

function restorePreviousCompResult() {
  if (state.requestInFlight) return;
  const snapshot = state.resultNavigation.pop();
  if (!snapshot) return;

  state.lastInput = snapshot.lastInput;
  state.lastDisplayInput = snapshot.lastDisplayInput;
  state.lastQuickTask = snapshot.lastQuickTask ?? null;
  state.lastResult = snapshot.data;
  state.lastResultId = snapshot.lastResultId;
  state.lastSuggestions = snapshot.lastSuggestions;
  state.lastEntityCandidates = snapshot.lastEntityCandidates;
  state.currentResponseId = snapshot.currentResponseId;
  state.compRankingMetric = snapshot.compRankingMetric;
  state.feedbackByCard = { ...snapshot.feedbackByCard };
  state.explanationFeedback = snapshot.explanationFeedback;
  state.resultView = { type: "result", data: snapshot.data };
  rawOutputEl.textContent = snapshot.rawOutput;
  resultTitleEl.textContent = t("resultTitle");
  renderCurrentResult(snapshot.data);

  const openCompKeys = new Set(snapshot.openCompKeys);
  for (const card of resultContentEl.querySelectorAll(".comp-card")) {
    card.open = openCompKeys.has(compCardNavigationKey(card));
  }
  resultContentEl.scrollTop = snapshot.scrollTop;
  resultRefreshButton.disabled = !state.lastInput;
  setStatusKey("statusReturnedToComp", "ready", { name: snapshot.compName });
  resultPane.focus();
}

function scrollConversation() {
  conversationPane.scroll();
}

function setStatus(text, stateName = "ready") {
  state.statusKey = null;
  state.statusParams = null;
  state.statusText = text;
  state.statusState = stateName;
  statusEl.dataset.state = stateName;
  const label = statusEl.querySelector("span:last-child");
  if (label) label.textContent = text;
}

function setStatusKey(key, stateName = "ready", params = {}) {
  setStatus(t(key, params), stateName);
  state.statusKey = key;
  state.statusParams = params;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function localizedThemeValue(value, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value[getLocale()] ?? value["zh-CN"] ?? value["en-US"] ?? fallback;
  }
  return value ?? fallback;
}

function normalizedSeasonSummary(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\bset\s*(?=\d)/g, "s")
    .replace(/[^a-z0-9.]+/g, "");
}

function seasonSubtitleForSummary(label, subtitle) {
  const value = String(subtitle ?? "").trim();
  if (!value) return "";
  return normalizedSeasonSummary(label) === normalizedSeasonSummary(value) ? "" : value;
}

function seasonStatusLabel(context) {
  if (context?.status === "archived") return t("seasonArchivedStatus");
  if (context?.status === "revival" || context?.mode === "revival") return t("seasonRevivalStatus");
  if (context?.environment === "pbe" && context?.status !== "coming_soon") return t("seasonPbeStatus");
  if (context?.status === "live") return t("seasonLiveStatus");
  if (context?.status === "coming_soon") return t("seasonComingSoonStatus");
  return t("seasonUnavailableStatus");
}

function seasonOptionLabel(context) {
  const base = getLocale() === "en-US"
    ? `Set ${context.season} · ${context.environment === "pbe" ? "PBE" : seasonStatusLabel(context)}`
    : context.label;
  return context.status === "coming_soon" ? `${base} — ${seasonStatusLabel(context)}` : base;
}

function renderSeasonContextOptions() {
  if (!seasonContextSelect || !state.seasonContexts.length) return;
  seasonContextSelect.replaceChildren(...state.seasonContexts.map((context) => {
    const option = document.createElement("option");
    option.value = context.id;
    option.textContent = seasonOptionLabel(context);
    option.disabled = !context.selectable && !context.themePreview;
    if (context.notices?.length) option.title = context.notices.join(" ");
    return option;
  }));
  seasonContextSelect.value = state.seasonContextId ?? "";
  seasonContextSelect.disabled = state.seasonContexts.length === 0;
}

function seasonNoticeDismissed(seasonContextId) {
  try {
    return sessionStorage.getItem(`${SEASON_NOTICE_DISMISSED_STORAGE_KEY}.${seasonContextId}`) === "true";
  } catch {
    return false;
  }
}

function dismissSeasonNotice(seasonContextId = state.seasonContextId) {
  if (!seasonContextId) return;
  try {
    sessionStorage.setItem(`${SEASON_NOTICE_DISMISSED_STORAGE_KEY}.${seasonContextId}`, "true");
  } catch {
    // A storage failure should not prevent the current notice from closing.
  }
  if (seasonContextNotice) seasonContextNotice.hidden = true;
}

function applySeasonTheme(context, { refreshWallpaper = true } = {}) {
  if (!context) return;
  const theme = context.theme ?? {};
  const colors = theme.colors ?? {};
  const wallpaper = theme.wallpaper ?? {};
  const previewOnly = Boolean(context.themePreview && !context.selectable);
  shellEl.dataset.seasonContextId = context.id;
  shellEl.dataset.seasonEnvironment = context.environment;
  shellEl.dataset.seasonTheme = context.themeId ?? "";
  shellEl.dataset.seasonPreview = String(previewOnly);
  shellEl.style.setProperty("--season-primary", colors.primary ?? "#6b63df");
  shellEl.style.setProperty("--season-secondary", colors.secondary ?? "#34b9d6");
  if (seasonPreviewBanner) seasonPreviewBanner.hidden = !previewOnly;
  queryInput.disabled = previewOnly;
  sendButton.disabled = previewOnly;
  if (previewOnly) queryInput.setAttribute("aria-describedby", "season-preview-banner");
  else queryInput.removeAttribute("aria-describedby");
  if (refreshWallpaper) {
    wallpaperController.setSeason(wallpaper.seasonId, wallpaper.defaultId, {
      primary: colors.primary,
      secondary: colors.secondary,
      particles: theme.particles
    });
  }
  const label = seasonContextSummary?.querySelector("[data-season-label]");
  const subtitle = seasonContextSummary?.querySelector("[data-season-subtitle]");
  const subtitleSeparator = seasonContextSummary?.querySelector("[data-season-subtitle-separator]");
  const labelText = seasonOptionLabel(context).replace(/\s+—\s+.*/, "");
  const subtitleText = seasonSubtitleForSummary(
    labelText,
    localizedThemeValue(theme.subtitle, context.themeId ?? "")
  );
  if (label) label.textContent = labelText;
  if (subtitle) {
    subtitle.textContent = subtitleText;
    subtitle.hidden = !subtitleText;
  }
  if (subtitleSeparator) subtitleSeparator.hidden = !subtitleText;
  const notice = localizedThemeValue(theme.riskNotice, context.notices?.[0] ?? "");
  if (seasonContextNotice) {
    if (seasonContextNoticeText) seasonContextNoticeText.textContent = notice;
    seasonContextNotice.hidden = !notice || seasonNoticeDismissed(context.id);
  }
  renderSeasonContextOptions();
}

async function selectSeasonContext(seasonContextId, { reset = true, announce = true } = {}) {
  const previousSeasonContextId = state.seasonContextId;
  let didReset = false;
  seasonContextSelect.disabled = true;
  try {
    const response = await fetch("/api/season-contexts/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seasonContextId })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("seasonSwitchFailed"));
    if (reset && previousSeasonContextId && previousSeasonContextId !== data.seasonContext.id) {
      await resetConversation({ previousSeasonContextId, announce: false });
      didReset = true;
    }
    state.seasonContextId = data.seasonContext.id;
    state.seasonContext = data.seasonContext;
    localStorage.setItem(SEASON_CONTEXT_STORAGE_KEY, state.seasonContextId);
    applySeasonTheme(data.seasonContext);
    if (didReset) {
      resultEl.innerHTML = welcomeConversationHtml();
      renderEmptyResult();
    }
    if (announce) setStatusKey("seasonSwitched", "ready", { season: seasonOptionLabel(data.seasonContext) });
    return data.seasonContext;
  } catch (error) {
    seasonContextSelect.value = previousSeasonContextId ?? "";
    if (announce) setStatus(error.message || t("seasonSwitchFailed"), "error");
    return null;
  } finally {
    seasonContextSelect.disabled = state.seasonContexts.length === 0;
  }
}

async function loadSeasonContexts() {
  try {
    const response = await fetch("/api/season-contexts");
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("seasonLoadFailed"));
    state.seasonContexts = data.seasonContexts ?? [];
    const storedId = localStorage.getItem(SEASON_CONTEXT_STORAGE_KEY);
    const preferred = state.seasonContexts.find((context) => context.id === storedId && (context.selectable || context.themePreview))
      ?? state.seasonContexts.find((context) => context.id === data.defaultSeasonContextId && context.selectable)
      ?? state.seasonContexts.find((context) => context.selectable);
    renderSeasonContextOptions();
    if (!preferred) throw new Error(t("seasonLoadFailed"));
    await selectSeasonContext(preferred.id, { reset: false, announce: false });
  } catch (error) {
    state.seasonContextId = "set17-live";
    setStatus(error.message || t("seasonLoadFailed"), "error");
  }
}

const QUICK_TASK_CATEGORIES = [
  {
    id: "equipment",
    titleKey: "quickCategoryEquipmentTitle",
    bodyKey: "quickCategoryEquipmentBody",
    countKey: "quickCategoryEquipmentCount",
    icon: '<path d="m6 18 8-8"/><path d="m12 6 6-2-2 6-8 8-4 2 2-4z"/>'
  },
  {
    id: "comps",
    titleKey: "quickCategoryCompsTitle",
    bodyKey: "quickCategoryCompsBody",
    countKey: "quickCategoryCompsCount",
    icon: '<path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z"/>'
  },
  {
    id: "library",
    titleKey: "quickCategoryLibraryTitle",
    bodyKey: "quickCategoryLibraryBody",
    countKey: "quickCategoryLibraryCount",
    icon: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M8 16h10M9 8h5M9 11h6"/>'
  },
  {
    id: "news",
    titleKey: "quickCategoryNewsTitle",
    bodyKey: "quickCategoryNewsBody",
    countKey: "quickCategoryNewsCount",
    icon: '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>'
  }
];

const QUICK_TASKS = [
  {
    category: "equipment",
    id: "unit-build",
    operation: "unit_build_rankings",
    formFields: ["champion"],
    queryTemplateKey: "quickTaskBuildTemplate",
    titleKey: "quickTaskBuildTitle",
    bodyKey: "quickTaskBuildBody",
    exampleKey: "quickTaskBuildExample",
    icon: '<path d="m6 18 8-8"/><path d="m12 6 6-2-2 6-8 8-4 2 2-4z"/>'
  },
  {
    category: "equipment",
    id: "unit-build-completion",
    operation: "unit_build_completion",
    formFields: ["champion", "item1", "item2Optional"],
    queryTemplateKey: "quickTaskCompletionTemplate",
    optionalQueryTemplateKey: "quickTaskCompletionWithSecondTemplate",
    titleKey: "quickTaskCompletionTitle",
    bodyKey: "quickTaskCompletionBody",
    exampleKey: "quickTaskCompletionExample",
    icon: '<path d="M5 12h14M12 5v14"/><circle cx="12" cy="12" r="9"/>'
  },
  {
    category: "equipment",
    id: "item-performance",
    operation: "unit_item_rankings",
    formFields: ["champion", "itemCategory"],
    queryTemplateKey: "quickTaskPerformanceTemplate",
    titleKey: "quickTaskPerformanceTitle",
    bodyKey: "quickTaskPerformanceBody",
    exampleKey: "quickTaskPerformanceExample",
    icon: '<path d="m4 17 5-5 4 3 7-8"/><path d="M15 7h5v5"/>'
  },
  {
    category: "equipment",
    id: "item-comparison",
    operation: "unit_item_comparison",
    formFields: ["champion", "comparisonItem1", "item2"],
    queryTemplateKey: "quickTaskComparisonTemplate",
    titleKey: "quickTaskComparisonTitle",
    bodyKey: "quickTaskComparisonBody",
    exampleKey: "quickTaskComparisonExample",
    icon: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>'
  },
  {
    category: "equipment",
    id: "item-carriers",
    operation: "item_carrier_rankings",
    formFields: ["item"],
    queryTemplateKey: "quickTaskCarriersTemplate",
    titleKey: "quickTaskCarriersTitle",
    bodyKey: "quickTaskCarriersBody",
    exampleKey: "quickTaskCarriersExample",
    icon: '<circle cx="12" cy="8" r="3"/><path d="M5.5 19c.8-3.4 3-5 6.5-5s5.7 1.6 6.5 5"/>'
  },
  {
    category: "equipment",
    id: "special-items",
    operation: "unit_item_rankings",
    formFields: ["champion", "specialCategory"],
    queryTemplateKey: "quickTaskSpecialTemplate",
    titleKey: "quickTaskSpecialTitle",
    bodyKey: "quickTaskSpecialBody",
    exampleKey: "quickTaskSpecialExample",
    icon: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/>'
  },
  {
    category: "comps",
    id: "comp-rankings",
    operation: "comp_rankings",
    query: "\u63a8\u8350\u5f53\u524d\u7248\u672c\u70ed\u95e8\u9635\u5bb9",
    promptKey: "quickTaskCompsPrompt",
    titleKey: "quickTaskCompsTitle",
    bodyKey: "quickTaskCompsBody",
    exampleKey: "quickTaskCompsExample",
    icon: '<path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z"/>'
  },
  {
    category: "comps",
    id: "comp-trends",
    operation: "comp_trends",
    query: "\u5f53\u524d\u7248\u672c\u9635\u5bb9\u8d8b\u52bf",
    promptKey: "quickTaskTrendsPrompt",
    titleKey: "quickTaskTrendsTitle",
    bodyKey: "quickTaskTrendsBody",
    exampleKey: "quickTaskTrendsExample",
    icon: '<path d="m4 17 5-5 4 3 7-8"/><path d="M15 7h5v5"/>'
  },
  {
    category: "comps",
    id: "hero-comps",
    operation: "comp_rankings",
    formFields: ["champion"],
    queryTemplateKey: "quickTaskHeroCompsTemplate",
    titleKey: "quickTaskHeroCompsTitle",
    bodyKey: "quickTaskHeroCompsBody",
    exampleKey: "quickTaskHeroCompsExample",
    icon: '<circle cx="9" cy="9" r="4"/><path d="m12 12 7 7M15 15l2-2"/>'
  },
  {
    category: "library",
    id: "unit-details",
    operation: "unit_details",
    formFields: ["champion"],
    queryTemplateKey: "quickTaskUnitDetailsTemplate",
    titleKey: "quickTaskUnitDetailsTitle",
    bodyKey: "quickTaskUnitDetailsBody",
    exampleKey: "quickTaskUnitDetailsExample",
    icon: '<circle cx="12" cy="8" r="3"/><path d="M6 19c.7-3.4 2.7-5 6-5s5.3 1.6 6 5"/>'
  },
  {
    category: "library",
    id: "unit-catalog",
    operation: "unit_catalog",
    queryKey: "quickTaskUnitCatalogPrompt",
    promptKey: "quickTaskUnitCatalogPrompt",
    titleKey: "quickTaskUnitCatalogTitle",
    bodyKey: "quickTaskUnitCatalogBody",
    exampleKey: "quickTaskUnitCatalogExample",
    icon: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 19c.5-3.2 2.2-5 5-5s4.5 1.8 5 5M11 19c.5-3.2 2.2-5 5-5s4.5 1.8 5 5"/>'
  },
  {
    category: "library",
    id: "item-details",
    operation: "item_details",
    formFields: ["item"],
    queryTemplateKey: "quickTaskItemDetailsTemplate",
    titleKey: "quickTaskItemDetailsTitle",
    bodyKey: "quickTaskItemDetailsBody",
    exampleKey: "quickTaskItemDetailsExample",
    icon: '<path d="m8 16 8-8M7 5l12 12M5 7l2-2M17 19l2-2"/>'
  },
  {
    category: "library",
    id: "trait-details",
    operation: "trait_details",
    formFields: ["trait"],
    queryTemplateKey: "quickTaskTraitDetailsTemplate",
    titleKey: "quickTaskTraitDetailsTitle",
    bodyKey: "quickTaskTraitDetailsBody",
    exampleKey: "quickTaskTraitDetailsExample",
    icon: '<path d="M12 3 5 7v5c0 4.3 2.8 7.4 7 9 4.2-1.6 7-4.7 7-9V7z"/><path d="m9 12 2 2 4-5"/>'
  },
  {
    category: "library",
    id: "trait-catalog",
    operation: "trait_catalog",
    queryKey: "quickTaskTraitCatalogPrompt",
    promptKey: "quickTaskTraitCatalogPrompt",
    titleKey: "quickTaskTraitCatalogTitle",
    bodyKey: "quickTaskTraitCatalogBody",
    exampleKey: "quickTaskTraitCatalogExample",
    icon: '<path d="M4 6h6v5H4zM14 6h6v5h-6zM9 15h6v5H9z"/><path d="M7 11v2h5M17 11v2h-5v2"/>'
  },
  {
    category: "news",
    id: "patch-notes",
    view: "patch-note",
    titleKey: "quickTaskUpdatesTitle",
    bodyKey: "quickTaskUpdatesBody",
    exampleKey: "quickTaskUpdatesExample",
    icon: '<path d="M6 5h12v14H6z"/><path d="M9 9h6M9 12h6M9 15h4"/>'
  },
  {
    category: "news",
    id: "opgg-pro-trends",
    view: "opgg-pro-trends",
    titleKey: "quickTaskOpggTrendsTitle",
    bodyKey: "quickTaskOpggTrendsBody",
    exampleKey: "quickTaskOpggTrendsExample",
    icon: '<path d="M3 17l5-5 4 3 6-7 3 3"/><path d="M3 21h18"/>'
  },
  {
    category: "news",
    id: "opgg-personal-review",
    view: "opgg-personal-review",
    titleKey: "quickTaskOpggPersonalTitle",
    bodyKey: "quickTaskOpggPersonalBody",
    exampleKey: "quickTaskOpggPersonalExample",
    icon: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4 20c.8-3.5 3.6-5.5 8-5.5s7.2 2 8 5.5"/>'
  },
  {
    category: "news",
    id: "opgg-pro-teaching",
    view: "opgg-pro-teaching",
    titleKey: "quickTaskOpggTeachingTitle",
    bodyKey: "quickTaskOpggTeachingBody",
    exampleKey: "quickTaskOpggTeachingExample",
    icon: '<path d="M8 4h8v16H8z"/><path d="M5 8h3M16 8h3M11 12h2M11 15h2"/>'
  }
];

function quickTasksForSeason() {
  const configured = localizedThemeValue(state.seasonContext?.theme?.quickQuestions, []);
  const configuredIndexes = new Map([
    ["comp-rankings", 0],
    ["comp-trends", 1]
  ]);
  return QUICK_TASKS.map((task) => {
    const configuredIndex = configuredIndexes.get(task.id);
    return configuredIndex !== undefined && configured[configuredIndex]
      ? { ...task, query: configured[configuredIndex] }
      : task;
  });
}

function quickTaskCardHtml(task) {
  const isInteractive = task.query || task.queryKey || task.view || task.formFields;
  const action = isInteractive
    ? ` data-quick-task="${escapeHtml(task.id)}"`
    : " disabled";
  return `
    <button type="button" class="quick-task-card${isInteractive ? "" : " is-planned"}"${action}>
      <span class="quick-task-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${task.icon}</svg></span>
      <span class="quick-task-copy">
        <strong data-i18n="${task.titleKey}">${escapeHtml(t(task.titleKey))}</strong>
        <small data-i18n="${task.bodyKey}">${escapeHtml(t(task.bodyKey))}</small>
        <span class="quick-task-example" data-i18n="${task.exampleKey}">${escapeHtml(t(task.exampleKey))}</span>
      </span>
      <span class="quick-task-arrow" aria-hidden="true">→</span>
    </button>
  `;
}

function quickTasksHtml() {
  const tasks = quickTasksForSeason();
  const categoryCards = QUICK_TASK_CATEGORIES.map((category) => `
    <button type="button" class="quick-category-card" data-quick-category="${escapeHtml(category.id)}" aria-expanded="false" aria-controls="quick-category-panel-${escapeHtml(category.id)}">
      <span class="quick-category-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${category.icon}</svg></span>
      <span class="quick-category-copy">
        <strong data-i18n="${category.titleKey}">${escapeHtml(t(category.titleKey))}</strong>
        <small data-i18n="${category.bodyKey}">${escapeHtml(t(category.bodyKey))}</small>
      </span>
      <span class="quick-category-count" data-i18n="${category.countKey}">${escapeHtml(t(category.countKey))}</span>
      <span class="quick-category-chevron" aria-hidden="true">⌄</span>
    </button>
  `).join("");
  const panels = QUICK_TASK_CATEGORIES.map((category) => {
    const categoryTasks = tasks.filter((task) => task.category === category.id);
    return `
      <section class="quick-task-panel" id="quick-category-panel-${escapeHtml(category.id)}" data-quick-category-panel="${escapeHtml(category.id)}" aria-labelledby="quick-category-title-${escapeHtml(category.id)}" hidden>
        <header class="quick-task-panel-heading">
          <div>
            <strong id="quick-category-title-${escapeHtml(category.id)}" data-i18n="${category.titleKey}">${escapeHtml(t(category.titleKey))}</strong>
            <small data-i18n="${category.bodyKey}">${escapeHtml(t(category.bodyKey))}</small>
          </div>
          <span data-i18n="${category.countKey}">${escapeHtml(t(category.countKey))}</span>
        </header>
        <div class="quick-task-list">${categoryTasks.map(quickTaskCardHtml).join("")}</div>
      </section>
    `;
  }).join("");
  return `
    <section class="quick-tasks" data-i18n-aria="quickTasksLabel" aria-label="${escapeHtml(t("quickTasksLabel"))}">
      <div class="quick-tasks-heading">
        <strong data-i18n="quickTasksTitle">${escapeHtml(t("quickTasksTitle"))}</strong>
        <span data-i18n="quickTasksHint">${escapeHtml(t("quickTasksHint"))}</span>
      </div>
      <div class="quick-category-grid">${categoryCards}</div>
      ${panels}
    </section>
  `;
}

const QUICK_TASK_FIELD_DEFINITIONS = {
  champion: { labelKey: "quickFieldChampion", placeholderKey: "quickFieldChampionPlaceholder", required: true },
  item: { labelKey: "quickFieldItem", placeholderKey: "quickFieldItemPlaceholder", required: true },
  item1: { labelKey: "quickFieldOwnedItem", placeholderKey: "quickFieldOwnedItemPlaceholder", required: true },
  comparisonItem1: { valueKey: "item1", labelKey: "quickFieldComparedItemOne", placeholderKey: "quickFieldComparedItemOnePlaceholder", required: true },
  item2: { labelKey: "quickFieldComparedItem", placeholderKey: "quickFieldComparedItemPlaceholder", required: true },
  item2Optional: { valueKey: "item2", labelKey: "quickFieldOptionalItem", placeholderKey: "quickFieldOptionalItemPlaceholder", required: false },
  trait: { labelKey: "quickFieldTrait", placeholderKey: "quickFieldTraitPlaceholder", required: true },
  itemCategory: { labelKey: "quickFieldItemCategory", placeholderKey: "quickFieldItemCategoryPlaceholder", required: true },
  specialCategory: { labelKey: "quickFieldSpecialCategory", placeholderKey: "quickFieldSpecialCategoryPlaceholder", required: true }
};

function closeQuickTaskForm({ focus = false } = {}) {
  activeQuickTask = null;
  quickTaskForm.hidden = true;
  quickTaskFields.replaceChildren();
  form.classList.remove("quick-task-form-active");
  queryInput.hidden = false;
  if (focus) queryInput.focus();
}

function openQuickTaskForm(task) {
  activeQuickTask = task;
  queryInput.value = "";
  queryInput.setCustomValidity("");
  queryInput.hidden = true;
  quickTaskFormTitle.textContent = t(task.titleKey);
  quickTaskFields.innerHTML = task.formFields.map((fieldName) => {
    const field = QUICK_TASK_FIELD_DEFINITIONS[fieldName];
    const valueKey = field.valueKey ?? fieldName;
    return `
      <label class="quick-task-field">
        <span data-i18n="${field.labelKey}">${escapeHtml(t(field.labelKey))}${field.required ? `<b aria-hidden="true">*</b>` : ""}</span>
        <input type="text" name="quick-${escapeHtml(valueKey)}" data-quick-field="${escapeHtml(valueKey)}"
          data-i18n-placeholder="${field.placeholderKey}" placeholder="${escapeHtml(t(field.placeholderKey))}"
          autocomplete="off" spellcheck="false"${field.required ? " required" : ""}>
      </label>
    `;
  }).join("");
  quickTaskForm.hidden = false;
  form.classList.add("quick-task-form-active");
  quickTaskFields.querySelector("input")?.focus();
}

function quickTaskQuery(task) {
  const values = {};
  for (const input of quickTaskFields.querySelectorAll("[data-quick-field]")) {
    values[input.dataset.quickField] = input.value.trim();
    if (!input.reportValidity()) return null;
  }
  const templateKey = task.optionalQueryTemplateKey && values.item2
    ? task.optionalQueryTemplateKey
    : task.queryTemplateKey;
  return {
    query: t(templateKey, values),
    values
  };
}

function structuredQuickTask(task, values = {}) {
  if (!task?.id || !task?.operation) return null;
  return {
    schemaVersion: "quick-task.v1",
    requestId: globalThis.crypto?.randomUUID?.()
      ?? `quick-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    id: task.id,
    operation: task.operation,
    locale: getLocale(),
    arguments: Object.fromEntries(
      Object.entries(values)
        .map(([key, value]) => [key, String(value ?? "").trim()])
        .filter(([, value]) => value)
    )
  };
}

async function submitQuickTaskForm() {
  if (!activeQuickTask) return false;
  const task = activeQuickTask;
  const submission = quickTaskQuery(task);
  if (!submission) return true;
  closeQuickTaskForm();
  queryInput.value = submission.query;
  await requestRecommendation(
    false,
    submission.query,
    {
      startNewTask: true,
      quickTask: structuredQuickTask(task, submission.values)
    }
  );
  return true;
}

function collapseQuickTaskCategories(section) {
  if (!section) return;
  for (const button of section.querySelectorAll("[data-quick-category]")) {
    button.setAttribute("aria-expanded", "false");
  }
  for (const panel of section.querySelectorAll("[data-quick-category-panel]")) {
    panel.hidden = true;
  }
}

function toggleQuickTaskCategory(button) {
  const section = button.closest(".quick-tasks");
  if (!section) return;
  const category = button.dataset.quickCategory;
  const shouldExpand = button.getAttribute("aria-expanded") !== "true";
  collapseQuickTaskCategories(section);
  if (!shouldExpand) return;
  const panel = [...section.querySelectorAll("[data-quick-category-panel]")]
    .find((entry) => entry.dataset.quickCategoryPanel === category);
  if (!panel) return;
  button.setAttribute("aria-expanded", "true");
  panel.hidden = false;
}

function welcomeConversationHtml(messageKey = "newConversation") {
  return `
    <article class="message assistant-message welcome-message">
      <div class="message-meta"><span class="assistant-avatar" aria-hidden="true"><img src="/favicon.png?v=20260727" alt=""></span><strong data-i18n="assistant">${escapeHtml(t("assistant"))}</strong></div>
      <div class="message-body" data-i18n="${messageKey}">${escapeHtml(t(messageKey))}</div>
    </article>
    ${quickTasksHtml()}
  `;
}

function normalizeUiAlias(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?'"`~\-_/\\()[\]{}<>]/g, "");
}

function setActiveButton(group, value) {
  for (const button of group.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.value === String(value));
  }
}

function applyPreferences(preferences = {}) {
  if (preferences.minSamples !== undefined) state.minSamples = Number(preferences.minSamples);
  if (preferences.itemPolicy) state.itemPolicy = preferences.itemPolicy;
  if (preferences.sort) state.sort = preferences.sort;
  if (preferences.days) state.days = Number(preferences.days);
  if (preferences.structuredParserMode) state.structuredParserMode = preferences.structuredParserMode;
  if (preferences.conclusionMode) state.conclusionMode = preferences.conclusionMode;
  if (Array.isArray(preferences.rankFilter)) state.rankFilter = preferences.rankFilter;

  setActiveButton(document.querySelector("#sample-control"), state.minSamples);
  setActiveButton(document.querySelector("#policy-control"), state.itemPolicy);
  sortSelect.value = state.sort;
  daysSelect.value = String(state.days);
  structuredParserModeSelect.value = state.structuredParserMode;
  conclusionModeSelect.value = state.conclusionMode;
  for (const input of rankControl.querySelectorAll("input[type=checkbox]")) {
    input.checked = state.rankFilter.includes(input.value);
  }
}

async function savePreferences() {
  try {
    await fetch("/api/preferences", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        preferences: {
          minSamples: state.minSamples,
          itemPolicy: state.itemPolicy,
          sort: state.sort,
          days: state.days,
          structuredParserMode: state.structuredParserMode,
          conclusionMode: state.conclusionMode,
          rankFilter: state.rankFilter
        }
      })
    });
  } catch {
    setStatusKey("statusNotSaved", "error");
  }
}

function scheduleSavePreferences() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePreferences, 160);
}

async function loadPreferences() {
  try {
    const response = await fetch("/api/preferences");
    const data = await response.json();
    if (response.ok && data.ok) applyPreferences(data.preferences);
  } catch {
    setStatusKey("statusReady");
  }
}

function cacheStatusLabel(type) {
  return {
    json: t("cacheJson"),
    sqlite: t("cacheSqlite"),
    memory: t("cacheMemory")
  }[type] ?? String(type ?? "-");
}

function renderRuntimeStatus(runtime = {}) {
  state.runtimeStatus = runtime;
  const cache = runtime.cache ?? {};
  const parser = runtime.structuredParser ?? {};
  const conclusion = runtime.conclusionGenerator ?? {};
  const requests = runtime.requests ?? {};
  cacheStatusEl.textContent = cacheStatusLabel(cache.type);
  llmStatusEl.textContent = conclusion.enabled
    ? `${t("dataInterpretation")} / ${conclusion.model ?? conclusion.provider ?? "LLM"}`
    : parser.enabled
      ? `${parser.provider ?? "LLM"} / ${parser.mode ?? "auto"}`
      : t("disabled");

  const detail = [];
  if (cache.persistent) detail.push(cache.pathConfigured ? t("persistence") : t("persistenceUnset"));
  if (parser.enabled && parser.model) detail.push(parser.model);
  if (conclusion.enabled && conclusion.timeoutMs) detail.push(`${t("dataInterpretation")} ${conclusion.timeoutMs}ms`);
  const explorerTimeoutMs = Number(requests.explorerTimeoutMs);
  if (requests.explorerTimeoutMs != null && Number.isFinite(explorerTimeoutMs) && explorerTimeoutMs > 0) {
    detail.push(t("timeout", { seconds: explorerTimeoutMs / 1000 }));
  }
  if (parser.enabled && parser.timeoutMs) detail.push(`${parser.timeoutMs}ms`);
  if (parser.enabled && parser.apiKeyConfigured) detail.push(t("keyConfigured"));
  runtimeDetailEl.textContent = detail.join(" / ") || t("rulesFirst");
  for (const element of document.querySelectorAll(".admin-only")) {
    element.classList.toggle("hidden", Boolean(runtime.publicMode));
  }
}

function renderAccessStatus(access = {}) {
  state.access = access;
  const quota = access.quota ?? {};
  if (!quota.enabled) {
    aiQuotaEl.classList.add("hidden");
    return;
  }
  aiQuotaEl.classList.remove("hidden");
  aiQuotaEl.dataset.empty = quota.remaining === 0 ? "true" : "false";
  aiQuotaEl.textContent = quota.remaining === 0
    ? t("aiQuotaEmpty")
    : t("aiQuotaRemaining", { remaining: quota.remaining, limit: quota.limit });
}

async function loadAccessStatus() {
  try {
    const response = await fetch("/api/access");
    const data = await response.json();
    if (response.ok && data.ok) renderAccessStatus(data.access);
  } catch {
    aiQuotaEl.classList.add("hidden");
  }
}

async function loadRuntimeStatus() {
  try {
    const response = await fetch("/api/runtime");
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "runtime status unavailable");
    renderRuntimeStatus(data.runtime);
  } catch {
    cacheStatusEl.textContent = "-";
    llmStatusEl.textContent = "-";
    runtimeDetailEl.textContent = t("statusUnavailable");
  }
}

function selectedRanks() {
  return [...rankControl.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
}

function bindSegmented(id, key, coerce = (value) => value) {
  const group = document.querySelector(id);
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    state[key] = coerce(button.dataset.value);
    setActiveButton(group, state[key]);
    scheduleSavePreferences();
  });
}

function metric(label, value) {
  return `<div class="stat"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`;
}

function itemPill(item) {
  const label = localizedName(item, t("item"));
  return `<span class="item${item.locked ? " locked" : ""}${item.compared ? " compared" : ""}" title="${escapeHtml(label)}">
    ${assetThumb(item.iconUrl, label, "item-icon")}
    <span class="item-label">${escapeHtml(label)}</span>
  </span>`;
}

function assetThumb(iconUrl, label, className = "", fallbackIconUrl = null) {
  const text = String(label ?? "?").trim();
  const fallback = text.slice(0, 1) || "?";
  const image = iconUrl
    ? `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy"${fallbackIconUrl ? ` data-fallback-src="${escapeHtml(fallbackIconUrl)}"` : ""} onerror="if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc=''}else{this.hidden=true}">`
    : "";
  return `<span class="asset-thumb ${escapeHtml(className)}" role="img" aria-label="${escapeHtml(text)}" title="${escapeHtml(text)}"><span>${escapeHtml(fallback)}</span>${image}</span>`;
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function rate(value) {
  return hasNumericValue(value) ? `${formatNumber(Number(value) * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : t("unavailable");
}

function placement(value) {
  return hasNumericValue(value) ? formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t("unavailable");
}

function compMetricLabel(key) {
  return {
    top4Rate: t("top4Highest"),
    winRate: t("winHighest"),
    winShare: t("winShareHighest"),
    avgPlacement: t("avgBest"),
    popularity: t("mostPopular")
  }[key] ?? key;
}

function compPrimaryMetric(key, comp) {
  if (key === "winRate") return `${t("winShort")} ${rate(comp.stats?.winRate)}`;
  if (key === "winShare") return `${t("winShareShort")} ${rate(comp.stats?.winShare)}`;
  if (key === "trend") return `↟ ${t("avgPlacementImproved", { value: Math.abs(comp.trend?.avgPlacementChange ?? 0).toFixed(2) })}`;
  if (key === "trendDown") return `↡ ${t("avgPlacementDeclined", { value: Math.abs(comp.trend?.avgPlacementChange ?? 0).toFixed(2) })}`;
  if (key === "avgPlacement") return `${t("avgShort")} ${placement(comp.stats?.avgPlacement)}`;
  if (key === "popularity") return `${t("selectionRate")} ${rate(comp.stats?.selectionRate)}`;
  return `${t("top4Short")} ${rate(comp.stats?.top4Rate)}`;
}

function compTraitLabel(trait) {
  const tier = Number(trait?.tier);
  const name = localizedName(trait);
  return Number.isInteger(tier) && tier > 0 ? `${name} · ${tier}` : name;
}

function compRankLabel(rankFilter = []) {
  return rankFilter.length ? rankFilter.join("/") : t("allRanks");
}

function compUpdatedLabel(value) {
  return value ? `${t("updated")} ${formatDate(value)}` : t("updateUnavailable");
}

function renderCompTrendNotice(data, improving) {
  if (improving.length) return "";
  const status = data.trend?.status;
  const gate = data.trend?.officialGate;
  let message = "";
  if (gate && !gate.ready && status !== "local" && status !== "mixed") {
    message = gate.status === "insufficient"
      ? t("trendGateInsufficient", {
        eligible: gate.eligibleCount ?? 0,
        minimum: gate.minimum ?? 3
      })
      : t("trendGateFieldMissing");
  } else if (status === "warming") {
    message = data.trend?.readyAt
      ? t("trendWarmingReady", { value: escapeHtml(formatDate(data.trend.readyAt)) })
      : t("trendWarming");
  } else if (status === "local" || status === "mixed") {
    message = t("trendNoneLocal");
  } else if (status === "upstream") {
    message = t("trendNoneUpstream");
  } else if (status === "unavailable") {
    message = t("trendUnavailable");
  }
  return message ? `<div class="comp-trend-notice" data-trend-status="${escapeHtml(status)}">${message}</div>` : "";
}

function compTrendSourceLabel(comp) {
  if (comp.trend?.source === "local_72h") return t("trendSourceLocal");
  if (comp.trend?.source === "metatft_page_calculated") return t("trendSourcePageCalculated");
  return t("trendSourceOfficial");
}

function compSignature(comp) {
  const units = [...new Set((comp.units ?? [])
    .map((unit) => String(unit.apiName ?? "").trim())
    .filter((apiName) => /^(?:TFT|DA_)[\w-]+$/i.test(apiName)))];
  const traits = [...new Set((comp.traits ?? [])
    .map((trait) => String(trait.filterId ?? "").trim())
    .filter((filterId) => /^TFT[\w-]+_\d+(?:plus|minus)?$/i.test(filterId)))];
  return units.length && traits.length ? `${units.join("&")}|${traits.join("&")}` : "";
}

function renderCompUnit(unit, comp, expanded = false) {
  const items = expanded && unit.items?.length
    ? `<span class="unit-items">${unit.items.map((item) => assetThumb(item.iconUrl, localizedName(item), "tiny-item-icon")).join("")}</span>`
    : "";
  const averageStar = expanded && hasNumericValue(unit.avgStarLevel)
    ? `<small class="unit-star">${t("avgShort")} ${formatNumber(unit.avgStarLevel, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}★</small>`
    : "";
  const targetStarLevel = Number(unit.targetStarLevel);
  const targetStars = Number.isInteger(targetStarLevel) && targetStarLevel >= 3
    ? `<span class="target-star-badge" title="${escapeHtml(t("targetStarLevel", { value: targetStarLevel }))}" aria-label="${escapeHtml(t("targetStarLevel", { value: targetStarLevel }))}">${"★".repeat(Math.min(4, targetStarLevel))}</span>`
    : "";
  const queryStarLevel = targetStarLevel === 3 ? 3 : 2;
  const unitName = localizedName(unit);
  const queryLabel = t("queryCompUnit", {
    star: queryStarLevel,
    unit: unitName,
    comp: localizedName(comp)
  });
  return `<div class="comp-unit comp-unit-query${unit.core ? " core" : ""}${targetStars ? " has-star-target" : ""}"
    data-comp-unit-query
    data-unit-api-name="${escapeHtml(unit.apiName)}"
    data-unit-name="${escapeHtml(unitName)}"
    data-unit-star-level="${queryStarLevel}"
    role="button"
    tabindex="0"
    title="${escapeHtml(queryLabel)}"
    aria-label="${escapeHtml(queryLabel)}">
    ${targetStars}
    ${assetThumb(unit.iconUrl, unitName, "unit-icon", unit.fallbackIconUrl)}
    ${expanded ? `<span class="unit-name">${escapeHtml(unitName)}</span>${averageStar}${items}` : ""}
  </div>`;
}

function compDetailDescriptor(comp) {
  const compId = String(comp?.source?.clusterId ?? "").trim();
  const dataClusterId = String(comp?.source?.dataClusterId ?? "").trim();
  if (!compId || !dataClusterId) return null;
  const units = [...new Set((comp?.units ?? [])
    .map((unit) => String(unit?.apiName ?? "").trim())
    .filter((apiName) => /^(?:TFT|DA_)[\w-]+$/i.test(apiName)))];
  const seasonContextId = String(state.seasonContextId ?? "").trim();
  const key = [seasonContextId, compId, dataClusterId, units.join(",")].join("|");
  const descriptor = { key, comp, compId, dataClusterId, seasonContextId, units };
  state.compDetailDescriptors.set(key, descriptor);
  return descriptor;
}

function normalizedCompDetailStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function boardCellIndex(cell) {
  const coordinate = (value, maximum) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= maximum ? number : null;
  };
  const zeroBasedIndex = (value) => {
    const number = coordinate(value, 27);
    return number === null ? null : number;
  };
  const metaTftCellIndex = (value) => {
    const number = Number(value);
    // MetaTFT counts cells bottom-first, without serpentine rows: 1..7 => 21..27, 22..28 => 0..6.
    return Number.isInteger(number) && number >= 1 && number <= 28
      ? (3 - Math.floor((number - 1) / 7)) * 7 + ((number - 1) % 7)
      : null;
  };

  if (Array.isArray(cell) && cell.length >= 2) {
    const row = coordinate(cell[0], 3);
    const column = coordinate(cell[1], 6);
    return row === null || column === null ? null : row * 7 + column;
  }
  if (cell && typeof cell === "object") {
    const direct = zeroBasedIndex(cell.index ?? cell.cellIndex);
    if (direct !== null) return direct;
    const row = coordinate(cell.row ?? cell.r ?? cell.y, 3);
    const column = coordinate(cell.column ?? cell.col ?? cell.c ?? cell.x, 6);
    return row === null || column === null ? null : row * 7 + column;
  }
  if (typeof cell === "string") {
    const trimmed = cell.trim();
    if (/^\d+$/u.test(trimmed)) return metaTftCellIndex(trimmed);
    const match = trimmed.match(/^(\d+)\s*[,/:|-]\s*(\d+)$/u);
    if (match) {
      const row = coordinate(match[1], 3);
      const column = coordinate(match[2], 6);
      return row === null || column === null ? null : row * 7 + column;
    }
    return null;
  }
  return metaTftCellIndex(cell);
}

function normalizedDetailItem(item) {
  if (typeof item === "string") return { apiName: item, name: item };
  return item && typeof item === "object" ? item : {};
}

function positionedFormationUnits(comp, formation) {
  const status = normalizedCompDetailStatus(formation?.status);
  if (status === "unavailable" || status === "error" || status === "missing") return new Map();
  const listedUnits = new Map((comp?.units ?? []).map((unit) => [String(unit?.apiName ?? ""), unit]));
  const placed = new Map();
  for (const sourceUnit of formation?.units ?? []) {
    const cell = boardCellIndex(sourceUnit?.cell);
    const apiName = String(sourceUnit?.apiName ?? "").trim();
    if (cell === null || !apiName || placed.has(cell)) continue;
    const listedUnit = listedUnits.get(apiName) ?? {};
    const detailItems = Array.isArray(sourceUnit?.items) ? sourceUnit.items : null;
    placed.set(cell, {
      ...listedUnit,
      ...sourceUnit,
      apiName,
      name: sourceUnit?.name ?? listedUnit.name ?? apiName,
      iconUrl: sourceUnit?.iconUrl ?? listedUnit.iconUrl ?? null,
      fallbackIconUrl: sourceUnit?.fallbackIconUrl ?? listedUnit.fallbackIconUrl ?? null,
      targetStarLevel: sourceUnit?.targetStarLevel ?? listedUnit.targetStarLevel ?? null,
      items: detailItems?.length ? detailItems : (listedUnit.items ?? [])
    });
  }
  return placed;
}

function renderCompBoardUnit(unit, comp) {
  const unitName = localizedName(unit, unit.apiName);
  const targetStarLevel = Number(unit.targetStarLevel);
  const queryStarLevel = targetStarLevel === 3 ? 3 : 2;
  const queryLabel = t("queryCompUnit", {
    star: queryStarLevel,
    unit: unitName,
    comp: localizedName(comp)
  });
  const targetStars = Number.isInteger(targetStarLevel) && targetStarLevel >= 3
    ? `<span class="board-target-star" aria-hidden="true">${"★".repeat(Math.min(4, targetStarLevel))}</span>`
    : "";
  const items = (unit.items ?? []).slice(0, 3).map(normalizedDetailItem);
  return `<div class="comp-board-unit comp-unit-query${unit.core ? " core" : ""}"
    data-comp-unit-query
    data-unit-api-name="${escapeHtml(unit.apiName)}"
    data-unit-name="${escapeHtml(unitName)}"
    data-unit-star-level="${queryStarLevel}"
    role="button"
    tabindex="0"
    title="${escapeHtml(queryLabel)}"
    aria-label="${escapeHtml(queryLabel)}">
    ${targetStars}
    ${assetThumb(unit.iconUrl, unitName, "board-unit-icon", unit.fallbackIconUrl)}
    ${items.length ? `<span class="comp-board-unit-items">${items.map((item) => assetThumb(item.iconUrl, localizedName(item, item.name ?? item.apiName), "tiny-item-icon")).join("")}</span>` : ""}
  </div>`;
}

function renderCompFormation(comp, formation, placedUnits) {
  if (!placedUnits.size) {
    return `<section class="comp-formation" data-status="unavailable"><h3>${escapeHtml(t("compFormation"))}</h3><p>${escapeHtml(t("compFormationUnavailable"))}</p></section>`;
  }
  return `<section class="comp-formation" data-status="available">
    <h3>${escapeHtml(t("compFormation"))}</h3>
    <div class="comp-hex-board" role="group" aria-label="${escapeHtml(t("compFormation"))}">
      ${Array.from({ length: 28 }, (_, cell) => {
        const row = Math.floor(cell / 7);
        const unit = placedUnits.get(cell);
        return `<div class="comp-hex-cell${row % 2 ? " is-offset" : ""}${unit ? " is-occupied" : ""}" data-cell="${cell}" data-row="${row}" data-column="${cell % 7}">${unit ? renderCompBoardUnit(unit, comp) : ""}</div>`;
      }).join("")}
    </div>
  </section>`;
}

function augmentCompatibilityTier(entry) {
  const tier = String(entry?.tier ?? "").trim().toUpperCase();
  return /^[SABCD]$/u.test(tier) ? tier : "unknown";
}

function augmentCompatibilityLabel(tier) {
  return tier === "unknown"
    ? t("augmentCompatibilityUnavailable")
    : t("augmentCompatibilityTier", { value: tier });
}

function augmentRarity(entry) {
  const raw = String(entry?.rarity ?? "").trim().toLowerCase();
  if (raw === "3" || /prismatic|orange/u.test(raw)) return "prismatic";
  if (raw === "2" || /gold/u.test(raw)) return "gold";
  if (raw === "1" || /silver/u.test(raw)) return "silver";
  return "unknown";
}

function augmentRarityLabel(rarity) {
  return t({
    prismatic: "augmentRarityPrismatic",
    gold: "augmentRarityGold",
    silver: "augmentRaritySilver",
    unknown: "augmentRarityUnknown"
  }[rarity] ?? "augmentRarityUnknown");
}

const DISPLAYED_COMP_AUGMENT_RARITIES = new Set(["gold", "prismatic"]);
const DISPLAYED_COMP_AUGMENT_LIMIT = 6;

function availableAugmentEntries(recommendations) {
  const status = normalizedCompDetailStatus(recommendations?.status);
  if (status === "unavailable" || status === "error" || status === "missing") return [];
  return (recommendations?.entries ?? [])
    .filter((entry) => (
      entry
      && typeof entry === "object"
      && (entry.apiName || entry.name)
      && DISPLAYED_COMP_AUGMENT_RARITIES.has(augmentRarity(entry))
    ))
    .slice(0, DISPLAYED_COMP_AUGMENT_LIMIT);
}

function renderCompAugments(entries) {
  if (!entries.length) return "";
  return `<section class="comp-augment-recommendations">
    <h3>${escapeHtml(t("compAugmentRecommendations"))}</h3>
    <div class="comp-augment-list">
      ${entries.map((entry) => {
        const tier = augmentCompatibilityTier(entry);
        const rarity = augmentRarity(entry);
        const name = entry.enName ?? entry.name ?? localizedName(entry, entry.apiName);
        const compatibilityLabel = augmentCompatibilityLabel(tier);
        return `<div class="comp-augment-chip" data-tier="${tier}" data-rarity="${rarity}" title="${escapeHtml(`${name} · ${compatibilityLabel}`)}">
          ${assetThumb(entry.iconUrl, name, "augment-icon", entry.fallbackIconUrl)}
          <span class="comp-augment-copy"><strong>${escapeHtml(name)}</strong>${rarity === "unknown" ? "" : `<small>${escapeHtml(augmentRarityLabel(rarity))}</small>`}</span>
          <span class="comp-augment-tier" data-tier="${tier}">${escapeHtml(compatibilityLabel)}</span>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function compDetailSourceLabel(source) {
  return [source?.provider, source?.endpoint].map((value) => String(value ?? "").trim()).filter(Boolean).join(" / ");
}

function renderCompDetailContent(descriptor) {
  const detailState = state.compDetailCache.get(descriptor.key);
  if (!detailState || detailState.status === "loading") {
    return `<div class="comp-detail-state" data-status="loading" aria-live="polite">${escapeHtml(t("compDetailLoading"))}</div>`;
  }
  if (detailState.status === "error") {
    return `<div class="comp-detail-state" data-status="error" role="alert"><span>${escapeHtml(t("compDetailLoadFailed"))}</span><small>${escapeHtml(detailState.error ?? "")}</small><button type="button" data-retry-comp-detail data-comp-detail-key="${escapeHtml(descriptor.key)}">${escapeHtml(t("retry"))}</button></div>`;
  }
  const detail = detailState.data ?? {};
  const placedUnits = positionedFormationUnits(descriptor.comp, detail.formation);
  const augmentEntries = availableAugmentEntries(detail.augmentRecommendations);
  if (!placedUnits.size && !augmentEntries.length) {
    return `<div class="comp-detail-state" data-status="unavailable">${escapeHtml(t("compDetailUnavailable"))}</div>`;
  }
  const sourceLabel = compDetailSourceLabel(detail.source);
  return `${renderCompFormation(descriptor.comp, detail.formation, placedUnits)}${renderCompAugments(augmentEntries)}${sourceLabel ? `<small class="comp-detail-source">${escapeHtml(t("sourceLabel"))}：${escapeHtml(sourceLabel)}</small>` : ""}`;
}

function renderCompDetailPanel(descriptor) {
  if (!descriptor) {
    return `<section class="comp-tactical-detail" data-status="unavailable"><div class="comp-detail-state" data-status="unavailable">${escapeHtml(t("compDetailUnavailable"))}</div></section>`;
  }
  return `<section class="comp-tactical-detail" data-comp-detail data-comp-detail-key="${escapeHtml(descriptor.key)}" data-comp-detail-comp="${escapeHtml(descriptor.compId)}" data-comp-detail-cluster-id="${escapeHtml(descriptor.dataClusterId)}" data-comp-detail-units="${escapeHtml(descriptor.units.join(","))}">${renderCompDetailContent(descriptor)}</section>`;
}

function updateCompDetailPanels(key) {
  const descriptor = state.compDetailDescriptors.get(key);
  if (!descriptor) return;
  for (const panel of resultContentEl.querySelectorAll("[data-comp-detail][data-comp-detail-key]")) {
    if (panel.dataset.compDetailKey === key) panel.innerHTML = renderCompDetailContent(descriptor);
  }
}

async function loadCompDetail(descriptor, { retry = false } = {}) {
  const cached = state.compDetailCache.get(descriptor.key);
  if (!retry && (cached?.status === "ready" || cached?.status === "unavailable" || cached?.status === "loading")) return;
  if (state.compDetailRequests.has(descriptor.key)) return state.compDetailRequests.get(descriptor.key);

  state.compDetailCache.set(descriptor.key, { status: "loading" });
  updateCompDetailPanels(descriptor.key);
  const request = (async () => {
    try {
      const params = new URLSearchParams({
        comp: descriptor.compId,
        clusterId: descriptor.dataClusterId,
        seasonContextId: descriptor.seasonContextId,
        units: descriptor.units.join(",")
      });
      const response = await fetch(`/api/comp-details?${params.toString()}`, {
        headers: { accept: "application/json" }
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      const detail = payload?.detail ?? payload?.data ?? payload ?? {};
      const hasFormation = positionedFormationUnits(descriptor.comp, detail.formation).size > 0;
      const hasAugments = availableAugmentEntries(detail.augmentRecommendations).length > 0;
      state.compDetailCache.set(descriptor.key, {
        status: hasFormation || hasAugments ? "ready" : "unavailable",
        data: detail
      });
    } catch (error) {
      state.compDetailCache.set(descriptor.key, {
        status: "error",
        error: error?.message ?? t("compDetailLoadFailed")
      });
    } finally {
      state.compDetailRequests.delete(descriptor.key);
      updateCompDetailPanels(descriptor.key);
    }
  })();
  state.compDetailRequests.set(descriptor.key, request);
  return request;
}

function loadCompDetailForCard(card) {
  const key = card?.dataset?.compDetailKey;
  const descriptor = key ? state.compDetailDescriptors.get(key) : null;
  if (!descriptor) return;
  return loadCompDetail(descriptor);
}

function queueOpenCompDetailLoads() {
  queueMicrotask(() => {
    for (const card of resultContentEl.querySelectorAll(".comp-card[open][data-comp-detail-key]")) {
      void loadCompDetailForCard(card);
    }
  });
}

function clearCompDetailState() {
  state.compDetailCache.clear();
  state.compDetailRequests.clear();
  state.compDetailDescriptors.clear();
}

function renderCompCard(comp, metricKey, initiallyOpen = false) {
  const mainTraits = (comp.traits ?? []).filter((trait) => !/UniqueTrait|SummonTrait/.test(trait.filterId ?? trait.apiName)).slice(0, 3);
  const coreUnits = (comp.units ?? []).filter((unit) => unit.core).slice(0, 4);
  const foldedUnits = coreUnits.length ? coreUnits : (comp.units ?? []).slice(0, 5);
  const appearanceRate = hasNumericValue(comp.stats?.selectionRate)
    ? Number(comp.stats.selectionRate)
    : hasNumericValue(comp.stats?.pickRate)
      ? Number(comp.stats.pickRate) * 8
      : null;
  const metricSubline = metricKey === "trend" || metricKey === "trendDown"
    ? `${t("selectionRate")} ${rate(appearanceRate)} · ${formatNumber(comp.stats?.games ?? 0)} ${t("games")}`
    : `${formatNumber(comp.stats?.games ?? 0)} ${t("games")}`;
  const trendVariant = metricKey === "trend" ? "trend" : metricKey === "trendDown" ? "trend-down" : "ranking";
  const signature = compSignature(comp);
  const detailDescriptor = compDetailDescriptor(comp);
  const detailDataAttribute = detailDescriptor ? `data-comp-detail-key="${escapeHtml(detailDescriptor.key)}"` : "";
  return `
    <details class="comp-card" data-variant="${trendVariant}"
      data-comp-name="${escapeHtml(localizedName(comp))}"
      data-comp-signature="${escapeHtml(signature)}"
      ${detailDataAttribute}
      ${initiallyOpen ? "open" : ""}>
      <summary>
        <div class="comp-summary-main">
          <strong>${escapeHtml(localizedName(comp))}</strong>
          ${comp.lowSample ? `<span class="low-sample-label">${t("lowSample")}</span>` : ""}
          ${metricKey === "popularity" && comp.contested ? `<span class="contested-label">${t("contested")}</span>` : ""}
          <div class="trait-row">${mainTraits.map((trait) => assetThumb(trait.iconUrl, compTraitLabel(trait), "trait-icon")).join("")}</div>
          <div class="unit-row">${foldedUnits.map((unit) => renderCompUnit(unit, comp)).join("")}</div>
        </div>
        <div class="comp-summary-metric">
          <b>${escapeHtml(compPrimaryMetric(metricKey, comp))}</b>
          <span>${escapeHtml(metricSubline)}</span>
        </div>
      </summary>
      <div class="comp-expanded">
        <div class="comp-stat-line">
          <span>${t("top4Short")} ${rate(comp.stats?.top4Rate)}</span>
          <span>${t("winShort")} ${rate(comp.stats?.winRate)}</span>
          <span>${t("winShareShort")} ${rate(comp.stats?.winShare)}</span>
          <span>${t("avgShort")} ${placement(comp.stats?.avgPlacement)}</span>
          <span>${t("appearanceShort")} ${rate(appearanceRate)}</span>
        </div>
        ${metricKey === "trend" || metricKey === "trendDown" ? `<div class="trend-model-line"><span>${escapeHtml(compTrendSourceLabel(comp))}</span><small>${t("trendWindow")}</small></div>` : ""}
        ${renderCompDetailPanel(detailDescriptor)}
        <div class="full-unit-grid">${(comp.units ?? []).map((unit) => renderCompUnit(unit, comp, true)).join("")}</div>
        <div class="full-trait-row">${(comp.traits ?? []).map((trait) => `<span>${assetThumb(trait.iconUrl, compTraitLabel(trait), "trait-icon")}<small>${escapeHtml(compTraitLabel(trait))}</small></span>`).join("")}</div>
        <div class="comp-source">${t("sourceLabel")}：MetaTFT /comps_stats${comp.source?.clusterId ? ` / cluster ${escapeHtml(comp.source.clusterId)}` : ""} / ${escapeHtml(compUpdatedLabel(comp.source?.updatedAt))}</div>
      </div>
    </details>`;
}

function defaultPopularCompMetric(data) {
  if (data.query?.sort === "win_first") return "winRate";
  if (data.query?.sort === "avg_first" || data.query?.sort === "robust_first") return "avgPlacement";
  return "top4Rate";
}

function renderPopularMetricSwitch(activeMetric) {
  const metrics = ["avgPlacement", "top4Rate", "winRate", "popularity"];
  return `<div class="comp-metric-switch" role="group" aria-label="${escapeHtml(t("rankingStandard"))}">
    ${metrics.map((metric) => `<button type="button" data-comp-metric="${metric}" class="${metric === activeMetric ? "active" : ""}" aria-pressed="${metric === activeMetric}">${escapeHtml(compMetricLabel(metric))}</button>`).join("")}
  </div>`;
}

function compPreferenceValueLabel(field, value) {
  const labels = {
    strategy: { reroll: "preferenceReroll", fast8: "preferenceFast8", fast9: "preferenceFast9" },
    goal: { top4: "preferenceTop4", top1: "preferenceTop1", balanced: "preferenceBalanced" },
    contested: { low: "preferenceLow", medium: "preferenceMedium", high: "preferenceHigh" },
    difficulty: { low: "preferenceLow", medium: "preferenceMedium", high: "preferenceHigh" }
  };
  return labels[field]?.[value] ? t(labels[field][value]) : String(value);
}

function renderCompPreferenceSummary(data) {
  const search = data.preferenceSearch;
  if (!search) return "";
  const conditions = search.conditions ?? {};
  const chips = [];
  if (conditions.strategy) chips.push(t("preferenceStrategy", { value: compPreferenceValueLabel("strategy", conditions.strategy) }));
  if (conditions.reroll === false) chips.push(t("preferenceNoReroll"));
  if (conditions.goal) chips.push(t("preferenceGoal", { value: compPreferenceValueLabel("goal", conditions.goal) }));
  if (conditions.contested) chips.push(t("preferenceContested", { value: compPreferenceValueLabel("contested", conditions.contested) }));
  if (conditions.difficulty) chips.push(t("preferenceDifficulty", { value: compPreferenceValueLabel("difficulty", conditions.difficulty) }));
  if (conditions.beginnerFriendly !== null && conditions.beginnerFriendly !== undefined) {
    chips.push(t(conditions.beginnerFriendly ? "preferenceBeginner" : "preferenceExperienced"));
  }
  chips.push(conditions.returnAll
    ? t("preferenceAll")
    : t("preferenceCount", { value: conditions.count ?? search.requestedCount ?? 3 }));
  const statusKey = {
    ok: "preferenceStatusOk",
    low_sample_only: "preferenceStatusLowSample",
    insufficient_profile: "preferenceStatusProfile",
    insufficient_evidence: "preferenceStatusEvidence",
    zero_results: "preferenceStatusZero"
  }[search.status] ?? "preferenceStatusEvidence";
  return `<section class="comp-preference-summary" data-status="${escapeHtml(search.status ?? "unknown")}">
    <div><strong>${t("preferenceSearchTitle")}</strong><span>${escapeHtml(t(statusKey))}</span></div>
    <div class="comp-preference-chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
    <small>${conditions.returnAll
      ? t("preferenceReturnedAll", { returned: search.returnedCount ?? 0 })
      : t("preferenceReturned", { returned: search.returnedCount ?? 0, requested: search.requestedCount ?? conditions.count ?? 3 })} · ${t("deterministicRanking")}</small>
  </section>`;
}

function renderCompRankings(data) {
  if (data.type === "comp_analysis") {
    renderCompAnalysis(data);
    return;
  }
  const references = data.references ?? [];
  const isTrendView = data.type === "comp_trends";
  const rising = data.rising ?? data.improving ?? [];
  const falling = data.falling ?? [];
  const popularity = data.rankings?.popularity ?? [];
  const isPopularView = !isTrendView && Boolean(data.query?.popularRequested);
  let sections;
  let metricSwitch = "";
  if (isTrendView) {
    sections = [];
  } else if (isPopularView) {
    const availableMetrics = ["avgPlacement", "top4Rate", "winRate", "popularity"]
      .filter((metric) => data.rankings?.[metric]?.length);
    const defaultMetric = defaultPopularCompMetric(data);
    if (!availableMetrics.includes(state.compRankingMetric)) {
      state.compRankingMetric = availableMetrics.includes(defaultMetric)
        ? defaultMetric
        : availableMetrics[0] ?? null;
    }
    sections = state.compRankingMetric
      ? [[state.compRankingMetric, data.rankings[state.compRankingMetric]]]
      : [];
    metricSwitch = renderPopularMetricSwitch(state.compRankingMetric);
  } else {
    sections = Object.entries(data.rankings ?? {}).filter(([, comps]) => comps?.length);
  }
  const stale = data.cache?.query?.stale ? t("staleCache") : data.cache?.query?.hit ? t("localCache") : t("live");
  const hasTrendData = rising.length || falling.length || popularity.length;
  if (!sections.length && !references.length && !hasTrendData) {
    setResponseHtml(`
      <div class="empty-state">
        <div>${t("noCompData")}</div>
        <small>${t("daysRecent", { value: escapeHtml(data.query?.days ?? 3) })} · ${t("samplesAtLeast", { value: escapeHtml(data.query?.minSamples ?? 500) })} · ${t("rank")} ${escapeHtml(compRankLabel(data.query?.rankFilter))}</small>
        <small>${escapeHtml(compUpdatedLabel(data.source?.updatedAt))}</small>
      </div>
      ${renderCompPreferenceSummary(data)}
      ${(data.warnings ?? []).map((warning) => `<div class="comp-warning">${escapeHtml(warning)}</div>`).join("")}
      ${renderCompTrendNotice(data, [])}
      <div class="comp-footnote">${escapeHtml(data.source?.risk ?? t("externalRisk"))}</div>${sourceAndRisk(data)}`);
    return;
  }
  let firstCompCard = true;
  const renderCompCards = (comps, metricKey) => (comps ?? []).map((comp) => {
    const initiallyOpen = firstCompCard;
    firstCompCard = false;
    return renderCompCard(comp, metricKey, initiallyOpen);
  }).join("");
  setResponseHtml(`
    <div class="comp-overview">
      <strong>${t(isTrendView ? "currentCompTrends" : "currentCompRanking")}</strong>
      <span>${t("daysRecent", { value: escapeHtml(data.query?.days ?? 3) })} · ${t("samplesAtLeast", { value: escapeHtml(data.query?.minSamples ?? 500) })} · ${escapeHtml(stale)}</span>
      <small title="${escapeHtml(compRankLabel(data.query?.rankFilter))}">${t("rank")} ${escapeHtml(compRankLabel(data.query?.rankFilter))} · ${escapeHtml(compUpdatedLabel(data.source?.updatedAt))}</small>
    </div>
    ${renderCompPreferenceSummary(data)}
    ${(data.warnings ?? []).map((warning) => `<div class="comp-warning">${escapeHtml(warning)}</div>`).join("")}
    ${isTrendView ? renderCompTrendNotice(data, [...rising, ...falling]) : ""}
    ${isPopularView ? `<div class="popular-ranking-toolbar"><span>${t("popularCompSample", { value: 21 })}</span>${metricSwitch}</div>` : ""}
    ${isTrendView && rising.length ? `<section class="ranking-section improving-section"><h2>${t("risingComps")}</h2><p class="trend-method">${t("risingFormula")}</p>${renderCompCards(rising, "trend")}</section>` : ""}
    ${isTrendView && falling.length ? `<section class="ranking-section falling-section"><h2>${t("fallingComps")}</h2><p class="trend-method">${t("fallingFormula")}</p>${renderCompCards(falling, "trendDown")}</section>` : ""}
    ${isTrendView && popularity.length ? `<section class="ranking-section popularity-section"><h2>${t("selectionRateTop")}</h2>${renderCompCards(popularity, "popularity")}</section>` : ""}
    ${sections.map(([key, comps]) => `<section class="ranking-section"><h2>${escapeHtml(compMetricLabel(key))}</h2>${renderCompCards(comps, key)}</section>`).join("")}
    ${references.length ? `<section class="ranking-section low-sample-section"><h2>${t("lowSampleSection")}</h2>${renderCompCards(references, "popularity")}</section>` : ""}
    <div class="comp-footnote">${escapeHtml(data.source?.risk ?? t("externalRisk"))}</div>${sourceAndRisk(data)}`);
  queueOpenCompDetailLoads();
}

function feedbackActions(cardIndex) {
  const sentiment = state.feedbackByCard[cardIndex];
  return `
    <div class="result-feedback" data-feedback-card="${cardIndex}">
      <button type="button" class="feedback-button${sentiment === "good" ? " selected" : ""}" data-result-feedback="good" data-card-index="${cardIndex}" aria-label="${t("helpful")}" title="${t("helpful")}" ${sentiment ? "disabled" : ""}>↑ <span>${t("helpful")}</span></button>
      <button type="button" class="feedback-button${sentiment === "bad" ? " selected" : ""}" data-result-feedback="bad" data-card-index="${cardIndex}" aria-label="${t("notHelpful")}" title="${t("notHelpful")}" ${sentiment ? "disabled" : ""}>↓ <span>${t("notHelpful")}</span></button>
      <span class="feedback-status" aria-live="polite">${sentiment ? t("recorded") : ""}</span>
      ${feedbackReasonPicker("recommendation", cardIndex)}
    </div>
  `;
}

function feedbackReasonPicker(target, cardIndex = null) {
  const recommendationOptions = [
    ["entity_parse_error", "feedbackReasonEntityParse"],
    ["wrong_comp_context", "feedbackReasonCompContext"],
    ["wrong_items", "feedbackReasonItems"],
    ["outdated_data", "feedbackReasonOutdated"],
    ["low_sample", "feedbackReasonLowSample"],
    ["answer_unclear", "feedbackReasonUnclear"],
    ["other", "feedbackReasonOther"]
  ];
  const explanationOptions = [
    ["answer_unclear", "feedbackReasonUnclear"],
    ["explanation_incorrect", "feedbackReasonIncorrect"],
    ["missing_information", "feedbackReasonMissing"],
    ["outdated_data", "feedbackReasonOutdated"],
    ["other", "feedbackReasonOther"]
  ];
  const options = target === "explanation" ? explanationOptions : recommendationOptions;
  const cardAttribute = Number.isInteger(cardIndex) ? ` data-card-index="${cardIndex}"` : "";
  return `
    <div class="feedback-reasons" data-feedback-reasons="${target}"${cardAttribute} hidden>
      <label>
        <span>${t("feedbackReasonPrompt")}</span>
        <select data-feedback-reason>
          <option value="">${t("feedbackReasonSkip")}</option>
          ${options.map(([value, key]) => `<option value="${value}">${t(key)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="feedback-reason-submit" data-feedback-reason-submit="${target}">${t("feedbackReasonSend")}</button>
    </div>
  `;
}

function compactTraitName(name) {
  return String(name ?? "")
    .replace(/^TFT\d*_/, "")
    .replace(/_1$/, "");
}

function compactTraitList(names = []) {
  if (!names.length) return t("noTraits");
  const compacted = names.map(compactTraitName);
  if (compacted.length <= 2) return compacted.join(" + ");
  return `${compacted.slice(0, 2).join(" + ")} +${compacted.length - 2}`;
}

function formatCacheUpdatedAt(value) {
  return value ? formatDate(value) : null;
}

function queryCacheLine(cache = {}) {
  if (!cache?.hit) return t("live");
  const label = cache.stale
    ? t("staleCache")
    : cache.revalidating
      ? t("cacheRefreshing")
      : t("localCache");
  const updatedAt = formatCacheUpdatedAt(cache.updatedAt);
  return updatedAt ? `${label} / ${t("updated")} ${updatedAt}` : label;
}

function compConstraintLine(comp) {
  if (comp?.status === "not_available") {
    return t("noStableCompLine");
  }
  if (comp?.status !== "applied" || !comp.value) return t("unrestrictedCompLine");
  return comp.value.selection === "explicit"
    ? t("explicitCompLine", { name: comp.value.name })
    : t("automaticCompLine", { name: comp.value.name, samples: comp.value.sampleCount });
}

function entityTypeLabel(type) {
  return {
    unit: t("hero"),
    item: t("item"),
    trait: t("trait")
  }[type] ?? type ?? "-";
}

function candidateLabel(candidate) {
  return candidate?.label ?? candidate?.matchedAlias ?? candidate?.apiName ?? "";
}

function candidateQueryText(candidate) {
  return (candidate?.queryText ?? candidateLabel(candidate)) || candidate?.apiName || "";
}

function canSaveCandidateAlias(candidate) {
  const inputFragment = normalizeUiAlias(candidate?.inputFragment);
  if (!inputFragment || !candidate?.apiName || !candidate?.entityType) return false;
  return inputFragment !== normalizeUiAlias(candidate.matchedAlias);
}

function renderSuggestionButtons(suggestions = [], responseId = "") {
  if (!suggestions.length) return "";
  return `
    <div class="suggestions">
      ${suggestions.map((item, index) => `
        <button type="button" data-suggestion-index="${index}" data-response-id="${escapeHtml(responseId)}">${escapeHtml(item)}</button>
      `).join("")}
    </div>
  `;
}

function renderEntityCandidates(candidates = [], responseId = "") {
  if (!candidates.length) return "";
  return `
    <div class="entity-candidates">
      ${candidates.map((candidate, index) => `
        <div class="candidate-row">
          <div class="candidate-main">
            <strong>${escapeHtml(candidateLabel(candidate))}</strong>
            <span>${escapeHtml(entityTypeLabel(candidate.entityType))} / ${escapeHtml(candidate.apiName)}</span>
            <small>${escapeHtml(candidate.inputFragment ?? candidate.matchedAlias ?? "")} -> ${escapeHtml(candidate.matchedAlias ?? "")} · ${Math.round(Number(candidate.confidence ?? 0) * 100)}%</small>
          </div>
          <div class="candidate-actions">
            <button type="button" data-candidate-action="query" data-candidate-index="${index}" data-response-id="${escapeHtml(responseId)}">${t("query")}</button>
            ${canSaveCandidateAlias(candidate) ? `<button type="button" data-candidate-action="save" data-candidate-index="${index}" data-response-id="${escapeHtml(responseId)}">${t("saveCandidate")}</button>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function summaryLines(data) {
  const query = data.query ?? {};
  const traits = compactTraitList(getLocale() === "en-US" ? query.traitFilters : query.traitNames);
  const cache = queryCacheLine(data.cache?.query);
  const comp = compConstraintLine(query.comp);
  const warnings = query.warnings?.length ? t("notices", { count: query.warnings.length }) : null;
  const excludedNames = getLocale() === "en-US" ? query.excludedItems : query.excludedItemNames;
  const exclusions = excludedNames?.length
    ? t("excludedSummary", { value: excludedNames.join(" + ") })
    : null;
  const locked = query.lockedItemNames?.length
    ? t("lockedSummary", { value: query.lockedItemNames.join(" + ") })
    : null;
  const comparisonAssumption = query.assumptions?.find((entry) => entry.key === "comparison_items");
  const comparisonOrigins = comparisonAssumption?.value?.length
    ? comparisonAssumption.origins ?? (comparisonAssumption.origin ? [comparisonAssumption.origin] : [])
    : [];
  const comparisonSource = comparisonOrigins.length
    ? t("candidateSource", { value: comparisonOrigins.map(constraintSourceLabel).join(" + ") })
    : null;
  const unitName = getLocale() === "en-US" ? query.unit : query.unitName;

  return [
    `<strong>${escapeHtml(t("starLevel", { value: query.starLevel?.join("/") ?? "-" }))} ${escapeHtml(unitName ?? "-")}</strong> / ${escapeHtml(traits)} / ${escapeHtml(t("samplesAtLeast", { value: query.minSamples ?? "-" }))}`,
    escapeHtml(comp),
    `${escapeHtml(cache)} / ${escapeHtml(data.meta?.durationMs ?? 0)}ms`,
    locked ? escapeHtml(locked) : null,
    exclusions ? escapeHtml(exclusions) : null,
    comparisonSource ? escapeHtml(comparisonSource) : null,
    warnings
  ].filter(Boolean).map((line) => `<div>${line}</div>`).join("");
}

function renderItemDetails(data) {
  const item = data.item ?? {};
  const recipe = item.recipe ?? [];
  const recipeHtml = recipe.length
    ? `<div class="items">${recipe.map(itemPill).join('<span class="recipe-plus">+</span>')}</div>`
    : `<div class="detail-muted">${escapeHtml(t("notCraftable"))}</div>`;
  const effect = escapeHtml(item.effect ?? t("missingOfficialItemDetails")).replace(/\n/g, "<br>");

  setResponseHtml(`
    <article class="result-card item-detail-card">
      <div class="card-head"><div class="card-title">${escapeHtml(item.name ?? t("itemDetails"))}</div><div class="detail-category">${escapeHtml(item.category ?? "")}</div></div>
      <strong class="detail-label">${escapeHtml(t("recipeRoute"))}</strong>${recipeHtml}
      <strong class="detail-label">${escapeHtml(t("effectAndStats"))}</strong><div class="detail-effect">${effect}</div>
    </article>
  `);
}

function entitySourceLine(source) {
  if (!source) return "";
  const parts = [source.season, source.version, source.updatedAt].filter(Boolean);
  return parts.length ? `<div class="entity-source">${escapeHtml(parts.join(" · "))}</div>` : "";
}

function entityStat(label, value, suffix = "") {
  const present = value !== null && value !== undefined && value !== "";
  const display = present ? `${value}${suffix}` : "-";
  return `<div class="entity-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(display)}</strong></div>`;
}

function entityCatalogCard(entry) {
  const name = localizedName(entry, entry.name);
  const role = getLocale() === "en-US" ? (entry.roleEn ?? entry.role) : (entry.roleZh ?? entry.role);
  const traitNames = getLocale() === "en-US"
    ? (entry.traitNamesEn ?? entry.traitNames ?? [])
    : (entry.traitNamesZh ?? entry.traitNames ?? []);
  const search = [
    name,
    entry.zhName,
    entry.enName,
    entry.apiName,
    role,
    entry.traitType,
    ...traitNames
  ].filter(Boolean).join(" ").toLocaleLowerCase(getLocale());
  const isUnit = entry.entityType === "unit";
  const metadata = isUnit
    ? [
      entry.cost ? t("unitCost", { value: entry.cost }) : null,
      role
    ].filter(Boolean).join(" · ")
    : entry.traitType === "race"
      ? t("catalogOrigin")
      : entry.traitType === "job"
        ? t("catalogClass")
        : "";
  const chips = isUnit
    ? traitNames.slice(0, 3)
    : (entry.tierCounts ?? []).map((value) => t("unitsRequired", { value }));

  return `
    <button type="button"
      class="entity-catalog-card"
      data-entity-detail
      data-entity-type="${escapeHtml(entry.entityType)}"
      data-entity-id="${escapeHtml(entry.apiName)}"
      data-catalog-search="${escapeHtml(search)}"
      data-catalog-cost="${escapeHtml(entry.cost ?? "")}"
      data-catalog-trait-type="${escapeHtml(entry.traitType ?? "")}"
      aria-label="${escapeHtml(t("openEntityDetails", { name }))}">
      ${assetThumb(entry.iconUrl, name, "entity-catalog-icon")}
      <span class="entity-catalog-copy">
        <strong>${escapeHtml(name)}</strong>
        ${metadata ? `<small>${escapeHtml(metadata)}</small>` : ""}
        ${chips.length ? `<span class="entity-catalog-chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</span>` : ""}
      </span>
      <span class="entity-catalog-arrow" aria-hidden="true">→</span>
    </button>`;
}

function applyEntityCatalogFilters() {
  const root = resultContentEl.querySelector("[data-entity-catalog]");
  if (!root) return;
  const search = root.querySelector("[data-catalog-query]")?.value.trim().toLocaleLowerCase(getLocale()) ?? "";
  const selected = root.querySelector("[data-catalog-filter]")?.value ?? "";
  let visible = 0;
  const cards = [...root.querySelectorAll("[data-entity-detail]")];
  for (const card of cards) {
    const matchesSearch = !search || String(card.dataset.catalogSearch ?? "").includes(search);
    const filterValue = root.dataset.entityType === "unit"
      ? card.dataset.catalogCost
      : card.dataset.catalogTraitType;
    const matchesFilter = !selected || filterValue === selected;
    const show = matchesSearch && matchesFilter;
    card.hidden = !show;
    if (show) visible += 1;
  }
  const count = root.querySelector("[data-catalog-visible-count]");
  if (count) count.textContent = t("catalogVisibleCount", { visible, total: cards.length });
  const empty = root.querySelector("[data-catalog-empty]");
  if (empty) empty.hidden = visible > 0;
}

function renderEntityCatalog(data) {
  const entityType = data.entityType === "trait" ? "trait" : "unit";
  const title = entityType === "unit" ? t("unitCatalog") : t("traitCatalog");
  const items = data.items ?? [];
  const costs = [...new Set(items.map((entry) => Number(entry.cost)).filter(Number.isFinite))].sort((a, b) => a - b);
  const filterOptions = entityType === "unit"
    ? costs.map((cost) => `<option value="${cost}">${escapeHtml(t("unitCost", { value: cost }))}</option>`).join("")
    : `<option value="race">${escapeHtml(t("catalogOrigin"))}</option><option value="job">${escapeHtml(t("catalogClass"))}</option>`;
  const total = data.pagination?.total ?? items.length;
  const summary = t(entityType === "unit" ? "catalogUnitSummary" : "catalogTraitSummary", { value: total });

  setResponseHtml(`
    ${resultHeader(title, summary, t("catalogCount", { value: total }))}
    <section class="entity-catalog" data-entity-catalog data-entity-type="${entityType}">
      <div class="entity-catalog-controls">
        <label class="entity-catalog-control entity-catalog-search">
          <span class="sr-only">${escapeHtml(t("catalogSearch"))}</span>
          <input type="search" data-catalog-query placeholder="${escapeHtml(t("catalogSearch"))}" autocomplete="off">
        </label>
        <label class="entity-catalog-control entity-catalog-filter">
          <span class="sr-only">${escapeHtml(entityType === "unit" ? t("catalogAllCosts") : t("catalogAllTypes"))}</span>
          <select data-catalog-filter>
            <option value="">${escapeHtml(entityType === "unit" ? t("catalogAllCosts") : t("catalogAllTypes"))}</option>
            ${filterOptions}
          </select>
        </label>
        <span class="entity-catalog-count" data-catalog-visible-count>${escapeHtml(t("catalogVisibleCount", { visible: items.length, total: items.length }))}</span>
      </div>
      <div class="entity-catalog-grid">${items.map(entityCatalogCard).join("")}</div>
      <div class="empty-state entity-catalog-empty" data-catalog-empty ${items.length ? "hidden" : ""}>${escapeHtml(t("catalogEmpty"))}</div>
    </section>
    ${entitySourceLine(data.source)}
  `);
}

function renderUnitDetails(data) {
  const unit = data.unit ?? {};
  const unitName = localizedName(unit, unit.name ?? t("unitDetails"));
  const unitRole = getLocale() === "en-US" ? (unit.roleEn ?? unit.role) : (unit.roleZh ?? unit.role);
  const unitTraitNames = getLocale() === "en-US"
    ? (unit.traitNamesEn ?? unit.traitNames ?? [])
    : (unit.traitNamesZh ?? unit.traitNames ?? []);
  const stats = unit.stats ?? {};
  const ability = unit.ability ?? {};
  const recommendations = data.recommendedItems ?? [];
  const manaValue = hasNumericValue(stats.startingMana) && hasNumericValue(stats.mana)
    ? `${stats.startingMana}/${stats.mana}`
    : stats.mana;
  const recommendationHtml = recommendations.length
    ? `<div class="stable-item-grid">${recommendations.map((item, index) => `
        <article class="stable-item-card">
          <div class="stable-item-head"><b>#${index + 1}</b>${itemPill(item)}</div>
          <div class="stable-item-stats">
            <span>${escapeHtml(t("metricSamples"))} <b>${formatNumber(item.stats?.games ?? 0)}</b></span>
            <span>${escapeHtml(t("metricTop4Rate"))} <b>${formatNumber(item.stats?.top4 ?? 0)}%</b></span>
            <span>${escapeHtml(t("metricAvgPlacement"))} <b>${formatNumber(item.stats?.avg ?? 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
          </div>
        </article>`).join("")}</div>`
    : `<div class="detail-muted">${escapeHtml(t("noStableItems"))}</div>`;
  const abilityDescription = escapeHtml(ability.description ?? "-").replace(/\n/g, "<br>");

  setResponseHtml(`
    <article class="result-card entity-detail-card">
      <header class="entity-detail-head">
        ${assetThumb(unit.iconUrl, unitName, "entity-icon")}
        <div><div class="card-title">${escapeHtml(unitName)}</div><small>${unit.cost ? escapeHtml(t("unitCost", { value: unit.cost })) : ""}${unitRole ? ` · ${escapeHtml(unitRole)}` : ""}</small></div>
      </header>
      ${unitTraitNames.length ? `<div class="entity-chips">${unitTraitNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : ""}
      <strong class="detail-label">${escapeHtml(t("baseStats"))}</strong>
      <div class="entity-stat-grid">
        ${entityStat(t("health"), stats.health)}${entityStat(t("mana"), manaValue)}${entityStat(t("attackDamage"), stats.attackDamage)}${entityStat(t("armor"), stats.armor)}
        ${entityStat(t("magicResist"), stats.magicResist)}${entityStat(t("attackSpeed"), stats.attackSpeed)}${entityStat(t("attackRange"), stats.attackRange)}${entityStat(t("critChance"), stats.critChance, "%")}
      </div>
      <strong class="detail-label">${escapeHtml(t("ability"))}</strong>
      <section class="ability-card">
        ${assetThumb(ability.iconUrl, ability.name ?? t("ability"), "ability-icon")}
        <div><div><strong>${escapeHtml(ability.name ?? t("ability"))}</strong>${ability.type ? `<span>${escapeHtml(ability.type)}</span>` : ""}</div><p>${abilityDescription}</p></div>
      </section>
      <strong class="detail-label">${escapeHtml(t("stableItemRecommendations"))}</strong>
      ${recommendationHtml}
      <div class="recommendation-method">${escapeHtml(t("recommendationMethod"))}</div>
      ${entitySourceLine(unit.source ?? data.source)}
    </article>
  `);
}

function renderTraitDetails(data) {
  const trait = data.trait ?? {};
  const traitName = localizedName(trait, trait.name ?? t("traitDetails"));
  const levels = trait.levels ?? [];
  setResponseHtml(`
    <article class="result-card entity-detail-card">
      <header class="entity-detail-head">
        ${assetThumb(trait.iconUrl, traitName, "entity-icon")}
        <div><div class="card-title">${escapeHtml(traitName)}</div><small>${escapeHtml(trait.type === "race" ? t("traitRace") : trait.type === "job" ? t("traitJob") : "")}</small></div>
      </header>
      <div class="detail-effect">${escapeHtml(trait.description ?? "-").replace(/\n/g, "<br>")}</div>
      <strong class="detail-label">${escapeHtml(t("traitTiers"))}</strong>
      <div class="trait-level-list">
        ${levels.map((level) => `<div class="trait-level"><strong>${escapeHtml(t("unitsRequired", { value: level.units }))}</strong><span>${escapeHtml(level.effect)}</span></div>`).join("") || `<div class="detail-muted">-</div>`}
      </div>
      ${entitySourceLine(trait.source ?? data.source)}
    </article>
  `);
}

function comparisonMetricLabel(metricName) {
  return {
    top4Rate: t("metricTop4Rate"),
    winRate: t("metricWinRate"),
    avgPlacement: t("metricAvgPlacement"),
    games: t("metricSamples")
  }[metricName] ?? t("metricTop4Rate");
}

function comparisonMetricValue(entry, metricName) {
  if (!entry?.stats?.games) return "-";
  if (metricName === "winRate") return `${entry.stats.win}%`;
  if (metricName === "avgPlacement") return entry.stats.avg;
  if (metricName === "games") return entry.stats.games;
  return `${entry.stats.top4}%`;
}

function comparisonReasonText(reason) {
  return {
    insufficient_sample: t("reasonInsufficientSample"),
    low_sample: t("reasonLowSample"),
    difference_too_small: t("reasonDifferenceTooSmall"),
    metric_unavailable: t("reasonMetricUnavailable"),
    overlap_too_high: t("reasonOverlapTooHigh"),
    stale_evidence: t("reasonStaleEvidence")
  }[reason] ?? t("reasonInsufficientEvidence");
}

function renderAgentSuggestedActions(actions = [], responseId = "") {
  if (!actions.length) return "";
  return `
    <div class="agent-suggested-actions" aria-label="${escapeHtml(t("nextAction"))}">
      ${actions.map((action, index) => `
        <button type="button" data-agent-action-index="${index}" data-response-id="${escapeHtml(responseId)}">${escapeHtml(action.label ?? action.query)}</button>
      `).join("")}
    </div>
  `;
}

function comparisonItemDetail(entry) {
  const detail = entry?.detail;
  if (!detail) return "";
  const recipe = detail.recipe ?? [];
  const recipeHtml = recipe.length
    ? `<div class="items">${recipe.map(itemPill).join('<span class="recipe-plus">+</span>')}</div>`
    : `<div class="detail-muted">${escapeHtml(t("notCraftable"))}</div>`;
  return `
    <details class="comparison-item-detail">
      <summary>${escapeHtml(t("itemDetails"))}</summary>
      <strong class="detail-label">${escapeHtml(t("recipeRoute"))}</strong>
      ${recipeHtml}
      <strong class="detail-label">${escapeHtml(t("effectAndStats"))}</strong>
      <div class="detail-effect">${escapeHtml(detail.effect ?? detail.description ?? t("missingOfficialItemDetails")).replace(/\n/g, "<br>")}</div>
    </details>
  `;
}

function renderItemComparison(data) {
  const comparison = data.comparison ?? {};
  const inputEntries = comparison.entries ?? data.results ?? [];
  const entries = inputEntries.length >= 3
    ? comparison.rankedEntries ?? inputEntries
    : inputEntries;
  const metricName = comparison.primaryMetric ?? data.query?.primaryMetric ?? "top4Rate";
  const winnerName = comparison.winnerName;
  const headline = winnerName
    ? t("comparisonWinner", { name: winnerName })
    : t("comparisonNoWinner", { reason: comparisonReasonText(comparison.decision?.reason) });
  const overlap = comparison.overlap;
  const overlapLine = overlap
    ? t("comparisonOverlap", { games: overlap.games, rate: (Number(overlap.rate ?? 0) * 100).toFixed(1) })
    : t("comparisonOverlapZero");

  setResponseHtml(`
    <section class="comparison-decision${winnerName ? " has-winner" : ""}">
      <strong>${escapeHtml(headline)}</strong>
      <span>${escapeHtml(t("primaryMetric", { value: comparisonMetricLabel(metricName) }))} · ${escapeHtml(overlapLine)}</span>
    </section>
    <section class="comparison-grid${entries.length === 2 ? " comparison-grid-two" : " comparison-grid-ranked"}">
      ${entries.map((entry, index) => {
        const common = entry.commonBuilds?.[0]?.items?.map((item) => item.name).join(" + ") ?? t("noStablePairing");
        return `
          <article class="result-card comparison-card${entry.apiName === comparison.winner ? " best" : ""}">
            <div class="card-head">
              <div class="comparison-name">
                ${entry.iconUrl ? `<img src="${escapeHtml(entry.iconUrl)}" alt="" loading="lazy">` : ""}
                <div><small>#${index + 1}</small><div class="card-title">${escapeHtml(entry.name)}</div></div>
              </div>
              ${entry.lowSample ? `<div class="risk">${escapeHtml(t("lowSample"))}</div>` : ""}
            </div>
            <div class="comparison-primary">
              <b>${escapeHtml(comparisonMetricLabel(metricName))}</b>
              <strong>${escapeHtml(comparisonMetricValue(entry, metricName))}</strong>
              <span>${escapeHtml(t("exclusiveSamples", { value: entry.stats?.games ?? 0 }))}</span>
            </div>
            <div class="stats comparison-stats">
              ${metric(t("top4Short"), entry.stats?.games ? `${entry.stats.top4}%` : "-")}
              ${metric(t("winShort"), entry.stats?.games ? `${entry.stats.win}%` : "-")}
              ${metric(t("avgShort"), entry.stats?.games ? entry.stats.avg : "-")}
              ${metric(t("metricSamples"), entry.stats?.games ?? 0)}
            </div>
            <div class="comparison-build"><b>${escapeHtml(t("commonFullBuild"))}</b><span>${escapeHtml(common)}</span></div>
            ${comparisonItemDetail(entry)}
          </article>
        `;
      }).join("")}
    </section>
    <div class="summary comparison-summary">
      <div>${escapeHtml(overlapLine)}</div>
      ${(comparison.warnings ?? []).map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}
      ${summaryLines(data)}
    </div>
    ${generatedConclusionCard(data)}
    ${conditionPanel(data)}
    ${sourceAndRisk(data)}
  `);
}

function constraintSourceLabel(source) {
  return {
    current_input: t("userSpecified"),
    conversation: t("previousRound"),
    preference: t("preference"),
    default_context: t("compFilled"),
    system_default: t("systemDefault"),
    user: t("userSpecified"),
    session: t("previousRound"),
    default: t("systemDefault")
  }[source] ?? source ?? t("unknown");
}

function itemPolicyChip(value) {
  return {
    ordinary_only: t("ordinaryItems"),
    include_radiant: t("radiantItems"),
    include_artifact: t("artifactItems"),
    include_special: t("specialItems")
  }[value] ?? value;
}

function rankChip(values = []) {
  const labels = {
    CHALLENGER: t("rankChallenger"), GRANDMASTER: t("rankGrandmaster"), MASTER: t("rankMaster"), DIAMOND: t("rankDiamond"),
    EMERALD: t("rankEmerald"), PLATINUM: t("rankPlatinum"), GOLD: t("rankGold"), SILVER: t("rankSilver"),
    BRONZE: t("rankBronze"), IRON: t("rankIron")
  };
  return values.map((value) => labels[value] ?? value).join("/");
}

function conditionChipValue(key, constraint, query) {
  const value = constraint?.value;
  if (key === "unit") return getLocale() === "en-US" ? (query.unit ?? value) : (query.unitName ?? value);
  if (key === "season_context") {
    const context = state.seasonContexts.find((entry) => entry.id === value);
    return t("conditionSeason", { value: context ? seasonOptionLabel(context) : value });
  }
  if (key === "patch") return t("conditionPatch", { value });
  if (key === "queue") {
    const queueLabel = ["1100", "RANKED_TFT"].includes(String(value)) ? t("rankedTftQueue") : value;
    return t("conditionQueue", { value: queueLabel });
  }
  if (key === "star_level") return t("starLevel", { value: (value ?? []).join("/") });
  if (key === "item_count") return t("completedItems", { value });
  if (key === "item_policy") return itemPolicyChip(value);
  if (key === "item_categories") {
    const labels = { radiant: t("radiant"), artifact: t("artifact"), emblem: t("emblem") };
    return (Array.isArray(value) ? value : [value]).map((category) => labels[category] ?? category).join("/");
  }
  if (key === "rank_filter") return rankChip(value);
  if (key === "days") return t("daysRecent", { value });
  if (key === "min_samples") return t("samplesAtLeast", { value });
  if (key === "owned_items") return value?.length ? t("carriedItems", { value: (getLocale() === "en-US" ? query.ownedItems : query.ownedItemNames)?.join(" + ") ?? value.join(" + ") }) : `${t("carried")} ${t("none")}`;
  if (key === "locked_items") return value?.length ? t("lockedSummary", { value: (getLocale() === "en-US" ? query.lockedItems : query.lockedItemNames)?.join(" + ") ?? value.join(" + ") }) : null;
  if (key === "comparison_items") return value?.length ? t("comparisonItems", { value: (getLocale() === "en-US" ? query.comparisonItems : query.comparisonItemNames)?.join(" + ") ?? value.join(" + ") }) : null;
  if (key === "primary_metric") return value ? t("primaryMetric", { value: comparisonMetricLabel(value) }) : null;
  if (key === "excluded_items") return value?.length ? t("excludedItems", { value: (getLocale() === "en-US" ? query.excludedItems : query.excludedItemNames)?.join(" + ") ?? value.join(" + ") }) : null;
  if (key === "trait_filters") return value?.length ? t("traits", { value: (getLocale() === "en-US" ? query.traitFilters : query.traitNames)?.join(" + ") ?? value.join(" + ") }) : null;
  if (key === "comp") {
    if (constraint?.status === "not_available") return t("noStableComp");
    const comp = query.comp ?? constraint;
    if (comp?.status !== "applied" || !comp.value) return t("unrestrictedComp");
    return comp.value.selection === "explicit"
      ? comp.value.name
      : t("compSamples", { name: comp.value.name, samples: comp.value.sampleCount });
  }
  return null;
}

function conditionChips(data) {
  const query = data.query ?? {};
  const constraints = query.constraints ?? {};
  const itemConditionKeys = data.type === "unit_item_comparison"
    ? ["locked_items", "comparison_items", "primary_metric"]
    : ["owned_items"];
  const order = [
    "unit", "season_context", "patch", "queue", "star_level", "rank_filter", "days", "item_count", "comp", "item_policy", "item_categories",
    ...itemConditionKeys,
    "excluded_items", "trait_filters", "min_samples"
  ];
  return `<div class="condition-chips">${order.map((key) => {
    const constraint = constraints[key];
    const label = conditionChipValue(key, constraint, query);
    if (!constraint || !label) return "";
    const sourceLabel = key === "comp"
      ? constraint.status === "not_available"
        ? null
        : query.comp?.value?.selection === "explicit"
          ? t("userSpecified")
          : t("compFilled")
      : constraintSourceLabel(constraint.source);
    return `<button type="button" class="condition-chip" data-condition-key="${escapeHtml(key)}" data-source="${escapeHtml(constraint.source)}">${escapeHtml(label)}${sourceLabel ? ` · ${escapeHtml(sourceLabel)}` : ""}</button>`;
  }).join("")}</div>`;
}

function conditionPanel(data) {
  return `<section class="condition-panel"><header class="condition-panel-head"><h3>${t("conditions")}</h3><small>${t("conditionEditHint")}</small></header>${conditionChips(data)}<div class="source-legend" aria-label="${t("conditionSources")}"><span><i></i>${t("sourceCurrent")}</span><span><i></i>${t("sourceConversation")}</span><span><i></i>${t("sourcePreference")}</span><span><i></i>${t("sourceDefault")}</span></div></section>`;
}

function renderCompositionChangeEvaluation(data) {
  const zh = getLocale().startsWith("zh");
  const labels = zh ? {
    title: "阵容变更评估",
    add: "加入",
    remove: "移除",
    replace: "替换",
    before: "变更前",
    after: "变更后",
    traitChanges: "羁绊变化",
    activated: "激活",
    advanced: "提升档位",
    deactivated: "失效",
    regressed: "降低档位",
    increased: "人数增加",
    decreased: "人数减少",
    noDelta: "没有检测到羁绊人数变化。",
    notStrength: "这里只评估阵容结构和羁绊变化，不代表变更后一定更强。",
    invalid: "无法执行这次阵容变更",
    members: "名成员"
  } : {
    title: "Composition change evaluation",
    add: "Add",
    remove: "Remove",
    replace: "Replace",
    before: "Before",
    after: "After",
    traitChanges: "Trait changes",
    activated: "Activated",
    advanced: "Advanced",
    deactivated: "Deactivated",
    regressed: "Regressed",
    increased: "Count increased",
    decreased: "Count decreased",
    noDelta: "No trait-count change was detected.",
    notStrength: "This evaluates structure and trait breakpoints, not whether the changed composition is stronger.",
    invalid: "This composition change could not be evaluated",
    members: " members"
  };
  const operation = data.operation ?? (data.type === "composition_replacement_evaluation" ? "replace" : "change");
  const target = data.target?.name ?? data.target?.apiName ?? "";
  const incoming = (data.incoming ?? data.replacement)?.name
    ?? (data.incoming ?? data.replacement)?.apiName
    ?? "";
  const operationText = operation === "add"
    ? `${labels.add} ${incoming}`
    : operation === "remove"
      ? `${labels.remove} ${target}`
      : `${labels.replace} ${target}${target && incoming ? " → " : ""}${incoming}`;
  const valid = data.status === "evaluated";
  const beforeMembers = data.memberChange?.before ?? [];
  const afterMembers = data.memberChange?.after ?? [];
  const memberName = (member) => typeof member === "string"
    ? member
    : member?.name ?? member?.displayName ?? member?.apiName ?? "";
  const deltaLabel = (change) => ({
    activated: labels.activated,
    advanced: labels.advanced,
    deactivated: labels.deactivated,
    regressed: labels.regressed,
    count_increased: labels.increased,
    count_decreased: labels.decreased
  }[change] ?? change);
  const deltaCards = (data.traitDeltas ?? []).map((delta) => {
    const name = delta.traitRef?.name ?? delta.traitRef?.displayName ?? delta.traitRef?.apiName ?? delta.trait ?? "Trait";
    const positive = ["activated", "advanced", "count_increased"].includes(delta.breakpointChange);
    return `<article class="result-card composition-trait-delta ${positive ? "positive" : "negative"}">
      <div class="card-head"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(deltaLabel(delta.breakpointChange))}</span></div>
      <div class="comparison-primary"><strong>${escapeHtml(`${delta.beforeCount ?? 0} → ${delta.afterCount ?? 0}`)}</strong></div>
      <small>${escapeHtml(`${delta.beforeBreakpoint?.threshold ?? "-"} → ${delta.afterBreakpoint?.threshold ?? "-"}`)}</small>
    </article>`;
  }).join("");
  setResponseHtml(`
    ${resultHeader(labels.title, valid ? operationText : labels.invalid, data.status ?? "unknown")}
    ${valid ? `<section class="composition-change-members">
      <article class="result-card"><strong>${escapeHtml(labels.before)}</strong><small>${escapeHtml(`${beforeMembers.length}${labels.members}`)}</small><div class="entity-chips">${beforeMembers.map((member) => `<span>${escapeHtml(memberName(member))}</span>`).join("")}</div></article>
      <article class="result-card"><strong>${escapeHtml(labels.after)}</strong><small>${escapeHtml(`${afterMembers.length}${labels.members}`)}</small><div class="entity-chips">${afterMembers.map((member) => `<span>${escapeHtml(memberName(member))}</span>`).join("")}</div></article>
    </section>
    <h2>${escapeHtml(labels.traitChanges)}</h2>
    <section class="comparison-grid comparison-grid-two">${deltaCards || `<div class="empty-state"><strong>${escapeHtml(labels.noDelta)}</strong></div>`}</section>
    <div class="risk-line">${escapeHtml(labels.notStrength)}</div>`
      : `<section class="empty-state"><strong>${escapeHtml(data.failureReason ?? labels.invalid)}</strong></section>`}
  `);
}

function sourceCacheLabel(value, fallbackCache) {
  return {
    live: t("live"),
    cache: t("localCache"),
    stale: t("staleCache")
  }[value] ?? (value || queryCacheLine(fallbackCache));
}

function sourceAndRisk(data) {
  const source = data.source ?? {};
  const updated = formatCacheUpdatedAt(source.updatedAt) ?? t("updateUnavailable");
  const risks = [...new Set([...(source.risks ?? []), ...(data.answer?.warnings ?? [])])];
  return `
    <section class="source-risk"><h3>${t("source")}</h3><div class="source-line">${escapeHtml(source.provider ?? "MetaTFT")} · ${escapeHtml(source.endpoint ?? t("unknownEndpoint"))} · ${escapeHtml(updated)} · ${escapeHtml(sourceCacheLabel(source.cache, data.cache?.query))}</div>
    ${source.compCandidates ? `<div class="source-line">${t("compCandidates")}：${escapeHtml(source.compCandidates.endpoint ?? t("unknownEndpoint"))} · ${escapeHtml(sourceCacheLabel(source.compCandidates.cache))}${source.compCandidates.stale ? ` · ${t("staleCache")}` : ""}</div>` : ""}
    ${risks.length ? `<div class="risk-line"><strong>${t("risk")}</strong> · ${risks.map(escapeHtml).join("；")}</div>` : ""}</section>
  `;
}

const EQUIPMENT_CONCLUSION_RESULT_TYPES = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items"
]);

function equipmentConclusionViewModel(data, content) {
  if (!EQUIPMENT_CONCLUSION_RESULT_TYPES.has(data?.type) || !content) return null;
  const entries = [...(content.reasons ?? []), ...(content.alternatives ?? [])];
  const uniqueText = (dimensions) => [...new Set(entries
    .filter((entry) => dimensions.includes(entry?.dimension))
    .map((entry) => String(entry?.text ?? "").trim())
    .filter(Boolean))].join("；");
  const completion = data.type === "unit_build_completion";
  const prioritize = completion && data?.itemDifferentiation?.hasClearLeader === true;
  const coreText = uniqueText(completion
    ? ["locked_item_compatibility"]
    : ["core_item_tendency"]);
  const candidateText = uniqueText(completion
    ? ["completion_options"]
    : ["build_performance"]);
  return [
    {
      key: "recommendation",
      title: t("conclusionRecommendation"),
      text: content.headline
    },
    {
      key: "core-items",
      title: t(prioritize ? "conclusionPrioritize" : "conclusionCoreItems"),
      text: coreText || content.summary
    },
    {
      key: "candidate-analysis",
      title: t("conclusionCandidateAnalysis"),
      text: candidateText || content.nextAction
    }
  ];
}

function generatedConclusionCard(data) {
  const conclusion = data?.answer?.generatedConclusion;
  if (!conclusion || conclusion.status === "disabled" || conclusion.status === "skipped") return "";
  if (conclusion.status === "pending") {
    return `<section class="generated-conclusion pending" data-conclusion-status="pending" data-conclusion-job="${escapeHtml(conclusion.jobId ?? "")}">
      <div class="conclusion-head"><strong>${t("dataInterpretation")}</strong><span class="streaming-badge">${t("generatedFromEvidence")}</span></div>
      <p class="conclusion-stream-text" data-conclusion-stream>${escapeHtml(state.conclusionStreamText || t("conclusionStreaming"))}</p>
    </section>`;
  }
  const observed = conclusion.status === "observed";
  if ((!observed && conclusion.status !== "generated") || !conclusion.content) {
    return `<section class="generated-conclusion fallback" data-conclusion-status="${escapeHtml(conclusion.status)}">
      <div class="conclusion-head"><strong>${t("dataInterpretation")}</strong><span>${t("templateFallback")}</span></div>
      <p>${escapeHtml(data.answer?.summary ?? data.text ?? t("noResult"))}</p>
    </section>`;
  }
  const content = conclusion.content;
  const validationErrors = Array.isArray(conclusion.validationErrors)
    ? conclusion.validationErrors.filter(Boolean).map(String)
    : [];
  const observedWarning = observed ? `<details class="conclusion-validation-warning">
    <summary>${escapeHtml(t("observedConclusion"))}</summary>
    <p>${escapeHtml(t("observedConclusionNotice"))}</p>
    ${validationErrors.length ? `<ul>${validationErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : ""}
  </details>` : "";
  const missingDimensions = conclusionMissingDimensions(content);
  const reasons = (content.reasons ?? []).map((reason) => `<li>${escapeHtml(reason.text)}</li>`).join("");
  const alternatives = (content.alternatives ?? []).map((alternative) => `<li>${escapeHtml(alternative.text)}</li>`).join("");
  const supportingEvidence = (conclusion.supportingEvidence ?? []).map((evidence) => `
    <li>
      <strong>${escapeHtml(evidence.type ?? "")}</strong>
      <span>${escapeHtml(evidence.text ?? "")}</span>
      <small>${escapeHtml([evidence.source, evidence.patch].filter(Boolean).join(" · "))}</small>
    </li>
  `).join("");
  const feedback = state.explanationFeedback;
  const equipmentSections = equipmentConclusionViewModel(data, content);
  if (equipmentSections) {
    return `<section class="generated-conclusion equipment-conclusion${observed ? " observed" : ""}" data-conclusion-status="${observed ? "observed" : "generated"}">
      <div class="conclusion-head"><strong>${t("dataInterpretation")}</strong><span>${observed ? t("observedConclusion") : conclusion.cached ? t("cachedConclusion") : t("generatedFromEvidence")}</span></div>
      <div class="equipment-conclusion-sections">
        ${equipmentSections.map((section) => `<section class="conclusion-section ${section.key}"><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.text)}</p></section>`).join("")}
      </div>
      ${missingDimensions ? `<div class="conclusion-missing"><strong>${t("conclusionMissingDimensions")}</strong><span>${escapeHtml(missingDimensions)}</span></div>` : ""}
      ${supportingEvidence ? `<details class="conclusion-supporting-evidence"><summary>${t("staticEvidence")}</summary><ul>${supportingEvidence}</ul></details>` : ""}
      ${observedWarning}
      <div class="conclusion-footer"><small>${escapeHtml(conclusion.model ?? "LLM")} · ${formatNumber(conclusion.latencyMs ?? 0)}ms</small><div class="result-feedback" data-explanation-feedback-group><button type="button" class="feedback-button${feedback === "good" ? " selected" : ""}" data-explanation-feedback="good">${t("explanationHelpful")}</button><button type="button" class="feedback-button${feedback === "bad" ? " selected" : ""}" data-explanation-feedback="bad">${t("explanationNotHelpful")}</button><span class="feedback-status">${feedback ? t("recorded") : ""}</span>${feedbackReasonPicker("explanation")}</div></div>
    </section>`;
  }
  return `<section class="generated-conclusion${observed ? " observed" : ""}" data-conclusion-status="${observed ? "observed" : "generated"}">
    <div class="conclusion-head"><strong>${t("dataInterpretation")}</strong><span>${observed ? t("observedConclusion") : conclusion.cached ? t("cachedConclusion") : t("generatedFromEvidence")}</span></div>
    <h3>${escapeHtml(content.headline)}</h3>
    <p>${escapeHtml(content.summary)}</p>
    ${missingDimensions ? `<div class="conclusion-missing"><strong>${t("conclusionMissingDimensions")}</strong><span>${escapeHtml(missingDimensions)}</span></div>` : ""}
    ${reasons ? `<ul>${reasons}</ul>` : ""}
    ${alternatives ? `<details><summary>${t("alternatives")}</summary><ul>${alternatives}</ul></details>` : ""}
    ${supportingEvidence ? `<details class="conclusion-supporting-evidence"><summary>${t("staticEvidence")}</summary><ul>${supportingEvidence}</ul></details>` : ""}
    ${observedWarning}
    ${content.nextAction ? `<div class="conclusion-action"><strong>${t("nextAction")}</strong><span>${escapeHtml(content.nextAction)}</span></div>` : ""}
    ${content.riskNotice ? `<div class="conclusion-risk">${escapeHtml(content.riskNotice)}</div>` : ""}
    <div class="conclusion-footer"><small>${escapeHtml(conclusion.model ?? "LLM")} · ${formatNumber(conclusion.latencyMs ?? 0)}ms</small><div class="result-feedback" data-explanation-feedback-group><button type="button" class="feedback-button${feedback === "good" ? " selected" : ""}" data-explanation-feedback="good">${t("explanationHelpful")}</button><button type="button" class="feedback-button${feedback === "bad" ? " selected" : ""}" data-explanation-feedback="bad">${t("explanationNotHelpful")}</button><span class="feedback-status">${feedback ? t("recorded") : ""}</span>${feedbackReasonPicker("explanation")}</div></div>
  </section>`;
}

function resultHeader(title, summary, kind) {
  return `<header class="result-header-card"><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(summary ?? "")}</p></div><span class="result-kind">${escapeHtml(kind)}</span></header>`;
}

function progressStepsHtml(activeIndex = 0) {
  return `<div class="progress-steps"><span class="progress-step${activeIndex === 0 ? " active" : ""}">${t("understand")}</span><span class="progress-step${activeIndex === 1 ? " active" : ""}">${t("fetchData")}</span><span class="progress-step${activeIndex === 2 ? " active" : ""}">${t("calculate")}</span></div>`;
}

function renderLoadingResult(track = true) {
  if (track) state.resultView = { type: "loading" };
  setResponseHtml(`<section class="result-state" data-state="loading"><div class="state-orbit" aria-hidden="true">✦</div><strong>${t("loadingResult")}</strong>${progressStepsHtml(state.progressIndex)}</section>`);
}

function renderStoppedResult(track = true) {
  if (track) state.resultView = { type: "stopped" };
  setResponseHtml(`<section class="result-state" data-state="error"><div class="state-orbit">■</div><strong>${t("stoppedBody")}</strong></section>`);
}

function renderEmptyResult(track = true) {
  if (track) state.resultView = { type: "empty" };
  resultTitleEl.textContent = t("resultTitle");
  setResponseHtml(`<section class="result-state result-empty" data-state="empty"><div class="state-orbit" aria-hidden="true">✦</div><strong>${t("resultEmptyTitle")}</strong><p>${t("resultEmptyBody")}</p></section>`);
}

function renderPatchNote(track = true) {
  const version = state.seasonContext?.theme?.patchNoteVersion;
  const patch = getPatchNote(version, getLocale());
  if (track) state.resultView = { type: "patch-note" };
  if (!patch) {
    resultTitleEl.textContent = t("patchNotesUnavailable");
    resultRefreshButton.disabled = true;
    rawOutputEl.textContent = JSON.stringify({
      seasonContextId: state.seasonContextId,
      patchNoteVersion: version ?? null,
      status: "unavailable"
    }, null, 2);
    setResponseHtml(`<section class="result-state result-empty" data-state="empty"><div class="state-orbit" aria-hidden="true">!</div><strong>${escapeHtml(t("patchNotesUnavailable"))}</strong></section>`);
    return;
  }
  resultTitleEl.textContent = t("patchNotesTitle", { version: patch.version });
  resultRefreshButton.disabled = true;
  rawOutputEl.textContent = JSON.stringify(patch, null, 2);
  setResponseHtml(`
    <article class="patch-note-hero">
      <div>
        <span class="patch-version">PATCH ${escapeHtml(patch.version)}</span>
        <h2>${escapeHtml(patch.title)}</h2>
        <p>${escapeHtml(patch.summary)}</p>
      </div>
      <time datetime="${escapeHtml(patch.publishedAt)}"><span>${t("patchNotesPublished")}</span>${escapeHtml(formatDate(patch.publishedAt))}</time>
    </article>
    <section class="patch-note-section" aria-label="${escapeHtml(t("patchNotesHighlights"))}">
      <div class="patch-note-section-title"><span class="eyebrow">${t("patchNotesHighlights")}</span><strong>${escapeHtml(patch.highlights.length)}</strong></div>
      <div class="patch-note-grid">
        ${patch.highlights.map((highlight, index) => `
          <article class="patch-note-card">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <div><strong>${escapeHtml(highlight.title)}</strong><p>${escapeHtml(highlight.body)}</p></div>
          </article>
        `).join("")}
      </div>
    </section>
    <footer class="patch-note-source">
      <div><span>${t("patchNotesSource")}</span><strong>${escapeHtml(patch.sourceName)}</strong></div>
      <a href="${escapeHtml(patch.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("patchNotesOfficialLink")} <span aria-hidden="true">↗</span></a>
    </footer>
  `);
}

function renderErrorResult(message, track = true, messageKey = null) {
  const displayMessage = messageKey ? t(messageKey) : message;
  if (track) state.resultView = { type: "error", message, messageKey };
  setResponseHtml(`${resultHeader(t("error"), displayMessage, t("error"))}<div class="error-state compact"><div class="state-orbit" aria-hidden="true">!</div><span>${escapeHtml(t("networkRetryHint"))}</span><div class="state-actions"><button type="button" data-retry-result>${t("retry")}</button><button type="button" data-refresh-result>${t("refresh")}</button></div></div>`);
}

function resultKind(data) {
  if (data?.type === CompRankingResult.type) return t("compRanking");
  if (data?.type === ItemRankingResult.type) return t("itemRanking");
  if (data?.clarification?.needsClarification) return t("clarification");
  return t("recommendation");
}

function conclusionMissingDimensions(content) {
  if (content?.status !== "insufficient_evidence") return "";
  const labels = {
    build_performance: "dimensionBuildPerformance",
    core_item_tendency: "dimensionCoreItemTendency",
    sample_risk: "dimensionSampleRisk",
    item_performance_ranking: "dimensionItemPerformanceRanking",
    metric_reliability: "dimensionMetricReliability",
    target_item_performance: "dimensionTargetItemPerformance",
    ranking_context: "dimensionRankingContext",
    emblem_performance_ranking: "dimensionEmblemPerformanceRanking",
    comparison_result: "dimensionComparisonResult",
    comparison_metrics: "dimensionComparisonMetrics"
  };
  return [...new Set(content.missingDimensions ?? [])]
    .map((dimension) => labels[dimension] ? t(labels[dimension]) : String(dimension))
    .join("、");
}

function renderCompAnalysis(data) {
  const analysis = data.analysis ?? {};
  const answer = analysis.answer ?? {};
  const target = data.rankings?.analysis?.[0] ?? null;
  const evidenceStatus = analysis.evidenceStatus ?? analysis.status ?? "unavailable";
  const sourceTypes = [...new Set((analysis.evidencePack ?? []).map((record) => record.sourceType).filter(Boolean))];
  setResponseHtml(`
    <div class="comp-overview comp-analysis-overview">
      <strong>${escapeHtml(t("compAnalysisTitle"))}</strong>
      <span>${escapeHtml(analysis.target?.name ?? t("compAnalysisUnknownTarget"))}</span>
      <small>${escapeHtml(t("compAnalysisEvidenceStatus", { value: evidenceStatus }))}</small>
    </div>
    <section class="comp-analysis-answer" data-status="${escapeHtml(evidenceStatus)}">
      <h2>${escapeHtml(t("compAnalysisConclusion"))}</h2>
      <p>${escapeHtml(answer.conclusion ?? data.text ?? "")}</p>
      ${(answer.reasons ?? []).length ? `<h3>${escapeHtml(t("compAnalysisReasons"))}</h3><ul>${answer.reasons.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}
      ${(answer.evidence ?? []).length ? `<h3>${escapeHtml(t("compAnalysisData"))}</h3><ul>${answer.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}
      ${(answer.risks ?? []).length ? `<h3>${escapeHtml(t("compAnalysisRisks"))}</h3><ul>${answer.risks.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : ""}
    </section>
    ${target ? `<section class="ranking-section"><h2>${escapeHtml(t("compAnalysisTargetData"))}</h2>${renderCompCard(target, "avgPlacement", true)}</section>` : ""}
    <div class="comp-footnote">${escapeHtml(t("compAnalysisSources", { value: sourceTypes.join(" / ") || "unavailable" }))}</div>
    ${(data.warnings ?? []).map((warning) => `<div class="comp-warning">${escapeHtml(warning)}</div>`).join("")}
    ${sourceAndRisk(data)}
  `);
  queueOpenCompDetailLoads();
}

const EQUIPMENT_CORE_RESULT_TYPES = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items"
]);

const MOBILE_CHAT_CONCLUSION_STREAM_RESULT_TYPES = new Set([
  "unit_item_comparison"
]);

const ITEM_RANKING_DISPLAY_LIMIT = 10;
const MIXED_ITEM_RANKING_DISPLAY_LIMIT = 30;

function itemRankingDisplayLimit(data) {
  return itemRankingIsMixed(data)
    ? MIXED_ITEM_RANKING_DISPLAY_LIMIT
    : ITEM_RANKING_DISPLAY_LIMIT;
}

function equipmentCoreConclusionText(data) {
  const summary = data?.coreItemSummary ?? data?.answer?.coreConclusion;
  if (!EQUIPMENT_CORE_RESULT_TYPES.has(data?.type) || Number(summary?.recommendationCount) < 2) return null;
  const unit = localizedName(data.unit, data.query?.unitName ?? data.query?.unit ?? t("hero"));
  const items = (summary.items ?? []).map((item) => localizedName(item)).filter(Boolean);
  const params = {
    count: Number(summary.recommendationCount),
    required: Number(summary.requiredAppearances),
    items: items.join(" + "),
    unit
  };
  return items.length ? t("chatCoreWithItems", params) : t("chatCoreWithoutItems", params);
}

function isSpecialItemRanking(data) {
  return data?.type === ItemRankingResult.type
    && (data?.query?.itemCategories ?? []).some((category) => ["radiant", "artifact"].includes(category));
}

function isItemPerformance(data) {
  return data?.type === ItemRankingResult.type && Boolean(data?.itemPerformance);
}

function shouldStreamGeneratedConclusion(data) {
  return EQUIPMENT_CORE_RESULT_TYPES.has(data?.type)
    || MOBILE_CHAT_CONCLUSION_STREAM_RESULT_TYPES.has(data?.type)
    || isSpecialItemRanking(data)
    || isItemPerformance(data)
    || !mobileLayoutQuery.matches
    || state.mobileView === "result";
}

function itemPerformanceConclusionText(data) {
  return isItemPerformance(data) ? data.itemPerformance.conclusion ?? data.answer?.summary ?? null : null;
}

function specialItemRankingConclusionText(data) {
  if (!isSpecialItemRanking(data)) return null;
  const categories = (data.query.itemCategories ?? [])
    .filter((category) => ["radiant", "artifact"].includes(category))
    .map((category) => t(category === "radiant" ? "radiantCategoryName" : "artifactCategoryName"));
  const rankings = data.itemRankings ?? [];
  if (!rankings.length) return t("chatSpecialRankingEmpty", { category: categories.join(" / ") });
  const displayedRankings = rankings.slice(0, itemRankingDisplayLimit(data));
  const itemNames = displayedRankings.map((item) => localizedName(item)).filter(Boolean);
  const best = displayedRankings[0];
  return t("chatSpecialRankingWithItems", {
    category: categories.join(" / "),
    count: displayedRankings.length,
    items: itemNames.join("、"),
    best: localizedName(best),
    avg: formatNumber(best.stats?.avg, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  });
}

function chatCoreConclusionText(data) {
  return itemPerformanceConclusionText(data) ?? equipmentCoreConclusionText(data) ?? specialItemRankingConclusionText(data);
}

function chatCoreScopeText(data) {
  return isItemPerformance(data) ? "\u6307\u5b9a\u88c5\u5907\u4e0e\u540c\u6761\u4ef6 Top 3 \u5bf9\u6bd4" : isSpecialItemRanking(data) ? t("chatSpecialRankingScope") : t("chatCoreScope");
}

function generatedConclusionText(conclusion, data = null) {
  const content = conclusion?.content;
  if (!content) return "";
  const equipmentSections = equipmentConclusionViewModel(data, content);
  if (equipmentSections) {
    return equipmentSections.map((section) => `${section.title}\n${section.text}`).join("\n\n");
  }
  const missingDimensions = conclusionMissingDimensions(content);
  return [
    content.headline,
    content.summary,
    missingDimensions ? `${t("conclusionMissingDimensions")}：${missingDimensions}` : null,
    ...(content.reasons ?? []).map((reason) => reason?.text),
    ...(content.alternatives ?? []).map((alternative) => alternative?.text),
    content.nextAction,
    content.riskNotice
  ].filter(Boolean).join("\n\n");
}

function chatCoreConclusionHtml(data, responseId, options = {}) {
  if (data?.assistantResponse?.text) return "";
  const fullFixedText = chatCoreConclusionText(data);
  if (!fullFixedText) return "";
  const fixedText = Object.prototype.hasOwnProperty.call(options, "fixedCoreText") ? options.fixedCoreText : fullFixedText;
  const conclusion = data?.answer?.generatedConclusion;
  const interpretation = conclusion?.status === "pending"
    ? state.conclusionStreamText || t("conclusionStreaming")
    : conclusion?.status === "generated" || conclusion?.status === "observed"
      ? generatedConclusionText(conclusion, data)
      : "";
  return `<section class="chat-core-conclusion" data-chat-core-conclusion="${escapeHtml(responseId)}">
    <header><strong>${t("chatCoreTitle")}</strong><small>${chatCoreScopeText(data)}</small></header>
    <p class="chat-core-fixed${options.streamingFixed ? " is-streaming" : ""}" data-chat-core-fixed>${escapeHtml(fixedText)}</p>
    ${interpretation ? `<div class="chat-core-interpretation${conclusion?.status === "pending" ? " pending" : ""}"><span>${t("chatFurtherInterpretation")}</span><p data-chat-conclusion-stream>${escapeHtml(interpretation)}</p></div>` : ""}
  </section>`;
}

function systemInteractionAnswerHtml(data) {
  const answer = String(data?.systemInteraction?.answer ?? data?.answer?.summary ?? data?.text ?? "");
  const lines = answer.split(/\r?\n/u);
  const lead = [];
  const examples = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("- ")) examples.push(trimmed.slice(2));
    else lead.push(trimmed);
  }
  return `<div class="system-interaction-answer">
    ${lead.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    ${examples.length ? `<ul>${examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function reactModelConclusionHtml(data, summary, responseId = "") {
  const answer = typeof data?.reactAnswer === "string" ? conclusionDisplayText(data.reactAnswer).trim() : "";
  if (!answer) return "";
  const systemFallback = data?.answerOrigin === "system_evidence_fallback";
  const rejectedModelAnswer = systemFallback && typeof data?.modelConclusion?.answer === "string"
    ? conclusionDisplayText(data.modelConclusion.answer).trim()
    : "";
  const rejectionErrors = Array.isArray(data?.modelConclusion?.validationErrors)
    ? data.modelConclusion.validationErrors.filter(Boolean).map(String)
    : [];
  const limited = data?.terminationReason === "insufficient_evidence"
    || data?.terminationReason === "missing_required_evidence";
  const hasGroundingWarnings = Array.isArray(data?.narrativeWarnings) && data.narrativeWarnings.length > 0;
  const softValidated = data?.answerOrigin === "model_soft_validated_summary";
  const feedback = state.explanationFeedback;
  const feedbackHtml = data?.queryId ? `<div class="result-feedback model-conclusion-feedback" data-explanation-feedback-group data-explanation-response-id="${escapeHtml(responseId)}">
    <button type="button" class="feedback-button${feedback === "good" ? " selected" : ""}" data-explanation-feedback="good">${t("explanationHelpful")}</button>
    <button type="button" class="feedback-button${feedback === "bad" ? " selected" : ""}" data-explanation-feedback="bad">${t("explanationNotHelpful")}</button>
    <span class="feedback-status">${feedback ? t("recorded") : ""}</span>
    ${feedbackReasonPicker("explanation")}
  </div>` : "";
  const rejectedCard = rejectedModelAnswer
    ? `<section class="chat-model-conclusion rejected" data-chat-rejected-model-conclusion>
      <header>
        <strong>${escapeHtml(t("rejectedModelConclusion"))}</strong>
        <small>${escapeHtml(t("rejectedModelConclusionNotice"))}</small>
      </header>
      ${conclusionRichTextHtml(rejectedModelAnswer)}
      ${rejectionErrors.length ? `<details class="model-conclusion-rejection-reasons">
        <summary>${escapeHtml(t("rejectedModelConclusionReasons", { count: rejectionErrors.length }))}</summary>
        <ul>${rejectionErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
      </details>` : ""}
    </section>`
    : "";
  const acceptedOrFallbackCard = `<section class="chat-model-conclusion${systemFallback ? " system-fallback" : ""}${softValidated ? " soft-validated" : ""}" data-chat-model-conclusion>
    <header>
      <strong>${systemFallback ? "" : `<span class="ai-generated-label">${escapeHtml(t("aiGeneratedLabel"))}</span>`}${escapeHtml(t(systemFallback ? "systemEvidenceConclusion" : "modelFinalConclusion"))}</strong>
      <small>${escapeHtml(t(systemFallback
        ? "systemConclusionFallback"
        : hasGroundingWarnings
          ? "modelConclusionGroundingWarning"
          : softValidated ? "modelConclusionPendingVerification"
          : limited ? "modelConclusionEvidenceLimited" : "modelConclusionFromAgent"))}</small>
    </header>
    ${conclusionRichTextHtml(answer || summary)}
    ${feedbackHtml}
  </section>`;
  return `${rejectedCard}${acceptedOrFallbackCard}`;
}

function rankingTierLabel(prefix, tier) {
  const normalized = tier === "medium" ? "Medium"
    : tier === "high" ? "High"
      : tier === "low" ? "Low"
        : "Unclassified";
  return t(`${prefix}Tier${normalized}`);
}

function rankingInsightLabel(code) {
  const keys = {
    mainstream_best: "insightMainstreamBest",
    mainstream_standard: "insightMainstreamStandard",
    popular_underperformer: "insightPopularUnderperformer",
    potential: "insightPotential",
    situational: "insightSituational",
    inefficient_alternative: "insightInefficientAlternative",
    small_sample_highlight: "insightSmallSampleHighlight",
    sparse_sample: "insightSparseSample"
  };
  return keys[code] ? t(keys[code]) : null;
}

function rankingInsightBadges(ranking) {
  if (!ranking) return "";
  const badges = [
    { label: rankingTierLabel("sample", ranking.sampleTier), className: `sample-tier-${ranking.sampleTier ?? "unclassified"}` },
    { label: rankingTierLabel("performance", ranking.performanceTier), className: `performance-tier-${ranking.performanceTier ?? "unclassified"}` },
    { label: rankingInsightLabel(ranking.insightCode), className: "insight-tier" }
  ].filter((badge) => badge.label);
  return `<div class="ranking-insight-badges">${badges.map((badge) => `<span class="ranking-badge ${escapeHtml(badge.className)}">${escapeHtml(badge.label)}</span>`).join("")}</div>`;
}

const MIXED_ITEM_CATEGORY_QUERY_VALUE = "\u666e\u901a\u3001\u795e\u5668\u3001\u5149\u660e\u3001\u7eb9\u7ae0";

function itemRankingIsMixed(data) {
  return (data?.query?.itemCategories ?? []).length > 1
    || data?.methodology?.methodology === "category_relative_sample_tier_then_performance_v1";
}

function itemCategoryQueryValue(category) {
  return {
    ordinary_completed: "\u666e\u901a",
    artifact: "\u795e\u5668",
    radiant: "\u5149\u660e",
    emblem: "\u7eb9\u7ae0"
  }[category] ?? "\u666e\u901a";
}

function itemRankingModeControl(data) {
  const mixed = itemRankingIsMixed(data);
  return `
    <section class="item-ranking-mode-control" data-ranking-mode="${mixed ? "mixed" : "category"}">
      <div><strong>${t(mixed ? "mixedRankingActive" : "categoryRankingActive")}</strong><small>${t("mixedRankingHint")}</small></div>
      <button type="button" data-item-ranking-mix-toggle="${mixed ? "off" : "on"}" aria-pressed="${mixed ? "true" : "false"}">${t(mixed ? "disableMixedRanking" : "enableMixedRanking")}</button>
    </section>
  `;
}

async function toggleItemRankingMode(data, enableMixed) {
  if (state.requestInFlight || !data?.query?.unit) return;
  const categories = data.query.itemCategories ?? [];
  if (!enableMixed && categories.length === 1) return;
  if (enableMixed && categories.length === 1) state.itemRankingCategoryBeforeMixed = categories[0];
  const category = enableMixed
    ? MIXED_ITEM_CATEGORY_QUERY_VALUE
    : itemCategoryQueryValue(state.itemRankingCategoryBeforeMixed);
  const champion = data.query.unitName ?? data.unit?.name ?? data.query.unit;
  const task = QUICK_TASKS.find((entry) => entry.id === "item-performance");
  const values = { champion, itemCategory: category };
  const query = t(task.queryTemplateKey, values);
  queryInput.value = query;
  await requestRecommendation(false, t(enableMixed ? "enableMixedRankingDisplay" : "disableMixedRankingDisplay", { unit: champion }), {
    quickTask: structuredQuickTask(task, values)
  });
}

function buildNarrativeWarningText(error) {
  const value = String(error ?? "");
  const unsupportedStatistic = value.match(/statistic is not present in cited evidence:\s*(.+)$/u);
  if (unsupportedStatistic) return t("buildNarrativeUnsupportedStatistic", { value: unsupportedStatistic[1] });
  if (/unknown evidenceId/u.test(value)) return t("buildNarrativeUnknownEvidence");
  if (/available current-season item mechanics|lacks item-level evidence/u.test(value)) {
    return t("buildNarrativeItemMechanismMissing");
  }
  if (/outside the deterministic difference plan|contradicts the deterministic build rank/u.test(value)) {
    return t("buildNarrativePlanMismatch");
  }
  if (/optionId is not present/u.test(value)) return t("buildNarrativeOptionMismatch");
  return t("buildNarrativeValidationGeneric");
}

function strategyVideoChatSummary(data) {
  if (data?.type !== "strategy_video_search_results") return null;
  if (data.status === "unsupported_scope") {
    return getLocale().startsWith("zh")
      ? "\u4ec5\u652f\u6301\u4e91\u9876\u4e4b\u5f08\u548c\u91d1\u94f2\u94f2\u653b\u7565\u89c6\u9891\u3002"
      : "Only Teamfight Tactics and Golden Spatula strategy videos are supported.";
  }
  const groups = Array.isArray(data.groups) && data.groups.length
    ? data.groups
    : [{ videos: data.videos ?? data.results ?? [] }];
  const count = groups.reduce((total, group) => total + (group.videos ?? group.results ?? []).length, 0);
  if (!count) return getLocale().startsWith("zh") ? "\u672a\u627e\u5230\u653b\u7565\u89c6\u9891\u3002" : "No strategy videos found.";
  return getLocale().startsWith("zh")
    ? `\u627e\u5230 ${count} \u4e2a\u653b\u7565\u89c6\u9891\uff0c\u6700\u65b0\u4f18\u5148\u3002`
    : `Found ${count} strategy videos, newest first.`;
}

function assistantResponseHtml(data, responseId = "", options = {}) {
  if (data?.type === "system_interaction") {
    return systemInteractionAnswerHtml(data);
  }
  const understanding = renderUnderstandingPanel(data, {
    locale: getLocale(),
    surface: "chat",
    traceState: data?.processingTrace,
    completed: true
  });
  const compactVideoSummary = strategyVideoChatSummary(data);
  const followUpGuidance = data?.agentSuggestedActions?.actions?.length
    ? `<div class="answer-follow-up"><span>${escapeHtml(data.agentSuggestedActions.prompt ?? "")}</span>${renderAgentSuggestedActions(data.agentSuggestedActions.actions, responseId)}</div>`
    : "";
  if (compactVideoSummary) {
    return `${understanding}<div class="answer-summary">${escapeHtml(compactVideoSummary)}</div>${followUpGuidance}<button type="button" class="view-result" data-view-result data-response-id="${escapeHtml(responseId)}">${t("resultDetails")} →</button>`;
  }
  if (data?.clarification?.needsClarification) {
    return `${understanding}<div class="answer-summary">${escapeHtml(data.clarification.question)}</div>${renderEntityCandidates(data.clarification.entityCandidates ?? [], responseId)}${renderSuggestionButtons(data.clarification.suggestions ?? [], responseId)}`;
  }
  const summary = data?.assistantResponse?.text
    ?? data?.answer?.summary
    ?? data?.text
    ?? (data?.type === "comp_trends"
      ? t("currentCompTrends")
      : data?.type === CompRankingResult.type
        ? t("currentCompRanking")
        : t("noResult"));
  const modelConclusion = reactModelConclusionHtml(data, summary, responseId);
  if (modelConclusion) {
    return `${understanding}${chatCoreConclusionHtml(data, responseId, options)}${modelConclusion}${data?.query?.constraints ? conditionChips(data) : ""}${followUpGuidance}<button type="button" class="view-result" data-view-result data-response-id="${escapeHtml(responseId)}">${t("resultDetails")} →</button>`;
  }
  return `${understanding}${chatCoreConclusionHtml(data, responseId, options)}<div class="answer-summary">${escapeHtml(summary)}</div>${data?.query?.constraints ? conditionChips(data) : ""}${followUpGuidance}<button type="button" class="view-result" data-view-result data-response-id="${escapeHtml(responseId)}">${t("resultDetails")} →</button>`;
}

function stopAssistantCoreStream(record) {
  if (!record?.coreConclusionTimer) return;
  clearInterval(record.coreConclusionTimer);
  record.coreConclusionTimer = null;
}

function streamAssistantCoreConclusion(record) {
  const fullText = chatCoreConclusionText(record?.data);
  const target = record?.target?.querySelector("[data-chat-core-fixed]");
  if (!fullText || !target) return;
  stopAssistantCoreStream(record);
  const characters = Array.from(fullText);
  let index = 0;
  record.coreConclusionTimer = setInterval(() => {
    if (!target.isConnected) {
      stopAssistantCoreStream(record);
      return;
    }
    index += 1;
    target.textContent = characters.slice(0, index).join("");
    if (index % 10 === 0) scrollConversation();
    if (index >= characters.length) {
      target.classList.remove("is-streaming");
      stopAssistantCoreStream(record);
    }
  }, 16);
}

function rerenderAssistantRecord(record) {
  if (!record?.target?.isConnected) return;
  stopAssistantCoreStream(record);
  record.target.innerHTML = assistantResponseHtml(record.data, record.id);
}

function recordAssistantResponse(data) {
  if (!activeResponseEl) return null;
  const id = `response-${++state.responseCounter}`;
  const record = {
    id,
    target: activeResponseEl,
    data,
    input: state.lastInput,
    displayInput: state.lastDisplayInput,
    quickTask: state.lastQuickTask
  };
  const fixedCoreText = chatCoreConclusionText(data);
  activeResponseEl.innerHTML = assistantResponseHtml(data, id, fixedCoreText ? { fixedCoreText: "", streamingFixed: true } : {});
  state.responseRecords.push(record);
  state.responsesById.set(id, record);
  if (fixedCoreText) streamAssistantCoreConclusion(record);
  return id;
}

function activateResponseResult(record) {
  if (!record?.data) return false;
  state.currentConclusionController?.abort();
  state.currentConclusionController = null;
  state.lastInput = record.input ?? state.lastInput;
  state.lastDisplayInput = record.displayInput ?? record.input ?? state.lastDisplayInput;
  state.lastQuickTask = record.quickTask ?? null;
  state.lastResult = record.data;
  state.lastResultId = record.data.queryId ?? null;
  state.lastSuggestions = record.data.clarification?.suggestions ?? [];
  state.lastEntityCandidates = record.data.clarification?.entityCandidates ?? [];
  state.currentResponseId = record.id;
  state.compRankingMetric = null;
  state.feedbackByCard = {};
  state.explanationFeedback = null;
  state.conclusionStreamText = "";
  state.resultView = { type: "result", data: record.data };
  setDeveloperOutput(record.data);
  resultTitleEl.textContent = t("resultTitle");
  renderCurrentResult(record.data);
  refreshButton.disabled = state.requestInFlight || !state.lastInput;
  resultRefreshButton.disabled = state.requestInFlight || !state.lastInput;
  return true;
}

function rerenderLocalizedState() {
  applyI18n();
  if (activeQuickTask) quickTaskFormTitle.textContent = t(activeQuickTask.titleKey);
  for (const record of state.responseRecords) {
    rerenderAssistantRecord(record);
  }
  if (
    state.requestInFlight
    && activeResponseEl?.isConnected
    && activeRecommendationProgress
  ) {
    const understandingOpen = activeResponseEl
      .querySelector(".chat-understanding-panel")
      ?.hasAttribute("open");
    activeResponseEl.innerHTML = recommendationProgressHtml(activeRecommendationProgress, {
      understandingOpen: understandingOpen ?? true
    });
  }
  if (state.resultView.type === "result" && state.resultView.data) renderCurrentResult(state.resultView.data);
  else if (state.resultView.type === "loading") renderLoadingResult(false);
  else if (state.resultView.type === "error") renderErrorResult(state.resultView.message, false, state.resultView.messageKey);
  else if (state.resultView.type === "stopped") renderStoppedResult(false);
  else if (state.resultView.type === "patch-note") renderPatchNote(false);
  else renderEmptyResult(false);
  if (state.aliases) renderAliases(state.aliases);
  renderRuntimeStatus(state.runtimeStatus ?? {});
  const statusKey = state.statusKey;
  const statusParams = state.statusParams;
  if (statusKey) setStatusKey(statusKey, state.statusState ?? "ready", statusParams ?? {});
  else setStatus(state.statusText ?? t("statusReady"), state.statusState ?? "ready");
}

function renderItemRankings(data) {
  if (data.itemPerformance) {
    const performance = data.itemPerformance;
    const target = performance.item;
    const rankingCards = performance.topRankings ?? [];
    setResponseHtml(`
      ${resultHeader("\u88c5\u5907\u8868\u73b0\u9a8c\u8bc1", performance.conclusion ?? data.answer?.summary ?? data.text, "\u88c5\u5907\u8868\u73b0\u9a8c\u8bc1")}
      ${target ? `<section class="item-ranking-list"><h2>\u6307\u5b9a\u88c5\u5907</h2><article class="item-ranking-card best"><div class="item-ranking-head">${assetThumb(target.iconUrl, localizedName(target), "tiny-item-icon")}<strong>${escapeHtml(localizedName(target))}</strong><span>${performance.rank ? `#${performance.rank}` : t("lowSample")}</span></div><div class="stats">${metric(t("top4"), `${formatNumber(target.stats.top4)}%`)}${metric(t("win"), `${formatNumber(target.stats.win)}%`)}${metric(t("avg"), formatNumber(target.stats.avg, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}${metric(t("samples"), formatNumber(target.stats.games))}</div></article></section>` : ""}
      <section class="item-ranking-list"><h2>\u540c\u6761\u4ef6\u88c5\u5907 Top 3</h2>${rankingCards.map((item, index) => `<article class="item-ranking-card"><div class="item-ranking-head">${assetThumb(item.iconUrl, localizedName(item), "tiny-item-icon")}<strong>${index + 1}. ${escapeHtml(localizedName(item))}</strong></div><div class="stats">${metric(t("top4"), `${formatNumber(item.stats.top4)}%`)}${metric(t("win"), `${formatNumber(item.stats.win)}%`)}${metric(t("avg"), formatNumber(item.stats.avg, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}${metric(t("samples"), formatNumber(item.stats.games))}</div></article>`).join("")}</section>
      <div class="item-ranking-meta">${t("methodology")}：${escapeHtml(data.answer?.methodology ?? "")}</div>${conditionPanel(data)}${sourceAndRisk(data)}
    `);
    return;
  }
  const rankings = data.itemRankings ?? [];
  if (!rankings.length) {
    setResponseHtml(`${resultHeader(t("itemRanking"), data.answer?.summary ?? data.text ?? t("noResult"), t("noResult"))}${conditionPanel(data)}${sourceAndRisk(data)}`);
    return;
  }
  if (!itemRankingIsMixed(data) && data.query?.itemCategories?.length === 1) {
    state.itemRankingCategoryBeforeMixed = data.query.itemCategories[0];
  }
  setResponseHtml(`
    ${resultHeader(t("itemRanking"), data.answer?.summary ?? data.text, t("itemRanking"))}
    ${itemRankingModeControl(data)}
    <div class="item-ranking-list">
      ${rankings.slice(0, itemRankingDisplayLimit(data)).map((item, index) => `
        <article class="item-ranking-card">
          <div class="item-ranking-head">
            ${assetThumb(item.iconUrl, localizedName(item), "tiny-item-icon")}
            <strong>${index + 1}. ${escapeHtml(localizedName(item))}</strong>
            <span>${item.coverage === null ? "" : t("rankCoverage", { value: escapeHtml(item.coverage) })}</span>
          </div>
          <div class="stats">
            ${metric(t("top4"), `${formatNumber(item.stats.top4)}%`)}
            ${metric(t("win"), `${formatNumber(item.stats.win)}%`)}
            ${metric(t("avg"), formatNumber(item.stats.avg, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
            ${metric(t("samples"), formatNumber(item.stats.games))}
            ${item.ranking?.performanceScore == null ? "" : metric(t("performanceScore"), formatNumber(item.ranking.performanceScore, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}
          </div>
          ${rankingInsightBadges(item.ranking)}
          <div class="item-ranking-meta">${t("commonPairings")}：${item.commonPairings?.length ? item.commonPairings.map((pairing) => `${pairing.items.map((entry) => escapeHtml(localizedName(entry))).join(" + ")}（${formatNumber(pairing.games)}）`).join("；") : t("itemUnavailable")}</div>
          ${item.copyCounts?.some((copy) => copy.copyCount > 1) ? `<div class="item-ranking-meta">${t("duplicateItems")}：${item.copyCounts.map((copy) => `${copy.copyCount}× · ${formatNumber(copy.stats.games)} ${t("games")}`).join(" / ")}</div>` : ""}
        </article>
      `).join("")}
    </div>
    <div class="item-ranking-meta">${t("methodology")}：${escapeHtml(data.answer?.methodology ?? "")}</div>
    ${generatedConclusionCard(data)}
    ${conditionPanel(data)}
    ${sourceAndRisk(data)}
  `);
}

function renderItemCarrierRankings(data) {
  const carriers = data.carriers ?? [];
  const itemLabel = localizedName(data.item, data.query?.itemName ?? t("item"));
  const detail = data.itemDetail ?? null;
  const detailFacts = detail?.facts ?? {};
  const detailRecipe = detailFacts.composition ?? [];
  const detailHtml = detail ? `<article class="result-card item-detail-card carrier-item-detail" data-carrier-item-detail>
    <div class="card-head"><div class="card-title-group">${assetThumb(data.item?.iconUrl, detail.displayName ?? itemLabel, "equipment-unit-icon")}<div class="card-title">${escapeHtml(detail.displayName ?? itemLabel)}</div></div><div class="detail-category">${escapeHtml(detailFacts.category ?? data.item?.category ?? "")}</div></div>
    <strong class="detail-label">${escapeHtml(t("recipeRoute"))}</strong>
    ${detailRecipe.length
      ? `<div class="items">${detailRecipe.map((component) => itemPill(typeof component === "string" ? { apiName: component, name: component } : component)).join('<span class="recipe-plus">+</span>')}</div>`
      : `<div class="detail-muted">${escapeHtml(t("notCraftable"))}</div>`}
    <strong class="detail-label">${escapeHtml(t("effectAndStats"))}</strong>
    <div class="detail-effect">${escapeHtml(detailFacts.effect ?? detailFacts.description ?? t("missingOfficialItemDetails")).replace(/\n/g, "<br>")}</div>
  </article>` : "";
  if (!carriers.length) {
    setResponseHtml(`
      ${resultHeader(t("itemCarriers"), data.text ?? t("noPositiveCarriers"), t("noResult"))}
      ${detailHtml}
      <div class="empty-state"><div class="state-orbit" aria-hidden="true">✦</div><strong>${escapeHtml(data.text ?? t("noPositiveCarriers"))}</strong></div>
      ${conditionPanel(data)}${sourceAndRisk(data)}
    `);
    return;
  }
  setResponseHtml(`
    ${resultHeader(t("itemCarriers"), data.text, itemLabel)}
    ${detailHtml}
    <div class="carrier-ranking-list">
      ${carriers.map((carrier, index) => `
        <article class="carrier-ranking-card">
          <div class="carrier-ranking-head">
            <div class="carrier-unit">
              ${assetThumb(carrier.unit?.iconUrl, localizedName(carrier.unit), "equipment-unit-icon")}
              <div><strong>${index + 1}. ${escapeHtml(localizedName(carrier.unit))}</strong><small>${t("positivePlacementUplift", { value: formatNumber(carrier.placementUplift, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</small></div>
            </div>
            ${data.item ? assetThumb(data.item.iconUrl, itemLabel, "tiny-item-icon") : ""}
          </div>
          <div class="stats">
            ${metric(t("top4"), `${formatNumber(carrier.stats.top4)}%`)}
            ${metric(t("win"), `${formatNumber(carrier.stats.win)}%`)}
            ${metric(t("avg"), formatNumber(carrier.stats.avg, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
            ${metric(t("samples"), formatNumber(carrier.stats.games))}
          </div>
          <div class="carrier-baseline">${t("unitBaselineAvg", { value: formatNumber(carrier.baselineAvgPlacement, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</div>
          <div class="carrier-builds">
            ${(carrier.builds ?? []).map((build) => `
              <div class="carrier-build">
                <div class="items">${build.items.map(itemPill).join("")}</div>
                <small>${t("avg")} ${formatNumber(build.stats.avg, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${t("samples")} ${formatNumber(build.stats.games)}</small>
              </div>
            `).join("")}
          </div>
        </article>
      `).join("")}
    </div>
    ${conditionPanel(data)}${sourceAndRisk(data)}
  `);
}

function recommendationCard(data, card, index) {
  const unitLabel = localizedName(data.unit, data.query?.unitName ?? data.query?.unit ?? t("hero"));
  const comparedItem = card.items?.find((item) => item.compared);
  const completion = (data.lockedItems?.length ?? 0) > 0;
  const roleTitleKey = card.ranking?.method === "performance_role_v4" && !card.lowSample
    ? card.ranking.recommendationRole === "mainstream"
      ? completion ? "mainstreamCompletion" : "mainstreamBuild"
      : card.ranking.recommendationRole === "best_performance_alternative"
        ? completion ? "bestPerformanceCompletionAlternative" : "bestPerformanceAlternative"
        : completion ? "highPerformanceCompletionAlternative" : "highPerformanceAlternative"
    : null;
  const cardTitle = data.comparison
    ? `${card.winner ? t("best") : card.lowSample ? t("lowSample") : t("alternatives")} · ${localizedName(comparedItem, card.title)}`
    : roleTitleKey ? t(roleTitleKey) : (card.winner
      ? data.query?.sort === "robust_first"
        ? t("applicabilityRecommendation")
        : t("bestRecommendation")
      : card.lowSample
        ? t("lowSample")
        : `${t("alternatives")} ${index}`);
  const difference = card.difference
    ? `<div class="difference-note">${t("relativeRecommendation")}：${card.difference.removed?.length ? `${t("replace")} ${escapeHtml(card.difference.removed.join(" + "))} → ${escapeHtml(card.difference.added.join(" + "))}` : t("sameItems")}；${t("top4Short")} ${card.difference.top4Delta >= 0 ? "+" : ""}${formatNumber(card.difference.top4Delta)}pp，${t("samples")} ${card.difference.gamesDelta >= 0 ? "+" : ""}${formatNumber(card.difference.gamesDelta)}</div>`
    : "";
  const rankingRationale = card.ranking?.method === "performance_role_v4"
    ? `<div class="ranking-rationale${card.winner ? " primary" : ""}">
      <strong>${t(card.winner ? "applicabilityRecommendation" : "applicabilityScore")}</strong>
      <span>${t("applicabilityScoreValue", { score: formatNumber(card.ranking.score, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
      <span>${rankingTierLabel("sample", card.ranking.sampleTier)}</span>
      <span>${rankingTierLabel("performance", card.ranking.performanceTier)}</span>
      ${card.winner ? `<small>${t("applicabilityMethodShort")}</small>` : ""}
    </div>`
    : "";
  return `<article class="result-card${card.winner ? " best" : ""}">
    ${card.winner ? `<span class="best-label">${t("best")}</span>` : ""}
    <div class="card-head"><div class="card-title-group">${assetThumb(data.unit?.iconUrl ?? data.query?.unitIconUrl, unitLabel, "equipment-unit-icon")}<div class="card-title">${escapeHtml(cardTitle)}</div></div>${card.lowSample ? `<div class="risk">${t("lowSample")}</div>` : ""}</div>
    <div class="items">${card.items.map(itemPill).join("")}</div>
    <div class="stats">${metric(t("top4"), `${formatNumber(card.stats.top4)}%`)}${metric(t("win"), `${formatNumber(card.stats.win)}%`)}${metric(t("avg"), formatNumber(card.stats.avg, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}${metric(t("samples"), formatNumber(card.stats.games))}</div>
    ${rankingRationale}${difference}${feedbackActions(index)}
  </article>`;
}

function renderRecommendationResult(data) {
  if (data.clarification?.needsClarification) {
    setResponseHtml(`${resultHeader(t("clarification"), data.clarification.question, t("clarification"))}<div class="clarification-state"><div class="state-orbit" aria-hidden="true">?</div><strong>${escapeHtml(data.clarification.question)}</strong>${renderEntityCandidates(data.clarification.entityCandidates ?? [], state.currentResponseId)}${renderSuggestionButtons(data.clarification.suggestions ?? [], state.currentResponseId)}</div>${data.query ? conditionPanel(data) : ""}${data.source ? sourceAndRisk(data) : ""}`);
    return;
  }
  if (!data.cards?.length) {
    const narrative = String(data.text ?? "").trim();
    if (data.type === "react_chat_result" && narrative && narrative !== t("noResult")) {
      setResponseHtml(`${resultHeader(t("recommendation"), narrative, t("recommendation"))}${data.query ? conditionPanel(data) : ""}${data.source ? sourceAndRisk(data) : ""}`);
      return;
    }
    setResponseHtml(`${resultHeader(t("noResult"), data.text ?? t("noResult"), t("noResult"))}<div class="empty-state"><div class="state-orbit" aria-hidden="true">✦</div><strong>${escapeHtml(data.text ?? t("noResult"))}</strong>${data.query ? `<div class="summary">${summaryLines(data)}</div>` : ""}</div>${data.query ? conditionPanel(data) : ""}${data.source ? sourceAndRisk(data) : ""}`);
    return;
  }
  const locked = data.lockedItems?.length ? data.lockedItems.map((item) => localizedName(item)).join(" + ") : t("none");
  const coreSummary = data.coreItemSummary ?? data.answer?.coreConclusion;
  const commonCore = coreSummary?.items?.length ? coreSummary.items.map((item) => localizedName(item)).join(" + ") : null;
  const [best, ...alternatives] = data.cards;
  setResponseHtml(`${resultHeader(t("recommendation"), data.answer?.summary ?? data.text, t("recommendation"))}
    <div class="locked-line">${t("carried")}：${escapeHtml(locked)}</div>
    ${commonCore ? `<div class="core-line">${t("frequentCore")}：${escapeHtml(commonCore)}（${t("coreFrequencyRule", { count: coreSummary.recommendationCount, required: coreSummary.requiredAppearances })}）</div>` : ""}
    ${recommendationCard(data, best, 0)}
    ${alternatives.length ? `<details class="alternatives" ${window.innerWidth >= 520 ? "open" : ""}><summary>${t("alternatives")} · ${alternatives.length}</summary><div class="alternatives-grid">${alternatives.slice(0, 2).map((card, index) => recommendationCard(data, card, index + 1)).join("")}</div></details>` : ""}
    ${generatedConclusionCard(data)}
    ${conditionPanel(data)}${sourceAndRisk(data)}`);
}

function safeKnowledgeSourceUrl(value, timestampStart = null) {
  try {
    const url = new URL(String(value ?? ""));
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (Number.isFinite(Number(timestampStart)) && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) {
      url.searchParams.set("t", `${Math.max(0, Math.floor(Number(timestampStart)))}s`);
    }
    return url.href;
  } catch {
    return null;
  }
}

function knowledgeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function knowledgePublishedDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Intl.DateTimeFormat(getLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC"
    }).format(new Date(`${text}T00:00:00Z`));
  }
  return formatDate(value);
}

function renderKnowledgeEvidence(data) {
  const evidence = Array.isArray(data?.knowledgeEvidence) ? data.knowledgeEvidence : [];
  if (!evidence.length) return "";
  return `<section class="knowledge-evidence" aria-label="${escapeHtml(t("knowledgeEvidenceTitle"))}">
    <header class="knowledge-evidence-head">
      <div><span>${escapeHtml(t("knowledgeEvidenceEyebrow"))}</span><h2>${escapeHtml(t("knowledgeEvidenceTitle"))}</h2></div>
      <small>${escapeHtml(t("knowledgeEvidenceCount", { count: evidence.length }))}</small>
    </header>
    <div class="knowledge-evidence-list">
      ${evidence.map((record) => {
        const timestamp = knowledgeTimestamp(record.timestampStart);
        const sourceUrl = safeKnowledgeSourceUrl(record.sourceUrl, record.timestampStart);
        const sourceLabel = record.sourceType === "youtube"
          ? t("videoGuideSource")
          : record.namespace === "current_stats"
            ? t("currentStatsSource")
          : t("knowledgeSource");
        const title = record.sourceTitle ?? sourceLabel;
        const aiGenerated = record.aiGenerated === true
          || record.contentOrigin === "ai_generated_transcript_summary";
        const aiReviewLabel = record.reviewStatus === "human_reviewed"
          ? t("aiGeneratedReviewed")
          : t("aiGeneratedUnreviewed");
        const metadata = [
          record.author ? `${t("knowledgeAuthor")}: ${record.author}` : null,
          record.publishedAt ? `${t("publishedAt")}: ${knowledgePublishedDate(record.publishedAt)}` : null,
          timestamp ? `${t("timestamp")}: ${timestamp}` : null,
          record.patch ? `${t("patchLabel")}: ${record.patch}` : null,
          record.rank ? `${t("rankScope")}: ${record.rank}` : null,
          record.timeWindow ? `${t("timeWindowLabel")}: ${record.timeWindow}` : null,
          record.region ? `${t("regionLabel")}: ${record.region}` : null,
          record.generatedAt ? `${t("generatedAtLabel")}: ${formatDate(record.generatedAt)}` : null
        ].filter(Boolean);
        return `<article class="knowledge-card">
          <div class="knowledge-card-source">
            <span>${escapeHtml(sourceLabel)}</span>
            <strong>${escapeHtml(title)}</strong>
            ${aiGenerated ? `<em class="knowledge-ai-badge">${escapeHtml(aiReviewLabel)}</em>` : ""}
          </div>
          ${metadata.length ? `<div class="knowledge-card-meta">${metadata.map((entry) => `<span>${escapeHtml(entry)}</span>`).join("")}</div>` : ""}
          <p>${escapeHtml(record.claim)}</p>
          ${aiGenerated ? `<p class="knowledge-ai-disclosure">${escapeHtml(t("aiGeneratedDisclosure"))}</p>` : ""}
          ${record.conditions?.length ? `<div class="knowledge-card-conditions"><strong>${escapeHtml(t("applicableConditions"))}</strong>${record.conditions.map((condition) => `<span>${escapeHtml(condition)}</span>`).join("")}</div>` : ""}
          ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(timestamp ? t("openSourceAtTimestamp", { timestamp }) : t("openSourceVideo"))}</a>` : ""}
        </article>`;
      }).join("")}
    </div>
    <p class="knowledge-authority-note">${escapeHtml(t("knowledgeAuthorityNote"))}</p>
  </section>`;
}

function renderCurrentStatsScopeStatus(data) {
  const status = data?.currentStatsScope;
  if (status?.status !== "scope_unavailable") return "";
  const requested = status.requestedScope ?? {};
  const requestedLabel = [
    requested.season,
    requested.patch,
    requested.rank,
    requested.timeWindow,
    requested.region
  ].filter(Boolean).join(" · ");
  const available = (status.availableScopes ?? []).slice(0, 4).map((scope) => [
    scope.season,
    scope.patch,
    scope.rank,
    scope.timeWindow,
    scope.region
  ].filter(Boolean).join(" · "));
  return `<section class="knowledge-evidence current-stats-scope-status" aria-live="polite">
    <header class="knowledge-evidence-head">
      <div><span>current_stats</span><h2>${escapeHtml(t("currentStatsScopeUnavailable"))}</h2></div>
    </header>
    <p>${escapeHtml(requestedLabel)}</p>
    ${available.length ? `<div class="knowledge-card-meta"><strong>${escapeHtml(t("currentStatsAvailableScopes"))}</strong>${available.map((scope) => `<span>${escapeHtml(scope)}</span>`).join("")}</div>` : ""}
  </section>`;
}

function renderCoachAnswerResult(data) {
  const response = data?.assistantResponse?.content ?? {};
  const warnings = Array.isArray(response.warnings) ? response.warnings : [];
  setResponseHtml(`
    ${resultHeader(t("coachAnswerTitle"), response.headline ?? data?.answer?.summary ?? data?.text, t("coachAnswerTitle"))}
    <section class="coach-answer-card">
      <p>${escapeHtml(data?.assistantResponse?.text ?? data?.text ?? t("noResult"))}</p>
      ${response.currentRecommendation?.label ? `<div class="coach-current-recommendation"><strong>${escapeHtml(t("currentStatsRecommendation"))}</strong><span>${escapeHtml(response.currentRecommendation.label)}</span></div>` : ""}
      ${warnings.length ? `<div class="coach-answer-warnings">${warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}
    </section>
    ${data?.query ? conditionPanel(data) : ""}
    ${data?.source ? sourceAndRisk(data) : ""}
  `);
}

function renderSystemInteractionResult(data) {
  setResponseHtml(`
    ${resultHeader("TFTClarity", data?.answer?.summary ?? data?.text, "SYSTEM")}
    <section class="system-interaction-card">
      ${systemInteractionAnswerHtml(data)}
    </section>
  `);
}

function renderMechanismClassification(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const incompleteEntities = Array.isArray(data?.classificationMeta?.incompleteEntities)
    ? data.classificationMeta.incompleteEntities
    : [];
  const cards = entries.map((entry) => {
    const labels = [];
    if (entry.isGrowth) labels.push(t("mechanismGrowth"));
    if (entry.isDevelopment) labels.push(t("mechanismDevelopment"));
    if (entry.needsReview) labels.push(t("mechanismNeedsReview"));
    const metadata = [
      entry.entityType === "trait" ? t("mechanismTrait") : t("mechanismUnit"),
      entry.trigger ? t("mechanismTrigger", { value: entry.trigger }) : null,
      entry.progression ? t("mechanismProgression", { value: entry.progression }) : null,
      entry.isGrowth
        ? t(entry.definitionMatchedGrowth
          ? "mechanismDefinitionMatched"
          : "mechanismDefinitionConflict")
        : null,
      Number.isFinite(Number(entry.confidence))
        ? t("mechanismConfidence", { value: Math.round(Number(entry.confidence) * 100) })
        : null
    ].filter(Boolean);
    const effectText = (entry.effects ?? []).filter(Boolean).join("; ");
    const originalLevels = (entry.originalLevels ?? []).map((level) => `<li>
      ${level.units == null ? "" : `<strong>${escapeHtml(t("mechanismTier", { value: level.units }))}</strong>`}
      <span>${escapeHtml(level.effect ?? "")}</span>
    </li>`).join("");
    const hasOriginal = Boolean(entry.originalDescription || entry.originalAbilityName || originalLevels);
    return `<details class="knowledge-card mechanism-classification-card" data-entity-type="${escapeHtml(entry.entityType)}">
      <summary class="mechanism-card-summary">
        <span class="knowledge-card-source">
          <span>${escapeHtml(labels.join(" / ") || t("mechanismLabel"))}</span>
          <strong>${escapeHtml(entry.name ?? entry.apiName)}</strong>
        </span>
        <span class="mechanism-card-description">${escapeHtml(entry.summary || effectText || t("mechanismSummaryUnavailable"))}</span>
        ${metadata.length ? `<span class="knowledge-card-meta">${metadata.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</span>` : ""}
        ${entry.reviewReason ? `<span class="knowledge-card-conditions"><strong>${escapeHtml(t("mechanismReviewReason"))}</strong><span>${escapeHtml(entry.reviewReason)}</span></span>` : ""}
        ${hasOriginal ? `<span class="mechanism-expand-hint">${escapeHtml(t("mechanismExpandOriginal"))}</span>` : ""}
      </summary>
      ${hasOriginal ? `<div class="mechanism-original-text">
        ${entry.originalAbilityName ? `<h3>${escapeHtml(entry.originalAbilityName)}</h3>` : ""}
        ${entry.originalDescription ? `<section><strong>${escapeHtml(t("mechanismOriginalDescription"))}</strong><p>${escapeHtml(entry.originalDescription)}</p></section>` : ""}
        ${originalLevels ? `<section><strong>${escapeHtml(t("mechanismOriginalLevels"))}</strong><ul>${originalLevels}</ul></section>` : ""}
      </div>` : ""}
    </details>`;
  }).join("");
  const cacheLabel = data?.classificationMeta?.cache === "hit" ? t("mechanismCacheHit") : t("mechanismCacheScan");
  const rawModelOutput = data?.modelOutput ? JSON.stringify(data.modelOutput, null, 2) : "";
  setResponseHtml(`
    ${resultHeader(t("mechanismTitle"), data?.answer?.summary ?? data?.text, "MECHANISM")}
    <section class="knowledge-evidence mechanism-classification-results">
      <header class="knowledge-evidence-head">
        <div><span>${escapeHtml(cacheLabel)}</span><h2>${escapeHtml(t("mechanismResultCount", { count: entries.length }))}</h2></div>
      </header>
      ${incompleteEntities.length ? `<div class="mechanism-incomplete-warning" role="alert">${escapeHtml(t("mechanismIncomplete", {
        names: incompleteEntities.map((entity) => entity.name || entity.apiName).join("、")
      }))}</div>` : ""}
      ${cards || `<section class="empty-state"><p>${escapeHtml(data?.text ?? t("mechanismEmpty"))}</p></section>`}
      ${rawModelOutput ? `<details class="knowledge-card mechanism-model-output"><summary>${escapeHtml(t("mechanismRawOutput"))}</summary><pre>${escapeHtml(rawModelOutput)}</pre></details>` : ""}
    </section>
    ${data?.source ? sourceAndRisk(data) : ""}
  `);
}

function buildOptionDecisionLabel(option, options) {
  const itemOccurrences = new Map();
  options.forEach((candidate) => {
    const seen = new Set();
    (candidate.items ?? []).forEach((item) => {
      const apiName = String(typeof item === "string" ? item : item?.apiName ?? item?.displayName ?? "");
      if (!apiName || seen.has(apiName)) return;
      seen.add(apiName);
      itemOccurrences.set(apiName, (itemOccurrences.get(apiName) ?? 0) + 1);
    });
  });
  const groupedItems = new Map();
  (option.items ?? []).forEach((item) => {
    const apiName = String(typeof item === "string" ? item : item?.apiName ?? item?.displayName ?? "");
    const name = typeof item === "string"
      ? localizedName(item)
      : item?.displayName ?? item?.name ?? localizedName(item?.apiName);
    if (!apiName || !name) return;
    const current = groupedItems.get(apiName) ?? { apiName, name, count: 0 };
    current.count += 1;
    groupedItems.set(apiName, current);
  });
  const items = [...groupedItems.values()];
  const differentiators = items.filter((item) => itemOccurrences.get(item.apiName) < options.length);
  const focusItems = (differentiators.length ? differentiators : items).slice(0, 2);
  return t("buildOptionDecisionLabel", {
    items: focusItems.map((item) => item.count > 1
      ? t("buildItemCopies", { count: item.count, item: item.name })
      : item.name).join(" + ")
  });
}

function buildRecommendationDecisionSummary(entries) {
  const overview = entries.reduce((result, entry) => {
    const options = entry.buildOptions ?? [];
    result.units.push(entry.name ?? entry.unit?.displayName ?? entry.apiName);
    result.preferred += options.filter((option) => ["stable", "best_available"].includes(option.role)).length;
    result.alternatives += options.filter((option) => !["stable", "best_available"].includes(option.role)).length;
    return result;
  }, { units: [], preferred: 0, alternatives: 0 });
  const fallback = t("buildRecommendationOverview", {
    units: overview.units.filter(Boolean).join(getLocale().startsWith("zh") ? "、" : ", "),
    preferred: overview.preferred,
    alternatives: overview.alternatives
  });
  if (entries.length !== 1) return fallback;
  const options = entries[0].buildOptions ?? [];
  const preferred = options.find((option) => ["stable", "best_available"].includes(option.role)) ?? options[0];
  const metrics = preferred?.metrics ?? {};
  if (
    !preferred
    || !Number.isFinite(Number(metrics.top4Rate))
    || !Number.isFinite(Number(metrics.winRate))
    || !Number.isFinite(Number(metrics.averagePlacement))
  ) return fallback;
  const preferredTop4 = Number(metrics.top4Rate);
  const preferredWin = Number(metrics.winRate);
  const preferredAverage = Number(metrics.averagePlacement);
  const comparable = options.filter((option) => (
    Number.isFinite(Number(option.metrics?.top4Rate))
    && Number.isFinite(Number(option.metrics?.winRate))
    && Number.isFinite(Number(option.metrics?.averagePlacement))
  ));
  const leadsAllMetrics = comparable.length > 0
    && preferredTop4 >= Math.max(...comparable.map((option) => Number(option.metrics.top4Rate)))
    && preferredWin >= Math.max(...comparable.map((option) => Number(option.metrics.winRate)))
    && preferredAverage <= Math.min(...comparable.map((option) => Number(option.metrics.averagePlacement)));
  const optionLabel = buildOptionDecisionLabel(preferred, options);
  const performance = t(leadsAllMetrics ? "buildRecommendationMetricLead" : "buildRecommendationMetrics", {
    option: optionLabel,
    top4: `${formatNumber(preferredTop4 * 100, { maximumFractionDigits: 1 })}%`,
    win: `${formatNumber(preferredWin * 100, { maximumFractionDigits: 1 })}%`,
    average: formatNumber(preferredAverage, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  });
  const preferredSamples = Number(metrics.samples ?? 0);
  const sampleLeader = options
    .filter((option) => option !== preferred)
    .sort((left, right) => Number(right.metrics?.samples ?? 0) - Number(left.metrics?.samples ?? 0))[0];
  const sampleLeaderSamples = Number(sampleLeader?.metrics?.samples ?? 0);
  const sampleTradeoff = sampleLeader && sampleLeaderSamples > preferredSamples
    ? t("buildRecommendationSampleTradeoff", {
      samples: formatNumber(preferredSamples),
      comparison: buildOptionDecisionLabel(sampleLeader, options),
      comparisonSamples: formatNumber(sampleLeaderSamples)
    })
    : t("buildRecommendationSampleStrength", { samples: formatNumber(preferredSamples) });
  const alternatives = overview.alternatives > 0
    ? t("buildRecommendationAlternativeHint", { alternatives: overview.alternatives })
    : "";
  const knowledgeSignal = preferred.knowledgeSignals?.[0];
  const knowledgeHint = knowledgeSignal?.text
    ? t("buildKnowledgeSummary", { text: knowledgeSignal.text })
    : "";
  return `${performance}${sampleTradeoff}${knowledgeHint}${alternatives}`;
}

function renderStrategyVideoSearchResult(data) {
  const zh = getLocale().startsWith("zh");
  const labels = zh ? {
    title: "Bilibili \u653b\u7565\u89c6\u9891",
    unavailable: "\u5f53\u524d\u65e0\u6cd5\u83b7\u53d6 Bilibili \u89c6\u9891\u641c\u7d22\u7ed3\u679c\u3002",
    unsupported: "\u4ec5\u652f\u6301\u4e91\u9876\u4e4b\u5f08\u548c\u91d1\u94f2\u94f2\u653b\u7565\u89c6\u9891\u3002",
    empty: "\u6ca1\u6709\u627e\u5230\u7b26\u5408\u8303\u56f4\u7684\u653b\u7565\u89c6\u9891\u3002",
    current: "\u5f53\u524d\u7248\u672c",
    previous: "\u4e0a\u4e00\u7248\u672c",
    older: "\u8f83\u65e7\u7248\u672c",
    unknown: "\u7248\u672c\u672a\u6807\u6ce8",
    tft_pc: "\u4e91\u9876\u4e4b\u5f08",
    golden_spatula: "\u91d1\u94f2\u94f2\u4e4b\u6218",
    author: "UP \u4e3b",
    published: "\u53d1\u5e03",
    publishedUnknown: "\u53d1\u5e03\u65e5\u671f\u672a\u77e5",
    views: "\u64ad\u653e",
    previousFallback: "\u542b\u4e0a\u4e00\u7248\u672c\u653b\u7565\u3002",
    olderFallback: "\u8f83\u65e7\u7248\u672c\u00b7\u4ec5\u4f9b\u53c2\u8003\u3002",
    unknownFallback: "\u7248\u672c\u672a\u6807\u6ce8\u00b7\u5df2\u6309\u53d1\u5e03\u65e5\u671f\u6392\u5e8f\u3002",
    open: "\u6253\u5f00\u89c6\u9891"
  } : {
    title: "Bilibili strategy videos",
    unavailable: "Bilibili video search is currently unavailable.",
    unsupported: "Only Teamfight Tactics and Golden Spatula strategy videos are supported.",
    empty: "No in-scope strategy videos were found.",
    current: "Current patch",
    previous: "Previous patch",
    older: "Older patch",
    unknown: "Patch not tagged",
    tft_pc: "Teamfight Tactics",
    golden_spatula: "Golden Spatula",
    author: "Creator",
    published: "Published",
    publishedUnknown: "Publish date unavailable",
    views: "Views",
    previousFallback: "Includes previous-patch guides.",
    olderFallback: "Older patch · for reference.",
    unknownFallback: "Patch not tagged · sorted by publish date.",
    open: "Open video"
  };
  const fallbackText = (group) => group.fallbackType === "previous_patch" ? labels.previousFallback
    : group.fallbackType === "older_patch" ? labels.olderFallback
      : group.fallbackType === "unknown_patch" ? labels.unknownFallback
        : "";
  const groups = data.status === "unsupported_scope"
    ? []
    : Array.isArray(data.groups) && data.groups.length
      ? data.groups
      : [{ ecosystem: data.requestedEcosystem ?? "tft_pc", ...data }];
  const sections = groups.map((group) => {
    const videos = group.results ?? group.videos ?? [];
    const fallback = fallbackText(group);
    const cards = videos.map((video) => {
      const url = safeKnowledgeSourceUrl(video.url);
      const cover = safeKnowledgeSourceUrl(video.coverUrl);
      const ecosystem = video.ecosystem ?? group.ecosystem ?? "tft_pc";
      const metrics = [
        video.authorName ? `${labels.author}：${video.authorName}` : null,
        video.publishedAt ? `${labels.published}：${formatDate(video.publishedAt)}` : labels.publishedUnknown,
        video.viewCount != null ? `${labels.views}：${formatNumber(video.viewCount)}` : null
      ].filter(Boolean);
      return `<article class="result-card strategy-video-card" data-patch-time-status="${escapeHtml(video.patchTimeStatus ?? "unknown")}">
        ${cover ? `<img class="strategy-video-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
        <div class="strategy-video-body">
          <div class="card-head"><div>
            ${ecosystem === "cross_ecosystem" ? "" : `<span class="ranking-badge strategy-video-ecosystem">${escapeHtml(labels[ecosystem] ?? ecosystem)}</span>`}
            ${group.ecosystem === "cross_ecosystem" ? "" : `<span class="ranking-badge patch-time-badge">${escapeHtml(labels[video.patchTimeStatus] ?? labels.unknown)}</span>`}
            <div class="card-title">${escapeHtml(video.title)}</div>
          </div></div>
          ${metrics.length ? `<small>${metrics.map(escapeHtml).join(" · ")}</small>` : ""}
          ${url ? `<a class="strategy-video-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(labels.open)} →</a>` : ""}
        </div>
      </article>`;
    }).join("");
    const groupLabel = group.ecosystem === "cross_ecosystem" ? "" : (labels[group.ecosystem] ?? group.ecosystem ?? labels.title);
    return `<section class="strategy-video-group" data-ecosystem="${escapeHtml(group.ecosystem ?? "unknown")}">
      ${groupLabel ? `<h3>${escapeHtml(groupLabel)}</h3>` : ""}
      ${fallback ? `<div class="risk-line strategy-video-fallback">${escapeHtml(fallback)}</div>` : ""}
      ${cards ? `<div class="ranking-section strategy-video-grid">${cards}</div>` : `<div class="empty-state"><strong>${escapeHtml(group.status === "unavailable" ? labels.unavailable : labels.empty)}</strong></div>`}
    </section>`;
  }).join("");
  const resultCount = groups.reduce((total, group) => total + (group.results ?? group.videos ?? []).length, 0);
  const summary = data.status === "unsupported_scope" ? labels.unsupported
    : data.status === "unavailable" ? labels.unavailable
    : resultCount ? (zh ? `\u627e\u5230 ${resultCount} \u4e2a\u653b\u7565\u89c6\u9891 \u00b7 \u6700\u65b0\u4f18\u5148` : `${resultCount} strategy videos \u00b7 newest first`)
      : labels.empty;
  setResponseHtml(`
    ${resultHeader(labels.title, summary, "BILIBILI")}
    ${data.partialFailure?.message ? `<div class="risk-line strategy-video-fallback">${escapeHtml(data.partialFailure.message)}</div>` : ""}
    ${sections}
  `);
}

function renderSemanticNativeResult(data) {
  if (data.type === "strategy_video_search_results") {
    renderStrategyVideoSearchResult(data);
    return;
  }
  if (data.type === "composition_tactical_details") {
    const comp = {
      name: data.compositionRef?.name ?? data.compositionRef?.compId ?? t("compFormation"),
      units: data.formation?.units ?? []
    };
    const placedUnits = positionedFormationUnits(comp, data.formation);
    const augmentEntries = availableAugmentEntries(data.augmentRecommendations);
    const sourceLabel = compDetailSourceLabel(data.source);
    setResponseHtml(`
      <section class="comp-tactical-detail react-comp-tactical-detail" data-status="${placedUnits.size || augmentEntries.length ? "available" : "unavailable"}">
        ${renderCompFormation(comp, data.formation, placedUnits)}
        ${renderCompAugments(augmentEntries)}
        ${sourceLabel ? `<small class="comp-detail-source">${escapeHtml(t("sourceLabel"))}：${escapeHtml(sourceLabel)}</small>` : ""}
      </section>
      ${(data.warnings ?? []).length ? `<div class="risk-line">${(data.warnings ?? []).map(escapeHtml).join("<br>")}</div>` : ""}
    `);
    return;
  }
  const isBatch = data.type === "unit_builds_batch_results";
  const isRankedBatch = isBatch && (
    data.resultMode === "rank_candidate_build_performance"
    || data.executionPlan?.resultPolicy?.payload?.mode === "rank_candidate_build_performance"
  );
  const entries = data.results ?? [];
  if (isBatch && entries.some((entry) => Array.isArray(entry.buildOptions))) {
    const narrative = data.narrative?.schemaVersion === "grounded-build-narrative.v1"
      ? data.narrative
      : null;
    const itemBatchEvidence = (data.evidence ?? []).find((entry) => entry.toolName === "item_details_batch");
    const mechanismStatus = itemBatchEvidence?.value?.mechanismStatus ?? null;
    const narrativeByOption = new Map((narrative?.options ?? []).map((entry) => [entry.optionId, entry]));
    const buildOverviewText = buildRecommendationDecisionSummary(entries);
    const unitGroups = entries.map((entry) => {
      const unitName = entry.name ?? entry.unit?.displayName ?? entry.apiName;
      const options = entry.buildOptions ?? [];
      const lockedItems = new Set((entry.constraintAudit?.lockedItems ?? []).map(String));
      const fallbackFrequency = new Map();
      options.forEach((option) => {
        const seen = new Set();
        (option.items ?? []).forEach((item) => {
          const apiName = String(typeof item === "string" ? item : item?.apiName ?? "");
          if (!apiName || seen.has(apiName) || lockedItems.has(apiName)) return;
          seen.add(apiName);
          const current = fallbackFrequency.get(apiName) ?? {
            ...(typeof item === "object" && item ? item : { apiName, displayName: item }),
            apiName,
            appearances: 0
          };
          current.appearances += 1;
          fallbackFrequency.set(apiName, current);
        });
      });
      const requiredCoreAppearances = Math.max(2, Math.ceil(options.length * 2 / 3));
      const coreItemSummary = entry.coreItemSummary ?? {
        rule: "visible_build_frequency_2_of_3",
        recommendationCount: options.length,
        requiredAppearances: requiredCoreAppearances,
        items: options.length >= 2
          ? [...fallbackFrequency.values()].filter((item) => item.appearances >= requiredCoreAppearances)
          : []
      };
      const coreItems = coreItemSummary.items ?? [];
      const coreItemsHtml = coreItems.length
        ? `<aside class="build-core-items" data-build-core-items>
          <div class="build-core-items-heading">
            <strong>${escapeHtml(t("conclusionCoreItems"))}</strong>
            <small>${escapeHtml(t("coreFrequencyRule", {
              count: coreItemSummary.recommendationCount ?? options.length,
              required: coreItemSummary.requiredAppearances ?? requiredCoreAppearances
            }))}</small>
          </div>
          <div class="items">${coreItems.map((item) => typeof item === "string"
            ? `<span class="item-pill">${escapeHtml(item)}</span>`
            : itemPill(item)).join("")}</div>
        </aside>`
        : "";
      const optionCards = options.map((option, index) => {
        const explanation = narrativeByOption.get(option.optionId) ?? null;
        const mechanismComparison = entry.mechanismQueryPlan?.comparisons?.find((candidate) => (
          candidate.optionId === option.optionId
        ));
        const requiresMechanism = Boolean(mechanismComparison?.selectedPairs?.length);
        const completion = lockedItems.size > 0;
        const roleLabel = option.role === "mainstream"
          ? t(completion ? "mainstreamCompletion" : "mainstreamBuild")
          : option.role === "best_performance_alternative"
            ? t(completion ? "bestPerformanceCompletionAlternative" : "bestPerformanceAlternative")
            : option.role === "alternative"
              ? t(completion ? "highPerformanceCompletionAlternative" : "highPerformanceAlternative")
              : option.role === "stable"
                ? t("stableBuildOption")
                : option.role === "best_available"
                  ? t("bestAvailableBuildOption")
                  : t("alternativeBuildOption", { value: Math.max(1, Number(option.rank ?? index + 1) - 1) });
        const items = (option.items ?? []).map((item) => typeof item === "string"
          ? `<span class="item-pill">${escapeHtml(item)}</span>`
          : itemPill(item)).join("");
        const metrics = option.metrics ?? {};
        const explanationLists = [
          ["buildSuitableWhen", explanation?.suitableWhen],
          ["buildTradeoffs", explanation?.tradeoffs],
          ["buildRisks", explanation?.risks]
        ].filter(([, values]) => values?.length).map(([label, values]) => `
          <section class="build-option-explanation-list">
            <strong>${escapeHtml(t(label))}</strong>
            ${label === "buildSuitableWhen" && values.some((value) => value?.inferenceType === "mechanism_based_advice")
              ? `<span class="mechanism-inference-badge">${escapeHtml(t("mechanismBasedInference"))}</span>`
              : ""}
            <ul>${values.map((value) => `<li>${escapeHtml(value?.text ?? value)}</li>`).join("")}</ul>
          </section>
        `).join("");
        const mechanismDifference = explanation?.mechanismDifference?.text
          ? `<section class="build-option-mechanism"><strong>${escapeHtml(t("buildMechanismDifference"))}</strong><p>${escapeHtml(explanation.mechanismDifference.text)}</p></section>`
          : requiresMechanism && mechanismStatus === "unavailable"
            ? `<div class="risk-line build-mechanism-missing">${escapeHtml(t("currentSeasonMechanismMissing"))}</div>`
            : "";
        const knowledgeSignals = (option.knowledgeSignals ?? []).filter((signal) => signal?.text);
        const knowledgeSignalHtml = knowledgeSignals.length
          ? `<aside class="build-knowledge-signal" data-build-knowledge-signal>
            <strong>${escapeHtml(t("buildKnowledgePossibleCause"))}</strong>
            ${knowledgeSignals.map((signal) => `<p>${escapeHtml(signal.text)}</p>`).join("")}
          </aside>`
          : "";
        const headlineExplanation = explanation?.mechanismDifference?.text
          ?? explanation?.statisticalBasis?.text
          ?? explanation?.explanation
          ?? ((data.narrativeWarnings ?? []).length
            ? t("buildNarrativeRejectedShort")
            : requiresMechanism && mechanismStatus === "unavailable"
              ? t("currentSeasonMechanismMissing")
              : t("buildNarrativeNotProvided"));
        return `<details class="result-card build-option-card${index === 0 ? " best" : " alternative"}" data-build-option-id="${escapeHtml(option.optionId)}" ${index === 0 ? "open" : ""}>
          <summary class="build-option-summary">
            <span class="build-option-role">${escapeHtml(roleLabel)}</span>
            <span class="build-option-unit">${escapeHtml(unitName)}</span>
            <span class="items">${items}</span>
            <span class="build-option-samples">${escapeHtml(t("buildOptionSamples", { value: formatNumber(metrics.samples ?? 0) }))}</span>
            <span class="build-option-difference">${escapeHtml(headlineExplanation)}</span>
          </summary>
          <div class="build-option-detail">
            <div class="stats">
              ${metric(t("top4"), metrics.top4Rate == null ? "-" : `${formatNumber(metrics.top4Rate * 100, { maximumFractionDigits: 1 })}%`)}
              ${metric(t("win"), metrics.winRate == null ? "-" : `${formatNumber(metrics.winRate * 100, { maximumFractionDigits: 1 })}%`)}
              ${metric(t("avg"), metrics.averagePlacement == null ? "-" : formatNumber(metrics.averagePlacement, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
              ${metric(t("performanceScore"), option.ranking?.performanceScore == null && option.ranking?.score == null ? "-" : formatNumber((option.ranking.performanceScore ?? option.ranking.score) * 100, { maximumFractionDigits: 1 }))}
            </div>
            ${rankingInsightBadges(option.ranking)}
            ${mechanismDifference}
            ${knowledgeSignalHtml}
            ${explanationLists}
            <small class="build-option-evidence">${escapeHtml(t("updated"))}：${escapeHtml(formatDate(data.updatedAt ?? data.source?.updatedAt))}</small>
          </div>
        </details>`;
      }).join("");
      const shortage = Number(entry.availableOptionCount ?? options.length) < Number(entry.requestedOptionCount ?? 3)
        ? `<div class="risk-line build-options-shortage">${escapeHtml(t("buildOptionsShortage", { value: entry.availableOptionCount ?? options.length }))}</div>`
        : "";
      return `<section class="unit-build-options" data-unit-build-options="${escapeHtml(entry.apiName ?? "")}">
        ${coreItemsHtml}
        ${optionCards || `<div class="empty-state"><strong>${escapeHtml(entry.warning ?? data.text ?? t("noResult"))}</strong></div>`}
        ${shortage}
      </section>`;
    }).join("");
    const narrativeWarnings = (data.narrativeWarnings ?? []).filter(Boolean).map(String);
    const narrativeWarning = narrativeWarnings.length
      ? `<details class="build-narrative-warning" data-build-narrative-warning>
        <summary>${escapeHtml(t("buildNarrativeWarningSummary", { count: narrativeWarnings.length }))}</summary>
        <p>${escapeHtml(t("buildNarrativeRejected"))}</p>
        <ul>${narrativeWarnings.map((warning) => `<li>
          <span>${escapeHtml(buildNarrativeWarningText(warning))}</span>
          <details class="build-narrative-technical">
            <summary>${escapeHtml(t("buildNarrativeTechnicalDetails"))}</summary>
            <code>${escapeHtml(warning)}</code>
          </details>
        </li>`).join("")}</ul>
      </details>`
      : "";
    const narrativeSummary = narrative?.summary?.text
      ? `<details class="build-model-summary">
        <summary>${escapeHtml(t("buildModelSummary"))}</summary>
        <p>${escapeHtml(narrative.summary.text)}</p>
      </details>`
      : "";
    setResponseHtml(`
      ${resultHeader(t("recommendation"), buildOverviewText, t("recommendation"))}
      ${data.query ? conditionPanel(data) : ""}
      ${narrativeWarning}
      <section class="ranking-section build-options-ranking">${unitGroups}</section>
      ${narrativeSummary}
      ${data.source ? sourceAndRisk(data) : ""}
    `);
    return;
  }
  const cards = entries.map((entry, index) => {
    const apiName = entry.apiName ?? entry.unit;
    const name = entry.name ?? apiName;
    const build = (entry.bestBuild ?? []).map((item) => typeof item === "string"
      ? `<span class="item-pill">${escapeHtml(item)}</span>`
      : itemPill(item)).join("");
    const stats = isBatch || data.type === "trait_external_unit_statistics"
      ? `<div class="stats">
          ${metric(t("top4"), entry.top4Rate == null ? "-" : `${formatNumber(entry.top4Rate * 100)}%`)}
          ${metric(t("win"), entry.winRate == null ? "-" : `${formatNumber(entry.winRate * 100)}%`)}
          ${metric(t("avg"), entry.avgPlacement == null ? "-" : formatNumber(entry.avgPlacement, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
          ${metric(t("samples"), formatNumber(entry.games ?? 0))}
        </div>`
      : "";
    const isBest = index === 0 && isRankedBatch && entry.available !== false;
    return `<article class="result-card${isBest ? " best" : ""}">
      ${isBest ? `<span class="best-label">${t("best")}</span>` : ""}
      <div class="card-head"><div class="card-title-group">${assetThumb(entry.iconUrl, name, "equipment-unit-icon")}<div><div class="card-title">${escapeHtml(name)}</div>${entry.cost != null ? `<small>${escapeHtml(t("unitCost", { value: entry.cost }))}</small>` : ""}</div></div></div>
      ${build ? `<div class="items">${build}</div>` : ""}
      ${entry.warning ? `<div class="risk-line">${escapeHtml(entry.warning)}</div>` : ""}
      ${stats}
    </article>`;
  }).join("");
  setResponseHtml(`
    ${resultHeader(t("recommendation"), data.answer?.summary ?? data.text, t("recommendation"))}
    ${cards ? `<section class="ranking-section">${cards}</section>` : `<div class="empty-state"><strong>${escapeHtml(data.text ?? t("noResult"))}</strong></div>`}
    ${data.query ? conditionPanel(data) : ""}
    ${data.source ? sourceAndRisk(data) : ""}
  `);
}

function renderCurrentResult(data) {
  if (data.type === "system_interaction") renderSystemInteractionResult(data);
  else if (
    data.type === "coach_answer"
    || (data?.clarification?.needsClarification && data?.assistantResponse?.text)
  ) renderCoachAnswerResult(data);
  else if (data.type === "mechanism_classification") renderMechanismClassification(data);
  else if (data.type === "entity_catalog") renderEntityCatalog(data);
  else if (data.type === "unit_details") renderUnitDetails(data);
  else if (data.type === "trait_details") renderTraitDetails(data);
  else if (data.type === "item_details") renderItemDetails(data);
  else if (data.type === "unit_item_comparison") renderItemComparison(data);
  else if (["composition_change_evaluation", "composition_replacement_evaluation"].includes(data.type)) renderCompositionChangeEvaluation(data);
  else if (data.type === CompRankingResult.type || data.type === "comp_trends" || data.type === "comp_analysis") renderCompRankings(data);
  else if (data.type === "item_carrier_rankings") renderItemCarrierRankings(data);
  else if (data.type === ItemRankingResult.type || data.type === "unit_emblem_rankings") renderItemRankings(data);
  else if (["entity_catalog_results", "unit_builds_batch_results", "trait_external_unit_statistics", "composition_tactical_details", "strategy_video_search_results"].includes(data.type)) renderSemanticNativeResult(data);
  else renderRecommendationResult(data);
  const currentStatsScopeHtml = renderCurrentStatsScopeStatus(data);
  if (currentStatsScopeHtml) resultContentEl.insertAdjacentHTML("beforeend", currentStatsScopeHtml);
  const knowledgeHtml = renderKnowledgeEvidence(data);
  if (knowledgeHtml) resultContentEl.insertAdjacentHTML("beforeend", knowledgeHtml);
}

function renderResult(data) {
  if (isCompResult(data) && state.resultNavigation.length) {
    state.resultNavigation = [];
  }
  state.lastResult = data;
  state.compRankingMetric = null;
  clearCompDetailState();
  state.lastResultId = data.queryId ?? null;
  state.feedbackByCard = {};
  state.explanationFeedback = null;
  state.conclusionStreamText = "";
  setDeveloperOutput(data);
  state.lastSuggestions = data.clarification?.suggestions ?? [];
  state.lastEntityCandidates = data.clarification?.entityCandidates ?? [];
  state.currentResponseId = recordAssistantResponse(data);
  state.resultView = { type: "result", data };
  resultTitleEl.textContent = t("resultTitle");
  renderCurrentResult(data);
  resultRefreshButton.disabled = false;
}

function applyConclusionEvent(data, event) {
  const pending = data?.answer?.generatedConclusion;
  if (!pending || pending.jobId !== state.lastResult?.answer?.generatedConclusion?.jobId) return false;
  if (event.type === "delta") {
    state.conclusionStreamText += String(event.text ?? "");
    const target = resultContentEl.querySelector("[data-conclusion-stream]");
    if (target) target.textContent = state.conclusionStreamText;
    const record = state.responsesById.get(state.currentResponseId);
    const chatTarget = record?.data === data ? record.target?.querySelector("[data-chat-conclusion-stream]") : null;
    if (chatTarget) chatTarget.textContent = state.conclusionStreamText;
    if (state.conclusionStreamText.length % 12 === 0) scrollConversation();
    return true;
  }
  if (event.type === "complete" && event.conclusion) {
    data.answer.generatedConclusion = event.conclusion;
    state.lastResult = data;
    state.resultView = { type: "result", data };
    const scrollTop = resultContentEl.scrollTop;
    renderCurrentResult(data);
    resultContentEl.scrollTop = scrollTop;
    const record = state.responsesById.get(state.currentResponseId);
    if (record?.data === data) rerenderAssistantRecord(record);
    setDeveloperOutput(data);
    return true;
  }
  return event.type === "start";
}

async function pollConclusionStatus(data, pending, signal) {
  while (!signal.aborted) {
    const response = await fetch(pending.statusUrl, {
      signal,
      headers: { accept: "application/json" }
    });
    const event = await response.json();
    if (!response.ok || !event.ok) throw new Error(event.error ?? t("queryFailed"));
    if (event.status === "complete") {
      applyConclusionEvent(data, { type: "complete", conclusion: event.conclusion });
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 650));
  }
}

async function streamGeneratedConclusion(data, requestId) {
  const pending = data?.answer?.generatedConclusion;
  if (pending?.status !== "pending" || !pending.streamUrl) return;
  state.currentConclusionController?.abort();
  const controller = new AbortController();
  state.currentConclusionController = controller;
  state.conclusionStreamText = "";

  try {
    const response = await fetch(pending.streamUrl, {
      signal: controller.signal,
      headers: { accept: "application/x-ndjson" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body?.getReader) {
      await pollConclusionStatus(data, pending, controller.signal);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        applyConclusionEvent(data, JSON.parse(line));
      }
      if (done) {
        if (buffer.trim()) applyConclusionEvent(data, JSON.parse(buffer));
        break;
      }
    }
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.requestSerial) return;
    if (data?.answer?.generatedConclusion !== pending) return;
    try {
      await pollConclusionStatus(data, pending, controller.signal);
    } catch (pollError) {
      if (pollError.name === "AbortError") return;
      if (data?.answer?.generatedConclusion !== pending) return;
      data.answer.generatedConclusion = {
        status: "fallback",
        reason: "provider_unavailable",
        content: null,
        model: pending.model ?? null
      };
      if (state.lastResult === data) {
        renderCurrentResult(data);
        const record = state.responsesById.get(state.currentResponseId);
        if (record?.data === data) rerenderAssistantRecord(record);
      }
    }
  } finally {
    if (state.currentConclusionController === controller) state.currentConclusionController = null;
  }
}

function requestErrorMessageKey(message) {
  return /(?:load failed|failed to fetch|fetch failed|network\s*error|network request failed|err_connection_closed|connection closed|the network connection was lost)/iu.test(String(message ?? ""))
    ? "networkInterrupted"
    : null;
}

function renderError(message, messageKey = null) {
  state.lastResult = null;
  state.lastResultId = null;
  const resolvedMessageKey = messageKey ?? requestErrorMessageKey(message);
  const displayMessage = resolvedMessageKey ? t(resolvedMessageKey) : message;
  rawOutputEl.textContent = displayMessage;
  renderErrorResult(message, true, resolvedMessageKey);
  if (activeResponseEl) activeResponseEl.innerHTML = `<div class="chat-request-error"><strong>${escapeHtml(displayMessage)}</strong><span>${escapeHtml(t("networkRetryHint"))}</span></div>`;
}

function aliasMeta(alias) {
  const typeLabel = {
    unit: t("hero"),
    item: t("item"),
    trait: t("trait")
  }[alias.entityType] ?? alias.entityType ?? "-";
  const stateLabel = alias.enabled ? t("enabled") : t("candidate");
  const confidence = Number.isFinite(Number(alias.confidence))
    ? Number(alias.confidence).toFixed(2)
    : "-";
  return `${typeLabel} / ${stateLabel} / ${confidence}`;
}

function selectedAliasIds() {
  return [...aliasList.querySelectorAll("input[data-alias-select]:checked")]
    .map((input) => Number(input.value))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function updateAliasBatchState() {
  const checkboxes = [...aliasList.querySelectorAll("input[data-alias-select]")];
  const selected = checkboxes.filter((input) => input.checked);
  const hasSelection = selected.length > 0;
  enableSelectedAliasesButton.disabled = !hasSelection;
  disableSelectedAliasesButton.disabled = !hasSelection;
  aliasSelectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
  aliasSelectAll.indeterminate = hasSelection && selected.length < checkboxes.length;
}

function updateAliasPagination(pagination = {}) {
  state.aliasHasMore = Boolean(pagination.hasMore);
  const returned = Number(pagination.returned ?? 0);
  const start = returned ? state.aliasOffset + 1 : 0;
  const end = returned ? state.aliasOffset + returned : 0;
  aliasPageLabel.textContent = `${start}-${end}`;
  aliasPrevButton.disabled = state.aliasOffset <= 0;
  aliasNextButton.disabled = !state.aliasHasMore;
}

function renderAliases(aliases = []) {
  state.aliases = aliases;
  if (!aliases.length) {
    aliasList.innerHTML = `<div class="alias-empty">${t("noCandidates")}</div>`;
    updateAliasBatchState();
    return;
  }

  aliasList.innerHTML = aliases.map((alias) => `
    <div class="alias-row">
      <input class="alias-select" type="checkbox" data-alias-select value="${escapeHtml(alias.id)}" aria-label="${escapeHtml(t("selectAlias", { alias: alias.alias }))}">
      <div class="alias-main">
        <strong>${escapeHtml(alias.alias)}</strong>
        <span>${escapeHtml(alias.apiName)}</span>
        <small>${escapeHtml(aliasMeta(alias))}</small>
      </div>
      <button type="button" data-alias-id="${escapeHtml(alias.id)}" data-alias-enabled="${alias.enabled ? "false" : "true"}">
        ${alias.enabled ? t("disable") : t("enabled")}
      </button>
    </div>
  `).join("");
  updateAliasBatchState();
}

function auditParams(format = "") {
  const params = new URLSearchParams();
  if (state.seasonContextId) params.set("seasonContextId", state.seasonContextId);
  if (itemAuditQuery.value.trim()) params.set("query", itemAuditQuery.value.trim());
  if (itemAuditPatch.value.trim()) params.set("patch", itemAuditPatch.value.trim());
  if (itemAuditSource.value.trim()) params.set("source", itemAuditSource.value.trim());
  if (itemAuditCategory.value) params.set("category", itemAuditCategory.value);
  if (itemAuditStatus.value) params.set("status", itemAuditStatus.value);
  if (itemAuditAvailability.value) params.set("availability", itemAuditAvailability.value);
  if (itemAuditIssues.value) params.set("issues", itemAuditIssues.value);
  if (format) params.set("format", format);
  return params;
}

function auditIssueLabel(issue) {
  return {
    missing_canonical_zh_name: t("auditMissingCanonicalName"),
    unknown_category: t("auditUnknownCategory"),
    missing_official_details: t("auditMissingOfficialDetails"),
    missing_official_effect: t("auditMissingOfficialEffect"),
    missing_recipe_components: t("auditMissingRecipe"),
    unversioned_availability_override: t("auditUnversionedAvailability"),
    official_manual_name_conflict: t("auditNameConflict"),
    catalog_cache_fallback: t("auditCatalogFallback"),
    official_details_source_error: t("auditOfficialSourceError")
  }[issue] ?? issue;
}

function renderItemAudit(data) {
  const records = data.report?.records ?? [];
  const report = data.report ?? {};
  const catalog = report.catalog ?? {};
  const details = report.officialDetails ?? {};
  itemAuditMeta.textContent = t("auditMeta", { patch: report.patch ?? "current", catalogStatus: catalog.status ?? "-", catalogSource: catalog.source ?? "-", detailStatus: details.status ?? "-" });
  itemAuditSummary.textContent = t("auditSummary", { returned: data.summary?.returned ?? records.length, total: data.summary?.total ?? records.length, issues: data.summary?.withIssues ?? 0 });
  itemAuditList.innerHTML = records.length ? records.map((record) => {
    const effect = record.completeness?.status ?? "unknown";
    const recipe = record.completeness?.recipeStatus ?? "unknown";
    const override = record.overrides?.availability ?? record.overrides?.alias;
    return `
      <article class="audit-row">
        <div class="audit-icon">${record.iconUrl ? `<img src="${escapeHtml(record.iconUrl)}" alt="">` : escapeHtml(t("noImage"))}</div>
        <div class="audit-main">
          <div class="audit-title"><strong>${escapeHtml(record.canonicalName)}</strong><span>${escapeHtml(record.shortName ?? t("noShortName"))}</span></div>
          <code>${escapeHtml(record.apiName)}</code>
          <small>${escapeHtml(record.historicalAliases.join(" / ") || t("noHistoricalAliases"))}</small>
          <div class="audit-tags">
            <span>${escapeHtml(record.category)}</span>
            <span>${escapeHtml(record.current && record.obtainable ? t("available") : t("unavailable"))}</span>
            <span>${escapeHtml(record.catalogStatus)}/${escapeHtml(record.catalogSource)}</span>
            <span>${escapeHtml(t("effectStatus", { value: effect }))}</span>
            <span>${escapeHtml(t("recipeStatus", { value: recipe }))}</span>
          </div>
          <small>${escapeHtml(t("auditNameSource", { source: record.nameSource ?? "-", override: override ? `${override.source ?? "-"} / ${override.patch ?? override.season ?? t("unversioned")}` : t("noAuditOverride") }))}</small>
          <div class="audit-issues">${record.issues.length ? record.issues.map((issue) => `<span>${escapeHtml(auditIssueLabel(issue))}</span>`).join("") : `<span class="clean">${escapeHtml(t("noAuditIssues"))}</span>`}</div>
        </div>
      </article>
    `;
  }).join("") : `<div class="audit-empty">${escapeHtml(t("noAuditResults"))}</div>`;
}

async function loadItemAudit(options = {}) {
  itemAuditList.innerHTML = `<div class="audit-empty">${escapeHtml(t("auditLoading"))}</div>`;
  const params = auditParams();
  if (options.refresh) params.set("refresh", "1");
  const response = await fetch(`/api/item-catalog-audit?${params.toString()}`);
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? t("auditLoadFailed"));
  state.itemAuditLoaded = true;
  renderItemAudit(data);
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportItemAudit(format) {
  const response = await fetch(`/api/item-catalog-audit?${auditParams(format).toString()}`);
  const data = await response.json();
  if (!response.ok || !data.ok || !data.export) throw new Error(data.error ?? t("auditExportFailed"));
  downloadText(
    data.export.filename,
    data.export.content,
    format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8"
  );
}

async function loadAliases() {
  try {
    const params = new URLSearchParams({
      limit: String(state.aliasLimit),
      offset: String(state.aliasOffset)
    });
    if (state.aliasState) params.set("enabled", state.aliasState);
    if (state.aliasType) params.set("entityType", state.aliasType);
    if (state.aliasQuery.trim()) params.set("query", state.aliasQuery.trim());

    const response = await fetch(`/api/entity-aliases?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("aliasLoadFailed"));
    renderAliases(data.aliases);
    updateAliasPagination(data.pagination);
  } catch (error) {
    aliasList.innerHTML = `<div class="alias-empty">${escapeHtml(error.message)}</div>`;
    updateAliasBatchState();
    updateAliasPagination({
      returned: 0,
      hasMore: false
    });
  }
}

async function reviewAlias(id, enabled) {
  const response = await fetch("/api/entity-aliases/review", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: Number(id),
      enabled
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? t("aliasUpdateFailed"));
  await loadAliases();
  setStatusKey(enabled ? "enabled" : "aliasDisabled");
}

async function reviewSelectedAliases(enabled) {
  const ids = selectedAliasIds();
  if (!ids.length) {
    setStatusKey("noAliasSelected");
    updateAliasBatchState();
    return;
  }

  enableSelectedAliasesButton.disabled = true;
  disableSelectedAliasesButton.disabled = true;
  const response = await fetch("/api/entity-aliases/review-batch", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      ids,
      enabled
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? t("batchUpdateFailed"));
  await loadAliases();
  setStatusKey("aliasesUpdated", "ready", { count: data.updated ?? ids.length });
}

async function clearEntityMemory() {
  const response = await fetch("/api/entity-memory/clear", {
    method: "POST"
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? t("candidateClearFailed"));
  state.aliasOffset = 0;
  await loadAliases();
  const cleared = data.cleared ?? {};
  setStatusKey("candidatesCleared", "ready", { count: cleared.candidateAliases ?? 0, feedback: cleared.feedbackEvents ?? 0 });
}

async function fetchAliasDraft() {
  const response = await fetch("/api/entity-aliases/export?limit=1000");
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? t("exportFailed"));
  return data.draft;
}

async function exportAliasDraft() {
  const draft = await fetchAliasDraft();
  rawOutputEl.textContent = draft?.text ?? JSON.stringify(draft, null, 2);
  detailsEl.open = true;
  setStatusKey("exported");
}

async function downloadAliasDraft() {
  const draft = await fetchAliasDraft();
  const text = draft?.text ?? JSON.stringify(draft, null, 2);
  rawOutputEl.textContent = text;
  detailsEl.open = true;

  const blob = new Blob([text], {
    type: "text/javascript;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tft-agent-alias-overrides-draft.js";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatusKey("downloaded");
}

async function saveEntityCandidate(candidate) {
  if (!canSaveCandidateAlias(candidate)) {
    setStatusKey("candidateKnown");
    return;
  }

  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      queryId: state.lastResultId,
      feedbackType: "alias_candidate",
      aliasCandidate: {
        alias: candidate.inputFragment,
        entityType: candidate.entityType,
        apiName: candidate.apiName,
        confidence: candidate.confidence,
        source: candidate.source ?? "local_entity_candidate_retriever"
      }
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? t("candidateSaveFailed"));
  setStatusKey("candidateSaved");
  if (appShell.settings.open) await loadAliases();
}

async function sendResultFeedback(sentiment, cardIndex, reason = null) {
  const data = state.lastResult;
  const card = data?.cards?.[cardIndex];
  if (!card || !state.lastResultId) throw new Error(t("feedbackUnavailable"));

  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      queryId: state.lastResultId,
      target: "recommendation",
      cardIndex,
      rating: sentiment === "good" ? "helpful" : "unhelpful",
      ...(reason ? { reason } : {})
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? t("feedbackSaveFailed"));
  return payload;
}

async function sendExplanationFeedback(sentiment, reason = null, sourceData = state.lastResult) {
  const conclusion = sourceData?.answer?.generatedConclusion;
  const reactAnswer = typeof sourceData?.reactAnswer === "string" ? sourceData.reactAnswer.trim() : "";
  const queryId = sourceData?.queryId ?? null;
  if ((!conclusion?.content && !reactAnswer) || !queryId) throw new Error(t("feedbackUnavailable"));
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queryId,
      target: "explanation",
      rating: sentiment === "good" ? "helpful" : "unhelpful",
      ...(reason ? { reason } : {})
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? t("feedbackSaveFailed"));
  return payload;
}

function appendUserMessage(input) {
  const time = new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  conversationPane.appendUser(escapeHtml(input), `<time>${escapeHtml(time)}</time><strong>${t("you")}</strong>`);
}

function appendAssistantMessage(progress = null) {
  const time = new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return conversationPane.appendAssistant(
    progress ? recommendationProgressHtml(progress) : progressStepsHtml(state.progressIndex),
    `<strong>${t("assistant")}</strong><time>${escapeHtml(time)}</time>`
  );
}

function createRecommendationProgressState() {
  return {
    phase: "request.accepted",
    data: null,
    completed: new Set(),
    active: "understanding",
    startedAt: Date.now(),
    completedAt: null,
    events: [],
    clockTimer: null
  };
}

function recommendationProgressEvent(event) {
  const data = event?.data ?? {};
  return {
    phase: String(event?.phase ?? "unknown"),
    data: {
      type: data.type ?? null,
      tool: data.tool ?? null,
      iteration: Number.isFinite(Number(data.iteration)) ? Number(data.iteration) : null,
      stage: data.stage ?? null,
      source: data.source ?? null,
      resultType: data.resultType ?? null,
      evidenceCount: Number.isFinite(Number(data.evidenceCount)) ? Number(data.evidenceCount) : null,
      reasonCode: data.reasonCode ?? null,
      terminationReason: data.terminationReason ?? null
    }
  };
}

function appendRecommendationProgressEvent(progress, event) {
  const next = recommendationProgressEvent(event);
  const previous = progress.events.at(-1);
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
  progress.events.push(next);
  if (progress.events.length > 24) progress.events.splice(0, progress.events.length - 24);
}

function mergeRecommendationProgressData(current, incoming = {}) {
  return {
    ...(current ?? {}),
    ...incoming,
    conversation: incoming.conversation ?? current?.conversation,
    answerModeRoute: incoming.answerModeRoute ?? current?.answerModeRoute,
    agent: {
      ...(current?.agent ?? {}),
      ...(incoming.agent ?? {})
    }
  };
}

function applyRecommendationProgressState(progress, event) {
  const phase = String(event?.phase ?? "");
  appendRecommendationProgressEvent(progress, event);
  progress.phase = phase;
  progress.data = mergeRecommendationProgressData(progress.data, event?.data ?? {});
  if (phase === "understanding.started" || phase === "request.accepted") {
    progress.active = "understanding";
  } else if (phase === "understanding.resolved") {
    progress.completed.add("understanding");
    progress.active = "plan";
  } else if (phase === "plan.ready") {
    progress.completed.add("understanding");
    progress.completed.add("plan");
    progress.active = "retrieval";
  } else if (phase === "retrieval.started") {
    progress.active = "retrieval";
  } else if (phase === "retrieval.completed") {
    progress.completed.add("retrieval");
    progress.active = "answer";
  } else if (phase === "answer.started") {
    progress.active = "answer";
  }
}

function recommendationProgressHtml(progress, options = {}) {
  return renderUnderstandingPanel(progress.data, {
    locale: getLocale(),
    surface: "chat",
    open: options.understandingOpen !== false,
    traceState: progress,
    now: options.now
  });
}

function updateRecommendationProgressClock(target, progress) {
  const elapsed = target?.querySelector("[data-processing-elapsed]");
  if (!elapsed) return;
  const end = Number.isFinite(progress.completedAt) ? progress.completedAt : Date.now();
  elapsed.textContent = formatProcessingDuration(end - progress.startedAt);
}

function startRecommendationProgressClock(target, progress) {
  if (progress.clockTimer) clearInterval(progress.clockTimer);
  updateRecommendationProgressClock(target, progress);
  progress.clockTimer = setInterval(() => {
    if (!target?.isConnected) {
      clearInterval(progress.clockTimer);
      progress.clockTimer = null;
      return;
    }
    updateRecommendationProgressClock(target, progress);
  }, 1000);
}

function stopRecommendationProgressClock(progress) {
  if (!progress?.clockTimer) return;
  clearInterval(progress.clockTimer);
  progress.clockTimer = null;
}

function completeRecommendationProgress(progress, data) {
  progress.completedAt = Date.now();
  progress.completed.add("answer");
  progress.active = null;
  stopRecommendationProgressClock(progress);
  data.processingTrace = {
    startedAt: progress.startedAt,
    completedAt: progress.completedAt,
    phase: "complete",
    completed: [...progress.completed],
    events: progress.events.map((event) => structuredClone(event))
  };
}

function renderRecommendationProgress(target, progress) {
  if (!target?.isConnected) return;
  const currentPanel = target.querySelector(".chat-understanding-panel");
  target.innerHTML = recommendationProgressHtml(progress, {
    understandingOpen: currentPanel ? currentPanel.hasAttribute("open") : true
  });
  const phaseIndex = progress.active === "understanding"
    ? 0
    : progress.active === "plan" || progress.active === "retrieval"
      ? 1
      : 2;
  if (target === activeResponseEl) state.progressIndex = phaseIndex;
  if (state.resultView.type === "loading") renderLoadingResult(false);
  scrollConversation();
}

function recommendationFailureMessage(failure, fallback = t("queryFailed")) {
  const nested = failure?.data ?? failure?.event?.data ?? {};
  const code = String(failure?.code ?? nested.code ?? failure?.terminationReason ?? "").trim();
  const rawMessage = String(failure?.error ?? failure?.message ?? nested.message ?? "").trim();
  const timeoutMatch = rawMessage.match(/react decision provider timed out after (\d+)ms/i);
  if (timeoutMatch) {
    const seconds = Math.max(1, Math.round(Number(timeoutMatch[1]) / 1000));
    return getLocale().startsWith("zh")
      ? `\u6a21\u578b\u51b3\u7b56\u8d85\u65f6\uff08${seconds} \u79d2\uff09\uff0c\u5c1a\u672a\u8c03\u7528\u6570\u636e\u5de5\u5177\u3002\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002`
      : `The model decision timed out after ${seconds} seconds before a data tool was called. Please retry.`;
  }
  if (code === "decision_provider_failed") {
    const strategyEvidence = Array.isArray(failure?.evidence)
      ? failure.evidence.find((entry) => entry?.value?.type === "strategy_video_search_results")?.value
      : null;
    if (strategyEvidence?.status === "found") {
      return getLocale().startsWith("zh")
        ? "\u6a21\u578b\u603b\u7ed3\u6682\u4e0d\u53ef\u7528\uff0c\u4ee5\u4e0b\u4e3a\u5df2\u83b7\u53d6\u7684\u89c6\u9891\u7ed3\u679c\u3002"
        : "The model summary is unavailable; retrieved video results are shown below.";
    }
    return getLocale().startsWith("zh")
      ? "\u6a21\u578b\u51b3\u7b56\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u5c1a\u672a\u5b8c\u6210\u6570\u636e\u67e5\u8be2\u3002\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002"
      : "The model decision service is temporarily unavailable, so the data query did not complete. Please retry.";
  }
  if (code === "missing_required_evidence") {
    return getLocale().startsWith("zh")
      ? "\u5df2\u68c0\u7d22\u5230\u5019\u9009\u6765\u6e90\uff0c\u4f46\u81ea\u52a8\u603b\u7ed3\u672a\u901a\u8fc7\u8bc1\u636e\u6821\u9a8c\uff1b\u4ee5\u4e0b\u76f4\u63a5\u5c55\u793a\u53ef\u6838\u9a8c\u7684\u89c6\u9891\u7ed3\u679c\u3002"
      : "Candidate sources were retrieved, but the generated summary did not pass evidence validation. The verifiable video results are shown below.";
  }
  return rawMessage || fallback;
}

function hasRenderableNativeEvidence(payload) {
  const nativeTypes = new Set([
    "composition_rankings",
    "comp_rankings",
    "comp_trends",
    "comp_analysis",
    "entity_catalog_results",
    "unit_build_rankings",
    "unit_build_completion",
    "unit_best_3_items",
    "unit_item_rankings",
    "unit_emblem_rankings",
    "unit_item_comparison",
    "unit_builds_batch_results",
    "item_carrier_rankings",
    "unit_details",
    "item_details",
    "trait_details",
    "composition_change_evaluation",
    "composition_replacement_evaluation",
    "trait_external_unit_statistics",
    "composition_tactical_details",
    "strategy_video_search_results"
  ]);
  return Array.isArray(payload?.evidence) && payload.evidence.some((entry) => nativeTypes.has(entry?.value?.type));
}

async function readRecommendationStream(response, target, progress, requestId, signal) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body?.getReader) throw new Error("recommendation progress stream is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completion = null;
  let failureDiagnostic = null;
  const applyLine = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "diagnostic") {
      progress.diagnostic = event;
      return;
    }
    if (event.type === "event") {
      const phase = String(event.event?.type ?? "react.event");
      if (phase === "error") failureDiagnostic = event.event;
      applyRecommendationProgressState(progress, {
        schemaVersion: "recommendation-progress.v1",
        sequence: Number(event.event?.sequence ?? 0),
        phase,
        data: event.event?.data ?? event.event ?? {}
      });
      if (requestId === state.requestSerial) renderRecommendationProgress(target, progress);
      return;
    }
    if (event.type === "progress") {
      applyRecommendationProgressState(progress, event.event);
      if (requestId === state.requestSerial) renderRecommendationProgress(target, progress);
      return;
    }
    if (event.type === "error") {
      throw new Error(recommendationFailureMessage(event));
    }
    if (event.type === "complete") completion = event;
  };
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) applyLine(line);
    if (done) {
      if (buffer.trim()) applyLine(buffer);
      break;
    }
  }
  if (signal.aborted) {
    const abortError = new Error("recommendation request aborted");
    abortError.name = "AbortError";
    throw abortError;
  }
  if (!completion) throw streamIncompleteError();
  if (Number(completion.statusCode ?? 200) >= 400 || !completion.payload?.ok) {
    if (hasRenderableNativeEvidence(completion.payload)) {
      const strategyEvidence = completion.payload.evidence
        ?.find((entry) => entry?.value?.type === "strategy_video_search_results")?.value;
      return {
        ...completion.payload,
        ok: true,
        ...(strategyEvidence?.status === "unsupported_scope" ? {} : {
          partialFailure: {
            code: String(completion.payload?.terminationReason ?? "evidence_validation_failed"),
            message: recommendationFailureMessage(completion.payload)
          }
        })
      };
    }
    throw new Error(recommendationFailureMessage(
      completion.payload,
      recommendationFailureMessage(failureDiagnostic)
    ));
  }
  return completion.payload;
}

function normalizeReactCompositionRankings(value) {
  const metricMap = {
    top4_rate: "top4Rate",
    win_rate: "winRate",
    win_share: "winShare",
    avg_placement: "avgPlacement",
    popularity: "popularity"
  };
  const metric = (value?.query?.metrics ?? []).map((entry) => metricMap[entry]).find(Boolean) ?? "top4Rate";
  const comps = (value?.results ?? []).map((result) => ({
    compId: result.compositionRef?.compId ?? null,
    name: result.compositionRef?.name ?? result.compositionRef?.compId ?? "-",
    patch: result.compositionRef?.patch ?? value?.query?.patch ?? "current",
    lowSample: Boolean(result.lowSample),
    units: (result.members ?? []).map((member) => ({
      apiName: member.apiName,
      name: member.name ?? member.apiName,
      iconUrl: member.iconUrl ?? null,
      fallbackIconUrl: member.fallbackIconUrl ?? null,
      targetStarLevel: member.targetStarLevel ?? null,
      avgStarLevel: member.avgStarLevel ?? null,
      core: Boolean(member.core || member.relations?.includes?.("itemized_core_candidate")),
      items: member.itemizationEvidence?.displayItems
        ?? (member.itemizationEvidence?.items ?? []).map((apiName) => ({ apiName, name: apiName }))
    })),
    traits: result.traits ?? [],
    stats: result.stats ?? {},
    source: result.source ?? value.source ?? null
  }));
  return {
    ...value,
    ok: true,
    type: "comp_rankings",
    rankings: { [metric]: comps },
    references: [],
    query: value.query ?? {},
    source: value.source ?? comps[0]?.source ?? null
  };
}

function normalizeReactOfficialDetail(value) {
  const facts = value?.facts ?? {};
  const source = value?.source ?? null;
  if (value?.type === "item_details") {
    return {
      ...value,
      item: {
        apiName: value.apiName,
        name: value.displayName ?? value.entityRef?.displayName ?? value.apiName,
        category: facts.category ?? null,
        effect: facts.effect ?? facts.description ?? null,
        recipe: facts.composition ?? [],
        stats: facts.stats ?? null,
        source
      }
    };
  }
  if (value?.type === "unit_details") {
    const stats = facts.stats ?? {};
    return {
      ...value,
      unit: {
        apiName: value.apiName,
        name: value.displayName ?? value.entityRef?.displayName ?? value.apiName,
        cost: facts.cost ?? null,
        role: facts.role ?? null,
        traitNames: facts.traits ?? [],
        stats: {
          ...stats,
          mana: facts.mana ?? stats.mana ?? null,
          attackRange: facts.range ?? stats.attackRange ?? null
        },
        ability: facts.ability ?? {},
        source
      },
      recommendedItems: value.recommendedItems ?? []
    };
  }
  if (value?.type === "trait_details") {
    return {
      ...value,
      trait: {
        apiName: value.apiName,
        name: value.displayName ?? value.entityRef?.displayName ?? value.apiName,
        description: facts.description ?? null,
        levels: facts.effects ?? [],
        members: facts.members ?? [],
        source
      }
    };
  }
  return value;
}

function normalizeEndpointPayload(payload) {
  if (payload?.type !== "react_chat_result") return payload;
  const clarification = payload.status === "clarification_required"
    ? {
      needsClarification: true,
      blocking: true,
      question: String(payload.clarification?.question ?? payload.question ?? t("clarification")),
      suggestions: Array.isArray(payload.clarification?.suggestions)
        ? payload.clarification.suggestions
        : [],
      entityCandidates: payload.clarification?.entityCandidates ?? [],
      ...(payload.clarification ?? {})
    }
    : payload.clarification;
  const answerText = conclusionDisplayText(typeof payload.answer === "string"
    ? payload.answer
    : String(payload.question ?? payload.error ?? payload.partialFailure?.message ?? t("noResult")));
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const nativeResultTypes = new Set([
    "composition_rankings",
    "comp_rankings",
    "comp_trends",
    "comp_analysis",
    "entity_catalog_results",
    "unit_build_rankings",
    "unit_build_completion",
    "unit_best_3_items",
    "unit_item_rankings",
    "unit_emblem_rankings",
    "unit_item_comparison",
    "unit_builds_batch_results",
    "item_carrier_rankings",
    "unit_details",
    "item_details",
    "trait_details",
    "composition_change_evaluation",
    "composition_replacement_evaluation",
    "trait_external_unit_statistics",
    "composition_tactical_details",
    "strategy_video_search_results"
  ]);
  const evidenceValues = [...evidence].reverse().map((entry) => entry?.value);
  const primaryTypeOrder = [
    "composition_change_evaluation", "composition_replacement_evaluation",
    "item_carrier_rankings", "unit_item_comparison", "unit_item_rankings", "unit_emblem_rankings",
    "unit_build_completion", "unit_build_rankings", "unit_best_3_items", "unit_builds_batch_results",
    "composition_tactical_details", "comp_analysis", "comp_trends", "comp_rankings", "composition_rankings",
    "trait_external_unit_statistics", "strategy_video_search_results",
    "unit_details", "item_details", "trait_details", "entity_catalog_results"
  ];
  const primaryValue = primaryTypeOrder
    .map((type) => evidenceValues.find((value) => value?.type === type))
    .find(Boolean)
    ?? evidenceValues.find((value) => value && typeof value === "object" && value.type)
    ?? null;
  const officialDetailValue = primaryValue?.schemaVersion === "official-entity-detail.v1"
    ? normalizeReactOfficialDetail(primaryValue)
    : primaryValue;
  const displayValue = officialDetailValue?.type === "composition_rankings"
    ? normalizeReactCompositionRankings(officialDetailValue)
    : officialDetailValue;
  const comparisonDetails = displayValue?.type === "unit_item_comparison"
    ? new Map(evidenceValues
      .filter((value) => value?.type === "item_details")
      .map((value) => [String(value.apiName ?? ""), normalizeReactOfficialDetail(value)?.item]))
    : null;
  const hydratedDisplayValue = comparisonDetails?.size
    ? {
      ...displayValue,
      comparison: {
        ...(displayValue.comparison ?? {}),
        entries: (displayValue.comparison?.entries ?? []).map((entry) => ({
          ...entry,
          detail: entry.detail ?? comparisonDetails.get(String(entry.apiName ?? "")) ?? null
        })),
        rankedEntries: (displayValue.comparison?.rankedEntries ?? []).map((entry) => ({
          ...entry,
          detail: entry.detail ?? comparisonDetails.get(String(entry.apiName ?? "")) ?? null
        }))
      }
    }
    : displayValue;
  const carrierItemApiName = displayValue?.type === "item_carrier_rankings"
    ? String(displayValue.item?.apiName ?? displayValue.item ?? displayValue.query?.item ?? "")
    : "";
  const itemDetail = carrierItemApiName
    ? evidenceValues.find((value) => (
      value?.type === "item_details"
      && String(value.apiName ?? "") === carrierItemApiName
    )) ?? null
    : null;
  const semanticHits = evidence
    .filter((entry) => entry?.toolName === "semantic_search")
    .flatMap((entry) => entry?.value?.hits ?? []);
  return {
    ...(hydratedDisplayValue ?? {}),
    ...payload,
    ...(clarification ? { clarification } : {}),
    ...(nativeResultTypes.has(primaryValue?.type) && displayValue?.status
      ? { status: displayValue.status, runStatus: payload.status }
      : {}),
    type: nativeResultTypes.has(primaryValue?.type) ? hydratedDisplayValue.type : payload.type,
    reactAnswer: answerText,
    text: answerText,
    assistantResponse: { text: answerText },
    answer: {
      ...(displayValue?.answer && typeof displayValue.answer === "object" ? displayValue.answer : {}),
      summary: answerText
    },
    ...(itemDetail ? { itemDetail } : {}),
    ...(semanticHits.length ? {
      knowledgeEvidence: semanticHits.map((hit) => ({
        evidenceId: hit.evidenceId,
        claim: hit.claim,
        claimType: hit.claimType,
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
        sourceTitle: hit.title,
        sourceUrl: hit.sourceUrl,
        author: hit.author,
        publishedAt: hit.publishedAt,
        patch: hit.patch,
        locale: hit.locale,
        score: hit.score
      }))
    } : {}),
    agent: {
      status: payload.status ?? null,
      route: { selectedPath: "react_chat", route: "react_chat" },
      executionPlan: null,
      executionTrace: payload.observations ?? null,
      shadowComparison: null,
      failureStage: null,
      metrics: payload.usage ?? null
    }
  };
}

function reactChatMessages() {
  return state.responseRecords.slice(-8).flatMap((record) => {
    const assistant = record.data?.assistantResponse?.text
      ?? record.data?.answer?.summary
      ?? record.data?.text
      ?? record.data?.reactAnswer;
    return [
      { role: "user", content: String(record.displayInput ?? record.input ?? "").slice(0, 8000) },
      { role: "assistant", content: String(assistant ?? "").slice(0, 8000) }
    ].filter((message) => message.content);
  }).slice(-20);
}

function setRequestRunning(running) {
  state.requestInFlight = running;
  stopButton.classList.toggle("hidden", !running);
  refreshButton.disabled = running || !state.lastInput;
  resultRefreshButton.disabled = running || !state.lastInput;
  form.querySelector("button[type=submit]").disabled = running;
  for (const button of resultEl.querySelectorAll("[data-quick-task]")) button.disabled = running;
  for (const button of resultContentEl.querySelectorAll("[data-return-comp]")) button.disabled = running;
  for (const button of resultContentEl.querySelectorAll("[data-return-catalog], [data-entity-detail]")) button.disabled = running;
}

async function requestRecommendation(refresh = false, displayInput = null, requestOptions = {}) {
  const normalizedRequestOptions = requestOptions?.schemaVersion === "quick-task.v1"
    ? { quickTask: requestOptions }
    : (requestOptions ?? {});
  const quickTask = normalizedRequestOptions.quickTask ?? null;
  const supplementalText = String(normalizedRequestOptions.supplementalText ?? "").trim().slice(0, 1200);
  const reuseLastInput = refresh || normalizedRequestOptions.reuseLastInput === true;
  const preserveResultPane = normalizedRequestOptions.preserveResultPane === true
    || Boolean(state.activeAnalysisContext && !state.lastQuickTask);
  if (state.seasonContext?.themePreview && !state.seasonContext.selectable) {
    setStatus(t("seasonPreviewQueryDisabled"), "stale");
    return;
  }
  const input = reuseLastInput ? state.lastInput : queryInput.value.trim();
  if (!input) {
    renderError("enterQuery", "enterQuery");
    return;
  }

  state.currentController?.abort();
  state.currentConclusionController?.abort();
  state.currentConclusionController = null;
  const requestId = ++state.requestSerial;
  state.progressIndex = 0;
  state.lastInput = input;
  state.lastDisplayInput = reuseLastInput ? state.lastDisplayInput ?? input : displayInput ?? input;
  state.lastQuickTask = reuseLastInput ? state.lastQuickTask : quickTask;
  state.lastSupplementalText = reuseLastInput ? state.lastSupplementalText : supplementalText;
  appendUserMessage(state.lastDisplayInput);
  const recommendationProgress = createRecommendationProgressState();
  activeRecommendationProgress = recommendationProgress;
  activeResponseEl = appendAssistantMessage(recommendationProgress);
  const assistantTarget = activeResponseEl;
  startRecommendationProgressClock(assistantTarget, recommendationProgress);
  if (!reuseLastInput) composer.clear();
  scrollConversation();
  setStatusKey(refresh ? "statusRefreshing" : "statusQuerying", "loading");
  const controller = new AbortController();
  state.currentController = controller;
  setRequestRunning(true);
  if (!preserveResultPane) renderLoadingResult();
  try {
    if (!state.runtimeStatus) await loadRuntimeStatus();
    const reactChatEnabled = Boolean(state.runtimeStatus?.routing?.reactChatEnabled);
    const endpoint = state.lastQuickTask || !reactChatEnabled
      ? "/api/recommend/stream"
      : "/api/react-chat/stream";
    const transportRequestId = state.lastQuickTask?.requestId
      ?? globalThis.crypto?.randomUUID?.()
      ?? `request-${Date.now()}-${requestId}`;
    const requestBody = {
      input,
      locale: getLocale(),
      requestId: transportRequestId,
      conversationId: state.conversationId,
      seasonContextId: state.seasonContextId,
      startNewTask: normalizedRequestOptions.startNewTask === true,
      refresh,
      deferConclusion: true,
      ...(state.lastQuickTask ? { quickTask: state.lastQuickTask } : {}),
      ...(state.lastQuickTask && state.lastSupplementalText
        ? { supplementalText: state.lastSupplementalText }
        : {}),
      ...(!state.lastQuickTask && reactChatEnabled ? { messages: reactChatMessages() } : {}),
      ...(!state.lastQuickTask && state.activeAnalysisContext
        ? { analysisContext: state.activeAnalysisContext }
        : {}),
      preferences: {
        minSamples: state.minSamples,
        itemPolicy: state.itemPolicy,
        sort: state.sort,
        days: state.days,
        structuredParserMode: state.structuredParserMode,
        conclusionMode: state.conclusionMode,
        rankFilter: state.rankFilter
      }
    };
    let response = null;
    let streamedPayload = null;
    for (let attempt = 0; attempt <= STREAM_TRANSPORT_MAX_RETRIES; attempt += 1) {
      try {
        response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            accept: "application/x-ndjson"
          },
          body: JSON.stringify({
            ...requestBody,
            transportRetry: {
              attempt,
              retryOfRequestId: attempt > 0 ? transportRequestId : null
            }
          })
        });
        streamedPayload = await readRecommendationStream(
          response,
          assistantTarget,
          recommendationProgress,
          requestId,
          controller.signal
        );
        break;
      } catch (error) {
        if (!shouldRetryStreamTransport({ error, attempt, signal: controller.signal })) throw error;
        applyRecommendationProgressState(recommendationProgress, {
          schemaVersion: "recommendation-progress.v1",
          phase: "transport.retrying",
          data: { attempt: attempt + 1 }
        });
        if (requestId === state.requestSerial) {
          renderRecommendationProgress(assistantTarget, recommendationProgress);
          setStatusKey("statusReconnecting", "loading");
        }
      }
    }
    const data = normalizeEndpointPayload(streamedPayload);
    if (requestId !== state.requestSerial) return;
    if (data.access) renderAccessStatus(data.access);
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("queryFailed"));
    completeRecommendationProgress(recommendationProgress, data);
    if (preserveResultPane) {
      setDeveloperOutput(data);
      if (activeResponseEl) {
        const answer = String(
          data.reactAnswer
          ?? data.text
          ?? data.assistantResponse?.text
          ?? (typeof data.answer === "string" ? data.answer : data.answer?.summary)
          ?? ""
        ).trim();
        activeResponseEl.innerHTML = answer
          ? `<div class="chat-conclusion">${conclusionRichTextHtml(answer)}</div>`
          : `<div>${t("queryFailed")}</div>`;
      }
    } else {
      renderResult(data);
    }
    if (!preserveResultPane && shouldStreamGeneratedConclusion(data)) {
      void streamGeneratedConclusion(data, requestId);
    }
    setStatusKey(
      data.cache?.query?.stale
        ? "statusStale"
        : data.cache?.query?.revalidating
          ? "statusCacheRefreshing"
          : data.cache?.query?.hit
            ? "statusCache"
            : "statusLive",
      data.cache?.query?.stale ? "stale" : "ready"
    );
  } catch (error) {
    if (requestId !== state.requestSerial) return;
    if (error.name === "AbortError") {
      renderStoppedResult();
      if (activeResponseEl) activeResponseEl.innerHTML = `<div>${t("stoppedBody")}</div>`;
      setStatusKey("statusStopped", "error");
    } else {
      renderError(error.message);
      setStatusKey("statusFailed", "error");
    }
  } finally {
    stopRecommendationProgressClock(recommendationProgress);
    if (requestId === state.requestSerial) {
      state.currentController = null;
      setRequestRunning(false);
      activeResponseEl = null;
      activeRecommendationProgress = null;
      scrollConversation();
    }
  }
}

async function requestCompUnitRecommendation(target) {
  if (state.requestInFlight) return;
  const compCard = target.closest(".comp-card");
  const signature = compCard?.dataset.compSignature?.trim();
  const unitApiName = target.dataset.unitApiName?.trim();
  if (!signature || !unitApiName) return;

  const requestedStarLevel = Number(target.dataset.unitStarLevel) === 3 ? 3 : 2;
  const unitName = target.dataset.unitName?.trim() || unitApiName;
  const compName = compCard.dataset.compName?.trim() || t("compRanking");
  const navigationSnapshot = captureCompNavigationSnapshot(compName);
  if (!navigationSnapshot) return;
  const input = `Comp: ${signature} ${requestedStarLevel}\u661f ${unitApiName}, \u4e09\u4ef6\u666e\u901a\u88c5\u5907, \u6837\u672c>=${COMP_UNIT_QUERY_MIN_SAMPLES}`;
  const displayInput = t("compUnitQueryDisplay", {
    star: requestedStarLevel,
    unit: unitName,
    comp: compName,
    samples: COMP_UNIT_QUERY_MIN_SAMPLES
  });
  state.resultNavigation.push(navigationSnapshot);
  queryInput.value = input;
  await requestRecommendation(false, displayInput);
}

async function requestEntityDetail(target) {
  if (state.requestInFlight) return;
  const entityType = target.dataset.entityType === "trait" ? "trait" : "unit";
  const apiName = target.dataset.entityId?.trim();
  if (!apiName) return;
  const catalogName = entityType === "unit" ? t("unitCatalog") : t("traitCatalog");
  const snapshot = captureEntityCatalogNavigationSnapshot(catalogName);
  if (!snapshot) return;
  state.resultNavigation.push(snapshot);
  setRequestRunning(true);
  setStatusKey("statusQuerying", "loading");
  renderLoadingResult(false);
  const controller = new AbortController();
  state.currentController = controller;
  let detailLoaded = false;

  try {
    const params = new URLSearchParams({
      type: entityType,
      id: apiName,
      seasonContextId: state.seasonContextId,
      locale: getLocale()
    });
    const response = await fetch(`/api/entity-details?${params.toString()}`, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("queryFailed"));
    state.lastResult = data;
    state.lastResultId = null;
    state.resultView = { type: "result", data };
    setDeveloperOutput(data);
    resultTitleEl.textContent = t("resultTitle");
    renderCurrentResult(data);
    detailLoaded = true;
    setStatusKey("statusLive", "ready");
    openMobileResult();
  } catch (error) {
    if (error.name === "AbortError") {
      restorePreviousCatalogResult();
      setStatusKey("statusStopped", "error");
    } else {
      renderError(error.message, false);
      setStatusKey("statusFailed", "error");
    }
  } finally {
    state.currentController = null;
    setRequestRunning(false);
    if (detailLoaded) resultRefreshButton.disabled = true;
  }
}

bindSegmented("#sample-control", "minSamples", Number);
bindSegmented("#policy-control", "itemPolicy");

sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  scheduleSavePreferences();
});

daysSelect.addEventListener("change", () => {
  state.days = Number(daysSelect.value);
  scheduleSavePreferences();
});


structuredParserModeSelect.addEventListener("change", () => {
  state.structuredParserMode = structuredParserModeSelect.value;
  scheduleSavePreferences();
});

conclusionModeSelect.addEventListener("change", () => {
  state.conclusionMode = conclusionModeSelect.value;
  scheduleSavePreferences();
});

rankControl.addEventListener("change", () => {
  const ranks = selectedRanks();
  if (ranks.length === 0) {
    applyPreferences({
      ...state,
      rankFilter: state.rankFilter
    });
    return;
  }
  state.rankFilter = ranks;
  scheduleSavePreferences();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await submitQuickTaskForm()) return;
  if (!state.activeAnalysisContext && await routeNaturalLanguageQuickTask(queryInput.value)) return;
  requestRecommendation(false);
});

window.addEventListener("tft:pool-analysis-context", (event) => {
  state.activeAnalysisContext = event.detail ?? null;
});

window.addEventListener("tft:request-pool-analysis", async (event) => {
  if (state.requestInFlight) return;
  const detail = event.detail ?? {};
  state.activeAnalysisContext = detail.context ?? state.activeAnalysisContext;
  const input = String(detail.input ?? "").trim();
  if (!input) return;
  queryInput.value = input;
  await requestRecommendation(false, input, { preserveResultPane: true });
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!state.requestInFlight) form.requestSubmit();
  }
});

stopButton.addEventListener("click", () => {
  state.currentController?.abort();
});

quickTaskFormClose.addEventListener("click", () => closeQuickTaskForm({ focus: true }));

const NATURAL_LANGUAGE_QUICK_TASK_RULES = [
  {
    id: "opgg-pro-teaching",
    patterns: [
      /\u804c\u4e1a\u9009\u624b.*(?:\u6559\u5b66|\u590d\u76d8|\u6253\u6cd5|\u600e\u4e48\u73a9)|(?:\u5b66\u4e60|\u770b\u770b|\u67e5\u770b).*\u804c\u4e1a\u9009\u624b|\u9ad8\u624b(?:\u6559\u5b66|\u590d\u76d8|\u6253\u6cd5)/iu,
      /pro\s*(?:player\s*)?(?:teaching|coaching|review)/iu
    ]
  },
  {
    id: "opgg-pro-trends",
    patterns: [
      /\u804c\u4e1a\u9635\u5bb9\u8d8b\u52bf|\u804c\u4e1a\u8d8b\u52bf|(?:\u804c\u4e1a|\u9009\u624b|\u804c\u4e1a\u6c60).*(?:\u9635\u5bb9|\u4e0a\u5206).*(?:\u8d8b\u52bf|\u7edf\u8ba1|\u6570\u636e)/iu,
      /pro\s*(?:comp|composition)\s*trends?/iu
    ]
  },
  {
    id: "patch-notes",
    patterns: [
      /\u66f4\u65b0\u516c\u544a|\u7248\u672c\u516c\u544a|\u8865\u4e01\u516c\u544a|(?:\u66f4\u65b0|\u7248\u672c|\u8865\u4e01).*(?:\u5185\u5bb9|\u8bf4\u660e|\u6539\u52a8|\u516c\u544a)/iu,
      /patch\s*notes?|release\s*notes?|what(?:'s| is)?\s*new/iu
    ]
  },
  {
    id: "opgg-personal-review",
    patterns: [
      /(?:\u5bf9\u5c40|\u6218\u5c40|\u6bd4\u8d5b).*(?:\u53ef\u89c6\u5316|\u68cb\u76d8|\u8be6\u60c5)|(?:\u53ef\u89c6\u5316|\u68cb\u76d8).*(?:\u5bf9\u5c40|\u6218\u5c40|\u6bd4\u8d5b)/iu,
      /(?:\u6211\u8981|\u6211\u60f3|\u5e2e\u6211|\u7ed9\u6211|\u8bf7|\u8fdb\u5165|\u6253\u5f00|\u67e5\u770b|\u5f00\u59cb|\u505a\u4e2a|\u505a\u4e00\u6b21)?(?:\u4e2a\u4eba|\u6211\u7684)?(?:\u6218\u7ee9|\u6218\u5c40|\u5bf9\u5c40|\u6e38\u620f)?\u590d\u76d8|\u590d\u76d8(?:\u4e00\u4e0b|\u6211\u7684\u6218\u7ee9|\u6211\u7684\u5bf9\u5c40)?/iu,
      /review\s*my\s*(?:matches|games)|match\s*review/iu
    ]
  }
];

function naturalLanguageQuickTaskId(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  return NATURAL_LANGUAGE_QUICK_TASK_RULES.find(
    (rule) => rule.patterns.some((pattern) => pattern.test(text))
  )?.id ?? null;
}

async function routeNaturalLanguageQuickTask(input) {
  const text = String(input ?? "").trim();
  const taskId = naturalLanguageQuickTaskId(text);
  if (!taskId) return false;
  appendUserMessage(text);
  state.lastInput = text;
  state.lastDisplayInput = text;
  queryInput.value = "";
  await launchQuickTask(taskId);
  scrollConversation();
  return true;
}

async function launchQuickTask(quickTaskTarget) {
  if (!quickTaskTarget || state.requestInFlight) return;
  const taskId = typeof quickTaskTarget === "string"
    ? quickTaskTarget
    : quickTaskTarget.dataset.quickTask;
  cancelOpggRequests();
  // Keep the selected category expanded while its result is open, so
  // returning to the conversation restores the same quick-entry context.
  const baseQuickTask = QUICK_TASKS.find((task) => task.id === taskId);
  const quickTask = quickTasksForSeason().find((task) => task.id === taskId) ?? baseQuickTask;
  if (!quickTask) return;
  if (quickTask.view) closeQuickTaskForm();
  if (quickTask.view === "patch-note") {
    state.currentConclusionController?.abort();
    state.currentConclusionController = null;
    renderPatchNote();
    openMobileResult();
    return;
  }
  if (quickTask.view === "opgg-pro-trends") {
    state.currentConclusionController?.abort();
    state.currentConclusionController = null;
    renderOpggTrends();
    openMobileResult();
    return;
  }
  if (quickTask.view === "opgg-personal-review") {
    state.currentConclusionController?.abort();
    state.currentConclusionController = null;
    renderOpggPersonal();
    openMobileResult();
    return;
  }
  if (quickTask.view === "opgg-pro-teaching") {
    state.currentConclusionController?.abort();
    state.currentConclusionController = null;
    renderOpggProTeaching();
    openMobileResult();
    return;
  }
  if (quickTask.formFields) {
    openQuickTaskForm(quickTask);
    return;
  }
  const quickQuery = quickTask.queryKey ? t(quickTask.queryKey) : quickTask.query;
  if (!quickQuery) return;
  queryInput.value = quickTask.query ?? quickQuery;
  await requestRecommendation(false, t(quickTask.promptKey), {
    startNewTask: true,
    quickTask: structuredQuickTask(quickTask)
  });
}

async function handleResultClick(event) {
  const returnCatalogButton = event.target.closest("[data-return-catalog]");
  if (returnCatalogButton) {
    restorePreviousCatalogResult();
    return;
  }
  const returnCompButton = event.target.closest("[data-return-comp]");
  if (returnCompButton) {
    restorePreviousCompResult();
    return;
  }
  const retryCompDetailButton = event.target.closest("button[data-retry-comp-detail]");
  if (retryCompDetailButton) {
    event.preventDefault();
    event.stopPropagation();
    const descriptor = state.compDetailDescriptors.get(retryCompDetailButton.dataset.compDetailKey);
    if (descriptor) void loadCompDetail(descriptor, { retry: true });
    return;
  }
  const compUnitTarget = event.target.closest("[data-comp-unit-query]");
  if (compUnitTarget) {
    event.preventDefault();
    event.stopPropagation();
    await requestCompUnitRecommendation(compUnitTarget);
    return;
  }
  const entityDetailTarget = event.target.closest("[data-entity-detail]");
  if (entityDetailTarget) {
    event.preventDefault();
    await requestEntityDetail(entityDetailTarget);
    return;
  }
  const compMetricButton = event.target.closest("button[data-comp-metric]");
  if (compMetricButton && state.lastResult?.type === "comp_rankings") {
    state.compRankingMetric = compMetricButton.dataset.compMetric;
    renderCompRankings(state.lastResult);
    return;
  }
  const itemRankingMixButton = event.target.closest("button[data-item-ranking-mix-toggle]");
  if (itemRankingMixButton && ["unit_item_rankings", "unit_emblem_rankings"].includes(state.lastResult?.type)) {
    await toggleItemRankingMode(state.lastResult, itemRankingMixButton.dataset.itemRankingMixToggle === "on");
    return;
  }
  const quickCategoryButton = event.target.closest("button[data-quick-category]");
  if (quickCategoryButton) {
    toggleQuickTaskCategory(quickCategoryButton);
    return;
  }
  const quickTaskButton = event.target.closest("button[data-quick-task]");
  if (quickTaskButton) {
    await launchQuickTask(quickTaskButton);
    return;
  }
  const viewResultButton = event.target.closest("[data-view-result]");
  if (viewResultButton) {
    const responseRecord = state.responsesById.get(viewResultButton.dataset.responseId);
    if (responseRecord) activateResponseResult(responseRecord);
    openMobileResult();
    return;
  }
  if (event.target.closest("[data-retry-result]")) {
    if (state.lastInput && !state.requestInFlight) {
      requestRecommendation(false, null, { reuseLastInput: true });
    }
    return;
  }
  if (event.target.closest("[data-refresh-result]")) {
    if (state.lastInput && !state.requestInFlight) requestRecommendation(true);
    return;
  }
  const reasonSubmit = event.target.closest("button[data-feedback-reason-submit]");
  if (reasonSubmit) {
    const target = reasonSubmit.dataset.feedbackReasonSubmit;
    const reasonGroup = reasonSubmit.closest("[data-feedback-reasons]");
    const group = reasonSubmit.closest(".result-feedback");
    const reason = reasonGroup?.querySelector("[data-feedback-reason]")?.value || null;
    const buttons = [...(group?.querySelectorAll(".feedback-button") ?? [])];
    const status = group?.querySelector(".feedback-status");
    buttons.forEach((button) => { button.disabled = true; });
    reasonSubmit.disabled = true;
    try {
      if (target === "explanation") {
        const responseRecord = state.responsesById.get(group?.dataset.explanationResponseId);
        await sendExplanationFeedback("bad", reason, responseRecord?.data ?? state.lastResult);
        state.explanationFeedback = "bad";
        group?.querySelector('[data-explanation-feedback="bad"]')?.classList.add("selected");
      } else {
        const cardIndex = Number(reasonGroup?.dataset.cardIndex);
        await sendResultFeedback("bad", cardIndex, reason);
        state.feedbackByCard[cardIndex] = "bad";
        group?.querySelector('[data-result-feedback="bad"]')?.classList.add("selected");
      }
      reasonGroup.hidden = true;
      if (status) status.textContent = t("recorded");
      setStatusKey("statusRecorded");
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      reasonSubmit.disabled = false;
      if (status) status.textContent = t("saveFailed");
      setStatus(error.message);
    }
    return;
  }
  const explanationButton = event.target.closest("button[data-explanation-feedback]");
  if (explanationButton) {
    const group = explanationButton.closest("[data-explanation-feedback-group]");
    const buttons = [...(group?.querySelectorAll("button[data-explanation-feedback]") ?? [])];
    const status = group?.querySelector(".feedback-status");
    if (explanationButton.dataset.explanationFeedback === "bad") {
      const reasonGroup = group?.querySelector('[data-feedback-reasons="explanation"]');
      if (reasonGroup) {
        reasonGroup.hidden = false;
        reasonGroup.querySelector("[data-feedback-reason]")?.focus();
        return;
      }
    }
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const sentiment = explanationButton.dataset.explanationFeedback;
      const responseRecord = state.responsesById.get(group?.dataset.explanationResponseId);
      await sendExplanationFeedback(sentiment, null, responseRecord?.data ?? state.lastResult);
      state.explanationFeedback = sentiment;
      explanationButton.classList.add("selected");
      if (status) status.textContent = t("recorded");
      setStatusKey("statusRecorded");
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      if (status) status.textContent = t("saveFailed");
      setStatus(error.message);
    }
    return;
  }
  const feedbackButton = event.target.closest("button[data-result-feedback]");
  if (feedbackButton) {
    const group = feedbackButton.closest("[data-feedback-card]");
    const buttons = [...(group?.querySelectorAll("button[data-result-feedback]") ?? [])];
    const status = group?.querySelector(".feedback-status");
    if (feedbackButton.dataset.resultFeedback === "bad") {
      const reasonGroup = group?.querySelector('[data-feedback-reasons="recommendation"]');
      if (reasonGroup) {
        reasonGroup.hidden = false;
        reasonGroup.querySelector("[data-feedback-reason]")?.focus();
        return;
      }
    }
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await sendResultFeedback(
        feedbackButton.dataset.resultFeedback,
        Number(feedbackButton.dataset.cardIndex)
      );
      state.feedbackByCard[Number(feedbackButton.dataset.cardIndex)] = feedbackButton.dataset.resultFeedback;
      feedbackButton.classList.add("selected");
      if (status) status.textContent = t("recorded");
      setStatusKey("statusRecorded");
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      if (status) status.textContent = t("saveFailed");
      setStatus(error.message);
    }
    return;
  }

  const candidateButton = event.target.closest("button[data-candidate-action]");
  if (candidateButton) {
    const responseRecord = state.responsesById.get(candidateButton.dataset.responseId);
    const candidates = responseRecord?.data?.clarification?.entityCandidates ?? state.lastEntityCandidates;
    const candidate = candidates[Number(candidateButton.dataset.candidateIndex)];
    if (!candidate) return;
    if (candidateButton.dataset.candidateAction === "query") {
      queryInput.value = candidateQueryText(candidate);
      queryInput.focus();
      await requestRecommendation(false);
      return;
    }
    if (candidateButton.dataset.candidateAction === "save") {
      candidateButton.disabled = true;
      try {
        await saveEntityCandidate(candidate);
      } catch (error) {
        setStatus(error.message);
      } finally {
        candidateButton.disabled = false;
      }
      return;
    }
  }

  const suggestionButton = event.target.closest("button[data-suggestion-index]");
  const agentActionButton = event.target.closest("button[data-agent-action-index]");
  const conditionButton = event.target.closest("button[data-condition-key]");
  if (conditionButton) {
    queryInput.value = t("editCondition", { value: conditionButton.textContent.split("·")[0].trim() });
    setMobileView("chat");
    queryInput.focus();
    return;
  }
  if (agentActionButton) {
    const responseRecord = state.responsesById.get(agentActionButton.dataset.responseId);
    const actions = responseRecord?.data?.agentSuggestedActions?.actions ?? [];
    const action = actions[Number(agentActionButton.dataset.agentActionIndex)];
    if (!action?.query) return;
    queryInput.value = action.query;
    setMobileView("chat");
    queryInput.focus();
    await requestRecommendation(false);
    return;
  }
  if (!suggestionButton) return;
  const responseRecord = state.responsesById.get(suggestionButton.dataset.responseId);
  const suggestions = responseRecord?.data?.clarification?.suggestions ?? state.lastSuggestions;
  const suggestion = suggestions[Number(suggestionButton.dataset.suggestionIndex)];
  if (!suggestion) return;
  queryInput.value = suggestion;
  setMobileView("chat");
  queryInput.focus();
  await requestRecommendation(false);
}

resultEl.addEventListener("click", handleResultClick);
resultContentEl.addEventListener("click", handleResultClick);
resultContentEl.addEventListener("input", (event) => {
  if (event.target.closest("[data-catalog-query]")) applyEntityCatalogFilters();
});
resultContentEl.addEventListener("change", (event) => {
  if (event.target.closest("[data-catalog-filter]")) applyEntityCatalogFilters();
});
resultContentEl.addEventListener("toggle", (event) => {
  const card = event.target;
  if (!card?.matches?.(".comp-card[open][data-comp-detail-key]")) return;
  void loadCompDetailForCard(card);
}, true);
mobileResultBackButton.addEventListener("click", returnToMobileChat);
window.addEventListener("popstate", (event) => {
  setMobileView(event.state?.tftclarityMobileView === "result" ? "result" : "chat");
});
mobileLayoutQuery.addEventListener?.("change", () => {
  setMobileView(state.mobileView, { replaceHistory: mobileLayoutQuery.matches });
});
for (const container of [resultEl, resultContentEl]) {
  container.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const compUnitTarget = event.target.closest("[data-comp-unit-query]");
    if (!compUnitTarget) return;
    event.preventDefault();
    event.stopPropagation();
    requestCompUnitRecommendation(compUnitTarget);
  });
}

refreshButton.addEventListener("click", () => {
  requestRecommendation(true);
});

resultRefreshButton.addEventListener("click", () => {
  requestRecommendation(true);
});

async function resetConversation({ previousSeasonContextId = state.seasonContextId, announce = true } = {}) {
  const previousConversationId = state.conversationId;
  state.requestSerial += 1;
  state.currentController?.abort();
  state.currentConclusionController?.abort();
  state.currentController = null;
  state.currentConclusionController = null;
  activeResponseEl = null;
  activeRecommendationProgress = null;
  state.conversationId = globalThis.crypto?.randomUUID?.() ?? `conversation-${Date.now()}`;
  state.lastInput = "";
  state.lastDisplayInput = "";
  state.lastQuickTask = null;
  state.lastResult = null;
  state.lastResultId = null;
  state.lastSuggestions = [];
  state.lastEntityCandidates = [];
  state.responseRecords.forEach(stopAssistantCoreStream);
  state.responseRecords = [];
  state.responsesById.clear();
  state.currentResponseId = null;
  state.resultNavigation = [];
  clearCompDetailState();
  state.feedbackByCard = {};
  state.explanationFeedback = null;
  rawOutputEl.textContent = "";
  closeQuickTaskForm();
  composer.clear();
  resultEl.innerHTML = welcomeConversationHtml();
  renderEmptyResult();
  setMobileView("chat", { replaceHistory: true });
  setRequestRunning(false);
  if (announce) setStatusKey("statusCleared");
  try {
    const response = await fetch("/api/session/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: previousConversationId,
        seasonContextId: previousSeasonContextId
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch {
    if (announce) setStatusKey("sessionClearFailed", "error");
    return false;
  }
}

clearButton.addEventListener("click", () => {
  void resetConversation();
});

seasonContextSelect.addEventListener("change", () => {
  const requested = state.seasonContexts.find((context) => context.id === seasonContextSelect.value);
  if ((!requested?.selectable && !requested?.themePreview) || requested.id === state.seasonContextId) {
    seasonContextSelect.value = state.seasonContextId ?? "";
    return;
  }
  void selectSeasonContext(requested.id);
});

seasonContextNoticeClose?.addEventListener("click", () => {
  dismissSeasonNotice();
});

openItemAuditButton.addEventListener("click", async () => {
  appShell.settings.setOpen(false);
  itemAuditPanel.classList.remove("hidden");
  try {
    await loadItemAudit();
  } catch (error) {
    itemAuditList.innerHTML = `<div class="audit-empty">${escapeHtml(error.message)}</div>`;
  }
});

itemAuditClose.addEventListener("click", () => {
  itemAuditPanel.classList.add("hidden");
});

for (const control of [itemAuditCategory, itemAuditStatus, itemAuditAvailability, itemAuditIssues]) {
  control.addEventListener("change", () => loadItemAudit().catch((error) => {
    itemAuditList.innerHTML = `<div class="audit-empty">${escapeHtml(error.message)}</div>`;
  }));
}

for (const input of [itemAuditQuery, itemAuditPatch, itemAuditSource]) input.addEventListener("input", () => {
  clearTimeout(itemAuditTimer);
  itemAuditTimer = setTimeout(() => loadItemAudit().catch((error) => {
    itemAuditList.innerHTML = `<div class="audit-empty">${escapeHtml(error.message)}</div>`;
  }), 180);
});

itemAuditReload.addEventListener("click", () => loadItemAudit({ refresh: true }).catch((error) => {
  itemAuditList.innerHTML = `<div class="audit-empty">${escapeHtml(error.message)}</div>`;
}));

itemAuditExportJson.addEventListener("click", () => exportItemAudit("json").catch((error) => setStatus(error.message)));
itemAuditExportCsv.addEventListener("click", () => exportItemAudit("csv").catch((error) => setStatus(error.message)));

reloadAliasesButton.addEventListener("click", () => {
  state.aliasOffset = 0;
  loadAliases();
});

clearEntityMemoryButton.addEventListener("click", async () => {
  if (!window.confirm(t("confirmClearCandidates"))) return;
  clearEntityMemoryButton.disabled = true;
  try {
    await clearEntityMemory();
  } catch (error) {
    setStatus(error.message);
  } finally {
    clearEntityMemoryButton.disabled = false;
  }
});

aliasStateFilter.addEventListener("change", () => {
  state.aliasState = aliasStateFilter.value;
  state.aliasOffset = 0;
  loadAliases();
});

aliasTypeFilter.addEventListener("change", () => {
  state.aliasType = aliasTypeFilter.value;
  state.aliasOffset = 0;
  loadAliases();
});

aliasQueryFilter.addEventListener("input", () => {
  state.aliasQuery = aliasQueryFilter.value;
  state.aliasOffset = 0;
  loadAliases();
});

aliasPrevButton.addEventListener("click", () => {
  state.aliasOffset = Math.max(0, state.aliasOffset - state.aliasLimit);
  loadAliases();
});

aliasNextButton.addEventListener("click", () => {
  if (!state.aliasHasMore) return;
  state.aliasOffset += state.aliasLimit;
  loadAliases();
});

exportAliasesButton.addEventListener("click", async () => {
  exportAliasesButton.disabled = true;
  try {
    await exportAliasDraft();
  } catch (error) {
    setStatus(error.message);
  } finally {
    exportAliasesButton.disabled = false;
  }
});

downloadAliasesButton.addEventListener("click", async () => {
  downloadAliasesButton.disabled = true;
  try {
    await downloadAliasDraft();
  } catch (error) {
    setStatus(error.message);
  } finally {
    downloadAliasesButton.disabled = false;
  }
});

aliasSelectAll.addEventListener("change", () => {
  for (const input of aliasList.querySelectorAll("input[data-alias-select]")) {
    input.checked = aliasSelectAll.checked;
  }
  updateAliasBatchState();
});

enableSelectedAliasesButton.addEventListener("click", async () => {
  try {
    await reviewSelectedAliases(true);
  } catch (error) {
    setStatus(error.message);
    await loadAliases();
  } finally {
    updateAliasBatchState();
  }
});

disableSelectedAliasesButton.addEventListener("click", async () => {
  try {
    await reviewSelectedAliases(false);
  } catch (error) {
    setStatus(error.message);
    await loadAliases();
  } finally {
    updateAliasBatchState();
  }
});

aliasList.addEventListener("change", (event) => {
  if (event.target.closest("input[data-alias-select]")) {
    updateAliasBatchState();
  }
});

aliasList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-alias-id]");
  if (!button) return;
  button.disabled = true;
  try {
    await reviewAlias(button.dataset.aliasId, button.dataset.aliasEnabled === "true");
  } catch (error) {
    setStatus(error.message);
    await loadAliases();
  } finally {
    button.disabled = false;
  }
});

clearCacheButton.addEventListener("click", async () => {
  if (!window.confirm(t("confirmClearHistory"))) return;
  try {
    const response = await fetch("/api/cache/clear", {
      method: "POST"
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("clearFailed"));
    clearCompDetailState();
    rawOutputEl.textContent = "";
    renderEmptyResult();
    setStatusKey("clearHistory");
  } catch (error) {
    setStatus(error.message);
  }
});

resetPreferencesButton.addEventListener("click", async () => {
  if (!window.confirm(t("confirmReset"))) return;
  try {
    const response = await fetch("/api/preferences", {
      method: "DELETE"
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("resetFailed"));
    applyPreferences(data.preferences);
    setStatusKey("resetDone");
  } catch (error) {
    setStatus(error.message);
  }
});

resultEl.innerHTML = welcomeConversationHtml("welcome");
setMobileView("chat", { replaceHistory: true });
setLocale(getLocale());
wallpaperController.refreshLocale();
setRequestRunning(false);
void loadSeasonContexts();
loadPreferences();
loadAccessStatus();
void loadRuntimeStatus();
