const PATCH_SUMMARY_REQUEST = /(?:总结|简述|概括|摘要|归纳|梳理|(?:版本|补丁).{0,8}(?:更新|改动)|summari[sz]e|summary|recap|patch\s*notes?)/iu;
const RECOVERABLE_PATCH_SUMMARY_ERROR = /(?:answer statistic is not present in cited evidence|patch answer numeric series(?: pair)? is not present)/iu;

function requestText(request = {}) {
  const current = [request.input, request.question]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (current.length) return current.join("\n");
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const latestUserMessage = [...messages].reverse().find((message) => (
    message?.role === "user" && String(message?.content ?? "").trim()
  ));
  return String(latestUserMessage?.content ?? "");
}

function isEnglish(locale, facts) {
  return String(locale ?? facts?.locale ?? "").toLowerCase().startsWith("en");
}

function uniqueGroups(revisions = []) {
  return [...new Set(revisions.flatMap((revision) => (
    (revision?.changes ?? []).map((change) => String(change?.group ?? "").trim()).filter(Boolean)
  )))];
}

function requestedPatchOrder(request) {
  const patches = [...requestText(request).matchAll(/(?:^|[^0-9])([0-9]{1,2}\.[0-9]{1,2})(?![0-9])/gu)]
    .map((match) => match[1]);
  return [...new Set(patches)];
}

function orderedPatchEntries(entries, request) {
  const requestedOrder = new Map(requestedPatchOrder(request).map((patch, index) => [patch, index]));
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftRank = requestedOrder.get(left.entry.value?.patch) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = requestedOrder.get(right.entry.value?.patch) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ entry }) => entry);
}

function patchComparisonLines(factsList, english) {
  if (factsList.length !== 2) return [];
  const [left, right] = factsList;
  const leftCount = Number(left.summary?.changeCount ?? 0);
  const rightCount = Number(right.summary?.changeCount ?? 0);
  const countLine = leftCount === rightCount
    ? (english
      ? `- Numeric-change volume: both patches contain ${leftCount} records.`
      : `- 数值调整总量：两个版本均为 ${leftCount} 项。`)
    : (() => {
        const larger = leftCount > rightCount ? left : right;
        const smaller = larger === left ? right : left;
        const delta = Math.abs(leftCount - rightCount);
        return english
          ? `- Numeric-change volume: ${larger.patch} has ${delta} more records than ${smaller.patch}.`
          : `- 数值调整总量：${larger.patch} 比 ${smaller.patch} 多 ${delta} 项。`;
      })();
  const leftGroups = uniqueGroups(left.revisions);
  const rightGroups = uniqueGroups(right.revisions);
  const rightGroupSet = new Set(rightGroups);
  const leftGroupSet = new Set(leftGroups);
  const shared = leftGroups.filter((group) => rightGroupSet.has(group));
  const leftOnly = leftGroups.filter((group) => !rightGroupSet.has(group));
  const rightOnly = rightGroups.filter((group) => !leftGroupSet.has(group));
  return [
    countLine,
    shared.length
      ? (english ? `- Shared areas: ${shared.join(", ")}` : `- 共同涉及：${shared.join("、")}`)
      : (english ? "- Shared areas: none in the reviewed numeric group labels." : "- 共同涉及：已审校数值分组中没有同名范围。"),
    leftOnly.length
      ? (english ? `- ${left.patch} only: ${leftOnly.join(", ")}` : `- 仅 ${left.patch}：${leftOnly.join("、")}`)
      : null,
    rightOnly.length
      ? (english ? `- ${right.patch} only: ${rightOnly.join(", ")}` : `- 仅 ${right.patch}：${rightOnly.join("、")}`)
      : null
  ].filter(Boolean);
}

