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

export function buildPatchSummaryAnswer({ request, action, validation, ledger, locale } = {}) {
  if (action?.reasonCode !== "sufficient_evidence" || !action.evidenceIds?.length) return null;
  if (!PATCH_SUMMARY_REQUEST.test(requestText(request))) return null;
  if (!validation?.errors?.length || !validation.errors.every((error) => (
    RECOVERABLE_PATCH_SUMMARY_ERROR.test(String(error))
  ))) return null;

  const cited = ledger?.resolve?.(action.evidenceIds) ?? [];
  if (cited.length !== action.evidenceIds.length) return null;
  const entry = cited.find((candidate) => (
    candidate?.temporalStatus !== "historical"
    && candidate?.toolName === "patch_facts"
    && candidate?.value?.status === "found"
  ));
  if (!entry) return null;

  const facts = entry.value;
  const summary = facts.summary ?? {};
  const revisions = Array.isArray(facts.revisions) ? facts.revisions : [];
  const latest = revisions.at(-1) ?? null;
  const groups = uniqueGroups(revisions);
  const sourceName = facts.source?.sourceName ?? "Riot Games";
  const sourceUrl = facts.source?.sourceUrl ?? null;
  const english = isEnglish(locale, facts);
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
