const divider = /^:?-{2,}:?$/u;
const escape = value => String(value).replace(/[&<>"']/gu, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const plain = value => value.replaceAll("**", "").trim();

function cells(line = "") {
  const text = line.trim();
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
  const label = headers.findIndex((_, i) => !measures[i]);
  const metrics = headers.map((name, index) => ({ name: plain(name), index })).filter(({ index }) => measures[index]);
  const chart = rows.length >= 2 && label >= 0 && metrics.length > 0;
  const initial = metrics.find(m => measures[m.index].placement)?.index ?? metrics[0]?.index;
  const zh = headers.some(h => /\p{Script=Han}/u.test(h));
  const title = chart ? (zh ? plain(headers[label]) + "对比" : plain(headers[label]) + " comparison") : (zh ? "数据表" : "Data table");
  const toolbar = chart ? `<div class="answer-comparison__toolbar"><div class="answer-comparison__views" role="group" aria-label="${zh ? "显示方式" : "View"}"><button type="button" data-view-button="chart" aria-pressed="true">${zh ? "图表" : "Chart"}</button><button type="button" data-view-button="table" aria-pressed="false">${zh ? "表格" : "Table"}</button></div><label>${zh ? "排序" : "Sort"} <select data-sort-field><option value="">${zh ? "原始顺序" : "Original order"}</option>${metrics.map(m => `<option value="${m.index}" data-direction="${measures[m.index].ascending ? "asc" : "desc"}">${escape(m.name)}</option>`).join("")}</select></label><button class="answer-comparison__direction" type="button" data-sort-direction disabled aria-label="${zh ? "切换排序方向" : "Reverse order"}">↕</button></div>` : "";
  const column = index => `data-column="${index}"${index === label ? " data-label" : ""}${index === initial ? " data-plotted" : ""}`;
  const head = headers.map((h,i) => `<th scope="col" ${column(i)}>${inlineHtml(h)}</th>`).join("");
  const body = rows.map((row, r) => `<tr data-original="${r}">${row.map((value, i) => {
    if (i === label) return `<th scope="row" ${column(i)}>${inlineHtml(value)}</th>`;
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

if (typeof document !== "undefined") {
  document.addEventListener("change", event => {
    if (event.target.matches(".answer-comparison [data-sort-field]")) sortComparison(event.target.closest(".answer-comparison"), false);
  });
  document.addEventListener("click", event => {
    const button = event.target.closest?.(".answer-comparison button");
    if (!button) return;
    const card = button.closest(".answer-comparison");
    if (button.hasAttribute("data-sort-direction")) sortComparison(card, true);
    if (button.dataset.viewButton) {
      card.dataset.view = button.dataset.viewButton;
      for (const view of card.querySelectorAll("[data-view-button]")) view.setAttribute("aria-pressed", String(view === button));
    }
  });
}
