import { readFileSync } from "node:fs";

const assetManifest = JSON.parse(readFileSync(new URL("./generated/asset-manifest.json", import.meta.url), "utf8"));

const ALLOWED_HOSTS = new Set(["ddragon.leagueoflegends.com"]);
const ITEM_ASSET_ALIASES = new Map([
  ["TFT_Item_GiantSlayer", "TFT_Item_MadredsBloodrazor"]
]);

function traitBase(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}

export function normalizeAssetUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function createAssetResolver(options = {}) {
  const manifest = options.manifest ?? assetManifest;
  const records = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const byKey = new Map(records.map((record) => [`${record.entityType}:${record.apiName ?? record.filterId}`, record]));

  function resolve(entityType, apiNameOrFilterId) {
    const requested = String(apiNameOrFilterId ?? "");
    const lookup = entityType === "trait"
      ? traitBase(requested)
      : entityType === "item"
        ? ITEM_ASSET_ALIASES.get(requested) ?? requested
        : requested;
    const record = byKey.get(`${entityType}:${requested}`) ?? byKey.get(`${entityType}:${lookup}`);
    const iconUrl = normalizeAssetUrl(record?.iconUrl);
    return {
      entityType,
      apiName: entityType === "item" ? requested : lookup,
      ...(entityType === "item" && lookup !== requested ? { assetApiName: lookup } : {}),
      ...(entityType === "trait" ? { filterId: requested } : {}),
      iconUrl,
      source: record?.source ?? manifest?.source ?? null,
      sourcePatch: record?.sourcePatch ?? manifest?.sourcePatch ?? null,
      fallback: !iconUrl
    };
  }

  return {
    manifestVersion: manifest?.version ?? null,
    resolveUnit: (apiName) => resolve("unit", apiName),
    resolveItem: (apiName) => resolve("item", apiName),
    resolveTrait: (filterId) => resolve("trait", filterId)
  };
}

export function decorateCompAssets(result, options = {}) {
  const resolver = options.resolver ?? createAssetResolver(options);
  const catalog = options.catalog;
  const itemName = (apiName) => catalog?.itemByApiName?.get(apiName)?.zhName
    ?? catalog?.itemByApiName?.get(apiName)?.displayName
    ?? catalog?.itemByApiName?.get(apiName)?.name
    ?? apiName;
  const decorateComp = (comp) => ({
    ...comp,
    units: (comp.units ?? []).map((unit) => {
      const asset = resolver.resolveUnit(unit.apiName);
      const build = (comp.coreBuilds ?? []).find((entry) => entry.unitApiName === unit.apiName);
      return {
        ...unit,
        iconUrl: asset.iconUrl,
        assetFallback: asset.fallback,
        core: Boolean(build),
        items: (build?.items ?? unit.items ?? []).map((apiName) => ({
          apiName,
          name: itemName(apiName),
          ...resolver.resolveItem(apiName)
        }))
      };
    }),
    traits: (comp.traits ?? []).map((trait) => {
      const asset = resolver.resolveTrait(trait.filterId ?? trait.apiName);
      return { ...trait, iconUrl: asset.iconUrl, assetFallback: asset.fallback };
    })
  });
  return {
    ...result,
    rankings: Object.fromEntries(Object.entries(result.rankings ?? {}).map(([key, values]) => [
      key,
      (values ?? []).map(decorateComp)
    ])),
    references: (result.references ?? []).map(decorateComp)
  };
}
