import { AppShell, TitleBar } from "./app-shell.js";
import { Composer, ConversationPane } from "./conversation-pane.js";
import { CompRankingResult, ItemRankingResult, RecommendationResult, ResultPane } from "./result-pane.js";
import { applyI18n, formatDate, formatNumber, getLocale, localizedName, setLocale, t } from "./i18n.js";
import { getCurrentPatchNote } from "./patch-notes.js";
import { WallpaperController } from "./wallpaper-controller.js";

const COMP_UNIT_QUERY_MIN_SAMPLES = 500;

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
  resultNavigation: [],
  feedbackByCard: {},
  explanationFeedback: null,
  mobileView: "chat",
  conclusionStreamText: ""
};

const shellEl = document.querySelector("#app-shell");
const form = document.querySelector("#query-form");
const queryInput = document.querySelector("#query-input");
const refreshButton = document.querySelector("#refresh-button");
const clearButton = document.querySelector("#clear-button");
const retryButton = document.querySelector("#retry-button");
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
  return data?.type === CompRankingResult.type || data?.type === "comp_trends";
}

function compCardNavigationKey(card) {
  return card?.dataset?.compSignature?.trim()
    || card?.dataset?.compName?.trim()
    || "";
}

function renderResultNavigation() {
  const snapshot = state.resultNavigation.at(-1);
  if (!snapshot) return "";
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

function restorePreviousCompResult() {
  if (state.requestInFlight) return;
  const snapshot = state.resultNavigation.pop();
  if (!snapshot) return;

  state.lastInput = snapshot.lastInput;
  state.lastDisplayInput = snapshot.lastDisplayInput;
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

const QUICK_TASKS = [
  {
    id: "comp-rankings",
    query: "\u63a8\u8350\u5f53\u524d\u7248\u672c\u70ed\u95e8\u9635\u5bb9",
    promptKey: "quickTaskCompsPrompt",
    titleKey: "quickTaskCompsTitle",
    bodyKey: "quickTaskCompsBody",
    icon: '<path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z"/>'
  },
  {
    id: "comp-trends",
    query: "\u5f53\u524d\u7248\u672c\u9635\u5bb9\u8d8b\u52bf",
    promptKey: "quickTaskTrendsPrompt",
    titleKey: "quickTaskTrendsTitle",
    bodyKey: "quickTaskTrendsBody",
    icon: '<path d="m4 17 5-5 4 3 7-8"/><path d="M15 7h5v5"/>'
  },
  {
    id: "unit-build",
    inputTemplateKey: "quickTaskBuildTemplate",
    selectionKey: "quickTaskBuildSelection",
    titleKey: "quickTaskBuildTitle",
    bodyKey: "quickTaskBuildBody",
    icon: '<path d="m6 18 8-8"/><path d="m12 6 6-2-2 6-8 8-4 2 2-4z"/>'
  },
  {
    id: "patch-notes",
    view: "patch-note",
    titleKey: "quickTaskUpdatesTitle",
    bodyKey: "quickTaskUpdatesBody",
    icon: '<path d="M6 5h12v14H6z"/><path d="M9 9h6M9 12h6M9 15h4"/>'
  }
];

function quickTasksHtml() {
  const cards = QUICK_TASKS.map((task) => {
    const isInteractive = task.query || task.view || task.inputTemplateKey;
    const action = isInteractive
      ? ` data-quick-task="${escapeHtml(task.id)}"`
      : " disabled";
    const trailing = task.badgeKey
      ? `<span class="quick-task-badge" data-i18n="${task.badgeKey}">${escapeHtml(t(task.badgeKey))}</span>`
      : '<span class="quick-task-arrow" aria-hidden="true">↗</span>';
    return `
      <button type="button" class="quick-task-card${isInteractive ? "" : " is-planned"}"${action}>
        <span class="quick-task-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${task.icon}</svg></span>
        <span class="quick-task-copy"><strong data-i18n="${task.titleKey}">${escapeHtml(t(task.titleKey))}</strong><small data-i18n="${task.bodyKey}">${escapeHtml(t(task.bodyKey))}</small></span>
        ${trailing}
      </button>
    `;
  }).join("");
  return `
    <section class="quick-tasks" data-i18n-aria="quickTasksLabel" aria-label="${escapeHtml(t("quickTasksLabel"))}">
      <div class="quick-tasks-heading">
        <strong data-i18n="quickTasksTitle">${escapeHtml(t("quickTasksTitle"))}</strong>
        <span data-i18n="quickTasksHint">${escapeHtml(t("quickTasksHint"))}</span>
      </div>
      <div class="quick-task-grid">${cards}</div>
    </section>
  `;
}

function welcomeConversationHtml(messageKey = "newConversation") {
  return `
    <article class="message assistant-message welcome-message">
      <div class="message-meta"><span class="assistant-avatar" aria-hidden="true">✦</span><strong data-i18n="assistant">${escapeHtml(t("assistant"))}</strong></div>
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
    .filter((apiName) => /^TFT[\w-]+$/i.test(apiName)))];
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

function renderCompCard(comp, metricKey, index) {
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
  return `
    <details class="comp-card" data-variant="${trendVariant}"
      data-comp-name="${escapeHtml(localizedName(comp))}"
      data-comp-signature="${escapeHtml(signature)}"
      ${index === 0 ? "open" : ""}>
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
  const metrics = ["avgPlacement", "top4Rate", "winRate"];
  return `<div class="comp-metric-switch" role="group" aria-label="${escapeHtml(t("rankingStandard"))}">
    ${metrics.map((metric) => `<button type="button" data-comp-metric="${metric}" class="${metric === activeMetric ? "active" : ""}" aria-pressed="${metric === activeMetric}">${escapeHtml(compMetricLabel(metric))}</button>`).join("")}
  </div>`;
}

function renderCompRankings(data) {
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
    const availableMetrics = ["avgPlacement", "top4Rate", "winRate"]
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
      ${(data.warnings ?? []).map((warning) => `<div class="comp-warning">${escapeHtml(warning)}</div>`).join("")}
      ${renderCompTrendNotice(data, [])}
      <div class="comp-footnote">${escapeHtml(data.source?.risk ?? t("externalRisk"))}</div>${sourceAndRisk(data)}`);
    return;
  }
  setResponseHtml(`
    <div class="comp-overview">
      <strong>${t(isTrendView ? "currentCompTrends" : "currentCompRanking")}</strong>
      <span>${t("daysRecent", { value: escapeHtml(data.query?.days ?? 3) })} · ${t("samplesAtLeast", { value: escapeHtml(data.query?.minSamples ?? 500) })} · ${escapeHtml(stale)}</span>
      <small title="${escapeHtml(compRankLabel(data.query?.rankFilter))}">${t("rank")} ${escapeHtml(compRankLabel(data.query?.rankFilter))} · ${escapeHtml(compUpdatedLabel(data.source?.updatedAt))}</small>
    </div>
    ${(data.warnings ?? []).map((warning) => `<div class="comp-warning">${escapeHtml(warning)}</div>`).join("")}
    ${isTrendView ? renderCompTrendNotice(data, [...rising, ...falling]) : ""}
    ${isPopularView ? `<div class="popular-ranking-toolbar"><span>${t("popularCompSample", { value: 21 })}</span>${metricSwitch}</div>` : ""}
    ${isTrendView && rising.length ? `<section class="ranking-section improving-section"><h2>${t("risingComps")}</h2><p class="trend-method">${t("risingFormula")}</p>${rising.map((comp, index) => renderCompCard(comp, "trend", index)).join("")}</section>` : ""}
    ${isTrendView && falling.length ? `<section class="ranking-section falling-section"><h2>${t("fallingComps")}</h2><p class="trend-method">${t("fallingFormula")}</p>${falling.map((comp, index) => renderCompCard(comp, "trendDown", index)).join("")}</section>` : ""}
    ${isTrendView && popularity.length ? `<section class="ranking-section popularity-section"><h2>${t("selectionRateTop")}</h2>${popularity.map((comp, index) => renderCompCard(comp, "popularity", index)).join("")}</section>` : ""}
    ${sections.map(([key, comps]) => `<section class="ranking-section"><h2>${escapeHtml(compMetricLabel(key))}</h2>${comps.map((comp, index) => renderCompCard(comp, key, index)).join("")}</section>`).join("")}
    ${references.length ? `<section class="ranking-section low-sample-section"><h2>${t("lowSampleSection")}</h2>${references.map((comp, index) => renderCompCard(comp, "popularity", index)).join("")}</section>` : ""}
    <div class="comp-footnote">${escapeHtml(data.source?.risk ?? t("externalRisk"))}</div>${sourceAndRisk(data)}`);
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
  const label = cache.stale ? t("staleCache") : t("localCache");
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

function renderUnitDetails(data) {
  const unit = data.unit ?? {};
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
            <span>${escapeHtml(t("recommendationScore"))} <b>${formatNumber(item.recommendationScore ?? 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</b></span>
          </div>
        </article>`).join("")}</div>`
    : `<div class="detail-muted">${escapeHtml(t("noStableItems"))}</div>`;
  const abilityDescription = escapeHtml(ability.description ?? "-").replace(/\n/g, "<br>");

  setResponseHtml(`
    <article class="result-card entity-detail-card">
      <header class="entity-detail-head">
        ${assetThumb(unit.iconUrl, unit.name, "entity-icon")}
        <div><div class="card-title">${escapeHtml(unit.name ?? t("unitDetails"))}</div><small>${unit.cost ? escapeHtml(t("unitCost", { value: unit.cost })) : ""}${unit.role ? ` · ${escapeHtml(unit.role)}` : ""}</small></div>
      </header>
      ${(unit.traitNames ?? []).length ? `<div class="entity-chips">${unit.traitNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : ""}
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
  const levels = trait.levels ?? [];
  setResponseHtml(`
    <article class="result-card entity-detail-card">
      <header class="entity-detail-head">
        ${assetThumb(trait.iconUrl, trait.name, "entity-icon")}
        <div><div class="card-title">${escapeHtml(trait.name ?? t("traitDetails"))}</div><small>${escapeHtml(trait.type === "race" ? t("traitRace") : trait.type === "job" ? t("traitJob") : "")}</small></div>
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
    "unit", "star_level", "rank_filter", "days", "comp", "item_policy", "item_categories",
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
  return `<section class="condition-panel"><h3>${t("conditions")}</h3>${conditionChips(data)}<div class="source-legend" aria-label="${t("conditionSources")}"><span><i></i>${t("sourceCurrent")}</span><span><i></i>${t("sourceConversation")}</span><span><i></i>${t("sourcePreference")}</span><span><i></i>${t("sourceDefault")}</span></div></section>`;
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

function generatedConclusionCard(data) {
  const conclusion = data?.answer?.generatedConclusion;
  if (!conclusion || conclusion.status === "disabled" || conclusion.status === "skipped") return "";
  if (conclusion.status === "pending") {
    return `<section class="generated-conclusion pending" data-conclusion-status="pending" data-conclusion-job="${escapeHtml(conclusion.jobId ?? "")}">
      <div class="conclusion-head"><strong>${t("dataInterpretation")}</strong><span class="streaming-badge">${t("generatedFromEvidence")}</span></div>
      <p class="conclusion-stream-text" data-conclusion-stream>${escapeHtml(state.conclusionStreamText || t("conclusionStreaming"))}</p>
    </section>`;
  }
  if (conclusion.status !== "generated" || !conclusion.content) {
    return `<section class="generated-conclusion fallback" data-conclusion-status="${escapeHtml(conclusion.status)}">
      <div class="conclusion-head"><strong>${t("dataInterpretation")}</strong><span>${t("templateFallback")}</span></div>
      <p>${escapeHtml(data.answer?.summary ?? data.text ?? t("noResult"))}</p>
    </section>`;
  }
  const content = conclusion.content;
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
  return `<section class="generated-conclusion" data-conclusion-status="generated">
    <div class="conclusion-head"><strong>${t("dataInterpretation")}</strong><span>${conclusion.cached ? t("cachedConclusion") : t("generatedFromEvidence")}</span></div>
    <h3>${escapeHtml(content.headline)}</h3>
    <p>${escapeHtml(content.summary)}</p>
    ${reasons ? `<ul>${reasons}</ul>` : ""}
    ${alternatives ? `<details><summary>${t("alternatives")}</summary><ul>${alternatives}</ul></details>` : ""}
    ${supportingEvidence ? `<details class="conclusion-supporting-evidence"><summary>${t("staticEvidence")}</summary><ul>${supportingEvidence}</ul></details>` : ""}
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
  const patch = getCurrentPatchNote(getLocale());
  if (track) state.resultView = { type: "patch-note" };
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
  setResponseHtml(`${resultHeader(t("error"), displayMessage, t("error"))}<div class="error-state"><div class="state-orbit" aria-hidden="true">!</div><strong>${escapeHtml(displayMessage)}</strong><div class="state-actions"><button type="button" data-retry-result>${t("retry")}</button><button type="button" data-refresh-result>${t("refresh")}</button></div></div>`);
}

function resultKind(data) {
  if (data?.type === CompRankingResult.type) return t("compRanking");
  if (data?.type === ItemRankingResult.type) return t("itemRanking");
  if (data?.clarification?.needsClarification) return t("clarification");
  return t("recommendation");
}

const EQUIPMENT_CORE_RESULT_TYPES = new Set([
  "unit_build_rankings",
  "unit_build_completion",
  "unit_best_3_items"
]);

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

function specialItemRankingConclusionText(data) {
  if (!isSpecialItemRanking(data)) return null;
  const categories = (data.query.itemCategories ?? [])
    .filter((category) => ["radiant", "artifact"].includes(category))
    .map((category) => t(category === "radiant" ? "radiantCategoryName" : "artifactCategoryName"));
  const rankings = data.itemRankings ?? [];
  if (!rankings.length) return t("chatSpecialRankingEmpty", { category: categories.join(" / ") });
  const displayedRankings = rankings.slice(0, 5);
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
  return equipmentCoreConclusionText(data) ?? specialItemRankingConclusionText(data);
}

function chatCoreScopeText(data) {
  return isSpecialItemRanking(data) ? t("chatSpecialRankingScope") : t("chatCoreScope");
}

function generatedConclusionText(conclusion) {
  const content = conclusion?.content;
  if (!content) return "";
  return [
    content.headline,
    content.summary,
    ...(content.reasons ?? []).map((reason) => reason?.text),
    ...(content.alternatives ?? []).map((alternative) => alternative?.text),
    content.nextAction,
    content.riskNotice
  ].filter(Boolean).join("\n\n");
}

function chatCoreConclusionHtml(data, responseId, options = {}) {
  const fullFixedText = chatCoreConclusionText(data);
  if (!fullFixedText) return "";
  const fixedText = Object.prototype.hasOwnProperty.call(options, "fixedCoreText") ? options.fixedCoreText : fullFixedText;
  const conclusion = data?.answer?.generatedConclusion;
  const interpretation = conclusion?.status === "pending"
    ? state.conclusionStreamText || t("conclusionStreaming")
    : conclusion?.status === "generated"
      ? generatedConclusionText(conclusion)
      : "";
  return `<section class="chat-core-conclusion" data-chat-core-conclusion="${escapeHtml(responseId)}">
    <header><strong>${t("chatCoreTitle")}</strong><small>${chatCoreScopeText(data)}</small></header>
    <p class="chat-core-fixed${options.streamingFixed ? " is-streaming" : ""}" data-chat-core-fixed>${escapeHtml(fixedText)}</p>
    ${interpretation ? `<div class="chat-core-interpretation${conclusion?.status === "pending" ? " pending" : ""}"><span>${t("chatFurtherInterpretation")}</span><p data-chat-conclusion-stream>${escapeHtml(interpretation)}</p></div>` : ""}
  </section>`;
}

function assistantResponseHtml(data, responseId = "", options = {}) {
  if (data?.clarification?.needsClarification) {
    return `<div class="answer-summary">${escapeHtml(data.clarification.question)}</div>${renderEntityCandidates(data.clarification.entityCandidates ?? [], responseId)}${renderSuggestionButtons(data.clarification.suggestions ?? [], responseId)}`;
  }
  const summary = data?.answer?.summary
    ?? data?.text
    ?? (data?.type === "comp_trends"
      ? t("currentCompTrends")
      : data?.type === CompRankingResult.type
        ? t("currentCompRanking")
        : t("noResult"));
  return `${chatCoreConclusionHtml(data, responseId, options)}<div class="answer-summary">${escapeHtml(summary)}</div>${data?.query?.constraints ? conditionChips(data) : ""}<button type="button" class="view-result" data-view-result data-response-id="${escapeHtml(responseId)}">${t("resultDetails")} →</button>`;
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
    displayInput: state.lastDisplayInput
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
  rawOutputEl.textContent = record.data.text ?? JSON.stringify(record.data, null, 2);
  resultTitleEl.textContent = t("resultTitle");
  renderCurrentResult(record.data);
  refreshButton.disabled = state.requestInFlight || !state.lastInput;
  resultRefreshButton.disabled = state.requestInFlight || !state.lastInput;
  return true;
}

function rerenderLocalizedState() {
  applyI18n();
  for (const record of state.responseRecords) {
    rerenderAssistantRecord(record);
  }
  if (state.requestInFlight && activeResponseEl?.isConnected) activeResponseEl.innerHTML = progressStepsHtml(state.progressIndex);
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
  const rankings = data.itemRankings ?? [];
  if (!rankings.length) {
    setResponseHtml(`${resultHeader(t("itemRanking"), data.answer?.summary ?? data.text ?? t("noResult"), t("noResult"))}${conditionPanel(data)}${sourceAndRisk(data)}`);
    return;
  }
  setResponseHtml(`
    ${resultHeader(t("itemRanking"), data.answer?.summary ?? data.text, t("itemRanking"))}
    <div class="item-ranking-list">
      ${rankings.slice(0, 5).map((item, index) => `
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
          </div>
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

function recommendationCard(data, card, index) {
  const unitLabel = localizedName(data.unit, data.query?.unitName ?? data.query?.unit ?? t("hero"));
  const comparedItem = card.items?.find((item) => item.compared);
  const cardTitle = data.comparison
    ? `${card.winner ? t("best") : card.lowSample ? t("lowSample") : t("alternatives")} · ${localizedName(comparedItem, card.title)}`
    : card.winner
      ? data.query?.sort === "robust_first"
        ? t("applicabilityRecommendation")
        : t("bestRecommendation")
      : card.lowSample
        ? t("lowSample")
        : `${t("alternatives")} ${index}`;
  const difference = card.difference
    ? `<div class="difference-note">${t("relativeRecommendation")}：${card.difference.removed?.length ? `${t("replace")} ${escapeHtml(card.difference.removed.join(" + "))} → ${escapeHtml(card.difference.added.join(" + "))}` : t("sameItems")}；${t("top4Short")} ${card.difference.top4Delta >= 0 ? "+" : ""}${formatNumber(card.difference.top4Delta)}pp，${t("samples")} ${card.difference.gamesDelta >= 0 ? "+" : ""}${formatNumber(card.difference.gamesDelta)}</div>`
    : "";
  const rankingRationale = card.ranking?.method === "robust_applicability_v1"
    ? `<div class="ranking-rationale${card.winner ? " primary" : ""}">
      <strong>${t(card.winner ? "applicabilityRecommendation" : "applicabilityScore")}</strong>
      <span>${t("applicabilityScoreValue", { score: formatNumber(card.ranking.score, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
      <span>${t("sampleCoverageValue", { value: formatNumber(card.ranking.coverageScore, { maximumFractionDigits: 0 }) })}</span>
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

function renderCurrentResult(data) {
  if (data.type === "unit_details") renderUnitDetails(data);
  else if (data.type === "trait_details") renderTraitDetails(data);
  else if (data.type === "item_details") renderItemDetails(data);
  else if (data.type === "unit_item_comparison") renderItemComparison(data);
  else if (data.type === CompRankingResult.type || data.type === "comp_trends") renderCompRankings(data);
  else if (data.type === ItemRankingResult.type || data.type === "unit_emblem_rankings") renderItemRankings(data);
  else renderRecommendationResult(data);
}

function renderResult(data) {
  if (isCompResult(data) && state.resultNavigation.length) {
    state.resultNavigation = [];
  }
  state.lastResult = data;
  state.compRankingMetric = null;
  state.lastResultId = data.queryId ?? null;
  state.feedbackByCard = {};
  state.explanationFeedback = null;
  state.conclusionStreamText = "";
  rawOutputEl.textContent = data.text ?? JSON.stringify(data, null, 2);
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
    rawOutputEl.textContent = JSON.stringify(data, null, 2);
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

function renderError(message, messageKey = null) {
  state.lastResult = null;
  state.lastResultId = null;
  const displayMessage = messageKey ? t(messageKey) : message;
  rawOutputEl.textContent = displayMessage;
  renderErrorResult(message, true, messageKey);
  if (activeResponseEl) activeResponseEl.innerHTML = `<div class="error-state">${escapeHtml(displayMessage)}</div>`;
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

async function sendExplanationFeedback(sentiment, reason = null) {
  const conclusion = state.lastResult?.answer?.generatedConclusion;
  if (!conclusion?.content || !state.lastResultId) throw new Error(t("feedbackUnavailable"));
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queryId: state.lastResultId,
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

function appendAssistantMessage() {
  const time = new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return conversationPane.appendAssistant(progressStepsHtml(state.progressIndex), `<strong>${t("assistant")}</strong><time>${escapeHtml(time)}</time>`);
}

function updateProgress(target, index) {
  if (target === activeResponseEl) state.progressIndex = index;
  const steps = target?.querySelectorAll?.(".progress-step") ?? [];
  steps.forEach((step, stepIndex) => step.classList.toggle("active", stepIndex === index));
}

function setRequestRunning(running) {
  state.requestInFlight = running;
  stopButton.classList.toggle("hidden", !running);
  retryButton.disabled = running || !state.lastInput;
  refreshButton.disabled = running || !state.lastInput;
  resultRefreshButton.disabled = running || !state.lastInput;
  form.querySelector("button[type=submit]").disabled = running;
  for (const button of resultEl.querySelectorAll("[data-quick-task]")) button.disabled = running;
  for (const button of resultContentEl.querySelectorAll("[data-return-comp]")) button.disabled = running;
}

async function requestRecommendation(refresh = false, displayInput = null) {
  const input = refresh ? state.lastInput : queryInput.value.trim();
  if (!input) {
    renderError("enterQuery", "enterQuery");
    return;
  }
  if (!refresh) {
    const championPlaceholder = t("quickTaskBuildSelection");
    const selectionStart = queryInput.value.indexOf(championPlaceholder);
    if (selectionStart >= 0) {
      queryInput.setCustomValidity(t("enterChampion"));
      queryInput.focus();
      queryInput.setSelectionRange(selectionStart, selectionStart + championPlaceholder.length);
      queryInput.reportValidity();
      return;
    }
    queryInput.setCustomValidity("");
  }

  state.currentController?.abort();
  state.currentConclusionController?.abort();
  state.currentConclusionController = null;
  const requestId = ++state.requestSerial;
  state.progressIndex = 0;
  state.lastInput = input;
  state.lastDisplayInput = refresh ? state.lastDisplayInput ?? input : displayInput ?? input;
  appendUserMessage(state.lastDisplayInput);
  activeResponseEl = appendAssistantMessage();
  const assistantTarget = activeResponseEl;
  if (!refresh) composer.clear();
  scrollConversation();
  setStatusKey(refresh ? "statusRefreshing" : "statusQuerying", "loading");
  const controller = new AbortController();
  state.currentController = controller;
  setRequestRunning(true);
  renderLoadingResult();
  const progressTimers = [
    setTimeout(() => updateProgress(assistantTarget, 1), 280),
    setTimeout(() => updateProgress(assistantTarget, 2), 720)
  ];

  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        input,
        conversationId: state.conversationId,
        refresh,
        deferConclusion: true,
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
    const data = await response.json();
    if (requestId !== state.requestSerial) return;
    if (!response.ok || !data.ok) throw new Error(data.error ?? t("queryFailed"));
    if (data.access) renderAccessStatus(data.access);
    renderResult(data);
    if (EQUIPMENT_CORE_RESULT_TYPES.has(data.type) || isSpecialItemRanking(data) || !mobileLayoutQuery.matches || state.mobileView === "result") {
      void streamGeneratedConclusion(data, requestId);
    }
    setStatusKey(data.cache?.query?.stale ? "statusStale" : data.cache?.query?.hit ? "statusCache" : "statusLive", data.cache?.query?.stale ? "stale" : "ready");
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
    progressTimers.forEach(clearTimeout);
    if (requestId === state.requestSerial) {
      state.currentController = null;
      setRequestRunning(false);
      activeResponseEl = null;
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  requestRecommendation(false);
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!state.requestInFlight) requestRecommendation(false);
  }
});

queryInput.addEventListener("input", () => {
  if (!queryInput.value.includes(t("quickTaskBuildSelection"))) queryInput.setCustomValidity("");
});

stopButton.addEventListener("click", () => {
  state.currentController?.abort();
});

retryButton.addEventListener("click", () => {
  if (!state.lastInput || state.requestInFlight) return;
  queryInput.value = state.lastInput;
  requestRecommendation(false);
});

async function handleResultClick(event) {
  const returnCompButton = event.target.closest("[data-return-comp]");
  if (returnCompButton) {
    restorePreviousCompResult();
    return;
  }
  const compUnitTarget = event.target.closest("[data-comp-unit-query]");
  if (compUnitTarget) {
    event.preventDefault();
    event.stopPropagation();
    await requestCompUnitRecommendation(compUnitTarget);
    return;
  }
  const compMetricButton = event.target.closest("button[data-comp-metric]");
  if (compMetricButton && state.lastResult?.type === "comp_rankings") {
    state.compRankingMetric = compMetricButton.dataset.compMetric;
    renderCompRankings(state.lastResult);
    return;
  }
  const quickTaskButton = event.target.closest("button[data-quick-task]");
  if (quickTaskButton) {
    if (state.requestInFlight) return;
    const quickTask = QUICK_TASKS.find((task) => task.id === quickTaskButton.dataset.quickTask);
    if (quickTask?.view === "patch-note") {
      state.currentConclusionController?.abort();
      state.currentConclusionController = null;
      renderPatchNote();
      openMobileResult();
      return;
    }
    if (quickTask?.inputTemplateKey) {
      const template = t(quickTask.inputTemplateKey);
      const selection = t(quickTask.selectionKey);
      const selectionStart = template.indexOf(selection);
      queryInput.value = template;
      queryInput.focus();
      if (selectionStart >= 0) {
        queryInput.setSelectionRange(selectionStart, selectionStart + selection.length);
      }
      queryInput.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (!quickTask?.query) return;
    queryInput.value = quickTask.query;
    await requestRecommendation(false, t(quickTask.promptKey));
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
    if (state.lastInput && !state.requestInFlight) requestRecommendation(false);
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
        await sendExplanationFeedback("bad", reason);
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
      await sendExplanationFeedback(sentiment);
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
  const conditionButton = event.target.closest("button[data-condition-key]");
  if (conditionButton) {
    queryInput.value = t("editCondition", { value: conditionButton.textContent.split("·")[0].trim() });
    queryInput.focus();
    return;
  }
  if (!suggestionButton) return;
  const responseRecord = state.responsesById.get(suggestionButton.dataset.responseId);
  const suggestions = responseRecord?.data?.clarification?.suggestions ?? state.lastSuggestions;
  const suggestion = suggestions[Number(suggestionButton.dataset.suggestionIndex)];
  if (!suggestion) return;
  queryInput.value = suggestion;
  queryInput.focus();
}

resultEl.addEventListener("click", handleResultClick);
resultContentEl.addEventListener("click", handleResultClick);
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

clearButton.addEventListener("click", async () => {
  const previousConversationId = state.conversationId;
  state.requestSerial += 1;
  state.currentController?.abort();
  state.currentConclusionController?.abort();
  state.currentController = null;
  state.currentConclusionController = null;
  activeResponseEl = null;
  state.conversationId = globalThis.crypto?.randomUUID?.() ?? `conversation-${Date.now()}`;
  state.lastInput = "";
  state.lastDisplayInput = "";
  state.lastResult = null;
  state.lastResultId = null;
  state.lastSuggestions = [];
  state.lastEntityCandidates = [];
  state.responseRecords.forEach(stopAssistantCoreStream);
  state.responseRecords = [];
  state.responsesById.clear();
  state.currentResponseId = null;
  state.resultNavigation = [];
  state.feedbackByCard = {};
  state.explanationFeedback = null;
  rawOutputEl.textContent = "";
  resultEl.innerHTML = welcomeConversationHtml();
  renderEmptyResult();
  setMobileView("chat", { replaceHistory: true });
  setRequestRunning(false);
  setStatusKey("statusCleared");
  try {
    const response = await fetch("/api/session/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: previousConversationId })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    setStatusKey("sessionClearFailed", "error");
  }
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

setMobileView("chat", { replaceHistory: true });
setLocale(getLocale());
wallpaperController.refreshLocale();
setRequestRunning(false);
loadPreferences();
loadAccessStatus();
