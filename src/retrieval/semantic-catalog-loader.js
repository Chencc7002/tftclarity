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
