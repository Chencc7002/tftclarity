const key = text => String(text ?? "").normalize("NFKC").toLowerCase().replace(/[\s·•_-]/gu, "");

function searchTerms(unit) {
  const cost = Number(unit.cost);
  return [unit.name, unit.zhName, unit.enName, unit.apiName, ...(unit.searchAliases ?? []),
    ...(unit.traitNamesZh ?? []), ...(unit.traitNamesEn ?? []), ...(unit.traitNames ?? []),
    cost && String(cost), cost && cost + "费", cost && "一二三四五六七八九"[cost - 1] + "费", cost && cost + "cost"
  ].filter(Boolean).map(key);
}

export function attachChampionPicker(input, { season, load, name, locale, t }) {
  const listeners = new AbortController();
  const listen = (el, event, fn, options = {}) => el.addEventListener(event, fn, { ...options, signal: listeners.signal });
  const label = input.closest("label");
  input.id = "quick-champion-input";
  label.htmlFor = input.id;
  const field = document.createElement("div");
  field.className = "quick-champion-field";
  label.replaceWith(field);
  field.append(label);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "quick-champion-toggle";
  toggle.tabIndex = -1;
  toggle.setAttribute("aria-label", t("championList"));
  field.append(toggle);
  const list = document.createElement("div");
  list.id = "quick-champion-list";
  list.className = "quick-champion-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("championList"));
  list.hidden = true;
  document.body.append(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  for (const el of [input, toggle]) {
    el.setAttribute("aria-controls", list.id);
    el.setAttribute("aria-expanded", "false");
  }
  let entries = [], matches = [], index = -1, version = 0, status = "";
  const expanded = value => {
    list.hidden = !value;
    for (const el of [toggle, input]) el.setAttribute("aria-expanded", String(value));
  };
  function close() {
    version++;
    expanded(false);
    input.removeAttribute("aria-activedescendant");
    index = -1;
  }
  function position() {
    if (list.hidden) return;
    const box = input.getBoundingClientRect(), viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0, bottom = top + (viewport?.height ?? innerHeight);
    const below = bottom - box.bottom - 8, above = box.top - top - 8;
    const up = below < 190 && above > below;
    list.style.width = box.width + "px";
    list.style.left = box.left + "px";
    list.style.maxHeight = Math.min(288, Math.max(40, up ? above : below)) + "px";
    list.style.top = (up ? box.top - list.offsetHeight - 4 : box.bottom + 4) + "px";
  }
  function render() {
    const query = input.dataset.championId ? "" : key(input.value);
    const cost = /^([1-9])(?:费|cost)?$/u.exec(query);
    matches = entries.filter(({ unit, terms }) => cost ? Number(unit.cost) === Number(cost[1]) : terms.some(term => term.includes(query)));
    index = -1;
    input.removeAttribute("aria-activedescendant");
    list.replaceChildren();
    list.scrollTop = 0;
    if (!matches.length) {
      const message = document.createElement("div");
      message.className = "quick-champion-message";
      message.setAttribute("role","status");
      message.textContent = t(status || "championNoMatch");
      list.append(message);
    }
    const fragment = document.createDocumentFragment();
    matches.forEach(({ unit }, i) => {
      const row = document.createElement("div");
      row.id = list.id + "-" + i;
      row.dataset.index = String(i);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      const portrait = document.createElement("span");
      portrait.className = "quick-champion-portrait";
      portrait.textContent = name(unit).slice(0, 1);
      if (unit.iconUrl) {
        const img = document.createElement("img");
        img.loading = "lazy"; img.alt = ""; img.src = unit.iconUrl;
        img.onerror = () => img.remove();
        portrait.append(img);
      }
      const title = document.createElement("strong"), meta = document.createElement("small");
      title.textContent = name(unit);
      const en = locale() === "en-US";
      const traits = (en ? unit.traitNamesEn : unit.traitNamesZh) ?? unit.traitNames ?? [];
      meta.textContent = [unit.cost && unit.cost + (en ? " cost" : "费"), ...traits].filter(Boolean).join(" · ");
      row.append(portrait,title,meta);
      fragment.append(row);
    });
    list.append(fragment);
    position();
  }
  async function open() {
    if (!list.hidden) return;
    const request = ++version, scope = season();
    entries = []; status = "championLoading"; expanded(true); render();
    let units;
    try { units = scope ? await load(scope) : []; } catch { units = []; }
    if (request !== version || !input.isConnected || season() !== scope) return;
    entries = units.map(unit => ({ unit, terms: searchTerms(unit) }));
    status = units.length ? "" : "championUnavailable";
    render();
  }
  function pick(i) {
    const unit = matches[i]?.unit;
    if (!unit) return;
    input.value = name(unit);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dataset.championId = unit.queryApiName || unit.apiName;
    input.focus({ preventScroll:true });
    close();
  }
  listen(input, "focus", open);
  listen(input, "click", open);
  listen(input, "input", () => {
    delete input.dataset.championId;
    if (list.hidden) void open(); else render();
  });
  listen(toggle, "mousedown", e => e.preventDefault());
  listen(toggle, "click", () => {
    if (!list.hidden) return close();
    input.focus(); void open();
  });
  listen(list, "mousedown", e => e.preventDefault());
  listen(list, "click", e => {
    const row = e.target.closest("[data-index]");
    if (row) pick(Number(row.dataset.index));
  });
  listen(input, "keydown", e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape" && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Enter" && !list.hidden && index >= 0) { e.preventDefault(); pick(index); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (list.hidden) { void open(); return; }
    if (!matches.length) return;
    list.children[index]?.setAttribute("aria-selected","false");
    index = e.key === "ArrowDown" ? Math.min(matches.length-1,index+1) : index < 0 ? matches.length-1 : Math.max(0,index-1);
    const row = list.children[index];
    row.setAttribute("aria-selected","true");
    input.setAttribute("aria-activedescendant",row.id);
    row.scrollIntoView({block:"nearest"});
  });
  listen(document, "pointerdown", e => { if (!field.contains(e.target) && !list.contains(e.target)) close(); });
  listen(document, "focusin", e => { if (!field.contains(e.target) && !list.contains(e.target)) close(); });
  listen(window, "scroll", e => { if (!list.contains(e.target instanceof Node ? e.target : null)) position(); }, { capture:true, passive:true });
  listen(window, "resize", position);
  if (window.visualViewport) {
    listen(window.visualViewport, "resize", position);
    listen(window.visualViewport, "scroll", position);
  }
  return () => { close(); listeners.abort(); list.remove(); };
}
