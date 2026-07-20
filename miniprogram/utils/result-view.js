function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function percent(value) {
  const number = finite(value);
  if (number === null) return "—";
  const normalized = Math.abs(number) <= 1 ? number * 100 : number;
  return `${normalized.toFixed(1)}%`;
}

function placement(value) {
  const number = finite(value);
  return number === null ? "—" : `#${number.toFixed(2)}`;
}

function samples(value) {
  const number = finite(value);
  return number === null ? "—" : Math.round(number).toLocaleString();
}

function statsRows(stats) {
  if (!stats) return [];
  const values = [
    ["前四率", stats.top4 !== undefined ? percent(stats.top4) : percent(stats.top4Rate)],
    ["吃鸡率", stats.win !== undefined ? percent(stats.win) : percent(stats.winRate)],
    ["平均名次", stats.avg !== undefined ? placement(stats.avg) : placement(stats.avgPlacement)],
    ["样本", samples(stats.games)]
  ];
  return values
    .filter((entry) => entry[1] !== "—")
    .map((entry) => ({ label: entry[0], value: entry[1] }));
}

function itemView(item, index = 0) {
  return {
    id: `${item.apiName || item.name || "item"}-${index}`,
    name: item.name || item.zhName || item.apiName || "未知装备",
    iconUrl: item.iconUrl || "",
    locked: Boolean(item.locked)
  };
}

function recommendationCards(data) {
  return (data.cards || []).map((card, index) => ({
    id: `build-${index}`,
    badge: card.winner || index === 0 ? "最佳" : "备选",
    title: card.title || `方案 ${index + 1}`,
    subtitle: card.lowSample ? "低样本参考" : "",
    items: (card.items || []).map(itemView),
    units: [],
    stats: statsRows(card.stats)
  }));
}

function itemRankingCards(data) {
  return (data.itemRankings || []).slice(0, 10).map((item, index) => ({
    id: `item-${index}`,
    badge: `#${index + 1}`,
    title: item.name || item.apiName || "装备",
    subtitle: item.lowSample ? "低样本参考" : "",
    items: [itemView(item, index)],
    units: [],
    stats: statsRows(item.stats)
  }));
}

function uniqueComps(data) {
  const groups = [];
  Object.keys(data.rankings || {}).forEach((key) => groups.push.apply(groups, data.rankings[key] || []));
  groups.push.apply(groups, data.rising || []);
  groups.push.apply(groups, data.improving || []);
  groups.push.apply(groups, data.falling || []);
  const seen = {};
  return groups.filter((comp) => {
    const key = comp.compId || comp.name;
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function compCards(data) {
  return uniqueComps(data).slice(0, 12).map((comp, index) => ({
    id: comp.compId || `comp-${index}`,
    badge: `#${index + 1}`,
    title: comp.name || "阵容",
    subtitle: comp.lowSample ? "低样本参考" : (comp.contested ? "热门竞争阵容" : ""),
    items: [],
    units: (comp.units || []).slice(0, 9).map((unit) => ({
      name: unit.name || unit.apiName || "棋子",
      iconUrl: unit.iconUrl || unit.fallbackIconUrl || "",
      starLevel: unit.targetStarLevel || unit.starLevel || null
    })),
    stats: statsRows(comp.stats)
  }));
}

function detailsCards(data) {
  if (data.type === "unit_details" && data.unit) {
    const stats = data.unit.stats || {};
    return [{
      id: "unit",
      badge: data.unit.cost ? `${data.unit.cost} 费` : "棋子",
      title: data.unit.name,
      subtitle: data.unit.ability && data.unit.ability.name ? data.unit.ability.name : "",
      description: data.unit.ability && (data.unit.ability.description || data.unit.ability.desc) || "",
      units: [{ name: data.unit.name, iconUrl: data.unit.iconUrl || "" }],
      items: (data.recommendedItems || []).map(itemView),
      stats: Object.keys(stats).slice(0, 4).map((key) => ({ label: key, value: String(stats[key]) }))
    }];
  }
  if (data.type === "trait_details" && data.trait) {
    return [{
      id: "trait",
      badge: "羁绊",
      title: data.trait.name,
      subtitle: data.trait.type || "",
      description: data.trait.description || "",
      units: [],
      items: [],
      stats: (data.trait.levels || []).map((level) => ({
        label: `${level.minUnits || level.units || ""} 人`,
        value: level.description || level.effect || ""
      }))
    }];
  }
  if (data.type === "item_details" && data.item) {
    return [{
      id: "item-detail",
      badge: "装备",
      title: data.item.name,
      subtitle: data.item.category || "",
      description: data.item.effect || data.item.description || "",
      units: [],
      items: [itemView(data.item)],
      stats: []
    }];
  }
  return [];
}

function patchCards(data) {
  return (data.highlights || []).map((highlight, index) => ({
    id: `patch-${index}`,
    badge: String(index + 1).padStart(2, "0"),
    title: highlight.title,
    description: highlight.body,
    subtitle: "",
    units: [],
    items: [],
    stats: []
  }));
}

function titleFor(data) {
  const titles = {
    comp_rankings: "热门阵容",
    comp_trends: "阵容趋势",
    unit_item_rankings: "单件装备排行",
    unit_emblem_rankings: "纹章排行",
    unit_details: "棋子详情",
    trait_details: "羁绊详情",
    item_details: "装备详情",
    patch_notes: `${data.version || ""} 更新公告`
  };
  return titles[data.type] || "查询结果";
}

function conclusionView(conclusion) {
  if (!conclusion || conclusion.status !== "generated" || !conclusion.content) return null;
  const content = conclusion.content;
  return {
    headline: content.headline || "",
    summary: content.summary || "",
    reasons: (content.reasons || []).map((entry) => entry.text).filter(Boolean),
    alternatives: (content.alternatives || []).map((entry) => entry.text).filter(Boolean),
    nextAction: content.nextAction || "",
    riskNotice: content.riskNotice || "",
    model: conclusion.model || "LLM"
  };
}

function buildResultView(data) {
  let cards = recommendationCards(data);
  if (!cards.length) cards = itemRankingCards(data);
  if (!cards.length && (data.type === "comp_rankings" || data.type === "comp_trends")) cards = compCards(data);
  if (!cards.length) cards = detailsCards(data);
  if (!cards.length && data.type === "patch_notes") cards = patchCards(data);
  return {
    title: titleFor(data),
    summary: data.answer && data.answer.summary || data.summary || data.text || "已返回结构化查询结果。",
    cards,
    clarification: data.clarification && data.clarification.needsClarification
      ? data.clarification.question
      : "",
    source: data.source && (data.source.provider || data.source.endpoint) || data.sourceName || "",
    sourceUrl: data.sourceUrl || "",
    conclusion: conclusionView(data.answer && data.answer.generatedConclusion),
    conclusionPending: data.answer && data.answer.generatedConclusion && data.answer.generatedConclusion.status === "pending"
  };
}

module.exports = {
  buildResultView,
  conclusionView
};
