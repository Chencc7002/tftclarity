import { readFileSync } from "node:fs";

const assetManifest = JSON.parse(readFileSync(new URL("./generated/asset-manifest.json", import.meta.url), "utf8"));

const ALLOWED_HOSTS = new Set(["ddragon.leagueoflegends.com", "cdn.metatft.com"]);
const ITEM_ASSET_ALIASES = new Map([
  ["TFT_Item_GiantSlayer", "TFT_Item_MadredsBloodrazor"]
]);

export function resolveItemApiNameAlias(apiName) {
  const requested = String(apiName ?? "");
  return ITEM_ASSET_ALIASES.get(requested) ?? requested;
}

function traitBase(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}

function metaTFTUnitIconUrl(apiName) {
  const slug = String(apiName ?? "").trim().toLowerCase();
  // S18/PBE match payloads use DA_18_* ids and MetaTFT publishes those ids directly.
  if (!/^(?:tft\d+|da)_[a-z0-9_]+$/u.test(slug)) return null;
  return `https://cdn.metatft.com/file/metatft/champions/${slug}.png`;
}

function metaTFTCanonicalUnitIconUrl(apiName) {
  const value = String(apiName ?? "").trim();
  let canonical = value.replace(/^DA_(\d+)_/u, "TFT$1_");
  if (canonical === value) {
    canonical = value.replace(/^DA_([A-Za-z]+)(\d+)(.*)$/u, "TFT$2_$1$3");
  }
  return canonical === value ? null : metaTFTUnitIconUrl(canonical);
}

function metaTFTDataIconUrl(entityType, apiName) {
  const slug = String(apiName ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_]+$/u.test(slug)) return null;
  const directory = entityType === "item" ? "items" : entityType === "trait" ? "traits" : null;
  return directory ? `https://cdn.metatft.com/file/metatft/${directory}/${slug}.png` : null;
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
        ? resolveItemApiNameAlias(requested)
        : requested;
    const record = byKey.get(`${entityType}:${requested}`) ?? byKey.get(`${entityType}:${lookup}`);
    const manifestIconUrl = normalizeAssetUrl(record?.iconUrl);
    const metaTFTIconUrl = entityType === "unit"
      ? normalizeAssetUrl(metaTFTUnitIconUrl(lookup))
      : (entityType === "item" || entityType === "trait") && !manifestIconUrl
        ? normalizeAssetUrl(metaTFTDataIconUrl(entityType, lookup))
      : null;
    const metaTFTFallbackIconUrl = entityType === "unit"
      ? normalizeAssetUrl(metaTFTCanonicalUnitIconUrl(lookup))
      : null;
    const iconUrl = metaTFTIconUrl ?? manifestIconUrl;
    const fallbackIconUrl = [metaTFTFallbackIconUrl, manifestIconUrl]
      .find((candidate) => candidate && candidate !== iconUrl) ?? null;
    return {
      entityType,
      apiName: entityType === "item" ? requested : lookup,
      ...(entityType === "unit" && Number.isFinite(Number(record?.cost))
        ? { cost: Number(record.cost) }
        : {}),
      ...(entityType === "item" && lookup !== requested ? { assetApiName: lookup } : {}),
      ...(entityType === "trait" ? { filterId: requested } : {}),
      iconUrl,
      ...(entityType === "unit" && fallbackIconUrl
        ? { fallbackIconUrl }
        : {}),
      source: metaTFTIconUrl ? "MetaTFT CDN" : record?.source ?? manifest?.source ?? null,
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
        fallbackIconUrl: asset.fallbackIconUrl ?? null,
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
    rising: (result.rising ?? result.improving ?? []).map(decorateComp),
    falling: (result.falling ?? []).map(decorateComp),
    improving: (result.improving ?? []).map(decorateComp),
    references: (result.references ?? []).map(decorateComp)
  };
}
