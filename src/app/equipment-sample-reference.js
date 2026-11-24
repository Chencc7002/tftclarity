const counts = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function requestedRows(question) {
  const token = question.match(/(?:前\s*|top\s*|(?:列出|给我|推荐)\s*)(\d{1,2}|[一二两三四五六七八九十]{1,3})(?=\s*(?:件|套|种|个|名)|\b|[，。\s]|$)/iu)?.[1];
  if (!token) return 1;
  const [tens, ones] = token.replace("两", "二").split("十");
  const value = Number(token) || (ones === undefined ? counts.indexOf(tens)
    : (tens ? counts.indexOf(tens) : 1) * 10 + (ones ? counts.indexOf(ones) : 0));
  return Math.max(1, Math.min(100, value));
}

// The configured threshold continues to govern the main ranking. Only the
// descriptive supplemental rows use the lower threshold, within the same data.
export function equipmentSampleReference(result, question, itemName, explicitFloor) {
  const floor = result.query?.minSamples;
  if (!(floor > 0) || result.cache?.query?.stale || result.localDecision || result.clarification?.blocking) return null;
  if (/(?:不要|不许|禁止|不能|别|不允许).{0,5}(?:降|放宽)|do not (?:lower|relax)/iu.test(question)) return null;
  const flexible = /(?:可(?:以)?|允许|自动|不足(?:时)?)[^。！？]{0,10}(?:放宽|降[到至低])|(?:relax|lower) the (?:sample )?(?:threshold|minimum)/iu.test(question);
  const hardFloor = /样本(?:数|量|门槛|下限)?\s*(?:[≥>＝=]+|至少|不低于|不少于|达到|为)?\s*\d+|(?:至少|不低于|不少于|只看|最低|minimum|at least)\s*\d+\s*(?:场|局|样本|games?|samples?)|\d+\s*(?:场|局)(?:以上|起)|严格.{0,5}(?:样本|门槛)/iu.test(question);
  if (!flexible && (explicitFloor || hardFloor)) return null;
  let needed = requestedRows(question);
  let candidates, qualified, nameOf;
  if (result.comparison?.entries) {
    candidates = result.comparison.entries;
    needed = candidates.length;
    qualified = candidates.filter(x => x.stats.games >= floor).length;
    nameOf = x => itemName(x.apiName);
  } else if (["unit_item_rankings", "unit_emblem_rankings"].includes(result.type)) {
    const target = result.query.performanceItem;
    candidates = (result.itemRankingReferences ?? []).filter(x => x.excludedReason === "below_min_samples" && (!target || x.apiName === target));
    qualified = target ? Number(result.itemRankings.some(x => x.apiName === target)) : result.itemRankings.length;
    if (target) needed = 1;
    nameOf = x => itemName(x.apiName);
  } else if (["unit_build_rankings", "unit_build_completion", "unit_best_3_items"].includes(result.type)) {
    candidates = result.filteredBuilds ?? [];
    qualified = result.rankedBuilds.length;
    nameOf = x => x.items.map(itemName).join(" + ");
  } else return null;
  if (qualified >= needed) return null;
  const rows = candidates.filter(x => Number.isSafeInteger(x.stats?.games) && x.stats.games > 0 && x.stats.games < floor)
    .sort((a, b) => b.stats.games - a.stats.games).slice(0, needed - qualified)
    .map(x => ({ name: nameOf(x), games: x.stats.games, avg: +x.stats.avgPlacement.toFixed(2),
      top4: +(100 * x.stats.top4Rate).toFixed(1), win: +(100 * x.stats.winRate).toFixed(1) }));
  return rows.length ? { originalMinimum: floor, referenceMinimum: rows.at(-1).games, qualifiedCount: qualified, requestedCount: needed, rows } : null;
}

export function sampleReferenceText(ref, unit, locale, answer = "") {
  const en = String(locale).startsWith("en");
  const note = en
    ? `For ${unit}, the sample minimum for supplementary results was lowered from ${ref.originalMinimum} to ${ref.referenceMinimum} games. These small samples are descriptive only.`
    : `${unit}的补充结果已将样本门槛从 ${ref.originalMinimum} 场降至 ${ref.referenceMinimum} 场。低于原门槛的数据仅供参考。`;
  const segments = answer.replaceAll(",", "").split(/[；;。\n]/u);
  const missing = ref.rows.filter(row => !segments.some(segment => {
    const at = segment.indexOf(row.name);
    if (at < 0) return false;
    const samples = new RegExp(`(?:^|[^\\d.])${row.games}\\s*(?:场|局|games?\\b|samples?\\b|\\|\\s*$)|(?:样本(?:数|量)?|场次|games|samples)\\s*[:：]?\\s*${row.games}(?![\\d.])`, "iu");
    return samples.test(segment.slice(at + row.name.length));
  }));
  if (!missing.length) return note;
  const header = en ? "| Equipment | Avg placement | Top 4 | Win rate | Games |" : "| 装备 | 平均名次 | 前四率 | 吃鸡率 | 场次 |";
  return [note, "", header, "|---|---|---|---|---|", ...missing.map(x =>
    `| ${x.name.replaceAll("|", "\\|")} | ${x.avg.toFixed(2)} | ${x.top4}% | ${x.win}% | ${x.games} |`)].join("\n");
}
