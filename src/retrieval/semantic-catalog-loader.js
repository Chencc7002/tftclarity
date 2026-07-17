import { readFile } from "node:fs/promises";
import { normalizeCompsPageDataResponse } from "../data/comp-response-adapter.js";

function compact(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function entryValue(collection, patch) {
  const entry = collection?.[patch] ?? (patch === "current" ? collection?.current : null);
  return entry?.value ?? entry ?? null;
}

function entityKey(entity, type) {
  if (type === "trait") return String(entity?.apiName ?? entity?.filterId ?? "").trim();
  return String(entity?.apiName ?? entity?.filterId ?? entity?.id ?? "").trim();
}

function mergeEntities(values, type) {
  const merged = new Map();
  for (const entity of values ?? []) {
    const key = entityKey(entity, type);
    if (!key) continue;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, {
        ...entity,
        aliases: compact(entity.aliases)
      });
      continue;
    }
    merged.set(key, {
      ...previous,
      ...entity,
      apiName: previous.apiName ?? entity.apiName,
      filterId: previous.filterId ?? entity.filterId,
      zhName: previous.zhName ?? entity.zhName,
      displayName: previous.zhName ?? previous.displayName ?? entity.zhName ?? entity.displayName,
      aliases: compact([
        ...(previous.aliases ?? []),
        previous.displayName,
        previous.filterId,
        ...(entity.aliases ?? []),
        entity.displayName,
        entity.filterId
      ])
    });
  }
  return [...merged.values()];
}

function isPlayerUnit(entity) {
  const apiName = String(entity?.apiName ?? "");
  return !/_Enemy_|_PVE_|Minion$|_Summon$/.test(apiName);
}

function canonicalName(entity) {
  return entity?.preferredDisplayName
    ?? entity?.zhName
    ?? entity?.displayName
    ?? entity?.shortName
    ?? entity?.name
    ?? entity?.apiName
    ?? entity?.filterId;
}

function mapValue(collection, key) {
  if (!collection || !key) return null;
  if (typeof collection.get === "function") return collection.get(key) ?? null;
  return collection[key] ?? null;
}

function sourceMetadata(detail, fallback = {}) {
  const source = detail?.source ?? {};
  return {
    sourceVersion: source.version ?? fallback.version ?? null,
    sourceSeason: source.season ?? fallback.season ?? null,
    sourceUpdatedAt: source.updatedAt ?? fallback.updatedAt ?? null
  };
}

function officialDescriptionDocument({
  id,
  documentType,
  apiName,
  content,
  canonical,
  aliases,
  patch,
  locale,
  metadata = {}
}) {
  const sections = compact(content);
  const searchableAliases = compact(aliases);
  const text = compact([
    sections[0],
    searchableAliases.length ? `别名 ${searchableAliases.join(" ")}` : null,
    ...sections.slice(1)
  ]).join("；");
  if (!text) return null;
  return {
    id: `${patch}:${locale}:${documentType}:${id ?? apiName}`,
    documentType,
    apiName,
    content: text,
    patch,
    locale,
    source: "tencent_official_tft_catalog",
    metadata: {
      canonicalName: canonical,
      aliases: searchableAliases,
      officialStaticDescription: true,
      ...metadata
    }
  };
}

function traitDetailFor(entityDetails, entity) {
  const apiName = String(entity?.apiName ?? entity?.filterId ?? "").replace(/_[0-9]+$/, "");
  return mapValue(entityDetails?.traits, apiName);
}

