const state = {
  seasonContextId: "set17-live",
  aliases: [],
  profiles: [],
  bindings: [],
  currentComps: [],
  enrichment: null
};
const $ = (selector) => document.querySelector(selector);

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function notify(message) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.add("visible");
  window.setTimeout(() => notice.classList.remove("visible"), 2600);
}

function seasonQuery(extra = {}) {
  return new URLSearchParams({ seasonContextId: state.seasonContextId, ...extra }).toString();
}

async function loadSeasons() {
  const payload = await request("/api/season-contexts");
  const select = $("#season-context");
  select.replaceChildren(...payload.seasonContexts.map((context) => {
    const option = document.createElement("option");
    option.value = context.id;
    option.textContent = `${context.label}${context.status === "coming_soon" ? " · 数据准备中" : ""}`;
    option.disabled = !context.availability.available;
    option.selected = context.id === payload.defaultSeasonContextId;
    return option;
  }));
  state.seasonContextId = select.value;
}

async function loadAdminSeasons() {
  const payload = await request("/api/admin/seasons");
  $("#season-admin-cards").replaceChildren(...payload.seasonContexts.map((context) => {
    const card = document.createElement("article");
    card.className = "season-card";
    const title = document.createElement("strong");
    title.textContent = `${context.label}${context.isDefault ? " · 默认" : ""}`;
    const status = document.createElement("span");
    status.textContent = `状态 ${context.status} · ${context.availability.available ? "数据可用" : "数据不可用"}`;
    const source = document.createElement("span");
    source.textContent = `${context.source.provider} · queue ${context.source.queue} · patch ${context.source.effectivePatch}`;
    card.append(title, status, source);
    return card;
  }));
}

function resetForm() {
  $("#alias-form").reset();
  $("#alias-id").value = "";
  $("#alias-source").value = "admin";
  $("#alias-enabled").checked = true;
}

function renderAliases() {
  $("#alias-rows").replaceChildren(...state.aliases.map((alias) => {
    const row = document.createElement("tr");
    if (!alias.enabled) row.classList.add("disabled");
    const selectorCell = document.createElement("td");
    const selector = document.createElement("input");
    selector.type = "checkbox";
    selector.dataset.aliasSelect = alias.id;
    selectorCell.append(selector);
    row.append(selectorCell);
    const values = [alias.alias, alias.entityType, alias.apiName, alias.source, alias.enabled ? "已启用" : "已停用"];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 2) {
        const code = document.createElement("code");
        code.textContent = value;
        cell.append(code);
      } else cell.textContent = value;
      row.append(cell);
    });
    const actions = document.createElement("td");
    actions.className = "row-actions";
    for (const [label, action] of [["编辑", "edit"], [alias.enabled ? "停用" : "启用", "toggle"], ["删除", "delete"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.action = action;
      button.dataset.id = alias.id;
      actions.append(button);
    }
    row.append(actions);
    return row;
  }));
}

async function loadAliases() {
  const filters = {
    query: $("#alias-query").value,
    entityType: $("#filter-type").value,
    source: $("#filter-source").value,
    enabled: $("#filter-status").value,
    limit: "500"
  };
  Object.keys(filters).forEach((key) => { if (filters[key] === "") delete filters[key]; });
  state.aliases = (await request(`/api/admin/aliases?${seasonQuery(filters)}`)).aliases;
  renderAliases();
}

function aliasBody() {
  return {
    seasonContextId: state.seasonContextId,
    alias: $("#alias-value").value,
    entityType: $("#entity-type").value,
    apiName: $("#api-name").value,
    source: $("#alias-source").value,
    enabled: $("#alias-enabled").checked,
    confidence: 1
  };
}

function downloadJson(filename, payload) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function nullableRating(selector) {
  const value = $(selector).value;
  return value === "" ? null : Number(value);
}

function profileBody(profile = null) {
  return {
    seasonContextId: state.seasonContextId,
    profileKey: profile?.profileKey ?? $("#profile-key").value.trim(),
    enabled: profile?.enabled ?? $("#profile-enabled").checked,
    profile: {
      difficulty: profile ? profile.difficulty : nullableRating("#profile-difficulty"),
      beginnerFriendly: profile ? profile.beginnerFriendly : ($("#profile-beginner").value === "" ? null : $("#profile-beginner").value === "true"),
      pivotDifficulty: profile ? profile.pivotDifficulty : nullableRating("#profile-pivot"),
      positionDifficulty: profile ? profile.positionDifficulty : nullableRating("#profile-position"),
      contestTolerance: profile ? profile.contestTolerance : nullableRating("#profile-contest"),
      econDifficulty: profile ? profile.econDifficulty : nullableRating("#profile-econ"),
      notes: profile ? profile.notes : $("#profile-notes").value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    }
  };
}

