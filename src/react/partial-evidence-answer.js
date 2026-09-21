// Presentation only: consumes accepted Ledger entries; never retrieves facts,
// changes completion/grounding decisions, or promotes historical Evidence.
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" ? value.replace(/[\r\n]+/gu, " ").trim() : "";
const name = (value) => typeof value === "string" ? text(value)
  : text(value?.displayName ?? value?.name ?? value?.apiName);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const percent = (value) => finite(value) && value >= 0 && value <= 1 ? `${(value * 100).toFixed(1)}%` : null;

function metrics(value = {}) {
  value ??= {};
  return [
    finite(value.games ?? value.samples) ? `样本 ${value.games ?? value.samples}` : null,
    finite(value.avgPlacement ?? value.averagePlacement) ? `平均名次 ${value.avgPlacement ?? value.averagePlacement}` : null,
    percent(value.top4Rate) ? `前四率 ${percent(value.top4Rate)}` : null,
    percent(value.winRate) ? `登顶率 ${percent(value.winRate)}` : null
  ].filter(Boolean).join("，");
}

export function partialEvidenceSummary(entries = []) {
  const usable = entries.filter((entry) => entry.temporalStatus !== "historical"
    && !entry.metadata?.stale && !entry.value?.cache?.stale
    && ![entry.metadata?.temporalStatus, entry.metadata?.freshnessStatus].some((status) => ["historical", "stale", "expired"].includes(status)));
  const batchScope = (entry) => JSON.stringify([entry.value?.query?.compositionId ?? "",
    list(entry.value?.query?.entities ?? entry.value?.results).map((row) => row.apiName ?? row.unit?.apiName ?? (name(row.unit) || name(row)))]);
  const latestBatch = new Map(usable.filter((entry) => entry.toolName === "unit_builds_batch").map((entry) => [batchScope(entry), entry]));
  const current = usable.filter((entry) => entry.toolName !== "unit_builds_batch" || latestBatch.get(batchScope(entry)) === entry);
  const findings = [], limitations = [], evidenceIds = [];
  const add = (entry, finding) => {
    if (!finding) return;
    findings.push(finding);
    evidenceIds.push(entry.evidenceId);
  };
  for (const entry of current) {
    const value = entry.value ?? {};
    if (entry.toolName === "comps_rankings") {
      const ambiguous = value.resolution?.status === "ambiguous";
      for (const row of list(value.results).slice(0, 5)) {
        const label = name(row.compositionRef) || name(row);
        if (!label) continue;
        const members = list(row.members).map(name).filter(Boolean).join("、");
        const stats = metrics(row.stats);
        add(entry, `${ambiguous ? "候选阵容" : "阵容"}“${label}”${members ? `包含${members}` : "已找到"}${stats ? `；${stats}` : ""}。`);
        if (!stats) limitations.push(`“${label}”缺少可展示的表现统计，不能据此判断强度。`);
        else if (!finite(row.stats?.games) || !finite(row.stats?.top4Rate)) limitations.push(`“${label}”的样本量或前四率不完整，表现判断仍有限。`);
        if (row.lowSample) limitations.push(`“${label}”被数据源标记为低样本，统计表现可能不稳定。`);
        const plan = row.tacticalDetailQueryPlan;
        if (plan?.status === "ready") {
          const tactical = current.findLast((candidate) => candidate.toolName === "composition_tactical_details"
            && candidate.value?.compId === plan.compositionId && candidate.value?.clusterId === plan.clusterId
            && candidate.value?.seasonContextId === plan.seasonContextId);
          if (!tactical || tactical.value.formation?.status !== "available") {
            limitations.push(`“${label}”尚未取得完整的站位明细，不能确认整套阵容的具体站位。`);
          } else evidenceIds.push(tactical.evidenceId);
        }
      }
      if (ambiguous) limitations.push("尚未唯一确认目标阵容，以上候选不能当作同一套阵容合并解读。");
      else if (findings.length) limitations.push("以上仅能确认已返回的阵容信息，尚未形成完整的玩法与强弱分析。");
    }
    if (entry.toolName === "unit_builds_batch") {
      for (const row of list(value.results)) {
        const label = name(row.unit) || name(row) || "该成员";
        if (row.available === false) {
          limitations.push(`“${label}”的出装统计本次不可用，无法给出该成员的可靠出装方案。`);
          continue;
        }
        const options = list(row.buildOptions);
        if (options.length && !options.some((option) => list(option.items).length)) {
          add(entry, `${label}返回了 ${options.length} 条出装候选记录。`);
          limitations.push(`${label}的候选记录缺少具体装备，暂时无法列出可用出装。`);
        }
        for (const option of options.slice(0, 3)) {
          const items = list(option.items).map(name).filter(Boolean).join("、");
          if (!items) continue;
          const stats = metrics(option.metrics);
          add(entry, `${label}的已返回出装：${items}${stats ? `（${stats}）` : ""}。`);
        }
      }
    }
    if (["unit_details", "item_details", "trait_details"].includes(entry.toolName)
      && ["found", "partial"].includes(value.status)) {
      const label = name(value), facts = value.facts ?? {};
      const details = entry.toolName === "unit_details"
        ? [finite(facts.cost) ? `${facts.cost}费` : null,
          list(facts.traits).map(name).filter(Boolean).join("、"),
          name(facts.ability) ? `技能：${name(facts.ability)}` : null]
        : [text(facts.description ?? facts.effect)];
      if (label) add(entry, `${label}：${details.filter(Boolean).join("；") || "已确认资料对象"}。`);
      if (value.status === "partial") limitations.push(`${label || "该对象"}的详细资料不完整，未返回的属性与效果无法确认。`);
    }
  }
  // Name resolution is useful only as a limited finding, never as performance evidence.
  if (!findings.length && current.every((entry) => entry.toolName === "entity_catalog_query" || entry.value?.status === "not_found")) for (const entry of current.filter((entry) => entry.toolName === "entity_catalog_query")) {
    const resolved = list(entry.value?.resolution?.requests)
      .filter((row) => row.status === "resolved" && row.candidates?.length === 1)
      .map((row) => name(row.candidates[0])).filter(Boolean);
    if (resolved.length) {
      add(entry, `已确认查询对象：${[...new Set(resolved)].join("、")}。`);
      limitations.push("目前只有名称识别结果，缺少回答所需的详细资料或表现统计，不能据此推荐出装或判断强弱。");
    }
  }
  return { findings: [...new Set(findings)], limitations: [...new Set(limitations)], evidenceIds: [...new Set(evidenceIds)] };
}

