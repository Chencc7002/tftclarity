const RESULT_TYPE_LABELS = {
  comp_rankings: "热门阵容排行",
  emblem_rankings: "转职强度排行",
  emblem_carriers: "转职适配弈子",
  unit_build_rankings: "英雄出装推荐",
  unit_builds_batch_results: "多英雄出装对比",
  unit_performance: "装备提升表现",
  item_carriers: "装备适配弈子",
  item_carrier_rankings: "装备适配弈子",
  augment_rankings: "强化符文排行",
  react_chat: "AI 自由对话",
  react_chat_result: "AI 自由对话",
  react_chat_error: "AI 对话异常",
  coach_answer: "AI 运营攻略",
  comp_details: "阵容详情拆解",
  composition_tactical_details: "阵容站位与海克斯",
  unit_details: "英雄详情",
  item_details: "装备详情",
  trait_details: "羁绊详情",
  entity_catalog: "图鉴与目录查询",
  entity_catalog_results: "图鉴与目录查询",
  clarification: "意图澄清",
  other: "其他查询"
};

const STAGE_LABELS = {
  react_decision: "ReAct 决策推理",
  conclusion: "结论增强生成",
  structured_parser: "结构化意图解析",
  turn_delta: "多轮状态增量",
  planner: "执行规划"
};

const state = {
  days: 7,
  seasonContextId: "all",
  chartMode: "usage",
  dashboard: null,
  autoRefreshTimer: null,
  seasonsLoaded: false
};

const $ = (selector) => document.querySelector(selector);

function fmtInt(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  return Math.round(num).toLocaleString("zh-CN");
}

function fmtCompactTokens(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num === 0) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
  return Math.round(num).toLocaleString("zh-CN");
}

function fmtPct(rate) {
  const num = Number(rate ?? 0);
  if (!Number.isFinite(num)) return "0.0%";
  return `${(num * 100).toFixed(1)}%`;
}

function fmtCny(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num === 0) return "¥0.00";
  if (num < 0.01) return `¥${num.toFixed(4)}`;
  return `¥${num.toFixed(2)}`;
}

function fmtUsd(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num === 0) return "$0.00";
  if (num < 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}

function fmtMs(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "--";
  if (num >= 1000) return `${(num / 1000).toFixed(2)}s`;
  return `${Math.round(num)}ms`;
}

function fmtShortTime(iso) {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function notify(message) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.add("visible");
  window.setTimeout(() => notice.classList.remove("visible"), 2600);
}

function setError(message) {
  const banner = $("#error-banner");
  if (!message) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = message;
}