function resetProfileForm() {
  $("#profile-form").reset();
  $("#profile-key").readOnly = false;
  $("#profile-enabled").checked = true;
}

function renderProfiles() {
  $("#profile-rows").replaceChildren(...state.profiles.map((profile) => {
    const row = document.createElement("tr");
    if (!profile.enabled) row.classList.add("disabled");
    const key = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = profile.profileKey;
    key.append(code);
    const ratings = document.createElement("td");
    ratings.textContent = `总体 ${profile.difficulty ?? "-"} · 转型 ${profile.pivotDifficulty ?? "-"} · 站位 ${profile.positionDifficulty ?? "-"} · 同行 ${profile.contestTolerance ?? "-"} · 经济 ${profile.econDifficulty ?? "-"} · 新手 ${profile.beginnerFriendly === null ? "-" : profile.beginnerFriendly ? "友好" : "不友好"}`;
    const notes = document.createElement("td");
    notes.textContent = (profile.notes ?? []).join("；") || "-";
    const status = document.createElement("td");
    status.textContent = `${profile.enabled ? "启用" : "停用"} · ${profile.source ?? "seed"}`;
    const actions = document.createElement("td");
    actions.className = "row-actions";
    for (const [action, label] of [["edit", "编辑"], ["toggle", profile.enabled ? "停用" : "启用"], ["delete", "删除"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.profileAction = action;
      button.dataset.profileKey = profile.profileKey;
      button.textContent = label;
      actions.append(button);
    }
    row.append(key, ratings, notes, status, actions);
    return row;
  }));

  const options = state.profiles.filter((profile) => profile.enabled).map((profile) => {
    const option = document.createElement("option");
    option.value = profile.profileKey;
    option.textContent = profile.profileKey;
    return option;
  });
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "请先新增并启用 Profile";
    options.push(option);
  }
  $("#binding-profile").replaceChildren(...options);
}

async function loadProfiles() {
  const payload = await request(`/api/admin/comp-profiles?${seasonQuery()}`);
  const overrides = new Map(payload.overrides.map((profile) => [profile.profileKey, profile]));
  state.profiles = [
    ...payload.profiles.filter((profile) => !overrides.has(profile.profileKey)),
    ...payload.overrides
  ].sort((left, right) => left.profileKey.localeCompare(right.profileKey));
  state.bindings = payload.bindings;
  renderProfiles();
}

function editProfile(profile) {
  $("#profile-key").value = profile.profileKey;
  $("#profile-key").readOnly = true;
  $("#profile-difficulty").value = profile.difficulty ?? "";
  $("#profile-pivot").value = profile.pivotDifficulty ?? "";
  $("#profile-position").value = profile.positionDifficulty ?? "";
  $("#profile-contest").value = profile.contestTolerance ?? "";
  $("#profile-econ").value = profile.econDifficulty ?? "";
  $("#profile-beginner").value = profile.beginnerFriendly === null ? "" : String(profile.beginnerFriendly);
  $("#profile-notes").value = (profile.notes ?? []).join("\n");
  $("#profile-enabled").checked = profile.enabled;
}

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const editing = $("#profile-key").readOnly;
  const body = profileBody();
  await request(editing ? `/api/admin/comp-profiles/${body.profileKey}` : "/api/admin/comp-profiles", {
    method: editing ? "PATCH" : "POST",
    body: JSON.stringify(body)
  });
  resetProfileForm();
  await Promise.all([loadProfiles(), loadAudit()]);
  notify("Comp Profile 已保存并立即生效");
});

$("#profile-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-profile-key]");
  if (!button) return;
  const profile = state.profiles.find((entry) => entry.profileKey === button.dataset.profileKey);
  if (!profile) return;
  if (button.dataset.profileAction === "edit") return editProfile(profile);
  if (button.dataset.profileAction === "delete") {
    if (!window.confirm(`删除 Profile“${profile.profileKey}”及其数据库绑定？`)) return;
    await request(`/api/admin/comp-profiles/${profile.profileKey}?${seasonQuery()}`, { method: "DELETE" });
  } else {
    await request(`/api/admin/comp-profiles/${profile.profileKey}`, {
      method: "PATCH",
      body: JSON.stringify(profileBody({ ...profile, enabled: !profile.enabled }))
    });
  }
  await Promise.all([loadProfiles(), loadAudit()]);
});

