const state = {
  minSamples: 100,
  itemPolicy: "ordinary_only",
  sort: "top4_first",
  days: 3,
  defaultContextStrategy: "popular",
  structuredParserMode: "inherit",
  rankFilter: [],
  lastInput: "",
  lastResult: null,
  lastResultId: null,
  lastSuggestions: [],
  lastEntityCandidates: [],
  aliasLimit: 20,
  aliasOffset: 0,
  aliasHasMore: false,
  aliasQuery: "",
  aliasState: "",
  aliasType: ""
};

const form = document.querySelector("#query-form");
const queryInput = document.querySelector("#query-input");
const refreshButton = document.querySelector("#refresh-button");
const clearButton = document.querySelector("#clear-button");
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
const statusEl = document.querySelector("#status");
const rawOutputEl = document.querySelector("#raw-output");
const detailsEl = document.querySelector("#details");
const sortSelect = document.querySelector("#sort-select");
const daysSelect = document.querySelector("#days-select");
const contextStrategySelect = document.querySelector("#context-strategy-select");
const structuredParserModeSelect = document.querySelector("#structured-parser-mode-select");
const rankControl = document.querySelector("#rank-control");
const cacheStatusEl = document.querySelector("#cache-status");
const llmStatusEl = document.querySelector("#llm-status");
const runtimeDetailEl = document.querySelector("#runtime-detail");
let saveTimer = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  if (preferences.minSamples) state.minSamples = Number(preferences.minSamples);
  if (preferences.itemPolicy) state.itemPolicy = preferences.itemPolicy;
  if (preferences.sort) state.sort = preferences.sort;
  if (preferences.days) state.days = Number(preferences.days);
  if (preferences.defaultContextStrategy) state.defaultContextStrategy = preferences.defaultContextStrategy;
  if (preferences.structuredParserMode) state.structuredParserMode = preferences.structuredParserMode;
  if (Array.isArray(preferences.rankFilter)) state.rankFilter = preferences.rankFilter;

  setActiveButton(document.querySelector("#sample-control"), state.minSamples);
  setActiveButton(document.querySelector("#policy-control"), state.itemPolicy);
  sortSelect.value = state.sort;
  daysSelect.value = String(state.days);
  contextStrategySelect.value = state.defaultContextStrategy;
  structuredParserModeSelect.value = state.structuredParserMode;
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
          defaultContextStrategy: state.defaultContextStrategy,
          structuredParserMode: state.structuredParserMode,
          rankFilter: state.rankFilter
        }
      })
    });
  } catch {
    setStatus("偏好未保存");
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
    setStatus("就绪");
  }
}

function cacheStatusLabel(type) {
  return {
    json: "JSON",
    sqlite: "SQLite",
    memory: "内存"
  }[type] ?? String(type ?? "-");
}

function renderRuntimeStatus(runtime = {}) {
  const cache = runtime.cache ?? {};
  const parser = runtime.structuredParser ?? {};
  const requests = runtime.requests ?? {};
  cacheStatusEl.textContent = cacheStatusLabel(cache.type);
  llmStatusEl.textContent = parser.enabled
    ? `${parser.provider ?? "LLM"} / ${parser.mode ?? "auto"}`
    : "关闭";

  const detail = [];
  if (cache.persistent) detail.push(cache.pathConfigured ? "持久化" : "持久化未定");
  if (parser.enabled && parser.model) detail.push(parser.model);
  const explorerTimeoutMs = Number(requests.explorerTimeoutMs);
  if (requests.explorerTimeoutMs != null && Number.isFinite(explorerTimeoutMs) && explorerTimeoutMs > 0) {
    detail.push(`查询超时 ${explorerTimeoutMs / 1000}s`);
  }
  if (parser.enabled && parser.timeoutMs) detail.push(`${parser.timeoutMs}ms`);
  if (parser.enabled && parser.apiKeyConfigured) detail.push("已设密钥");
  runtimeDetailEl.textContent = detail.join(" / ") || "规则优先";
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
    runtimeDetailEl.textContent = "状态不可用";
  }
}

