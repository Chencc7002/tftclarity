import { createToolPreferences, QUICK_TOOL_STORAGE_KEY, recommendQuickTools } from "./quick-tool-preferences.js";

export function setupToolMenu({ button, menu, anchor, root = document }) {
  if (!button || !menu || !anchor) return { close() {} };
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  function close({ restoreFocus = false } = {}) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  }
  function open(last = false) {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    (last ? items().at(-1) : items()[0])?.focus();
  }
  button.addEventListener("click", () => {
    if (menu.hidden) open();
    else close({ restoreFocus: true });
  });
  button.addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) button.click();
      return;
    }
    if (!menu.hidden || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    open(event.key === "ArrowUp");
  });
  root.addEventListener("pointerdown", event => {
    if (!menu.hidden && !anchor.contains(event.target)) close();
  });
  root.addEventListener("focusin", event => {
    if (!menu.hidden && !anchor.contains(event.target)) close();
  });
  root.addEventListener("keydown", event => {
    if (menu.hidden || !anchor.contains(event.target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
    } else if (event.key === "Tab") {
      // Restore the trigger so normal tab navigation continues into the composer.
      close({ restoreFocus: true });
    } else if (["Enter", " "].includes(event.key) && items().includes(root.activeElement)) {
      event.preventDefault();
      if (!event.repeat) root.activeElement.click();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const entries = items();
      const current = entries.indexOf(root.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
      entries[next]?.focus();
    }
  });
  return { close };
}

export function createQuickToolLibrary({ tasks, categories, t, escapeHtml: escape, launch, isRunning, storage = () => window.localStorage, now = Date.now }) {
  const preferences = createToolPreferences({ ids: tasks().map(task => task.id), storage, now });
  const dialog = document.querySelector("#tool-library");
  const search = dialog.querySelector("input");
  const list = dialog.querySelector("[data-tool-list]");
  const filters = dialog.querySelector("[data-tool-filters]");
  const reminder = document.querySelector("#tool-reminder");
  const recommendationToggle = dialog.querySelector("#tool-recommendations-toggle");
  const toolMenu = setupToolMenu({ button: document.querySelector("#tool-menu-toggle"), menu: document.querySelector("#tool-menu"), anchor: document.querySelector("#composer-tool-anchor") });
  let view = "all";
  let category = "all";
  let recommendedIds = [];
  let reminderId = null;

  function favoriteButton(task, saved) {
    const label = t(saved ? "toolRemoveFavorite" : "toolAddFavorite", { name: t(task.titleKey) });
    return `<button type="button" class="tool-favorite" data-favorite-tool="${escape(task.id)}" aria-pressed="${saved}" aria-label="${escape(label)}" title="${escape(label)}"><span aria-hidden="true">${saved ? "★" : "☆"}</span></button>`;
  }

  function card(task, { compact = false } = {}) {
    const saved = preferences.snapshot().favorites.includes(task.id);
    return `<div class="tool-card">
      <button type="button" class="quick-task-card" data-quick-task="${escape(task.id)}"${isRunning() ? " disabled" : ""}>
        ${compact ? "" : `<span class="quick-task-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${task.icon}</svg></span>`}
        <span class="quick-task-copy"><strong>${escape(t(task.titleKey))}</strong>${compact ? "" : `<small>${escape(t(task.bodyKey))}</small><span class="quick-task-example">${escape(t(task.exampleKey))}</span>`}</span>
      </button>${favoriteButton(task, saved)}
    </div>`;
  }

  function welcomeHtml({ reshuffle = true } = {}) {
    if (preferences.snapshot().recommendationsHidden) return '<section class="quick-tasks tool-recommendations" hidden></section>';
    if (reshuffle || !recommendedIds.length) recommendedIds = recommendQuickTools(tasks(), preferences.snapshot(), { previous: recommendedIds });
    const selected = recommendedIds.map(id => tasks().find(task => task.id === id)).filter(Boolean);
    return `<section class="quick-tasks tool-recommendations" aria-label="${escape(t("toolRecommendations"))}">
      <div class="quick-tasks-heading"><strong>${escape(t("toolTryThese"))}</strong><div class="tool-recommendation-actions"><button type="button" class="tool-recommendations-shuffle" data-shuffle-tools><span aria-hidden="true">↻</span>${escape(t("toolShuffle"))}</button><button type="button" class="tool-recommendations-close" data-hide-recommendations aria-label="${escape(t("toolHideRecommendations"))}" title="${escape(t("toolHideRecommendations"))}"><span aria-hidden="true">×</span></button></div></div>
      <div class="quick-task-list">${selected.map(task => card(task, { compact: true })).join("")}</div>
    </section>`;
  }

  function renderLibrary() {
    dialog.querySelector("h2").textContent = t(view === "all" ? "toolAll" : "toolFavorites");
    dialog.querySelectorAll("[data-tool-view]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.toolView === view));
    });
    const snapshot = preferences.snapshot();
    if (recommendationToggle) recommendationToggle.checked = !snapshot.recommendationsHidden;
    const needle = search.value.trim().normalize("NFKC").toLocaleLowerCase();
    const available = tasks().filter(task => view === "all" || snapshot.favorites.includes(task.id));
    filters.innerHTML = [{ id: "all", titleKey: "toolAllCategories" }, ...categories].map(entry => `<button type="button" data-tool-category="${escape(entry.id)}" aria-pressed="${category === entry.id}">${escape(t(entry.titleKey))}<span>${entry.id === "all" ? available.length : available.filter(task => task.category === entry.id).length}</span></button>`).join("");
    const matches = available.filter(task => (category === "all" || category === task.category) && (!needle || [task.titleKey, task.bodyKey, task.exampleKey].map(key => t(key)).join(" ").normalize("NFKC").toLocaleLowerCase().includes(needle)));
    list.innerHTML = matches.length ? matches.map(task => card(task)).join("") : `<div class="tool-library-empty"><span aria-hidden="true">${view === "favorites" && !available.length ? "☆" : "⌕"}</span><strong>${escape(t(view === "favorites" && !available.length ? "toolFavoritesEmpty" : "toolSearchEmpty"))}</strong><p>${escape(t(view === "favorites" && !available.length ? "toolFavoritesEmptyHint" : "toolSearchEmptyHint"))}</p>${view === "favorites" && !available.length ? `<button type="button" class="subtle-button" data-tool-view="all">${escape(t("toolBrowseAll"))}</button>` : ""}</div>`;
    dialog.querySelector("[data-tool-count]").textContent = t("toolCount", { count: matches.length });
    dialog.querySelector("[data-tool-storage]").textContent = t(snapshot.persistent ? "toolStorageHint" : "toolStorageUnavailable");
  }

  function syncFavorites() {
    const snapshot = preferences.snapshot();
    document.querySelectorAll("[data-favorites-count]").forEach(node => { node.textContent = snapshot.favorites.length; });
    document.querySelectorAll("[data-favorite-tool]").forEach(button => {
      const task = tasks().find(task => task.id === button.dataset.favoriteTool);
      if (!task) return;
      const saved = snapshot.favorites.includes(task.id);
      const label = t(saved ? "toolRemoveFavorite" : "toolAddFavorite", { name: t(task.titleKey) });
      button.setAttribute("aria-pressed", String(saved));
      button.setAttribute("aria-label", label);
      button.title = label;
      button.querySelector("span").textContent = saved ? "★" : "☆";
    });
    if (reminderId && snapshot.favorites.includes(reminderId)) hideReminder();
  }

  function hideReminder() {
    reminderId = null;
    reminder.hidden = true;
    reminder.replaceChildren();
  }

  function renderReminder() {
    const task = tasks().find(task => task.id === reminderId);
    if (!task) return hideReminder();
    reminder.hidden = false;
    reminder.innerHTML = `<p role="status">${escape(t("toolReminderText", { name: t(task.titleKey) }))}</p><div><button type="button" data-tool-reminder="save">${escape(t("toolSave"))}</button><button type="button" data-tool-reminder="later">${escape(t("toolLater"))}</button><button type="button" data-tool-reminder="never">${escape(t("toolNever"))}</button></div>`;
  }

  function open(nextView) {
    toolMenu.close({ restoreFocus: true });
    view = nextView === "favorites" ? "favorites" : "all";
    category = "all";
    search.value = "";
    renderLibrary();
    dialog.showModal();
    search.focus();
  }

  function announce(message) {
    document.querySelector("#tool-library-status").textContent = message;
  }

  function setRecommendationsHidden(hidden) {
    const snapshot = preferences.setRecommendationsHidden(hidden);
    const section = document.querySelector(".tool-recommendations");
    if (section) section.outerHTML = welcomeHtml({ reshuffle: false });
    if (dialog.open) renderLibrary();
    announce(t(!snapshot.persistent ? "toolStorageUnavailable" : hidden ? "toolRecommendationsHidden" : "toolRecommendationsShown"));
  }

  function toggleFavorite(id) {
    const snapshot = preferences.toggleFavorite(id);
    syncFavorites();
    if (dialog.open) {
      renderLibrary();
      const button = [...list.querySelectorAll("[data-favorite-tool]")].find(node => node.dataset.favoriteTool === id);
      (button ?? search).focus();
    }
    announce(t(snapshot.persistent ? (snapshot.favorites.includes(id) ? "toolSaved" : "toolRemoved") : "toolStorageUnavailable"));
  }

  document.addEventListener("click", async event => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-open-tools]")) return open(target.dataset.openTools);
    if (target.matches("[data-close-tools]")) return dialog.close();
    if (target.matches("[data-favorite-tool]")) return toggleFavorite(target.dataset.favoriteTool);
    if (target.matches("[data-hide-recommendations]")) {
      setRecommendationsHidden(true);
      document.querySelector("#tool-menu-toggle")?.focus();
      return;
    }
    if (target.matches("[data-shuffle-tools]")) {
      const section = target.closest(".tool-recommendations");
      section.outerHTML = welcomeHtml();
      document.querySelector("[data-shuffle-tools]")?.focus();
      return;
    }
    if (target.matches("[data-tool-reminder]")) {
      if (target.dataset.toolReminder === "save") {
        if (!preferences.snapshot().favorites.includes(reminderId)) toggleFavorite(reminderId);
      } else preferences.dismissReminder(reminderId, target.dataset.toolReminder === "never");
      hideReminder();
      return;
    }
    if (!dialog.contains(target)) return;
    if (target.matches("[data-tool-view]")) {
      view = target.dataset.toolView;
      category = "all";
      search.value = "";
      renderLibrary();
      return;
    }
    if (target.matches("[data-tool-category]")) {
      category = target.dataset.toolCategory;
      renderLibrary();
      [...filters.querySelectorAll("button")].find(button => button.dataset.toolCategory === category)?.focus();
      return;
    }
    if (target.matches("[data-quick-task]") && !isRunning()) {
      dialog.close();
      await launch(target.dataset.quickTask);
    }
  });
  search.addEventListener("input", renderLibrary);
  recommendationToggle?.addEventListener("change", () => setRecommendationsHidden(!recommendationToggle.checked));
  window.addEventListener("storage", event => {
    if (event.key === QUICK_TOOL_STORAGE_KEY || event.key === null) {
      syncFavorites();
      const section = document.querySelector(".tool-recommendations");
      if (section) section.outerHTML = welcomeHtml({ reshuffle: false });
      if (dialog.open) renderLibrary();
    }
  });
  syncFavorites();
  return {
    welcomeHtml,
    recordUse(id) {
      preferences.recordUse(id);
      if (!reminderId && preferences.claimReminder(id)) {
        reminderId = id;
        renderReminder();
      }
    },
    reset() { hideReminder(); toolMenu.close(); },
    refreshLocale() {
      const section = document.querySelector(".tool-recommendations");
      if (section) section.outerHTML = welcomeHtml({ reshuffle: false });
      syncFavorites();
      if (dialog.open) renderLibrary();
      if (reminderId) renderReminder();
    }
  };
}