async function fetchDashboard() {
  const params = new URLSearchParams({
    days: String(state.days),
    seasonContextId: state.seasonContextId
  });
  const response = await fetch(`/api/admin/dashboard?${params.toString()}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload.dashboard;
}

function populateSeasonOptions(seasons = []) {
  if (state.seasonsLoaded || !Array.isArray(seasons) || !seasons.length) return;
  const select = $("#season-filter");
  const current = select.value || "all";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "全部赛季";
  const options = [allOption, ...seasons.map((season) => {
    const opt = document.createElement("option");
    opt.value = season.id;
    opt.textContent = season.label || season.id;
    return opt;
  })];
  select.replaceChildren(...options);
  select.value = current;
  state.seasonsLoaded = true;
}

function renderKpis(dashboard) {
  const { summary, tokens } = dashboard;
  $("#generated-at").textContent = `更新于 ${fmtShortTime(dashboard.window?.generatedAt)}`;

  $("#kpi-uv").textContent = fmtInt(summary.uniqueVisitors);
  $("#kpi-uv-sub").textContent = `今日活跃 ${fmtInt(summary.todayActiveVisitors)} · 会话 ${fmtInt(summary.uniqueConversations)}`;

  $("#kpi-queries").textContent = fmtInt(summary.totalQueries);
  $("#kpi-queries-sub").textContent = `今日 ${fmtInt(summary.todayQueries)} · 快捷 ${fmtInt(summary.quickQueries)} / AI ${fmtInt(summary.llmQueries)}`;

  $("#kpi-tokens").textContent = fmtCompactTokens(tokens.totalTokens);
  $("#kpi-tokens-sub").textContent = `今日 ${fmtCompactTokens(tokens.todayTotalTokens)} · 输入 ${fmtCompactTokens(tokens.totalInputTokens)} / 输出 ${fmtCompactTokens(tokens.outputTokens)}`;

  $("#kpi-cost").textContent = fmtCny(tokens.estimatedCostCny);
  $("#kpi-cost-sub").textContent = `今日 ${fmtCny(tokens.todayEstimatedCostCny)} · 约 ${fmtUsd(tokens.estimatedCostUsd)}`;

  $("#kpi-kv-hit").textContent = fmtPct(tokens.cacheHitRate);
  $("#kpi-kv-hit-sub").textContent = `已节省约 ${fmtCny(tokens.estimatedSavingsCny)}（${fmtCompactTokens(tokens.cachedInputTokens)} 命中）`;

  $("#kpi-perf").textContent = summary.totalQueries > 0 ? `P95 ${fmtMs(summary.p95DurationMs)}` : "--";
  $("#kpi-perf-sub").textContent = `均耗时 ${fmtMs(summary.avgDurationMs)} · 缓存 ${fmtPct(summary.cacheHitRate)} · 赞 ${fmtInt(summary.positiveFeedbacks)} / 踩 ${fmtInt(summary.negativeFeedbacks)}`;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

function renderTrendChart(dashboard) {
  const wrap = $("#daily-chart-wrap");
  const legend = $("#chart-legend");
  const detail = $("#chart-hover-detail");
  const series = dashboard.dailySeries ?? [];
  const isUsage = state.chartMode === "usage";

  legend.replaceChildren();
  const addLegend = (swatchClass, label) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = `legend-swatch ${swatchClass}`;
    item.append(swatch, document.createTextNode(label));
    legend.append(item);
  };
  if (isUsage) {
    addLegend("teal", "当日查询量（柱）");
    addLegend("amber", "当日独立用户 UV（折线）");
  } else {
    addLegend("violet", "当日 Token 消耗（柱）");
    addLegend("amber", "当日估算费用 CNY（折线）");
  }

  if (!series.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "所选时间窗口内暂无趋势数据";
    wrap.replaceChildren(empty);
    return;
  }

  const width = 920;
  const height = 220;
  const pad = { top: 18, right: 44, bottom: 30, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const barValues = series.map((d) => isUsage ? d.queries : d.totalTokens);
  const lineValues = series.map((d) => isUsage ? d.uniqueVisitors : d.estimatedCostCny);
  const maxBar = Math.max(1, ...barValues);
  const maxLine = Math.max(isUsage ? 1 : 0.01, ...lineValues);

  const svg = svgEl("svg", {
    class: "trend-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": isUsage ? "每日查询量与独立用户趋势图" : "每日 Token 消耗与费用趋势图"
  });

  const defs = svgEl("defs");
  const gradTeal = svgEl("linearGradient", { id: "barGradTeal", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradTeal.append(
    svgEl("stop", { offset: "0%", "stop-color": "#65d8cf", "stop-opacity": "0.95" }),
    svgEl("stop", { offset: "100%", "stop-color": "#1c6b6a", "stop-opacity": "0.65" })
  );
  const gradViolet = svgEl("linearGradient", { id: "barGradViolet", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradViolet.append(
    svgEl("stop", { offset: "0%", "stop-color": "#a898ff", "stop-opacity": "0.95" }),
    svgEl("stop", { offset: "100%", "stop-color": "#4b3da0", "stop-opacity": "0.65" })
  );
  defs.append(gradTeal, gradViolet);
  svg.append(defs);

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const y = pad.top + plotH * (1 - ratio);
    svg.append(svgEl("line", {
      class: "chart-grid-line",
      x1: pad.left,
      y1: y.toFixed(1),
      x2: width - pad.right,
      y2: y.toFixed(1)
    }));
    const labelVal = maxBar * ratio;
    const text = svgEl("text", {
      class: "chart-axis-text",
      x: pad.left - 8,
      y: (y + 4).toFixed(1),
      "text-anchor": "end"
    });
    text.textContent = isUsage ? fmtInt(labelVal) : fmtCompactTokens(labelVal);
    svg.append(text);
  }

  const slotW = plotW / series.length;
  const barW = Math.max(8, Math.min(36, slotW * 0.56));
  const labelStep = series.length > 14 ? Math.ceil(series.length / 10) : 1;
  const linePoints = [];

  const updateHoverDetail = (point) => {
    detail.textContent = `${point.date} · 查询 ${fmtInt(point.queries)} 次 · 独立用户 ${fmtInt(point.uniqueVisitors)} 人 · AI 调用 ${fmtInt(point.llmCalls)} 次 · Token ${fmtCompactTokens(point.totalTokens)}（缓存命中 ${fmtCompactTokens(point.cachedInputTokens)}）· 估算 ${fmtCny(point.estimatedCostCny)}`;
  };

  series.forEach((point, index) => {
    const cx = pad.left + slotW * index + slotW / 2;
    const barVal = barValues[index];
    const barH = Math.max(barVal > 0 ? 3 : 0, (barVal / maxBar) * plotH);
    const barY = pad.top + plotH - barH;

    const rect = svgEl("rect", {
      class: `chart-bar ${isUsage ? "chart-bar-primary" : "chart-bar-tokens"}`,
      x: (cx - barW / 2).toFixed(1),
      y: barY.toFixed(1),
      width: barW.toFixed(1),
      height: barH.toFixed(1),
      rx: 4
    });
    const title = svgEl("title");
    title.textContent = `${point.date}: 查询 ${point.queries} / UV ${point.uniqueVisitors} / Tokens ${fmtCompactTokens(point.totalTokens)} / ${fmtCny(point.estimatedCostCny)}`;
    rect.append(title);
    rect.addEventListener("mouseenter", () => updateHoverDetail(point));
    svg.append(rect);

    const lineVal = lineValues[index];
    const ly = pad.top + plotH - (lineVal / maxLine) * plotH;
    linePoints.push({ x: cx, y: ly, point });

    if (index % labelStep === 0 || index === series.length - 1) {
      const xLabel = svgEl("text", {
        class: "chart-axis-text",
        x: cx.toFixed(1),
        y: height - 8,
        "text-anchor": "middle"
      });
      xLabel.textContent = point.date.slice(5);
      svg.append(xLabel);
    }
  });

  if (linePoints.length > 1) {
    svg.append(svgEl("polyline", {
      class: "chart-line",
      points: linePoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    }));
  }

  for (const pt of linePoints) {
    const dot = svgEl("circle", {
      class: "chart-dot",
      cx: pt.x.toFixed(1),
      cy: pt.y.toFixed(1),
      r: 3.6
    });
    dot.addEventListener("mouseenter", () => updateHoverDetail(pt.point));
    svg.append(dot);
  }

  wrap.replaceChildren(svg);
  const latest = series[series.length - 1];
  if (latest) updateHoverDetail(latest);
}

function renderModelTable(dashboard) {
  const rows = dashboard.byModel ?? [];
  const tokens = dashboard.tokens ?? {};
  $("#llm-calls-badge").textContent = `${fmtInt(tokens.totalCalls)} 次调用 · 成功 ${fmtInt(tokens.okCalls)} / 错误 ${fmtInt(tokens.errorCalls)}`;

  const tbody = $("#model-rows");
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "empty-state";
    td.textContent = "暂无模型 Token 记录（发起 AI 对话或结论生成后将自动统计）";
    tr.append(td);
    tbody.replaceChildren(tr);
    return;
  }

  tbody.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    const cells = [
      { code: row.model },
      { text: fmtInt(row.calls), num: true },
      { text: `${fmtInt(row.retries)} / ${fmtInt(row.errors)}`, num: true },
      { text: fmtPct(row.cacheHitRate), num: true },
      { text: fmtCompactTokens(row.cachedInputTokens), num: true },
      { text: fmtCompactTokens(row.uncachedInputTokens), num: true },
      { text: fmtCompactTokens(row.outputTokens), num: true },
      { text: fmtMs(row.avgDurationMs), num: true },
      { text: `${fmtCny(row.estimatedCostCny)}`, num: true }
    ];
    for (const cell of cells) {
      const td = document.createElement("td");
      if (cell.num) td.className = "num";
      if (cell.code) {
        const code = document.createElement("code");
        code.textContent = cell.code;
        td.append(code);
      } else {
        td.textContent = cell.text;
      }
      tr.append(td);
    }
    return tr;
  }));
}

function renderProgressList(container, items, { emptyText, colorClass = "" }) {
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.replaceChildren(empty);
    return;
  }
  const maxVal = Math.max(1, ...items.map((item) => item.value));
  container.replaceChildren(...items.map((item) => {
    const row = document.createElement("div");
    row.className = "bar-row";

    const head = document.createElement("div");
    head.className = "bar-row-head";
    const label = document.createElement("span");
    label.textContent = item.label;
    const meta = document.createElement("span");
    meta.className = "bar-row-meta";
    meta.textContent = item.meta;
    head.append(label, meta);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = `bar-fill ${colorClass}`.trim();
    const widthPct = Math.max(item.value > 0 ? 3 : 0, Math.round((item.value / maxVal) * 100));
    fill.style.width = `${widthPct}%`;
    track.append(fill);

    row.append(head, track);
    return row;
  }));
}

function renderBreakdowns(dashboard) {
  const stageItems = (dashboard.byStage ?? []).map((row) => ({
    label: STAGE_LABELS[row.stage] ?? row.stage,
    value: row.totalTokens || row.calls,
    meta: `${fmtInt(row.calls)} 次 · ${fmtCompactTokens(row.totalTokens)} Tokens · ${fmtCny(row.estimatedCostCny)}`
  }));
  renderProgressList($("#stage-bars"), stageItems, {
    emptyText: "暂无 AI 阶段调用记录",
    colorClass: "violet"
  });

  const featureItems = (dashboard.byResultType ?? []).slice(0, 8).map((row) => ({
    label: RESULT_TYPE_LABELS[row.resultType] ?? row.resultType,
    value: row.count,
    meta: `${fmtInt(row.count)} 次 (${fmtPct(row.share)})`
  }));
  renderProgressList($("#feature-bars"), featureItems, {
    emptyText: "暂无查询使用记录"
  });

  const seasonNameMap = new Map((dashboard.seasons ?? []).map((s) => [s.id, s.label]));
  const seasonItems = (dashboard.bySeason ?? []).map((row) => ({
    label: seasonNameMap.get(row.seasonContextId) ?? row.seasonContextId,
    value: row.queries,
    meta: `${fmtInt(row.queries)} 次 · ${fmtInt(row.uniqueVisitors)} UV (${fmtPct(row.share)})`
  }));
  renderProgressList($("#season-bars"), seasonItems, {
    emptyText: "暂无赛季统计数据",
    colorClass: "amber"
  });
}

function renderRuntimeHealth(dashboard) {
  const rt = dashboard.runtime ?? {};
  const conc = rt.concurrency ?? {};
  const sse = conc.sse ?? {};
  const llm = conc.llm ?? {};
  const upstream = conc.metatft ?? {};
  const hotCache = conc.hotQueryCache ?? {};

  const storageLabel = rt.storage
    ? `${rt.storage.persistent}+${rt.storage.ephemeral}`
    : (rt.cache?.type ?? "sqlite");
  $("#runtime-mode-badge").textContent = `角色 ${rt.processRole ?? "all"} · 存储 ${storageLabel} · Patch ${rt.seasonPatch?.currentPatch ?? "--"}`;

  const cards = [
    {
      title: "SSE 并发流",
      metric: `${fmtInt(sse.active)} / ${fmtInt(sse.maxActive)}`,
      sub: `峰值 ${fmtInt(sse.peak)} · 拒绝 ${fmtInt(sse.rejected)}`,
      status: (sse.rejected ?? 0) > 0 ? "warn" : "ok"
    },
    {
      title: "LLM 并发舱壁",
      metric: `${fmtInt(llm.inFlight)} / ${fmtInt(llm.maxConcurrent)}`,
      sub: `排队 ${fmtInt(llm.queued)} · 峰值 ${fmtInt(llm.peakInFlight)} · 拒绝 ${fmtInt(llm.rejected)}`,
      status: (llm.rejected ?? 0) > 0 ? "warn" : "ok"
    },
    {
      title: "统计上游并发",
      metric: `${fmtInt(upstream.inFlight)} / ${fmtInt(upstream.maxConcurrent)}`,
      sub: `请求合并 ${fmtInt(upstream.singleflightCoalesced)} · 429 限流 ${fmtInt(upstream.upstream429Count)}`,
      status: (upstream.upstream429Count ?? 0) > 0 ? "warn" : "ok"
    },
    {
      title: "L1 热缓存",
      metric: `${fmtInt(hotCache.size)} / ${fmtInt(hotCache.maxEntries)}`,
      sub: `热命中 ${fmtInt(hotCache.hits)} · SWR 刷新 ${fmtInt(hotCache.staleHits)} · 合并 ${fmtInt(hotCache.coalesced)}`,
      status: "ok"
    },
    {
      title: "Event Loop P99",
      metric: conc.eventLoopLagP99Ms !== null && conc.eventLoopLagP99Ms !== undefined
        ? `${conc.eventLoopLagP99Ms} ms`
        : "--",
      sub: rt.access?.enabled
        ? `公网限额：全局 ${fmtInt(rt.access.globalDailyLimit)}/日 · 单人 ${fmtInt(rt.access.visitorDailyLimit)}/日`
        : "本地/非限流模式",
      status: (conc.eventLoopLagP99Ms ?? 0) > 100 ? "bad" : (conc.eventLoopLagP99Ms ?? 0) > 40 ? "warn" : "ok"
    }
  ];

  $("#health-grid").replaceChildren(...cards.map((card) => {
    const el = document.createElement("div");
    el.className = "health-card";
    const head = document.createElement("div");
    head.className = "health-title";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = card.title;
    const dot = document.createElement("span");
    dot.className = `status-dot ${card.status === "ok" ? "" : card.status}`.trim();
    head.append(titleSpan, dot);

    const metric = document.createElement("div");
    metric.className = "health-metric";
    metric.textContent = card.metric;

    const sub = document.createElement("div");
    sub.className = "health-sub";
    sub.textContent = card.sub;

    el.append(head, metric, sub);
    return el;
  }));

  const tiering = rt.modelTiering ?? {};
  const tierItems = [
    ["ReAct 主推理", tiering.reactDecision ?? "未启用"],
    ["轻量解析", tiering.lightweight ?? tiering.structuredParser ?? "未启用"],
    ["结论增强", tiering.conclusion ?? "未启用"],
    ["攻略助手", tiering.coach ?? "未启用"]
  ];
  $("#tiering-strip").replaceChildren(...tierItems.map(([label, value]) => {
    const item = document.createElement("span");
    item.className = "tiering-item";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const code = document.createElement("code");
    code.textContent = value;
    item.append(strong, code);
    return item;
  }));
}

function renderRecentQueries(dashboard) {
  const rows = dashboard.recentQueries ?? [];
  const tbody = $("#recent-query-rows");
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "empty-state";
    td.textContent = "暂无查询记录";
    tr.append(td);
    tbody.replaceChildren(tr);
    return;
  }

  tbody.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");

    const tdTime = document.createElement("td");
    tdTime.textContent = fmtShortTime(row.createdAt);

    const tdSeason = document.createElement("td");
    tdSeason.textContent = row.seasonContextId ?? "--";

    const tdVisitor = document.createElement("td");
    const vCode = document.createElement("code");
    vCode.textContent = row.visitorBadge ?? "local";
    tdVisitor.append(vCode);

    const tdType = document.createElement("td");
    tdType.textContent = RESULT_TYPE_LABELS[row.resultType] ?? row.resultType;

    const tdInput = document.createElement("td");
    tdInput.className = "input-cell";
    tdInput.textContent = row.input || "--";
    tdInput.title = row.input || "";

    const tdMode = document.createElement("td");
    const badge = document.createElement("span");
    if (row.llmUsed) {
      badge.className = "badge ai";
      badge.textContent = "AI";
    } else if (row.cacheHit) {
      badge.className = "badge cache";
      badge.textContent = "缓存";
    } else {
      badge.className = "badge live";
      badge.textContent = "实时";
    }
    tdMode.append(badge);

    const tdModel = document.createElement("td");
    if (row.llmModel) {
      const mCode = document.createElement("code");
      mCode.textContent = row.llmModel;
      tdModel.append(mCode);
    } else {
      tdModel.textContent = "--";
    }

    const tdDur = document.createElement("td");
    tdDur.className = "num";
    tdDur.textContent = fmtMs(row.durationMs);

    tr.append(tdTime, tdSeason, tdVisitor, tdType, tdInput, tdMode, tdModel, tdDur);
    return tr;
  }));
}

function renderAll(dashboard) {
  state.dashboard = dashboard;
  populateSeasonOptions(dashboard.seasons);
  renderKpis(dashboard);
  renderTrendChart(dashboard);
  renderModelTable(dashboard);
  renderBreakdowns(dashboard);
  renderRuntimeHealth(dashboard);
  renderRecentQueries(dashboard);
}

async function refreshDashboard({ silent = false } = {}) {
  try {
    setError("");
    const dashboard = await fetchDashboard();
    renderAll(dashboard);
    if (!silent) notify("看板数据已更新");
  } catch (error) {
    setError(`加载看板数据失败：${error.message}`);
  }
}

function syncAutoRefresh() {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if ($("#auto-refresh").checked) {
    state.autoRefreshTimer = window.setInterval(() => {
      refreshDashboard({ silent: true });
    }, 30_000);
  }
}

function exportJson() {
  if (!state.dashboard) return;
  const blob = new Blob([`${JSON.stringify(state.dashboard, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tftclarity-admin-dashboard-${state.days}d-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  notify("已导出看板 JSON 快照");
}

function bindEvents() {
  $("#window-days").addEventListener("change", (event) => {
    state.days = Number(event.target.value) || 7;
    refreshDashboard({ silent: true });
  });

  $("#season-filter").addEventListener("change", (event) => {
    state.seasonContextId = event.target.value || "all";
    refreshDashboard({ silent: true });
  });

  $("#auto-refresh").addEventListener("change", () => {
    syncAutoRefresh();
    notify($("#auto-refresh").checked ? "已开启每 30 秒自动刷新" : "已关闭自动刷新");
  });

  $("#refresh-btn").addEventListener("click", () => refreshDashboard());
  $("#export-json-btn").addEventListener("click", exportJson);

  for (const btn of document.querySelectorAll(".seg-btn")) {
    btn.addEventListener("click", () => {
      state.chartMode = btn.dataset.mode === "tokens" ? "tokens" : "usage";
      for (const other of document.querySelectorAll(".seg-btn")) {
        other.classList.toggle("active", other === btn);
      }
      if (state.dashboard) renderTrendChart(state.dashboard);
    });
  }
}

bindEvents();
refreshDashboard({ silent: true });
