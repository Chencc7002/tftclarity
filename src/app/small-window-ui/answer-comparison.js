const divider = /^:?-+:?$/u;
const compHeader = /阵容|\b(?:comp(?:osition)?s?|lineups?|teams?)\b/iu;
const unitHeader = /英雄|棋子|携带者|弈子|\b(?:units?|champions?|heroes?|carriers?)\b/iu;
const traitHeader = /羁绊|\b(?:traits?|synerg(?:y|ies))\b/iu;
const itemHeader = /装备|出装|神器|纹章|三件套|单件|\b(?:items?|equipment|builds?|artifacts?|emblems?)\b/iu;
const escape = value => String(value).replace(/[&<>"']/gu, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const plain = value => value.replaceAll("**", "").trim();

function cells(line = "") {
  const text = line.trim().replaceAll("｜", "|");
  if (!text.includes("|")) return [];
  return text.replace(/^\|/u, "").replace(/(?<!\\)\|$/u, "").split(/(?<!\\)\|/u).map(cell => cell.replaceAll("\\|", "|").trim());
}

function isSeparator(line, count) {
  const parts = cells(line);
  return parts.length === count && parts.every(cell => divider.test(cell));
}

export function readAnswerTable(lines, start) {
  const headers = cells(lines[start]);
  if (headers.length < 2 || headers.some(h => !h)) return null;
  let position = start + 1;
  while (position < lines.length && !lines[position].trim()) position++;
  if (!isSeparator(lines[position], headers.length)) return null;
  const rows = [];
  let end = ++position;
  while (position < lines.length) {
    if (!lines[position].trim()) { position++; continue; }
    const row = cells(lines[position]);
    if (row.length !== headers.length) break;
    let next = position + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    if (isSeparator(lines[next], headers.length)) break;
    rows.push(row);
    end = ++position;
  }
  return rows.length ? { headers, rows, end } : null;
}

function metricValue(cell) {
  const text = plain(cell).replaceAll("，", ",");
  if (/^(?:|[-—–]|N\/A)$/iu.test(text)) return null;
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|％|场|局)?$/u.exec(text);
  if (!match) return false;
  const value = Number(match[1].replaceAll(",", "") + (match[2] ?? ""));
  const percent = /[%％]/u.test(match[3] ?? "");
  return Number.isFinite(value) && (!percent || value <= 100) ? { value, percent } : false;
}

function measure(header, values) {
  const present = values.filter(value => value !== null);
  if (!present.length || present.some(v => !v || v.percent !== present[0].percent)) return null;
  const placement = /均名|平均名次|平均排名|avg\.?\s*(?:place|placement)|average placement/iu.test(header);
  const ascending = placement || /^(?:排名|名次|rank|#)$/iu.test(plain(header));
  const largest = present.reduce((max, entry) => Math.max(max, entry.value), 0);
  return { ascending, placement, max: present[0].percent ? 100 : Math.max(placement ? 8 : 1, largest) };
}

export function renderAnswerTable({ headers, rows }, inlineHtml) {
  const values = headers.map((_, i) => rows.map(row => metricValue(row[i])));
  const measures = headers.map((h, i) => measure(h, values[i]));
  let label = headers.findIndex((h, i) => !measures[i] && (compHeader.test(h) || itemHeader.test(h) || unitHeader.test(h) || traitHeader.test(h)));
  if (label < 0) label = headers.findIndex((_, i) => !measures[i]);
  const metrics = headers.map((name, index) => ({ name: plain(name), index })).filter(({ index }) => measures[index]);
  const chart = rows.length > 0 && label >= 0 && metrics.length > 0;
  const initial = metrics.find(m => measures[m.index].placement)?.index ?? metrics[0]?.index;
  const zh = headers.some(h => /\p{Script=Han}/u.test(h));
  const title = chart ? (zh ? plain(headers[label]) + "对比" : plain(headers[label]) + " comparison") : (zh ? "数据表" : "Data table");
  const toolbar = chart ? `<div class="answer-comparison__toolbar"><label>${zh ? "排序" : "Sort"} <select data-sort-field><option value="">${zh ? "原始顺序" : "Original order"}</option>${metrics.map(m => `<option value="${m.index}" data-direction="${measures[m.index].ascending ? "asc" : "desc"}">${escape(m.name)}</option>`).join("")}</select></label><button class="answer-comparison__direction" type="button" data-sort-direction disabled aria-label="${zh ? "切换排序方向" : "Reverse order"}">↕</button></div>` : "";
  const portraitType = compHeader.test(headers[label])
    ? "comp"
    : itemHeader.test(headers[label])
      ? "item"
      : unitHeader.test(headers[label])
        ? "unit"
        : traitHeader.test(headers[label])
          ? "trait"
          : "";
  const column = index => `data-column="${index}"${index === label ? " data-label" : ""}${index === initial ? " data-plotted" : ""}`;
  const head = headers.map((h,i) => `<th scope="col" ${column(i)}>${inlineHtml(h)}</th>`).join("");
  const body = rows.map((row, r) => `<tr data-original="${r}">${row.map((value, i) => {
    if (i === label) {
      const names = portraitType === "item" ? plain(value).split(/\s*[+＋、]\s*/u).filter(Boolean) : [plain(value)];
      const portrait = chart && portraitType ? names.map(name => `<span class="answer-comparison__portrait" data-${portraitType}-portrait="${escape(name)}" aria-hidden="true"></span>`).join("") : "";
      return `<th scope="row" ${column(i)}><span class="answer-comparison__name">${portrait}<span>${inlineHtml(value)}</span></span></th>`;
    }
    const number = measures[i] && values[i][r];
    const bar = chart && number ? `<meter aria-hidden="true" min="0" max="${measures[i].max}" value="${number.value}"></meter>` : "";
    return `<td ${column(i)}${number ? ` data-number="${number.value}"` : ""}><span class="answer-comparison__cell">${bar}<span>${inlineHtml(value)}</span></span></td>`;
  }).join("")}</tr>`).join("");
  return `<section class="answer-comparison" data-view="${chart ? "chart" : "table"}" data-initial="${initial ?? ""}" data-lang="${zh ? "zh" : "en"}"><div class="answer-comparison__heading"><strong>${escape(title)}</strong>${toolbar}</div><div class="answer-comparison__scroll" role="region" aria-label="${escape(title)}" tabindex="0"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function sortComparison(card, reverse) {
  const select = card.querySelector("[data-sort-field]");
  const index = select.value;
  const directionButton = card.querySelector("[data-sort-direction]");
  const ascending = reverse ? directionButton.dataset.direction === "desc" : select.selectedOptions[0].dataset.direction === "asc";
  directionButton.disabled = !index;
  directionButton.dataset.direction = ascending ? "asc" : "desc";
  directionButton.textContent = !index ? "↕" : ascending ? "↑" : "↓";
  directionButton.setAttribute("aria-label", card.dataset.lang === "zh" ? (ascending ? "升序，切换为降序" : "降序，切换为升序") : (ascending ? "Ascending, switch to descending" : "Descending, switch to ascending"));
  const plotted = index || card.dataset.initial;
  for (const cell of card.querySelectorAll("[data-column]")) {
    cell.toggleAttribute("data-plotted", cell.dataset.column === plotted);
    if (cell.scope === "col") {
      if (index && cell.dataset.column === index) cell.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      else cell.removeAttribute("aria-sort");
    }
  }
  const body = card.querySelector("tbody");
  const rows = [...body.rows];
  rows.sort((left, right) => {
    const original = Number(left.dataset.original) - Number(right.dataset.original);
    if (!index) return original;
    const a = left.cells[index].dataset.number, b = right.cells[index].dataset.number;
    if (a == null || b == null) return Number(a == null) - Number(b == null) || original;
    return (ascending ? Number(a) - Number(b) : Number(b) - Number(a)) || original;
  });
  body.append(...rows);
}

const portraitCatalogs = new Map();
const normalizeName = name => String(name ?? "").normalize("NFKC").toLowerCase().replace(/[\s·•/（）()_-]/gu, "");
export function catalogEntries(season, type) {
  const key = season + ":" + type;
  if (!portraitCatalogs.has(key)) {
    const params = new URLSearchParams({ type, seasonContextId: season, limit: "200" });
    const url = type === "item" ? "/api/item-icons?" + new URLSearchParams({ seasonContextId: season }) : "/api/entity-catalog?" + params;
    portraitCatalogs.set(key, fetch(url).then(async response => {
      if (!response.ok) throw Error("catalog unavailable");
      const payload = await response.json();
      if (payload.seasonContext?.id !== season || !Array.isArray(payload.items)) throw Error("catalog scope mismatch");
      return payload.items;
    }).catch(() => { portraitCatalogs.delete(key); return []; }));
  }
  return portraitCatalogs.get(key);
}

export function namedChartUnit(compName, units) {
  const pieces = compName.split(/[·•｜|：:＋+]/u).map(normalizeName).filter(Boolean);
  // Composition names commonly end in the carry. Resolve exact names before
  // suffixes so a shorter alias cannot displace a fully named champion.
  for (const piece of pieces.reverse()) {
    const names = unit => {
      const en = unit.enName?.replace(/\d+$/u, "");
      return [unit.name, unit.zhName, en, normalizeName(en) === "ezreal" ? "EZ" : "", ...(unit.aliases ?? [])].filter(Boolean).map(normalizeName);
    };
    let candidates = units.filter(unit => names(unit).includes(piece));
    if (!candidates.length) candidates = units.filter(unit => names(unit).some(name => name.length >= 2 && piece.endsWith(name)));
    if (candidates.length > 1) {
      const comp = normalizeName(compName).replace("真伤", "真实伤害");
      candidates = candidates.filter(unit => [...(unit.traitNames ?? []), ...(unit.traitNamesEn ?? [])]
        .some(trait => comp.includes(normalizeName(trait).replace(/\d+$/u, ""))));
    }
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

function showPortrait(slot, entry) {
  if (!entry?.iconUrl) return false;
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.title = entry.name ?? entry.zhName ?? "";
  let fallback = entry.fallbackIconUrl;
  img.addEventListener("error", () => {
    if (fallback && img.src !== fallback) { img.src = fallback; fallback = null; }
    else img.remove();
  });
  slot.replaceChildren(img);
  img.src = entry.iconUrl;
  return true;
}

export function namedChartItem(name, items) {
  const key = normalizeName(name);
  if (!key) return null;
  const exact = items.filter(item => [item.name, item.apiName, item.zhName, item.enName].some(value => normalizeName(value) === key));
  const matches = exact.length ? exact : items.filter(item => item.aliases?.some(alias => normalizeName(alias) === key));
  return matches.length && matches.every(item => item.apiName === matches[0].apiName) ? matches[0] : null;
}

async function hydrateItemPortraits(record, slots) {
  const data = record.data;
  const items = [...(data.itemRankings ?? []), ...(data.itemPerformance?.topRankings ?? []), data.itemPerformance?.item,
    data.item, ...(data.coreItemSummary?.items ?? []), ...(data.cards ?? []).flatMap(card => card.items ?? [])].filter(item => item?.iconUrl && item.apiName);
  const remaining = slots.filter(slot => !showPortrait(slot, namedChartItem(slot.dataset.itemPortrait, items)));
  if (!remaining.length) return;
  const catalog = await catalogEntries(record.seasonContextId, "item");
  for (const slot of remaining) {
    if (slot.isConnected) showPortrait(slot, namedChartItem(slot.dataset.itemPortrait, catalog));
  }
}

export async function hydrateComparisonPortraits(record) {
  if (!record.seasonContextId) return;
  const itemSlots = [...record.target.querySelectorAll("[data-item-portrait]")];
  if (itemSlots.length) await hydrateItemPortraits(record, itemSlots);
  const unitSlots = [...record.target.querySelectorAll("[data-unit-portrait]")];
  if (unitSlots.length) {
    const units = await catalogEntries(record.seasonContextId, "unit");
    for (const slot of unitSlots) {
      if (slot.isConnected) showPortrait(slot, namedChartUnit(slot.dataset.unitPortrait, units));
    }
  }
  const traitSlots = [...record.target.querySelectorAll("[data-trait-portrait]")];
  if (traitSlots.length) {
    const traits = await catalogEntries(record.seasonContextId, "trait");
    for (const slot of traitSlots) {
      if (slot.isConnected) showPortrait(slot, namedChartItem(slot.dataset.traitPortrait, traits));
    }
  }
  const slots = [...record.target.querySelectorAll("[data-comp-portrait]")];
  if (!slots.length) return;
  const groups = [record.data, ...(record.data.compositionResultGroups ?? []).map(group => group.result)];
  const comps = groups.flatMap(group => Object.values(group?.rankings ?? {}).flat());
  const remaining = slots.filter(slot => {
    const name = slot.dataset.compPortrait;
    const comp = comps.find(entry => normalizeName(entry.name) === normalizeName(name));
    const units = comp?.units ?? [];
    return !showPortrait(slot, namedChartUnit(name, units) ?? units.find(unit => unit.core && unit.iconUrl));
  });
  if (!remaining.length) return;
  const units = await catalogEntries(record.seasonContextId, "unit");
  const unresolved = remaining.filter(slot => slot.isConnected && !showPortrait(slot, namedChartUnit(slot.dataset.compPortrait, units)));
  if (!unresolved.length) return;
  const traits = await catalogEntries(record.seasonContextId, "trait");
  for (const slot of unresolved) {
    if (slot.isConnected) showPortrait(slot, namedChartUnit(slot.dataset.compPortrait, traits));
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("change", event => {
    if (event.target.matches(".answer-comparison [data-sort-field]")) sortComparison(event.target.closest(".answer-comparison"), false);
  });
  document.addEventListener("click", event => {
    const button = event.target.closest?.(".answer-comparison button");
    if (!button) return;
    const card = button.closest(".answer-comparison");
    if (button.hasAttribute("data-sort-direction")) sortComparison(card, true);
  });
}
