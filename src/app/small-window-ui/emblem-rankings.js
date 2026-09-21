export function filteredEmblems(rows, base, sort = "avg") {
  return rows.filter(row => base === "all" || (base === "craftable" ? Boolean(row.recipeBase) : row.recipeBase === base))
    .sort((a, b) => Number(a.lowSample) - Number(b.lowSample)
      || (sort === "top4" ? b.stats.top4Rate - a.stats.top4Rate
        : sort === "win" ? b.stats.winRate - a.stats.winRate
          : sort === "games" ? b.stats.games - a.stats.games : a.stats.avgPlacement - b.stats.avgPlacement)
      || b.stats.games - a.stats.games || a.item.apiName.localeCompare(b.item.apiName));
}

export function mountEmblemRankings({ root, data, t, escapeHtml: escape, itemPill, assetThumb, localizedName, loadCarriers }) {
  let base = data.query?.recipeBase ?? (data.query?.apiNames?.length ? "all" : "craftable");
  let sort = { avgPlacement: "avg", top4Rate: "top4", winRate: "win", games: "games" }[data.query?.primaryMetric] ?? "avg";
  const cached = new Map();
  const pending = new Map();
  const percent = value => `${(value * 100).toFixed(1)}%`;
  const number = value => Number(value).toLocaleString();
  const metric = (label, value) => `<div class="stat"><b>${escape(label)}</b><span>${escape(value)}</span></div>`;
  function buildsHtml(carrier, emblem) {
    const builds = (carrier.builds ?? []).filter(build => build.items?.length === 3
      && build.items.includes(emblem) && build.displayItems?.length === 3);
    return `<div class="emblem-carrier-builds"><span class="emblem-build-label">${escape(t("emblemCommonBuild"))}</span>${builds.length
      ? builds.map(build => `<div class="emblem-carrier-build"><div class="emblem-build-items">${build.displayItems.map(itemPill).join("")}</div><small>${escape(t("emblemBuildSamples"))} ${number(build.stats.games)} · ${escape(t("avg"))} ${build.stats.avgPlacement.toFixed(2)}</small></div>`).join("")
      : `<small>${escape(t("emblemNoBuild"))}</small>`}</div>`;
  }
  function carrierHtml(value) {
    return value.carriers?.length ? value.carriers.map(carrier => `<div class="emblem-carrier">
      ${assetThumb(carrier.unit?.iconUrl, localizedName(carrier.unit, carrier.unitApiName), "equipment-unit-icon", carrier.unit?.fallbackIconUrl)}
      <div class="emblem-carrier-info"><strong>${escape(localizedName(carrier.unit, carrier.unitApiName))}</strong><small>${escape(t("samples"))} ${number(carrier.stats.games)} · ${escape(t("avg"))} ${carrier.stats.avgPlacement.toFixed(2)}</small>${buildsHtml(carrier, value.item)}</div>
    </div>`).join("") : `<p class="detail-muted">${escape(t("emblemNoCarriers"))}</p>`;
  }
  function render() {
    const rows = filteredEmblems(data.rows ?? [], base, sort);
    root.innerHTML = `<section class="emblem-results">
      <div class="emblem-intro"><span class="emblem-eyebrow">${escape(t("emblemEyebrow"))}</span><h2>${escape(t("quickTaskEmblemsTitle"))}</h2><p>${escape(t("emblemIntro"))}</p></div>
      <div class="emblem-filters" role="group" aria-label="${escape(t("emblemRecipeFilter"))}">${["craftable", "spatula", "pan", "all"].map(value => `<button type="button" data-emblem-base="${value}" aria-pressed="${value === base}">${escape(t(`emblemBase_${value}`))}</button>`).join("")}</div>
      <div class="emblem-toolbar"><span>${escape(t("emblemCount", { count: rows.length }))}</span><label>${escape(t("emblemSort"))} <select data-emblem-sort>${["avg", "top4", "win", "games"].map(value => `<option value="${value}"${value === sort ? " selected" : ""}>${escape(t(`emblemSort_${value}`))}</option>`).join("")}</select></label></div>
      <p class="emblem-note">${escape(t("emblemScope"))}</p>
      ${rows.length ? rows.map((row, index) => `<article class="emblem-card${index === 0 && !row.lowSample ? " is-leading" : ""}">
        <div class="emblem-card-head"><span class="emblem-rank">${String(index + 1).padStart(2, "0")}</span>${itemPill(row.item)}${row.lowSample ? `<span class="emblem-low-sample">${escape(t("lowSample"))}</span>` : ""}</div>
        <div class="emblem-recipe">${row.recipeBase ? row.recipe.map(itemPill).join('<span class="recipe-plus">+</span>') : `<span>${escape(t(row.recipeStatus === "unknown" ? "emblemRecipeUnknown" : "notCraftable"))}</span>`}</div>
        <div class="stats">${metric(t("avg"), row.stats.avgPlacement.toFixed(2))}${metric(t("top4"), percent(row.stats.top4Rate))}${metric(t("win"), percent(row.stats.winRate))}${metric(t("samples"), number(row.stats.games))}</div>
        <details data-emblem-carriers="${escape(row.item.apiName)}"><summary>${escape(t("emblemCommonCarriers"))}<span>${escape(t("emblemByGames"))}</span></summary><div data-emblem-carrier-content>${cached.has(row.item.apiName) ? carrierHtml(cached.get(row.item.apiName)) : escape(t("emblemLoading"))}</div></details>
      </article>`).join("") : `<div class="empty-state"><strong>${escape(t("emblemEmpty"))}</strong><p>${escape(t("emblemEmptyHint"))}</p></div>`}
      <footer class="emblem-source"><a href="https://www.metatft.com/explorer?tab=items&amp;emblem_count=1-any" target="_blank" rel="noopener noreferrer">MetaTFT ↗</a><span>${escape(data.query?.patch ?? "")} · ${escape(t("emblemDays", { days: data.query?.days ?? 3 }))}</span><time datetime="${escape(data.updatedAt ?? "")}">${escape(new Date(data.updatedAt).toLocaleString())}</time></footer>
    </section>`;
    root.querySelectorAll("[data-emblem-base]").forEach(button => button.addEventListener("click", () => {
      base = button.dataset.emblemBase; render(); root.querySelector(`[data-emblem-base="${base}"]`)?.focus();
    }));
    root.querySelector("[data-emblem-sort]").addEventListener("change", event => {
      sort = event.target.value; render(); root.querySelector("[data-emblem-sort]")?.focus();
    });
    root.querySelectorAll("[data-emblem-carriers]").forEach(details => details.addEventListener("toggle", async () => {
      if (!details.open) return;
      const id = details.dataset.emblemCarriers;
      const content = details.querySelector("[data-emblem-carrier-content]");
      if (cached.has(id)) { content.innerHTML = carrierHtml(cached.get(id)); return; }
      try {
        if (!pending.has(id)) pending.set(id, loadCarriers(id).finally(() => pending.delete(id)));
        const result = await pending.get(id);
        cached.set(id, result);
        content.innerHTML = carrierHtml(result);
      } catch {
        content.textContent = t("emblemCarrierError");
      }
    }));
  }
  render();
}