function selectedRanks() {
  return [...rankControl.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
}

function setSettingsOpen(open) {
  settingsPanel.classList.toggle("hidden", !open);
  if (open) {
    loadRuntimeStatus();
    loadAliases();
  }
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
  const label = item.name ?? item.apiName ?? "装备";
  return `<span class="item${item.locked ? " locked" : ""}${item.compared ? " compared" : ""}" title="${escapeHtml(label)}">
    ${assetThumb(item.iconUrl, label, "item-icon")}
    <span class="item-label">${escapeHtml(label)}</span>
  </span>`;
}

function assetThumb(iconUrl, label, className = "") {
  const text = String(label ?? "?").trim();
  const fallback = text.slice(0, 1) || "?";
  const image = iconUrl
    ? `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" onerror="this.hidden=true">`
    : "";
  return `<span class="asset-thumb ${escapeHtml(className)}" role="img" aria-label="${escapeHtml(text)}" title="${escapeHtml(text)}"><span>${escapeHtml(fallback)}</span>${image}</span>`;
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function rate(value) {
  return hasNumericValue(value) ? `${(Number(value) * 100).toFixed(1)}%` : "不可用";
}

function placement(value) {
  return hasNumericValue(value) ? Number(value).toFixed(2) : "不可用";
}

function compMetricLabel(key) {
  return {
    top4Rate: "前四率最高",
    winRate: "登顶率最高",
    avgPlacement: "平均名次最好",
    popularity: "最热门"
  }[key] ?? key;
}

function compPrimaryMetric(key, comp) {
  if (key === "winRate") return `登顶 ${rate(comp.stats?.winRate)}`;
  if (key === "avgPlacement") return `均名 ${placement(comp.stats?.avgPlacement)}`;
  if (key === "popularity") return `样本 ${Number(comp.stats?.games ?? 0).toLocaleString("zh-CN")}`;
  return `前四 ${rate(comp.stats?.top4Rate)}`;
}

function compTraitLabel(trait) {
  const tier = Number(trait?.tier);
  return Number.isInteger(tier) && tier > 0 ? `${trait.name} · ${tier}档` : trait?.name;
}

function compRankLabel(rankFilter = []) {
  return rankFilter.length ? rankFilter.join("/") : "全部段位";
}

function compUpdatedLabel(value) {
  if (!value) return "更新时间不可用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间不可用";
  return `更新 ${new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date)}`;
}

function renderCompUnit(unit, expanded = false) {
  const items = expanded && unit.items?.length
    ? `<span class="unit-items">${unit.items.map((item) => assetThumb(item.iconUrl, item.name ?? item.apiName, "tiny-item-icon")).join("")}</span>`
    : "";
  const averageStar = expanded && hasNumericValue(unit.avgStarLevel)
    ? `<small class="unit-star">均 ${Number(unit.avgStarLevel).toFixed(1)}★</small>`
    : "";
  return `<div class="comp-unit${unit.core ? " core" : ""}">
    ${assetThumb(unit.iconUrl, unit.name, "unit-icon")}
    ${expanded ? `<span class="unit-name">${escapeHtml(unit.name)}</span>${averageStar}${items}` : ""}
  </div>`;
}

function renderCompCard(comp, metricKey, index) {
  const mainTraits = (comp.traits ?? []).filter((trait) => !/UniqueTrait|SummonTrait/.test(trait.filterId ?? trait.apiName)).slice(0, 3);
  const coreUnits = (comp.units ?? []).filter((unit) => unit.core).slice(0, 4);
  const foldedUnits = coreUnits.length ? coreUnits : (comp.units ?? []).slice(0, 5);
  return `
    <details class="comp-card" ${index === 0 ? "open" : ""}>
      <summary>
        <div class="comp-summary-main">
          <strong>${escapeHtml(comp.name)}</strong>
          ${comp.lowSample ? '<span class="low-sample-label">低样本参考</span>' : ""}
          <div class="trait-row">${mainTraits.map((trait) => assetThumb(trait.iconUrl, compTraitLabel(trait), "trait-icon")).join("")}</div>
          <div class="unit-row">${foldedUnits.map((unit) => renderCompUnit(unit)).join("")}</div>
        </div>
        <div class="comp-summary-metric">
          <b>${escapeHtml(compPrimaryMetric(metricKey, comp))}</b>
          <span>${Number(comp.stats?.games ?? 0).toLocaleString("zh-CN")} 场</span>
        </div>
      </summary>
      <div class="comp-expanded">
        <div class="comp-stat-line">
          <span>前四 ${rate(comp.stats?.top4Rate)}</span>
          <span>登顶 ${rate(comp.stats?.winRate)}</span>
          <span>均名 ${placement(comp.stats?.avgPlacement)}</span>
        </div>
        <div class="full-unit-grid">${(comp.units ?? []).map((unit) => renderCompUnit(unit, true)).join("")}</div>
        <div class="full-trait-row">${(comp.traits ?? []).map((trait) => `<span>${assetThumb(trait.iconUrl, compTraitLabel(trait), "trait-icon")}<small>${escapeHtml(compTraitLabel(trait))}</small></span>`).join("")}</div>
        <div class="comp-source">来源：MetaTFT exact_units_traits2${comp.source?.clusterId ? ` / cluster ${escapeHtml(comp.source.clusterId)}` : ""} / ${escapeHtml(comp.source?.variantCount ?? 1)} 个形态 / ${escapeHtml(compUpdatedLabel(comp.source?.updatedAt))}</div>
      </div>
    </details>`;
}

function renderCompRankings(data) {
  const sections = Object.entries(data.rankings ?? {}).filter(([, comps]) => comps?.length);
  const references = data.references ?? [];
  const stale = data.cache?.query?.stale ? "过期缓存" : data.cache?.query?.hit ? "缓存" : "实时";
  if (!sections.length && !references.length) {
    resultEl.innerHTML = `
      <div class="empty-state">
        <div>没有可用的阵容数据</div>
        <small>近${escapeHtml(data.query?.days ?? 3)}天 · 样本>=${escapeHtml(data.query?.minSamples ?? 500)} · 段位 ${escapeHtml(compRankLabel(data.query?.rankFilter))}</small>
        <small>未找到符合本地完整性规则的对局样本 · ${escapeHtml(compUpdatedLabel(data.source?.updatedAt))}</small>
      </div>
      ${(data.warnings ?? []).map((warning) => `<div class="comp-warning">${escapeHtml(warning)}</div>`).join("")}
      <div class="comp-footnote">${escapeHtml(data.source?.risk ?? "外部数据仅供参考")}</div>`;
    return;
  }
  resultEl.innerHTML = `
    <div class="comp-overview">
      <strong>当前版本阵容榜</strong>
      <span>近${escapeHtml(data.query?.days ?? 3)}天 · 样本>=${escapeHtml(data.query?.minSamples ?? 500)} · ${escapeHtml(stale)}</span>
      <small title="${escapeHtml(compRankLabel(data.query?.rankFilter))}">段位 ${escapeHtml(compRankLabel(data.query?.rankFilter))} · ${escapeHtml(compUpdatedLabel(data.source?.updatedAt))}</small>
    </div>
    ${(data.warnings ?? []).map((warning) => `<div class="comp-warning">${escapeHtml(warning)}</div>`).join("")}
    ${sections.map(([key, comps]) => `<section class="ranking-section"><h2>${escapeHtml(compMetricLabel(key))}</h2>${comps.map((comp, index) => renderCompCard(comp, key, index)).join("")}</section>`).join("")}
    ${references.length ? `<section class="ranking-section low-sample-section"><h2>低样本参考（不进入排名）</h2>${references.map((comp, index) => renderCompCard(comp, "popularity", index)).join("")}</section>` : ""}
    <div class="comp-footnote">${escapeHtml(data.source?.risk ?? "外部数据仅供参考")}</div>`;
}

function newResultId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function feedbackActions(cardIndex) {
  return `
    <div class="result-feedback" data-feedback-card="${cardIndex}">
      <button type="button" class="feedback-button" data-result-feedback="good" data-card-index="${cardIndex}" aria-label="这条建议有帮助" title="有帮助">↑</button>
      <button type="button" class="feedback-button" data-result-feedback="bad" data-card-index="${cardIndex}" aria-label="这条建议不理想" title="不理想">↓</button>
      <span class="feedback-status" aria-live="polite"></span>
    </div>
  `;
}

function compactTraitName(name) {
  return String(name ?? "")
    .replace(/^TFT\d*_/, "")
    .replace(/_1$/, "");
}

function compactTraitList(names = []) {
  if (!names.length) return "未补羁绊";
  const compacted = names.map(compactTraitName);
  if (compacted.length <= 2) return compacted.join(" + ");
  return `${compacted.slice(0, 2).join(" + ")} +${compacted.length - 2}`;
}

function contextStrategyLabel(strategy) {
  return {
    popular: "样本优先",
    top4: "前四优先",
    score: "Score优先",
    avg: "均名优先"
  }[strategy] ?? null;
}

function defaultContextLine(summary) {
  if (!summary?.found) return null;
  const metrics = [];
  if (Number.isFinite(Number(summary.count))) metrics.push(`样本 ${Number(summary.count)}`);
  if (Number.isFinite(Number(summary.top4))) metrics.push(`前四 ${Number(summary.top4).toFixed(1)}%`);
  if (Number.isFinite(Number(summary.avg))) metrics.push(`均名 ${Number(summary.avg).toFixed(2)}`);
  const strategy = contextStrategyLabel(summary.strategy);
  const source = summary.sourceDescription ? "MetaTFT /comps" : summary.sourceEndpoint;
  const pieces = [
    `默认阵容：${summary.label ?? summary.clusterId ?? "主流阵容"}`,
    metrics.join(" / "),
    strategy,
    source
  ].filter(Boolean);
  return pieces.map(escapeHtml).join(" / ");
}

function defaultContextAlternativesLine(summary) {
  const alternatives = (summary?.alternatives ?? []).slice(0, 2);
  if (!alternatives.length) return null;
  const labels = alternatives
    .map((candidate) => candidate.label ?? candidate.clusterId)
    .filter(Boolean);
  if (!labels.length) return null;
  return ["备选阵容：", labels.join(" / ")].map(escapeHtml).join("");
}

function defaultContextCompBuildLine(summary) {
  const build = summary?.compBuilds?.[0];
  const itemNames = (build?.items ?? [])
    .map((item) => item.name)
    .filter(Boolean);
  if (!itemNames.length) return null;
  const metrics = [];
  if (Number.isFinite(Number(build.count))) metrics.push(`样本 ${Number(build.count)}`);
  if (Number.isFinite(Number(build.avg))) metrics.push(`均名 ${Number(build.avg).toFixed(2)}`);
  return [`阵容装备参考：${itemNames.join(" + ")}`, metrics.join(" / ")]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" / ");
}

function formatCacheUpdatedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function queryCacheLine(cache = {}) {
  if (!cache?.hit) return "实时";
  const label = cache.stale ? "过期缓存" : "缓存";
  const updatedAt = formatCacheUpdatedAt(cache.updatedAt);
  return updatedAt ? `${label} / 更新 ${updatedAt}` : label;
}

function entityTypeLabel(type) {
  return {
    unit: "英雄",
    item: "装备",
    trait: "羁绊"
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

function renderSuggestionButtons(suggestions = []) {
  if (!suggestions.length) return "";
  return `
    <div class="suggestions">
      ${suggestions.map((item, index) => `
        <button type="button" data-suggestion-index="${index}">${escapeHtml(item)}</button>
      `).join("")}
    </div>
  `;
}

function renderEntityCandidates(candidates = []) {
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
            <button type="button" data-candidate-action="query" data-candidate-index="${index}">查询</button>
            ${canSaveCandidateAlias(candidate) ? `<button type="button" data-candidate-action="save" data-candidate-index="${index}">存候选</button>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function summaryLines(data) {
  const query = data.query ?? {};
  const traits = compactTraitList(query.traitNames);
  const cache = queryCacheLine(data.cache?.query);
  const defaultSource = defaultContextLine(query.defaultContextSummary);
  const defaultAlternatives = defaultContextAlternativesLine(query.defaultContextSummary);
  const defaultCompBuild = defaultContextCompBuildLine(query.defaultContextSummary);
  const warnings = query.warnings?.length ? `提示：${query.warnings.length} 条` : null;
  const exclusions = query.excludedItemNames?.length
    ? `已排除：${query.excludedItemNames.join(" + ")}`
    : null;

  return [
    `<strong>${escapeHtml(query.starLevel?.join("/") ?? "-")}星${escapeHtml(query.unitName ?? "-")}</strong> / ${escapeHtml(traits)} / 样本>=${escapeHtml(query.minSamples ?? "-")}`,
    `${escapeHtml(cache)} / ${escapeHtml(data.meta?.durationMs ?? 0)}ms`,
    defaultSource,
    defaultCompBuild,
    defaultAlternatives,
    exclusions ? escapeHtml(exclusions) : null,
    warnings
  ].filter(Boolean).map((line) => `<div>${line}</div>`).join("");
}

function renderResult(data) {
  state.lastResult = data;
  state.lastResultId = newResultId();
  rawOutputEl.textContent = data.text ?? JSON.stringify(data, null, 2);

  if (data.type === "comp_rankings") {
    state.lastSuggestions = [];
    state.lastEntityCandidates = [];
    renderCompRankings(data);
    return;
  }

  if (data.clarification?.needsClarification) {
    state.lastSuggestions = data.clarification.suggestions ?? [];
    state.lastEntityCandidates = data.clarification.entityCandidates ?? [];
    resultEl.innerHTML = `
      <div class="clarification-state">
        <strong>${escapeHtml(data.clarification.question)}</strong>
        ${renderEntityCandidates(state.lastEntityCandidates)}
        ${renderSuggestionButtons(state.lastSuggestions)}
      </div>
    `;
    return;
  }

  state.lastSuggestions = [];
  state.lastEntityCandidates = [];

  if (!data.cards?.length) {
    resultEl.innerHTML = `
      <div class="empty-state">
        <div>${escapeHtml(data.text ?? "无结果")}</div>
        ${data.query ? `<div class="summary">${summaryLines(data)}</div>` : ""}
      </div>
    `;
    return;
  }

  resultEl.innerHTML = data.cards.map((card, index) => `
    <article class="result-card${card.winner ? " best" : ""}">
      <div class="card-head">
        <div class="card-title-group">
          ${assetThumb(data.unit?.iconUrl ?? data.query?.unitIconUrl, data.unit?.name ?? data.query?.unitName ?? data.query?.unit ?? "英雄", "equipment-unit-icon")}
          <div class="card-title">${escapeHtml(card.title)}</div>
        </div>
        ${card.lowSample ? '<div class="risk">低样本</div>' : ""}
      </div>
      <div class="items">${card.items.map(itemPill).join("")}</div>
      <div class="stats">
        ${metric("前四", `${card.stats.top4}%`)}
        ${metric("吃鸡", `${card.stats.win}%`)}
        ${metric("均名", card.stats.avg)}
        ${metric("样本", card.stats.games)}
      </div>
      ${feedbackActions(index)}
      ${index === 0 ? `<div class="summary">${summaryLines(data)}</div>` : ""}
    </article>
  `).join("");
}

function renderError(message) {
  state.lastResult = null;
  state.lastResultId = null;
  rawOutputEl.textContent = message;
  resultEl.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
}

function aliasMeta(alias) {
  const typeLabel = {
    unit: "英雄",
    item: "装备",
    trait: "羁绊"
  }[alias.entityType] ?? alias.entityType ?? "-";
  const stateLabel = alias.enabled ? "已启用" : "候选";
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
  if (!aliases.length) {
    aliasList.innerHTML = '<div class="alias-empty">无候选</div>';
    updateAliasBatchState();
    return;
  }

  aliasList.innerHTML = aliases.map((alias) => `
    <div class="alias-row">
      <input class="alias-select" type="checkbox" data-alias-select value="${escapeHtml(alias.id)}" aria-label="选择 ${escapeHtml(alias.alias)}">
      <div class="alias-main">
        <strong>${escapeHtml(alias.alias)}</strong>
        <span>${escapeHtml(alias.apiName)}</span>
        <small>${escapeHtml(aliasMeta(alias))}</small>
      </div>
      <button type="button" data-alias-id="${escapeHtml(alias.id)}" data-alias-enabled="${alias.enabled ? "false" : "true"}">
        ${alias.enabled ? "停用" : "启用"}
      </button>
    </div>
  `).join("");
  updateAliasBatchState();
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
    if (!response.ok || !data.ok) throw new Error(data.error ?? "别名加载失败");
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
  if (!response.ok || !data.ok) throw new Error(data.error ?? "别名更新失败");
  await loadAliases();
  setStatus(enabled ? "已启用" : "已停用");
}

async function reviewSelectedAliases(enabled) {
  const ids = selectedAliasIds();
  if (!ids.length) {
    setStatus("未选择别名");
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
  if (!response.ok || !data.ok) throw new Error(data.error ?? "批量更新失败");
  await loadAliases();
  setStatus(`${data.updated ?? ids.length} 条${enabled ? "已启用" : "已停用"}`);
}

async function clearEntityMemory() {
  const response = await fetch("/api/entity-memory/clear", {
    method: "POST"
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? "候选记忆清理失败");
  state.aliasOffset = 0;
  await loadAliases();
  const cleared = data.cleared ?? {};
  setStatus(`已清候选 ${cleared.candidateAliases ?? 0} 条 / 反馈 ${cleared.feedbackEvents ?? 0} 条`);
}

async function fetchAliasDraft() {
  const response = await fetch("/api/entity-aliases/export?limit=1000");
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? "导出失败");
  return data.draft;
}

async function exportAliasDraft() {
  const draft = await fetchAliasDraft();
  rawOutputEl.textContent = draft?.text ?? JSON.stringify(draft, null, 2);
  detailsEl.open = true;
  setStatus("已导出");
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
  setStatus("已下载");
}

async function saveEntityCandidate(candidate) {
  if (!canSaveCandidateAlias(candidate)) {
    setStatus("候选已在字典中");
    return;
  }

  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      feedbackType: "alias_candidate",
      payload: {
        input: state.lastInput,
        candidate
      },
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
  if (!response.ok || !data.ok) throw new Error(data.error ?? "候选保存失败");
  setStatus("已加入候选");
  if (!settingsPanel.classList.contains("hidden")) await loadAliases();
}

async function sendResultFeedback(sentiment, cardIndex) {
  const data = state.lastResult;
  const card = data?.cards?.[cardIndex];
  if (!card || !state.lastResultId) throw new Error("当前结果不可反馈");

  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      feedbackType: sentiment === "good" ? "good_recommendation" : "bad_recommendation",
      payload: {
        feedbackId: `${state.lastResultId}:${cardIndex}`,
        input: state.lastInput,
        cardIndex,
        query: {
          unit: data.query?.unit,
          starLevel: data.query?.starLevel,
          traitFilters: data.query?.traitFilters,
          itemPolicy: data.query?.itemPolicy,
          ownedItems: data.query?.ownedItems,
          excludedItems: data.query?.excludedItems,
          comparisonOptions: data.query?.comparison?.itemApiNames,
          minSamples: data.query?.minSamples,
          sort: data.query?.sort,
          patch: data.query?.patch,
          days: data.query?.days,
          rankFilter: data.query?.rankFilter
        },
        recommendation: {
          title: card.title,
          items: card.items.map((item) => item.apiName),
          top4: card.stats.top4,
          win: card.stats.win,
          avg: card.stats.avg,
          games: card.stats.games,
          lowSample: card.lowSample,
          winner: card.winner
        },
        cache: {
          hit: data.cache?.query?.hit,
          stale: data.cache?.query?.stale
        }
      }
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "反馈保存失败");
  return payload;
}

async function requestRecommendation(refresh = false) {
  const input = queryInput.value.trim();
  if (!input) {
    renderError("请输入查询内容");
    return;
  }

  state.lastInput = input;
  setStatus(refresh ? "刷新中" : "查询中");

  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        input,
        refresh,
        preferences: {
          minSamples: state.minSamples,
          itemPolicy: state.itemPolicy,
          sort: state.sort,
          days: state.days,
          defaultContextStrategy: state.defaultContextStrategy,
          structuredParserMode: state.structuredParserMode,
          rankFilter: state.rankFilter
        }
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "查询失败");
    renderResult(data);
    setStatus(data.cache?.query?.stale ? "过期缓存" : data.cache?.query?.hit ? "缓存" : "完成");
  } catch (error) {
    renderError(error.message);
    setStatus("失败");
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

contextStrategySelect.addEventListener("change", () => {
  state.defaultContextStrategy = contextStrategySelect.value;
  scheduleSavePreferences();
});

structuredParserModeSelect.addEventListener("change", () => {
  state.structuredParserMode = structuredParserModeSelect.value;
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

resultEl.addEventListener("click", async (event) => {
  const feedbackButton = event.target.closest("button[data-result-feedback]");
  if (feedbackButton) {
    const group = feedbackButton.closest("[data-feedback-card]");
    const buttons = [...(group?.querySelectorAll("button[data-result-feedback]") ?? [])];
    const status = group?.querySelector(".feedback-status");
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await sendResultFeedback(
        feedbackButton.dataset.resultFeedback,
        Number(feedbackButton.dataset.cardIndex)
      );
      feedbackButton.classList.add("selected");
      if (status) status.textContent = "已记录";
      setStatus("反馈已记录");
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      if (status) status.textContent = "保存失败";
      setStatus(error.message);
    }
    return;
  }

  const candidateButton = event.target.closest("button[data-candidate-action]");
  if (candidateButton) {
    const candidate = state.lastEntityCandidates[Number(candidateButton.dataset.candidateIndex)];
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
  if (!suggestionButton) return;
  const suggestion = state.lastSuggestions[Number(suggestionButton.dataset.suggestionIndex)];
  if (!suggestion) return;
  queryInput.value = suggestion;
  queryInput.focus();
});

refreshButton.addEventListener("click", () => {
  requestRecommendation(true);
});

clearButton.addEventListener("click", async () => {
  await fetch("/api/session/clear", {
    method: "POST"
  });
  rawOutputEl.textContent = "";
  resultEl.innerHTML = '<div class="empty-state">待查询</div>';
  setStatus("已清空");
});

settingsButton.addEventListener("click", () => {
  setSettingsOpen(settingsPanel.classList.contains("hidden"));
});

settingsClose.addEventListener("click", () => {
  setSettingsOpen(false);
});

settingsDone.addEventListener("click", () => {
  setSettingsOpen(false);
});

reloadAliasesButton.addEventListener("click", () => {
  state.aliasOffset = 0;
  loadAliases();
});

clearEntityMemoryButton.addEventListener("click", async () => {
  if (!window.confirm("清空未启用候选别名和反馈记录？已启用别名会保留。")) return;
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
  try {
    const response = await fetch("/api/cache/clear", {
      method: "POST"
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "清理失败");
    rawOutputEl.textContent = "";
    resultEl.innerHTML = '<div class="empty-state">等待查询</div>';
    setStatus("已清历史");
  } catch (error) {
    setStatus(error.message);
  }
});

resetPreferencesButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/preferences", {
      method: "DELETE"
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "重置失败");
    applyPreferences(data.preferences);
    setStatus("已重置");
  } catch (error) {
    setStatus(error.message);
  }
});

loadPreferences();