function multiPatchSummaryAnswer(entries, request, english) {
  const orderedEntries = orderedPatchEntries(entries, request);
  const factsList = orderedEntries.map((entry) => entry.value);
  const patchNames = factsList.map((facts) => facts.patch);
  const comparison = patchComparisonLines(factsList, english);
  const answer = [
    english
      ? `### Patch ${patchNames.join(" vs ")} comparison`
      : `### ${patchNames.join(" 与 ")} 版本更新对比`,
    "",
    ...(comparison.length
      ? [english ? "#### Comparison" : "#### 对比结论", ...comparison, ""]
      : [])
  ];

  for (const facts of factsList) {
    const summary = facts.summary ?? {};
    const revisions = Array.isArray(facts.revisions) ? facts.revisions : [];
    const groups = uniqueGroups(revisions);
    const sourceName = facts.source?.sourceName ?? "Riot Games";
    const sourceUrl = facts.source?.sourceUrl ?? null;
    answer.push(
      `#### ${english ? "Patch " : "版本 "}${facts.patch}`,
      english
        ? `- Numeric changes: ${summary.changeCount ?? 0} (${summary.buffs ?? 0} buffs, ${summary.nerfs ?? 0} nerfs)`
        : `- 数值调整：${summary.changeCount ?? 0} 项（增强 ${summary.buffs ?? 0} 项、削弱 ${summary.nerfs ?? 0} 项）`,
      english
        ? `- Revisions: ${summary.revisionCount ?? revisions.length}; latest update: ${facts.updatedAt ?? "unknown"}`
        : `- 修订数量：${summary.revisionCount ?? revisions.length}；最近更新：${facts.updatedAt ?? "未知"}`,
      groups.length
        ? (english ? `- Areas: ${groups.join(", ")}` : `- 涉及范围：${groups.join("、")}`)
        : null,
      english ? "- Revision highlights:" : "- 修订摘要：",
      ...revisions.map((revision) => (
        `  - ${revision.publishedAt ?? "-"} · ${revision.title ?? revision.id}: ${revision.summary ?? "-"}`
      )),
      sourceUrl ? `${english ? "Source" : "来源"}: [${sourceName}](${sourceUrl})` : `${english ? "Source" : "来源"}: ${sourceName}`,
      ""
    );
  }

  answer.push(english
    ? "This comparison reports official numeric patch facts only; it does not infer performance impact or causality."
    : "以上仅对比官方数值更新事实，不推断阵容表现变化或因果关系。");
  return {
    answer: answer.filter((line) => line != null).join("\n"),
    evidenceIds: orderedEntries.map((entry) => entry.evidenceId)
  };
}

export function buildPatchSummaryAnswer({ request, action, validation, ledger, locale } = {}) {
  if (action?.reasonCode !== "sufficient_evidence" || !action.evidenceIds?.length) return null;
  if (!PATCH_SUMMARY_REQUEST.test(requestText(request))) return null;
  if (!validation?.errors?.length || !validation.errors.every((error) => (
    RECOVERABLE_PATCH_SUMMARY_ERROR.test(String(error))
  ))) return null;

  const cited = ledger?.resolve?.(action.evidenceIds) ?? [];
  if (cited.length !== action.evidenceIds.length) return null;
  const entries = cited.filter((candidate) => (
    candidate?.temporalStatus !== "historical"
    && candidate?.toolName === "patch_facts"
    && candidate?.value?.status === "found"
  ));
  if (!entries.length) return null;

  const uniqueEntries = entries.filter((entry, index) => (
    entries.findIndex((candidate) => candidate.value?.patch === entry.value?.patch) === index
  ));
  const english = isEnglish(locale, uniqueEntries[0]?.value);
  if (uniqueEntries.length > 1) {
    return multiPatchSummaryAnswer(uniqueEntries, request, english);
  }

  const entry = uniqueEntries[0];
  const facts = entry.value;
  const summary = facts.summary ?? {};
  const revisions = Array.isArray(facts.revisions) ? facts.revisions : [];
  const latest = revisions.at(-1) ?? null;
  const groups = uniqueGroups(revisions);
  const sourceName = facts.source?.sourceName ?? "Riot Games";
  const sourceUrl = facts.source?.sourceUrl ?? null;
  const answer = english
    ? [
        `### ${facts.title ?? `Patch ${facts.patch}`}`,
        "",
        `- Numeric changes: ${summary.changeCount ?? 0} (${summary.buffs ?? 0} buffs, ${summary.nerfs ?? 0} nerfs)`,
        `- Revisions: ${summary.revisionCount ?? revisions.length}; latest update: ${facts.updatedAt ?? latest?.publishedAt ?? "unknown"}`,
        groups.length ? `- Areas: ${groups.join(", ")}` : null,
        "",
        latest?.summary ?? null,
        sourceUrl ? `Source: [${sourceName}](${sourceUrl})` : `Source: ${sourceName}`,
        "",
        "Ask about a specific unit, trait, item, Augment, or Wisp to see the exact before/after values."
      ]
    : [
        `### ${facts.title ?? `${facts.patch} 版本更新`}`,
        "",
        `- 数值调整：${summary.changeCount ?? 0} 项（增强 ${summary.buffs ?? 0} 项、削弱 ${summary.nerfs ?? 0} 项）`,
        `- 修订数量：${summary.revisionCount ?? revisions.length}；最近更新：${facts.updatedAt ?? latest?.publishedAt ?? "未知"}`,
        groups.length ? `- 涉及范围：${groups.join("、")}` : null,
        "",
        latest?.summary ?? null,
        sourceUrl ? `来源：[${sourceName}](${sourceUrl})` : `来源：${sourceName}`,
        "",
        "如果你想看具体数值，可以继续指定某个弈子、羁绊、装备、强化符文或灵火。"
      ];

  return {
    answer: answer.filter((line) => line != null).join("\n"),
    evidenceIds: [entry.evidenceId]
  };
}