function renderCurrentComps() {
  $("#profile-coverage").textContent = state.enrichment
    ? `Profile 覆盖 ${state.enrichment.matched}/${state.enrichment.currentComps}（${(state.enrichment.coverage * 100).toFixed(1)}%），有效 Profile ${state.enrichment.profiles} 个。`
    : "尚未读取当前阵容。";
  $("#current-comp-rows").replaceChildren(...state.currentComps.map((comp) => {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    const clusterId = String(comp.source?.clusterId ?? comp.clusterId ?? "");
    identity.textContent = `${comp.name ?? comp.compId} · cluster ${clusterId}`;
    const strategy = document.createElement("td");
    strategy.className = "strategy-detail";
    const strategyName = document.createElement("strong");
    strategyName.textContent = comp.strategyDerivation?.strategy ?? comp.strategy ?? "-";
    const reason = document.createElement("small");
    reason.textContent = `${(comp.strategyDerivation?.reason ?? []).join("；")} · ${comp.strategyDerivation?.algorithmVersion ?? "-"} · 置信度 ${comp.strategyDerivation?.confidence ?? "-"}`;
    strategy.append(strategyName, reason);
    const signature = document.createElement("td");
    const signatureCode = document.createElement("code");
    signatureCode.className = "signature";
    signatureCode.title = comp.lineupSignature?.value ?? "";
    signatureCode.textContent = `${comp.lineupSignature?.version ?? "-"} · ${comp.lineupSignature?.value ?? "-"}`;
    signature.append(signatureCode);
    const binding = document.createElement("td");
    binding.textContent = `${comp.profileBinding?.status ?? "unmatched"}${comp.profileBinding?.profileKey ? ` · ${comp.profileBinding.profileKey}` : ""}${comp.profileBinding?.confidence !== null && comp.profileBinding?.confidence !== undefined ? ` · ${comp.profileBinding.confidence}` : ""}`;
    const actions = document.createElement("td");
    const bind = document.createElement("button");
    bind.type = "button";
    bind.dataset.bindCluster = clusterId;
    bind.textContent = comp.profileBinding?.status === "matched" ? "重新绑定" : "绑定";
    bind.disabled = !clusterId;
    actions.append(bind);
    row.append(identity, strategy, signature, binding, actions);
    return row;
  }));
  if (!state.currentComps.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "当前筛选条件下没有阵容。";
    row.append(cell);
    $("#current-comp-rows").replaceChildren(row);
  }
  const queue = state.enrichment?.reviewQueue ?? [];
  $("#profile-review-queue").replaceChildren(...(queue.length ? queue : [{ matchStatus: "empty", name: "当前没有待审核项" }]).map((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.matchStatus} · ${entry.name ?? entry.clusterId ?? "-"}${entry.profileKey ? ` · ${entry.profileKey}` : ""}`;
    return item;
  }));
}

async function loadCurrentComps(refresh = false) {
  const matchStatus = $("#profile-match-filter").value;
  const payload = await request(`/api/admin/comp-profiles/current-comps?${seasonQuery({
    ...(matchStatus ? { matchStatus } : {}),
    ...(refresh ? { refresh: "1" } : {})
  })}`);
  state.currentComps = payload.comps;
  state.enrichment = payload.enrichment;
  renderCurrentComps();
}

$("#current-comp-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-bind-cluster]");
  if (!button) return;
  const profileKey = $("#binding-profile").value;
  if (!profileKey) return notify("请先选择一个已启用 Profile");
  const payload = await request("/api/admin/comp-profiles/bind", {
    method: "POST",
    body: JSON.stringify({ seasonContextId: state.seasonContextId, profileKey, clusterId: button.dataset.bindCluster })
  });
  $("#profile-preview").textContent = JSON.stringify(payload.preview, null, 2);
  await Promise.all([loadProfiles(), loadCurrentComps(), loadAudit()]);
  notify("阵容绑定已按服务端当前 lineupSignature 验证并生效");
});

$("#load-current-comps").addEventListener("click", () => loadCurrentComps(true));
$("#profile-match-filter").addEventListener("change", () => loadCurrentComps());
$("#cancel-profile-edit").addEventListener("click", resetProfileForm);
$("#export-profiles").addEventListener("click", async () => downloadJson(
  `tftclarity-${state.seasonContextId}-profiles.json`,
  await request(`/api/admin/comp-profiles/export?${seasonQuery()}`)
));
$("#backup-profiles").addEventListener("click", async () => downloadJson(
  `tftclarity-${state.seasonContextId}-profile-backup.json`,
  await request(`/api/admin/comp-profiles/backup?${seasonQuery()}`)
));
$("#import-profiles").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  const profiles = Array.isArray(parsed) ? parsed : parsed.profiles;
  const payload = await request("/api/admin/comp-profiles/import", {
    method: "POST",
    body: JSON.stringify({ seasonContextId: state.seasonContextId, profiles })
  });
  await Promise.all([loadProfiles(), loadAudit()]);
  notify(`已导入 ${payload.imported} 个 Comp Profile`);
});

$("#alias-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#alias-id").value;
  await request(id ? `/api/admin/aliases/${id}` : "/api/admin/aliases", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(aliasBody())
  });
  resetForm();
  await loadAliases();
  notify(id ? "别名已更新并即时生效" : "别名已新增并即时生效");
});

$("#alias-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const alias = state.aliases.find((entry) => String(entry.id) === button.dataset.id);
  if (button.dataset.action === "edit") {
    $("#alias-id").value = alias.id;
    $("#alias-value").value = alias.alias;
    $("#entity-type").value = alias.entityType;
    $("#api-name").value = alias.apiName;
    $("#alias-source").value = alias.source;
    $("#alias-enabled").checked = alias.enabled;
    return;
  }
  if (button.dataset.action === "delete") {
    if (!window.confirm(`删除俗称“${alias.alias}”？`)) return;
    await request(`/api/admin/aliases/${alias.id}?${seasonQuery()}`, { method: "DELETE" });
  } else {
    await request(`/api/admin/aliases/${alias.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...alias, seasonContextId: state.seasonContextId, enabled: !alias.enabled })
    });
  }
  await loadAliases();
});