export function attachOfficialSemanticDescriptions(catalog = {}, options = {}) {
  const patch = String(options.patch ?? catalog.patch ?? "current");
  const locale = String(options.locale ?? catalog.locale ?? "zh-CN");
  const entityDetails = options.entityDetails ?? {};
  const itemDetails = options.itemDetails ?? new Map();
  const descriptions = new Map((catalog.descriptions ?? []).map((document) => [document.id, document]));
  const coverage = {
    units: { total: 0, described: 0 },
    items: { total: 0, described: 0 },
    traits: { total: 0, described: 0 }
  };

  for (const entity of catalog.units ?? []) {
    if (entity?.current === false) continue;
    coverage.units.total += 1;
    const apiName = String(entity?.apiName ?? "").trim();
    const detail = mapValue(entityDetails.units, apiName);
    const abilityDescription = String(detail?.ability?.description ?? "").trim();
    if (!apiName || !abilityDescription) continue;
    const canonical = canonicalName(entity) ?? detail?.name ?? apiName;
    const source = sourceMetadata(detail, entityDetails.meta);
    const document = officialDescriptionDocument({
      id: apiName,
      documentType: "unit_description",
      apiName,
      content: [
        `棋子 ${canonical}`,
        `技能 ${detail?.ability?.name ?? "说明"}`,
        abilityDescription,
        detail?.traitNames?.length ? `羁绊 ${detail.traitNames.join(" ")}` : null
      ],
      canonical,
      aliases: [canonical, detail?.name, ...(entity.aliases ?? []), apiName],
      patch,
      locale,
      metadata: {
        abilityName: detail?.ability?.name ?? null,
        ...source
      }
    });
    if (document) {
      descriptions.set(document.id, document);
      coverage.units.described += 1;
    }
  }

  for (const entity of catalog.traits ?? []) {
    if (entity?.current === false) continue;
    coverage.traits.total += 1;
    const apiName = String(entity?.apiName ?? entity?.filterId ?? "").replace(/_[0-9]+$/, "");
    const detail = traitDetailFor(entityDetails, entity);
    const description = String(detail?.description ?? "").trim();
    const levels = (detail?.levels ?? [])
      .filter((level) => Number.isFinite(Number(level?.units)) && level?.effect)
      .map((level) => `${Number(level.units)}人 ${String(level.effect).trim()}`);
    if (!apiName || (!description && levels.length === 0)) continue;
    const canonical = canonicalName(entity) ?? detail?.name ?? apiName;
    const source = sourceMetadata(detail, entityDetails.meta);
    const document = officialDescriptionDocument({
      id: apiName,
      documentType: "trait_description",
      apiName,
      content: [
        `羁绊 ${canonical}`,
        description,
        levels.length ? `档位 ${levels.join("；")}` : null
      ],
      canonical,
      aliases: [canonical, detail?.name, ...(entity.aliases ?? []), entity?.filterId, apiName],
      patch,
      locale,
      metadata: {
        levels: levels.length,
        ...source
      }
    });
    if (document) {
      descriptions.set(document.id, document);
      coverage.traits.described += 1;
    }
  }

  for (const entity of catalog.items ?? []) {
    if (entity?.current === false) continue;
    coverage.items.total += 1;
    const apiName = String(entity?.apiName ?? "").trim();
    const detail = mapValue(itemDetails, apiName);
    const effect = String(detail?.effect ?? "").trim();
    if (!apiName || !effect) continue;
    const canonical = canonicalName(entity) ?? detail?.name ?? apiName;
    const recipe = (detail?.recipe ?? [])
      .map((component) => component?.name ?? component?.apiName)
      .filter(Boolean);
    const documentType = entity?.category === "emblem" ? "emblem_description" : "item_description";
    const document = officialDescriptionDocument({
      id: apiName,
      documentType,
      apiName,
      content: [
        `装备 ${canonical}`,
        effect,
        recipe.length ? `合成 ${recipe.join(" + ")}` : null
      ],
      canonical,
      aliases: [canonical, detail?.name, ...(detail?.keywords ?? []), ...(entity.aliases ?? []), apiName],
      patch,
      locale,
      metadata: {
        category: entity?.category ?? null,
        craftable: Boolean(detail?.craftable),
        recipe,
        sourceVersion: options.itemSourceVersion ?? itemDetails?.meta?.version ?? null,
        sourceSeason: options.itemSourceSeason ?? itemDetails?.meta?.season ?? null,
        sourceUpdatedAt: options.itemSourceUpdatedAt ?? itemDetails?.meta?.updatedAt ?? null
      }
    });
    if (document) {
      descriptions.set(document.id, document);
      coverage.items.described += 1;
    }
  }

  return {
    ...catalog,
    descriptions: [...descriptions.values()],
    semanticCatalogSource: `${catalog.semanticCatalogSource ?? "catalog"}+official_static_details`,
    semanticDescriptionCoverage: coverage
  };
}