export function buildPartialEvidenceAnswer(entries, { fallback = null, observations = [], explanation = "补充解读超出证据范围，尚不能给出完整结论。" } = {}) {
  const summary = partialEvidenceSummary(entries);
  const findings = [...new Set([...summary.findings, ...(fallback?.findings ?? (fallback?.answer ? [fallback.answer] : []))])];
  const limitations = [...summary.limitations, explanation];
  const toolLabels = { unit_builds: "英雄出装统计", unit_builds_batch: "成员出装统计",
    unit_details: "英雄详细资料", item_details: "装备属性与效果", item_details_batch: "装备属性与效果",
    comps_rankings: "阵容统计", composition_tactical_details: "阵容站位与强化符文", semantic_search: "攻略与机制资料" };
  const latest = new Map();
  for (const observation of observations) if (["tool_result", "tool_failed"].includes(observation.type)) latest.set(observation.tool, observation);
  for (const [tool, observation] of latest) if (observation.type === "tool_failed" && toolLabels[tool]) {
    limitations.unshift(`${toolLabels[tool]}查询失败，这部分信息仍需补全。`);
  }
  return {
    answer: [
      "### 已确认的信息",
      ...(findings.length ? findings.map((finding) => `- ${finding}`)
        : ["当前有效证据尚不足以形成可直接回答问题的具体结论。"]),
      "", "### 还缺什么 / 结论边界",
      ...[...new Set(limitations)].filter(Boolean).map((limitation) => `- ${limitation}`)
    ].join("\n"),
    evidenceIds: [...new Set([...summary.evidenceIds, ...(fallback?.evidenceIds ?? [])])]
  };
}
