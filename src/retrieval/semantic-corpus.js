import { normalizeSemanticDocument } from "./semantic-document-store.js";

export const INTENT_SEMANTIC_SAMPLES = Object.freeze({
  unit_build_rankings: ["这名棋子的三件套排行", "哪个完整出装最好", "推荐三件成装"],
  unit_build_completion: ["我已经有一件装备接下来补什么", "已有装备怎么补齐三件套", "剩下两件怎么出"],
  unit_best_3_items: ["最好的三件装备是什么", "标准三件套推荐"],
  unit_item_rankings: ["单件装备排行", "哪些普通装备适合这个棋子", "核心装备和备选装备"],
  unit_item_comparison: ["这两件装备哪个好", "比较两个装备的排他样本", "二选一应该选什么"],
  unit_emblem_rankings: [
    "剑圣哪个转职好",
    "剑圣有什么强的转职",
    "剑圣应该带什么转",
    "易大师适合什么纹章"
  ],
  comp_rankings: ["当前阵容排行", "哪些阵容上分稳定", "阵容前四率和登顶率排名"],
  comp_trends: ["最近哪些阵容在上升", "阵容趋势变化", "值得关注的新兴阵容"]
});

function compact(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function entityName(entity) {
  return entity.preferredDisplayName
    ?? entity.displayName
    ?? entity.shortName
    ?? entity.zhName
    ?? entity.name
    ?? entity.apiName
    ?? entity.filterId;
}

function entityDocument(entity, type, options) {
  const apiName = String(entity.apiName ?? entity.filterId ?? "").trim();
  if (!apiName) return null;
  const canonicalName = entityName(entity);
  const aliases = compact([canonicalName, ...(entity.aliases ?? []), entity.apiName, entity.filterId]);
  const description = String(entity.description ?? entity.effect ?? entity.text ?? "").trim();
  const category = String(entity.category ?? "");
  const documentType = type === "item" && category === "emblem" ? "emblem_description" : type;
  return normalizeSemanticDocument({
    id: `${options.patch}:${options.locale}:${documentType}:${apiName}`,
    documentType,
    apiName: entity.apiName ?? entity.filterId,
    content: compact([
      `${type} ${canonicalName}`,
      aliases.length ? `别名 ${aliases.join(" ")}` : null,
      category ? `类型 ${category}` : null,
      description || null
    ]).join("；"),
    patch: entity.patch ?? options.patch,
    locale: options.locale,
    source: entity.source ?? options.source,
    metadata: {
      canonicalName,
      aliases,
      category: category || null,
      current: entity.current !== false,
      staticDescription: description || null
    }
  });
}

function descriptionDocument(value, index, options) {
  const content = String(value.content ?? value.text ?? value.description ?? "").trim();
  if (!content) return null;
  const type = String(value.documentType ?? value.type ?? "static_description");
  return normalizeSemanticDocument({
    ...value,
    id: value.id ?? `${options.patch}:${options.locale}:${type}:${index}`,
    documentType: type,
    content,
    patch: value.patch ?? options.patch,
    locale: value.locale ?? options.locale,
    source: value.source ?? options.source
  });
}

export function buildSemanticCorpus(catalog = {}, options = {}) {
  const settings = {
    patch: String(options.patch ?? catalog.patch ?? "current"),
    locale: String(options.locale ?? catalog.locale ?? "zh-CN"),
    source: String(options.source ?? "tft_static_catalog")
  };
  const documents = [];
  const collections = [
    ["unit", catalog.units],
    ["item", catalog.items],
    ["trait", catalog.traits],
    ["comp", catalog.comps]
  ];
  for (const [type, entities] of collections) {
    for (const entity of Array.isArray(entities) ? entities : []) {
      if (entity?.current === false && options.includeHistorical !== true) continue;
      const document = entityDocument(entity, type, settings);
      if (document) documents.push(document);
    }
  }
  if (options.includeIntentSamples !== false) {
    for (const [intent, samples] of Object.entries(options.intentSamples ?? INTENT_SEMANTIC_SAMPLES)) {
      samples.forEach((sample, index) => documents.push(normalizeSemanticDocument({
        id: `${settings.patch}:${settings.locale}:intent_sample:${intent}:${index + 1}`,
        documentType: "intent_sample",
        intent,
        content: String(sample),
        patch: settings.patch,
        locale: settings.locale,
        source: "curated_intent_sample",
        metadata: { canonicalName: intent, sampleIndex: index + 1 }
      })));
    }
  }
  for (const [index, description] of (catalog.descriptions ?? []).entries()) {
    const document = descriptionDocument(description, index + 1, settings);
    if (document) documents.push(document);
  }
  const explicit = Array.isArray(catalog.documents) ? catalog.documents : [];
  explicit.forEach((document, index) => {
    const normalized = descriptionDocument(document, `explicit:${index + 1}`, settings);
    if (normalized) documents.push(normalized);
  });
  return [...new Map(documents.map((document) => [document.id, document])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
}