$("#match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = await request("/api/admin/aliases/match", {
    method: "POST",
    body: JSON.stringify({ seasonContextId: state.seasonContextId, input: $("#match-input").value })
  });
  $("#match-result").textContent = payload.matched
    ? payload.matches.map((match) => `${match.alias} → ${match.apiName}`).join("；")
    : "未命中任何已启用数据库别名";
});

$("#import-aliases").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  const aliases = Array.isArray(parsed) ? parsed : parsed.aliases;
  const result = await request("/api/admin/aliases/import", {
    method: "POST",
    body: JSON.stringify({ seasonContextId: state.seasonContextId, aliases })
  });
  await loadAliases();
  notify(`已导入 ${result.imported} 条别名`);
});

$("#export-aliases").addEventListener("click", async () => downloadJson(
  `tftclarity-${state.seasonContextId}-aliases.json`,
  await request(`/api/admin/aliases/export?${seasonQuery()}`)
));
$("#backup-aliases").addEventListener("click", async () => downloadJson(
  `tftclarity-${state.seasonContextId}-alias-backup.json`,
  await request(`/api/admin/aliases/backup?${seasonQuery()}`)
));

async function reviewSelected(enabled) {
  const ids = [...document.querySelectorAll("[data-alias-select]:checked")].map((input) => Number(input.dataset.aliasSelect));
  const payload = await request("/api/admin/aliases/review-batch", {
    method: "POST",
    body: JSON.stringify({ seasonContextId: state.seasonContextId, ids, enabled })
  });
  await loadAliases();
  notify(`已更新 ${payload.updated} 条候选别名`);
}

$("#approve-selected").addEventListener("click", () => reviewSelected(true));
$("#disable-selected").addEventListener("click", () => reviewSelected(false));
$("#catalog-audit-button").addEventListener("click", async () => {
  const payload = await request(`/api/admin/item-catalog-audit?${seasonQuery()}`);
  $("#catalog-result").textContent = JSON.stringify(payload.summary, null, 2);
});
$("#clear-cache").addEventListener("click", async () => {
  const payload = await request("/api/admin/cache/clear", { method: "POST", body: JSON.stringify({ seasonContextId: state.seasonContextId }) });
  $("#catalog-result").textContent = JSON.stringify(payload.cleared, null, 2);
});

async function loadAudit() {
  const payload = await request(`/api/admin/audit?${seasonQuery({ limit: "100" })}`);
  $("#audit-rows").replaceChildren(...payload.audits.map((audit) => {
    const item = document.createElement("li");
    item.textContent = `${audit.createdAt} · ${audit.action} ${audit.entityType}${audit.entityId ? ` #${audit.entityId}` : ""}`;
    return item;
  }));
}

$("#season-context").addEventListener("change", async (event) => {
  state.seasonContextId = event.target.value;
  resetForm();
  resetProfileForm();
  state.currentComps = [];
  state.enrichment = null;
  renderCurrentComps();
  await Promise.all([loadAliases(), loadProfiles(), loadAudit()]);
});
$("#reload-aliases").addEventListener("click", loadAliases);
$("#reload-audit").addEventListener("click", loadAudit);
$("#cancel-edit").addEventListener("click", resetForm);

try {
  await loadSeasons();
  await Promise.all([loadAdminSeasons(), loadAliases(), loadProfiles(), loadAudit()]);
} catch (error) {
  notify(error.message);
}