function createEntityNameResolver(catalog) {
  const names = new Map();
  for (const entity of [...(catalog.units ?? []), ...(catalog.traits ?? [])]) {
    const name = canonicalName(entity);
    if (!name) continue;
    for (const key of compact([entity.apiName, entity.filterId])) names.set(key, name);
  }
  return (token) => names.get(String(token))
    ?? names.get(String(token).replace(/_\d+$/, ""))
    ?? null;
}

export function createStaticCompCatalog(compsResponse, catalog = {}, options = {}) {
  const normalized = normalizeCompsPageDataResponse(compsResponse);
  const resolveName = createEntityNameResolver(catalog);
  const patch = String(options.patch ?? catalog.patch ?? "current");
  return normalized.definitions.map((definition) => {
    const translatedTokens = definition.nameTokens.map((token) => resolveName(token)).filter(Boolean);
    const fallbackTokens = definition.nameTokens.map((token) => String(token)
      .replace(/^TFT\d+_/, "")
      .replace(/_/g, " "));
    const nameParts = translatedTokens.length ? translatedTokens : fallbackTokens;
    const displayName = compact(nameParts).join(" ") || `阵容 ${definition.clusterId}`;
    return {
      apiName: `metatft_comp_${definition.clusterId}`,
      displayName,
      zhName: displayName,
      aliases: compact([
        displayName,
        ...translatedTokens,
        ...definition.nameTokens,
        definition.nameString,
        `cluster ${definition.clusterId}`
      ]),
      current: true,
      patch,
      source: "metatft_comp_identity_snapshot",
      clusterId: definition.clusterId
    };
  });
}

export function catalogFromRuntimeCacheSnapshot(snapshot = {}, options = {}) {
  const patch = String(options.patch ?? "current");
  const itemValue = entryValue(snapshot.itemCatalogs, patch);
  const domainValue = entryValue(snapshot.domainCatalogs, patch);
  if (!itemValue && !domainValue) {
    throw new Error(`Runtime catalog cache does not contain patch "${patch}"`);
  }
  return {
    patch,
    locale: String(options.locale ?? "zh-CN"),
    units: mergeEntities(domainValue?.units ?? [], "unit").filter(isPlayerUnit),
    items: mergeEntities(itemValue?.items ?? [], "item"),
    traits: mergeEntities(domainValue?.traits ?? [], "trait"),
    comps: [],
    semanticCatalogSource: "runtime_catalog_cache"
  };
}

export async function loadRuntimeCatalogSnapshot(filePath, options = {}) {
  if (!filePath) throw new TypeError("loadRuntimeCatalogSnapshot requires filePath");
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  return catalogFromRuntimeCacheSnapshot(parsed, options);
}

export async function loadCompleteSemanticCatalog({
  catalogCachePath,
  compsInputPath,
  patch = "current",
  locale = "zh-CN"
} = {}) {
  if (!catalogCachePath) throw new TypeError("loadCompleteSemanticCatalog requires catalogCachePath");
  const catalog = await loadRuntimeCatalogSnapshot(catalogCachePath, { patch, locale });
  if (compsInputPath) {
    const compsResponse = JSON.parse(await readFile(compsInputPath, "utf8"));
    catalog.comps = createStaticCompCatalog(compsResponse, catalog, { patch });
  }
  return catalog;
}
