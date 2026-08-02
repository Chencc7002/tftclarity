/**
 * OP.GG pro trends / player review panel for the tftclarity small-window UI.
 * Renders into the existing result pane, following the patch-notes quick
 * task pattern. All data comes from /api/opgg/* (desensitized).
 */

const DEFAULT_POOL = "default-na-pro";
const PERSONAL_POOL = "my-review";

let state = {
  view: "trends",
  pool: DEFAULT_POOL,
  sig: null,
  playerId: null,
  matchId: null
};
let teachingController = null;

function el(id) {
  return document.querySelector(`#${id}`);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function pct(value) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value * 100)}%`;
}

function pct1(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function imageHtml(url, alt, className, fallbackUrl = null) {
  if (!url) {
    return `<span class="${className} opgg-image-fallback" aria-label="${esc(alt)}">${esc(String(alt ?? "?").slice(0, 1) || "?")}</span>`;
  }
  return `<img class="${className}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async"${fallbackUrl ? ` data-fallback-src="${esc(fallbackUrl)}"` : ""}>`;
}

function normalizedItems(unit) {
  if (Array.isArray(unit?.items) && unit.items.length) return unit.items;
  return (unit?.itemNames ?? []).map((apiName, index) => ({
    apiName,
    displayName: unit?.itemDisplayNames?.[index] ?? apiName,
    iconUrl: null
  }));
}

function unitBoardHtml(units, { compact = false, showNames = false } = {}) {
  const board = (units ?? []).filter(Boolean).slice(0, 10);
  if (!board.length) return '<span class="opgg-board-empty">暂无棋子数据</span>';
  return `<div class="opgg-board ${compact ? "opgg-board-compact" : ""}">${board.map((unit) => {
    const name = unit.displayName ?? unit.characterId ?? unit.name ?? "棋子";
    const tier = Math.max(1, Math.min(4, Number(unit.tier ?? 1)));
    const items = normalizedItems(unit);
    return `<div class="opgg-board-unit" title="${esc(name)} · ${tier} 星">
      <span class="opgg-board-stars" aria-label="${tier} 星">${"★".repeat(tier)}</span>
      ${imageHtml(unit.iconUrl, name, "opgg-unit-portrait", unit.fallbackIconUrl)}
      ${showNames ? `<span class="opgg-board-name">${esc(name)}</span>` : ""}
      <span class="opgg-board-items">${items.map((item) => imageHtml(item.iconUrl, item.displayName ?? item.apiName, "opgg-item-icon")).join("")}</span>
    </div>`;
  }).join("")}</div>`;
}

function compLabel(comp) {
  const signature = comp?.displaySignature;
  const traits = (signature?.traits ?? []).map((trait) => trait.name ?? trait.id).filter(Boolean);
  if (traits.length) return traits.slice(0, 2).join(" · ");
  return signature?.carry?.name ?? signature?.tank?.name ?? "未命名阵容";
}

function analysisCompSummary(result, selected, metric) {
  if (!selected) return "";
  const ties = (result?.compTrends ?? []).filter(
    (comp) => comp?.[metric] === selected?.[metric]
  );
  const candidates = ties.length ? ties : [selected];
  const names = candidates.length > 2
    ? `${candidates.length} 套阵容并列`
    : candidates.map(compLabel).join(" / ");
  const counts = [...new Set(candidates.map((comp) => comp.playerMatchCount))];
  const allLowSample = candidates.every((comp) => !comp.performanceComparable);
  const sample = counts.length === 1
    ? `${candidates.length > 1 ? "各 " : ""}${counts[0]} 场${allLowSample ? "小样本" : ""}`
    : `样本 ${candidates.map((comp) => comp.playerMatchCount).join("/")} 场`;
  return `${names} · ${sample}`;
}

function aiReviewButton(playerId, matchId = null, { compact = false } = {}) {
  return `<button type="button" class="opgg-ai-button ${compact ? "opgg-ai-button-compact" : ""}" data-opgg-action="teaching" data-player="${esc(playerId)}"${matchId ? ` data-match="${esc(matchId)}"` : ""}>
    <span class="opgg-ai-icon" aria-hidden="true">✦</span>
    <span><strong>AI 智能复盘</strong>${compact ? "" : "<small>分析风格、问题与下一局建议</small>"}</span>
  </button>`;
}

function placementClass(placement) {
  if (placement === 1) return "opgg-placement-1";
  if (placement >= 2 && placement <= 4) return "opgg-placement-top4";
  return "opgg-placement-rest";
}

function tierBadge(tier) {
  const map = {
    no_data: ["opgg-badge-muted", "暂无数据"],
    recent_only: ["opgg-badge-warn", "仅展示"],
    recent_attempts: ["opgg-badge-warn", "近期尝试"],
    insufficient: ["opgg-badge-warn", "样本不足"],
    full: ["opgg-badge-success", "样本充足"],
    recent_attempt: ["opgg-badge-warn", "近期尝试"],
    frequency_only: ["opgg-badge-warn", "仅频率"],
    caution: ["opgg-badge-indigo", "谨慎参考"],
    confident: ["opgg-badge-success", "可比较"]
  };
  const [cls, label] = map[tier] ?? ["opgg-badge-muted", esc(tier)];
  return `<span class="opgg-badge ${cls}">${label}</span>`;
}

function parseSignature(signature) {
  const parts = String(signature ?? "").split("|");
  const traits = [];
  let carry = null;
  let tank = null;
  for (const part of parts) {
    if (part.startsWith("trait:")) traits.push(part.slice(6));
    else if (part.startsWith("carry:")) carry = part.slice(6);
    else if (part.startsWith("tank:")) tank = part.slice(5);
  }
  return { set: parts[0] ?? "", traits, carry, tank };
}

function signatureHtml(signature, displaySignature = null) {
  const parsed = parseSignature(signature);
  const displayTraits = Array.isArray(displaySignature?.traits)
    ? displaySignature.traits.map((trait) => trait?.name ?? trait?.id).filter(Boolean)
    : parsed.traits;
  const carry = displaySignature?.carry?.name ?? parsed.carry;
  const tank = displaySignature?.tank?.name ?? parsed.tank;
  const traits = displayTraits
    .map((trait) => `<span class="opgg-trait-chip">${esc(trait)}</span>`)
    .join("");
  const roles = [];
  if (carry) roles.push(`主C ${esc(carry)}`);
  if (tank) roles.push(`前排 ${esc(tank)}`);
  return (
    `<div><div class="opgg-traits">${traits || '<span class="opgg-badge opgg-badge-muted">无主羁绊</span>'}</div>` +
    (roles.length
      ? `<div class="opgg-match-sub" style="margin-top:5px">${roles.join(" · ")}</div>`
      : "") +
    `</div>`
  );
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

function setResult(title, html, raw) {
  const titleEl = el("result-title");
  const resultEl = el("result-content");
  const refreshButton = el("result-refresh-button");
  const rawOutputEl = el("raw-output");
  if (titleEl) titleEl.textContent = title;
  if (refreshButton) refreshButton.disabled = true;
  if (rawOutputEl) {
    rawOutputEl.textContent = JSON.stringify(
      raw ?? { view: state.view, pool: state.pool },
      null,
      2
    );
  }
  if (resultEl) resultEl.innerHTML = html;
}

function loadingHtml(message = "加载中…") {
  return `<div class="opgg-loading">${esc(message)}</div>`;
}

function errorHtml(error) {
  return `<div class="opgg-empty">加载失败：${esc(error?.message ?? error)}</div>`;
}

function backLink(label, action, data = {}) {
  const attributes = Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ` data-${key}="${esc(value)}"`)
    .join("");
  return `<button type="button" class="opgg-back" data-opgg-action="${action}"${attributes}>
    <span class="opgg-back-icon" aria-hidden="true">←</span>
    <span>${esc(label)}</span>
  </button>`;
}

function overviewChips(result) {
  const overview = result.overview;
  const chips = [
    ["当前补丁", esc(overview.currentPatch ?? "无数据")],
    ["样本", `${overview.availablePlayerMatches}/${overview.maximumPlayerMatches}`],
    ["唯一对局", overview.uniqueMatches],
    ["选手覆盖", `${overview.playersWithData}/${overview.trackedPlayers}`],
    ["达标选手", `${overview.playersMeetingTarget} 人`]
  ];
  return `<div class="opgg-chips">${chips
    .map(([label, value]) => `<div class="opgg-chip"><b>${label}</b><span>${value}</span></div>`)
    .join("")}</div>`;
}

async function renderTrends() {
  state.view = "trends";
  setResult("NA 职业选手近期阵容趋势", loadingHtml());
  try {
    const [pools, result] = await Promise.all([
      api("/api/opgg/pools"),
      api(`/api/opgg/trends?pool=${encodeURIComponent(state.pool)}`)
    ]);
    const poolOptions = pools
      .map((pool) => `<option value="${esc(pool.id)}" ${pool.id === state.pool ? "selected" : ""}>${esc(pool.name)}（${pool.memberCount} 人）</option>`)
      .join("");
    const rows = (result.compTrends ?? []).map((comp) => `
      <a class="opgg-trend-row ${comp.performanceComparable ? "" : "opgg-trend-row-exploratory"}" href="#" role="row" data-opgg-action="comp" data-sig="${esc(comp.compSignature)}">
        <span class="opgg-trend-comp" role="cell">
          <span class="opgg-trend-comp-copy">
            <strong>${esc(compLabel(comp))}</strong>
            <small>覆盖 ${comp.playerCoverage}/${result.overview.trackedPlayers} 名选手 · ${comp.representativeBoardCount ?? 0} 场代表阵容</small>
          </span>
          ${unitBoardHtml(comp.representativeUnits, { compact: true })}
        </span>
        <span role="cell"><b class="opgg-rating opgg-rating-${esc(String(comp.ratingGrade ?? "u").toLowerCase())}">${esc(comp.ratingGrade ?? "—")}</b></span>
        <span role="cell"><b>${comp.playerMatchCount}</b></span>
        <span role="cell">${pct1(comp.playerMatchShare)}</span>
        <span role="cell" class="opgg-number-good">${comp.observedAvgPlacement ?? "—"}</span>
        <span role="cell" class="opgg-number-good">${pct1(comp.observedTop4Rate)}</span>
        <span role="cell" class="opgg-number-gold">${pct1(comp.observedWinRate)}</span>
        <span role="cell" class="${(comp.observedEighthRate ?? 0) >= 0.2 ? "opgg-number-risk" : ""}">${pct1(comp.observedEighthRate)}</span>
      </a>`).join("");
    const analysis = result.compAnalysis;
    const analysisEntries = analysis ? [
      ["最常使用", analysis.mostPlayed, analysis.mostPlayed ? `${analysis.mostPlayed.playerMatchCount} 场` : "—", "playerMatchCount"],
      ["最佳均名", analysis.bestAveragePlacement, analysis.bestAveragePlacement?.observedAvgPlacement ?? "—", "observedAvgPlacement"],
      ["最高前四", analysis.highestTop4Rate, pct1(analysis.highestTop4Rate?.observedTop4Rate), "observedTop4Rate"],
      ["最高登顶", analysis.highestWinRate, pct1(analysis.highestWinRate?.observedWinRate), "observedWinRate"]
    ] : [];
    const analysisHtml = analysisEntries.length ? `<div class="opgg-analysis-strip">${analysisEntries.map(([label, comp, value, metric]) => `
      <div class="opgg-analysis-item">
        <span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(analysisCompSummary(result, comp, metric))}</small>
      </div>`).join("")}</div>` : "";
    setResult(
      "NA 职业选手近期阵容趋势",
      `
        <div class="opgg-page-head">
          <div>
            <h3 class="opgg-page-title">职业趋势</h3>
            <p class="opgg-page-sub">每名选手最近 ${result.overview.perPlayerMatchWindow} 场 · 仅当前补丁 · 不描述为全服 Meta</p>
          </div>
          <div class="opgg-toolbar">
            <select id="opgg-pool-select">${poolOptions}</select>
            <a class="opgg-badge opgg-badge-indigo" href="#" data-opgg-action="players">选手与荣誉</a>
          </div>
        </div>
        ${overviewChips(result)}
        ${analysisHtml}
        ${result.overview.availablePlayerMatches < result.overview.maximumPlayerMatches
          ? `<div class="opgg-notice">当前积累 ${result.overview.availablePlayerMatches}/${result.overview.maximumPlayerMatches} 条 player-match。评级、均名、前四、登顶与老八均为职业池小样本观察；少于 5 场的行已弱化显示，不代表全服强度。</div>`
          : ""}
        <div class="opgg-section-title">阵容小数据 <small>点击行查看每一场的棋子与装备</small></div>
        <div class="opgg-trend-table" role="table" aria-label="职业选手阵容小数据">
          <div class="opgg-trend-header" role="row">
            <span role="columnheader">阵容</span><span role="columnheader">评级</span><span role="columnheader">场次</span><span role="columnheader">出场率</span><span role="columnheader">均名</span><span role="columnheader">前四率</span><span role="columnheader">登顶率</span><span role="columnheader">老八率</span>
          </div>
          ${rows || '<div class="opgg-empty">当前补丁暂无已分类阵容</div>'}
        </div>
        ${result.unclassifiedPlayerMatches ? `<div class="opgg-notice">另有 ${result.unclassifiedPlayerMatches} 场对局缺少完整棋子/羁绊数据，未参与阵容统计。</div>` : ""}
      `,
      { view: "trends", pool: state.pool }
    );
    const select = el("opgg-pool-select");
    if (select) {
      select.addEventListener("change", (event) => {
        state.pool = event.target.value;
        renderTrends();
      });
    }
  } catch (error) {
    setResult("职业趋势", errorHtml(error));
  }
}

async function renderPlayers() {
  state.view = "players";
  setResult("职业选手与个人复盘", loadingHtml());
  try {
    const data = await api(`/api/opgg/players?pool=${encodeURIComponent(state.pool)}`);
    const cards = (data.players ?? []).map((player) => {
      const honors = player.honors
        ? `
          <div class="opgg-honor-title" style="font-size:14px">${esc(player.honors.achievementZh)}</div>
          <div class="opgg-honor-intro" style="font-size:11.5px">${esc(player.honors.introZh)}</div>
          <div class="opgg-honor-tags">${(player.honors.tags ?? []).map((tag) => `<span class="opgg-badge opgg-badge-gold">${esc(tag)}</span>`).join("")}</div>`
        : `<div class="opgg-match-sub">暂无荣誉资料</div>`;
      return `
        <div class="opgg-card opgg-card-link" data-opgg-action="player" data-player="${esc(player.id)}" style="cursor:pointer">
          <div class="opgg-card-body">
            <div class="opgg-card-head">
              <span class="opgg-card-title">${esc(player.displayName)}</span>
              <span class="opgg-badge opgg-badge-muted">${esc(player.region ?? "na")}</span>
            </div>
            <div class="opgg-match-sub">${esc(player.gameName)}#${esc(player.tagLine)}</div>
            <div class="opgg-honor-card" style="margin-top:9px">${honors}</div>
            <div class="opgg-metrics" style="margin-top:10px">
              <div class="opgg-metric"><b>已采集</b><span>${player.summary?.matchCount ?? 0} 场</span></div>
              <div class="opgg-metric"><b>均名次</b><span>${player.summary?.avgPlacement ?? "-"}</span></div>
              <div class="opgg-metric"><b>前四率</b><span>${player.summary?.top4Rate != null ? Math.round(player.summary.top4Rate * 100) + "%" : "-"}</span></div>
            </div>
            <div class="opgg-card-actions">${aiReviewButton(player.id, null, { compact: true })}</div>
          </div>
        </div>`;
    }).join("");
    setResult(
      "职业选手与个人复盘",
      `${backLink("返回趋势", "trends")}
       <div class="opgg-page-head">
         <div>
           <h3 class="opgg-page-title">选手与荣誉</h3>
           <p class="opgg-page-sub">荣誉仅用于介绍，不参与聚合权重 · 个人复盘页与选手详情页同构</p>
         </div>
       </div>
       <div class="opgg-grid">${cards || '<div class="opgg-empty">暂无选手</div>'}</div>`,
      { view: "players", pool: state.pool }
    );
  } catch (error) {
    setResult("选手列表", errorHtml(error));
  }
}

async function renderComp() {
  state.view = "comp";
  setResult("阵容对局", loadingHtml());
  try {
    const data = await api(
      `/api/opgg/comp?pool=${encodeURIComponent(state.pool)}&sig=${encodeURIComponent(state.sig ?? "")}`
    );
    const cards = (data.cards ?? []).map((card) => `
      <a class="opgg-match-board-card" href="#" data-opgg-action="match" data-player="${esc(card.playerId)}" data-match="${esc(card.matchId)}">
        <span class="opgg-match-summary">
          <span class="opgg-placement-badge ${placementClass(card.placement)}">${card.placement ?? "?"}</span>
          <span class="opgg-match-main">
            <strong>${esc(card.playerDisplayName ?? card.playerId)}</strong>
            <small>${fmtDate(card.gameDatetime)} · patch ${esc(card.patchLabel ?? "-")} · Lv${card.level ?? "-"}</small>
          </span>
        </span>
        ${unitBoardHtml(card.units)}
      </a>`).join("");
    setResult(
      "阵容对局",
      `${state.playerId
        ? backLink("返回选手", "player", { player: state.playerId })
        : backLink("返回趋势", "trends")}
       <div class="opgg-page-head">
         <div>
           <h3 class="opgg-page-title">阵容对局</h3>
           <p class="opgg-page-sub">patch ${esc(data.patch ?? "-")} · ${data.cards.length} 场 player-match</p>
         </div>
       </div>
        <div class="opgg-card opgg-comp-summary"><div class="opgg-card-body">${signatureHtml(data.signature, data.displaySignature)}</div></div>
       <div class="opgg-section-title">对局卡片 <small>点击查看终局阵容详情</small></div>
       <div class="opgg-match-board-list">${cards || '<div class="opgg-empty">该阵容暂无对局</div>'}</div>`,
      { view: "comp", pool: state.pool, sig: state.sig }
    );
  } catch (error) {
    setResult("阵容对局", errorHtml(error));
  }
}

async function renderPlayer() {
  state.view = "player";
  setResult("选手详情", loadingHtml());
  try {
    const data = await api(`/api/opgg/players/${encodeURIComponent(state.playerId)}/review`);
    const review = data.review;
    const player = data.player;
    const honors = player.honors ? `
      <div class="opgg-honor-card">
        <div class="opgg-honor-title">${esc(player.honors.achievementZh)}</div>
        <div class="opgg-honor-detail">${esc(player.honors.achievementDetailZh)}</div>
        <div class="opgg-honor-intro">${esc(player.honors.introZh)}</div>
        <div class="opgg-honor-tags">
          <span class="opgg-badge opgg-badge-indigo">${esc(player.honors.competitiveRegion ?? "?")}</span>
          ${(player.honors.tags ?? []).map((tag) => `<span class="opgg-badge opgg-badge-gold">${esc(tag)}</span>`).join("")}
        </div>
      </div>` : "";
     const comps = (review.compPreferences ?? []).map((comp) => `
      <a class="opgg-card opgg-card-link" href="#" data-opgg-action="comp" data-sig="${esc(comp.compSignature)}">
        <div class="opgg-card-body">
          <div class="opgg-card-head"><span class="opgg-badge opgg-badge-cyan">${comp.count} 场</span><span class="opgg-badge opgg-badge-muted">${pct(comp.share)}</span></div>
          <div style="margin-top:8px">${signatureHtml(comp.compSignature, comp.displaySignature)}</div>
        </div>
      </a>`).join("");
    const matches = (review.matches ?? []).map((entry) => {
      const facts = entry.facts;
      return `
        <div class="opgg-player-match-card">
          <a class="opgg-player-match-link" href="#" data-opgg-action="match" data-player="${esc(state.playerId)}" data-match="${esc(facts.matchId)}">
            <span class="opgg-match-summary">
              <span class="opgg-placement-badge ${placementClass(facts.placement)}">${facts.placement ?? "?"}</span>
              <span class="opgg-match-main">
                <strong>${fmtDate(facts.gameDatetime)} · patch ${esc(facts.patchLabel ?? "-")}</strong>
                <small>Lv${facts.level ?? "-"} · 第${facts.lastRound ?? "-"}回合 · ${facts.units.length} 棋子</small>
              </span>
            </span>
            ${unitBoardHtml(facts.units, { compact: true })}
          </a>
          <div class="opgg-player-match-actions">${aiReviewButton(state.playerId, facts.matchId, { compact: true })}</div>
        </div>`;
    }).join("");
    setResult(
      `${player.displayName} · 选手详情`,
      `${backLink("返回选手列表", "players")}
       <div class="opgg-page-head">
         <div>
           <h3 class="opgg-page-title">${esc(player.displayName)} <span class="opgg-badge opgg-badge-muted">${esc(player.gameName)}#${esc(player.tagLine)} · ${esc(player.region)}</span></h3>
           <p class="opgg-page-sub">${esc(review.accumulatedLabel)} ${tierBadge(review.sampleTier)}</p>
         </div>
          <div class="opgg-toolbar">${aiReviewButton(state.playerId)}</div>
       </div>
       ${honors}
       <div class="opgg-chips">
         <div class="opgg-chip"><b>均名次</b><span>${review.stats.avgPlacement ?? "-"}</span></div>
         <div class="opgg-chip"><b>前四率</b><span>${pct(review.stats.top4Rate)}</span></div>
         <div class="opgg-chip"><b>平均人口</b><span>${review.stats.avgLevel ?? "-"}</span></div>
         <div class="opgg-chip"><b>完整对局</b><span>${review.stats.completeMatches}/${review.accumulatedMatches}</span></div>
         <div class="opgg-chip"><b>最佳/最差</b><span>${review.stats.bestPlacement ?? "-"}/${review.stats.worstPlacement ?? "-"}</span></div>
       </div>
       <div class="opgg-notice">${esc(review.styleNote)} ${esc(review.dataBoundaryNote)}</div>
       ${comps ? `<div class="opgg-section-title">常玩阵容</div><div class="opgg-grid">${comps}</div>` : ""}
       <div class="opgg-section-title">最近对局 <small>可查看详情或直接复盘单局</small></div>
       <div class="opgg-player-match-list">${matches || '<div class="opgg-empty">暂无已采集对局</div>'}</div>`,
      { view: "player", playerId: state.playerId }
    );
  } catch (error) {
    setResult("选手详情", errorHtml(error));
  }
}

async function renderMatch() {
  state.view = "match";
  setResult("对局详情", loadingHtml());
  try {
    const data = await api(
      `/api/opgg/players/${encodeURIComponent(state.playerId)}/matches/${encodeURIComponent(state.matchId)}`
    );
    const facts = data.review.facts;
    const units = (facts.units ?? []).map((unit) => {
      const stars = "★".repeat(Math.max(1, unit.tier ?? 1));
      const items = normalizedItems(unit).map((item) => `
        <span class="opgg-item-visual" title="${esc(item.displayName ?? item.apiName)}">
          ${imageHtml(item.iconUrl, item.displayName ?? item.apiName, "opgg-item-icon opgg-item-icon-large")}
          <span>${esc(item.displayName ?? item.apiName)}</span>
        </span>`).join("");
      return `
        <div class="opgg-unit-card">
          <div class="opgg-unit-card-head">
            ${imageHtml(unit.iconUrl, unit.displayName ?? unit.characterId ?? "棋子", "opgg-unit-card-image", unit.fallbackIconUrl)}
            <div><div class="opgg-unit-name">${esc(unit.displayName ?? unit.characterId ?? "?")}</div>
            <div class="opgg-unit-meta">${unit.cost ?? "?"} 费 · <span class="opgg-stars">${stars}</span></div></div>
          </div>
          ${items ? `<div class="opgg-unit-items">${items}</div>` : `<div class="opgg-unit-no-items">无装备</div>`}
        </div>`;
    }).join("");
    const traits = (facts.traits ?? []).map((trait) =>
      `<span class="opgg-trait-chip">${esc(trait.displayName ?? trait.name)} ×${trait.numUnits ?? "?"}</span>`
    ).join("");
    const conclusions = (data.review.conclusions ?? []).map((item) =>
      `<li>${esc(item.conclusion)}</li>`
    ).join("");
    setResult(
      "对局详情",
      `${backLink("返回选手", "player", { player: state.playerId })}
       <div class="opgg-page-head">
         <div>
           <h3 class="opgg-page-title">对局详情</h3>
           <p class="opgg-page-sub">${esc(facts.matchId)} · ${fmtDate(facts.gameDatetime)} · patch ${esc(facts.patchLabel ?? "-")} · ${esc(data.player.displayName)}</p>
         </div>
         <div class="opgg-detail-actions">
           ${aiReviewButton(state.playerId, state.matchId, { compact: true })}
           <div class="opgg-placement-badge ${placementClass(facts.placement)}">${facts.placement ?? "?"}名</div>
         </div>
       </div>
       <div class="opgg-chips">
         <div class="opgg-chip"><b>最终等级</b><span>Lv${facts.level ?? "-"}</span></div>
         <div class="opgg-chip"><b>剩余金币</b><span>${facts.goldLeft ?? "-"}</span></div>
         <div class="opgg-chip"><b>淘汰回合</b><span>第${facts.lastRound ?? "-"}回合</span></div>
         <div class="opgg-chip"><b>淘汰玩家</b><span>${facts.playersEliminated ?? "-"} 人</span></div>
         ${facts.vsRecentAverage?.placementDiff != null ? `<div class="opgg-chip"><b>对比近期平均</b><span>${facts.vsRecentAverage.placementDiff > 0 ? "+" : ""}${facts.vsRecentAverage.placementDiff}</span></div>` : ""}
       </div>
       <div class="opgg-card"><div class="opgg-card-body">
         <div class="opgg-section-title" style="margin-top:0">阵容</div>
          ${signatureHtml(facts.compFamilySignature, facts.displaySignature)}
       </div></div>
       <div class="opgg-section-title">终局棋子与装备 <small>OP.GG 数据源未返回站位坐标</small></div>
       <div class="opgg-notice">以下展示对局结束时的棋子、星级与装备；当前数据源不包含逐回合经济、搜牌和棋盘站位。</div>
       <div class="opgg-units-grid" style="margin-top:10px">${units || '<div class="opgg-empty">无棋子数据（早期淘汰或数据缺失）</div>'}</div>
       <div class="opgg-section-title">激活羁绊</div>
       <div class="opgg-traits">${traits || '<span class="opgg-badge opgg-badge-muted">无</span>'}</div>
       <div class="opgg-section-title">确定性结论</div>
       <ul class="opgg-conclusion-list">${conclusions || "<li>该局无规则结论（数据不完整）。</li>"}</ul>
       <div class="opgg-notice">${esc(data.review.dataBoundaryNote)}</div>`,
      { view: "match", playerId: state.playerId, matchId: state.matchId }
    );
  } catch (error) {
    setResult("对局详情", errorHtml(error));
  }
}

async function renderPersonal() {
  state.view = "personal";
  setResult("个人战绩复盘", loadingHtml());
  try {
    const data = await api("/api/opgg/my-review");
    const cards = (data.players ?? []).map((player) => `
      <div class="opgg-card opgg-personal-card">
        <a class="opgg-card-link" href="#" data-opgg-action="player" data-player="${esc(player.id)}">
          <div class="opgg-card-body">
          <div class="opgg-card-head">
            <span class="opgg-card-title">${esc(player.displayName)}</span>
            <span class="opgg-badge opgg-badge-muted">${esc(player.region ?? "na")}</span>
          </div>
          <div class="opgg-match-sub">${esc(player.gameName)}#${esc(player.tagLine)}</div>
          <div class="opgg-metrics" style="margin-top:9px">
            <div class="opgg-metric"><b>已采集</b><span>${player.summary?.matchCount ?? 0} 场</span></div>
            <div class="opgg-metric"><b>均名次</b><span>${player.summary?.avgPlacement ?? "-"}</span></div>
            <div class="opgg-metric"><b>前四率</b><span>${player.summary?.top4Rate != null ? Math.round(player.summary.top4Rate * 100) + "%" : "-"}</span></div>
          </div>
          </div>
        </a>
        <div class="opgg-personal-actions">${aiReviewButton(player.id)}</div>
      </div>`).join("");
    setResult(
      "个人战绩复盘",
      `
        <div class="opgg-page-head">
          <div>
            <h3 class="opgg-page-title">个人战绩复盘</h3>
            <p class="opgg-page-sub">添加你的 Riot ID，首次同步最近 3 场，之后本地持续累积</p>
          </div>
        </div>
        <div class="opgg-card opgg-account-form"><div class="opgg-card-body">
          <div class="opgg-section-title">添加账号</div>
          <div class="opgg-account-fields">
            <label><span>Riot ID 游戏名</span><input id="opgg-personal-name" placeholder="例如 chencc" autocomplete="off"></label>
            <label><span>Tag</span><input id="opgg-personal-tag" placeholder="例如 1215" autocomplete="off"></label>
            <input type="hidden" id="opgg-personal-region" value="na">
            <span class="opgg-region-chip"><small>服务器</small><strong>NA</strong></span>
            <button type="button" class="opgg-primary-button" data-opgg-action="personal-add">添加并复盘</button>
          </div>
          <p class="opgg-form-hint">当前仅支持 NA。首次同步最近 3 场，后续采集会持续累积到 10 场。</p>
        </div></div>
        <div class="opgg-section-title">我的账号 <small>点击账号看详情，点击 AI 智能复盘直接生成分析</small></div>
        <div class="opgg-grid">${cards || '<div class="opgg-empty">还没有添加账号</div>'}</div>
      `,
      { view: "personal" }
    );
  } catch (error) {
    setResult("个人战绩复盘", errorHtml(error));
  }
}

async function addPersonalAccount() {
  const name = el("opgg-personal-name")?.value.trim();
  const tag = el("opgg-personal-tag")?.value.trim();
  const region = el("opgg-personal-region")?.value ?? "na";
  if (!name || !tag) {
    setResult("个人战绩复盘", errorHtml(new Error("请输入 Riot ID 与 Tag，例如 chencc / 1215")));
    return;
  }
  setResult("个人战绩复盘", loadingHtml());
  try {
    const data = await api("/api/opgg/players/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameName: name, tagLine: tag, region })
    });
    state.playerId = data.player.id;
    await renderPlayer();
  } catch (error) {
    setResult("个人战绩复盘", errorHtml(error));
  }
}

async function renderTeaching() {
  state.view = "teaching";
  teachingController?.abort();
  const controller = new AbortController();
  teachingController = controller;
  const playerId = state.playerId;
  const matchId = state.matchId;
  setResult(
    "AI 智能复盘",
    `${backLink("返回选手", "player", { player: playerId })}
     ${loadingHtml("AI 正在分析对局风格、关键问题和下一局建议，通常需要 20–60 秒；模型不可用时会自动降级为规则点评。")}
     <div class="opgg-toolbar" style="justify-content:center">
       <button type="button" class="opgg-badge opgg-badge-muted" data-opgg-action="cancel-teaching" data-player="${esc(playerId)}" style="border:1px solid var(--line);cursor:pointer">取消生成</button>
     </div>`
  );
  const timeout = setTimeout(() => controller.abort(), 70000);
  try {
    const matchQuery = matchId ? `&match=${encodeURIComponent(matchId)}` : "";
    const data = await api(
      `/api/opgg/teaching?player=${encodeURIComponent(playerId)}${matchQuery}`,
      { signal: controller.signal }
    );
    if (controller.signal.aborted || teachingController !== controller) return;
    const sourceBadge =
      data.source === "llm"
        ? `<span class="opgg-badge opgg-badge-success">LLM 教学点评 ${data.validated ? "· 校验通过" : "· 未通过"}</span>`
        : `<span class="opgg-badge opgg-badge-warn">规则降级（${esc(data.reason ?? "llm_disabled")}）</span>`;
    const reasons = (data.reasons ?? []).map((reason) => `
      <li><strong>${esc(reason.dimension ?? "理由")}</strong><div>${esc(reason.text)}</div></li>
    `).join("");
    const alternatives = (data.alternatives ?? []).map((alt) => `
      <li>${esc(alt.text)}</li>
    `).join("");
    const warnings = (data.warnings ?? []).map((warning) => `<li>${esc(warning)}</li>`).join("");
    setResult(
      "AI 智能复盘",
      `${backLink("返回选手", "player", { player: playerId })}
       <div class="opgg-page-head">
         <div>
           <h3 class="opgg-page-title">AI 智能复盘</h3>
           <p class="opgg-page-sub">${esc(data.headline ?? "")}</p>
         </div>
         ${sourceBadge}
       </div>
       <div class="opgg-card"><div class="opgg-card-body" style="white-space:pre-wrap;line-height:1.7;font-size:13px">${esc(data.text ?? "")}</div></div>
       ${reasons ? `<div class="opgg-section-title">理由</div><ul class="opgg-conclusion-list">${reasons}</ul>` : ""}
       ${alternatives ? `<div class="opgg-section-title">替代建议</div><ul class="opgg-conclusion-list">${alternatives}</ul>` : ""}
       ${warnings ? `<div class="opgg-section-title">提示</div><ul class="opgg-conclusion-list">${warnings}</ul>` : ""}`,
      { view: "teaching", playerId, matchId }
    );
  } catch (error) {
    if (controller.signal.aborted) {
      if (teachingController === controller) {
        setResult(
          "AI 智能复盘",
          `${backLink("返回选手", "player", { player: playerId })}${errorHtml(new Error("生成已取消或超时，请稍后重试"))}`
        );
      }
      return;
    }
    setResult("AI 智能复盘", errorHtml(error));
  } finally {
    clearTimeout(timeout);
    if (teachingController === controller) teachingController = null;
  }
}

async function dispatch(action, dataset) {
  if (action !== "teaching") {
    teachingController?.abort();
    teachingController = null;
  }
  if (action === "trends") return renderTrends();
  if (action === "players") return renderPlayers();
  if (action === "comp") {
    state.sig = dataset.sig;
    return renderComp();
  }
  if (action === "player") {
    state.playerId = dataset.player ?? state.playerId;
    if (!state.playerId) {
      return setResult("选手详情", errorHtml(new Error("缺少选手标识，请返回选手列表重试")));
    }
    return renderPlayer();
  }
  if (action === "match") {
    state.playerId = dataset.player;
    state.matchId = dataset.match;
    return renderMatch();
  }
  if (action === "personal-add") return addPersonalAccount();
  if (action === "cancel-teaching") {
    state.playerId = dataset.player ?? state.playerId;
    return renderPlayer();
  }
  if (action === "teaching") {
    state.playerId = dataset.player;
    state.matchId = dataset.match ?? null;
    return renderTeaching();
  }
  return renderTrends();
}

function attachClickDelegation() {
  const resultEl = el("result-content");
  if (!resultEl || resultEl.dataset.opggBound) {
    return;
  }
  resultEl.dataset.opggBound = "1";
  resultEl.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = image.dataset.fallbackSrc;
    if (fallback && image.src !== fallback) {
      image.dataset.fallbackSrc = "";
      image.src = fallback;
      return;
    }
    image.classList.add("opgg-image-broken");
  }, true);
  resultEl.addEventListener("click", (event) => {
    const target = event.target.closest("[data-opgg-action]");
    if (!target) {
      return;
    }
    event.preventDefault();
    dispatch(target.dataset.opggAction, target.dataset);
  });
}

export function renderOpggTrends() {
  state = { view: "trends", pool: DEFAULT_POOL, sig: null, playerId: null, matchId: null };
  attachClickDelegation();
  renderTrends();
}

export function renderOpggPersonal() {
  state = { view: "personal", pool: PERSONAL_POOL, sig: null, playerId: null, matchId: null };
  attachClickDelegation();
  renderPersonal();
}

export function renderOpggProTeaching() {
  state = { view: "players", pool: DEFAULT_POOL, sig: null, playerId: null, matchId: null };
  attachClickDelegation();
  renderPlayers();
}

export function cancelOpggRequests() {
  teachingController?.abort();
  teachingController = null;
}
