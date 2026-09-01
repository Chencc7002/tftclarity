import {
  deriveEnglishEntityName,
  localizedEntityName,
  localizedRoleLabel,
  normalizeDisplayLocale
} from "./display-locale.js";
import {
  traitDisplayOverrideByApiName,
  unitDisplayOverrideByApiName
} from "../data/entity-display-overrides.js";

const ENTITY_TYPES = new Set(["unit", "trait"]);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function includesQuery(values, query) {
  if (!query) return true;
  return values.some((value) => normalizedText(value).includes(query));
}

function compareNames(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
}

function publicSource(source) {
  if (!source) return null;
  return {
    version: source.version ?? null,
    season: source.season ?? null,
    updatedAt: source.updatedAt ?? null
  };
}

function localizedTraitNames(values, catalog, locale) {
  return [...new Set((values ?? []).map((value) => {
    const normalized = normalizedText(value);
    const trait = (catalog?.traits ?? []).find((entry) => (
      normalizedText(entry.zhName) === normalized
      || normalizedText(entry.displayName) === normalized
      || (entry.aliases ?? []).some((alias) => normalizedText(alias) === normalized)
    ));
    if (trait) return localizedEntityName(trait, locale, value);
    return normalizeDisplayLocale(locale) === "en-US" && /\p{Script=Han}/u.test(String(value ?? ""))
      ? null
      : value;
  }).filter(Boolean))];
}

function unitEntryScore(record) {
  const entry = record?.entry ?? {};
  return (entry.hasDetails ? 100 : 0)
    + (entry.iconUrl ? 20 : 0)
    + Math.min(10, (entry.traitNames ?? []).length * 2)
    + (entry.role ? 2 : 0);
}

function collapseUnitRecords(records) {
  const grouped = new Map();
  for (const record of records) {
    const key = normalizedText(record?.entry?.name) || normalizedText(record?.entry?.apiName);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        entry: record.entry,
        aliases: [...new Set([record.entry.apiName, ...(record.aliases ?? [])])]
      });
      continue;
    }
    const preferred = unitEntryScore(record) > unitEntryScore(existing) ? record : existing;
    grouped.set(key, {
      entry: preferred.entry,
      aliases: [...new Set([
        existing.entry.apiName,
        record.entry.apiName,
        ...(existing.aliases ?? []),
        ...(record.aliases ?? [])
      ])]
    });
  }
  return [...grouped.values()];
}

function unitEntries(catalog, details, options = {}) {
  const locale = normalizeDisplayLocale(options.locale);
  const query = normalizedText(options.query);
  const cost = options.cost === undefined || options.cost === null || options.cost === ""
    ? null
    : Number(options.cost);
  const role = normalizedText(options.role);
  const trait = normalizedText(options.trait);

  const catalogUnits = (catalog?.units ?? [])
    .filter((unit) => unit?.apiName && unit.current !== false);
  const officialUnits = details?.units instanceof Map
    ? [...details.units.entries()].filter(([apiName]) => apiName)
    : [];
  const officialByApiName = new Map(officialUnits.map(([mapApiName, official]) => [
    official?.apiName ?? mapApiName,
    official
  ]));
  const sourceUnits = catalogUnits.map((unit) => {
    const official = officialByApiName.get(unit.apiName)
      ?? officialUnits.find(([, candidate]) => (
        normalizedText(candidate?.name) === normalizedText(unit.zhName ?? unit.displayName ?? unit.name)
      ))?.[1]
      ?? null;
    return {
      unit,
      official,
      apiName: official?.apiName ?? unit.apiName,
      aliases: [unit.apiName, ...(unit.aliases ?? [])]
    };
  });

  return collapseUnitRecords(sourceUnits
    .map(({ unit, official, apiName, aliases }) => {
      const displayOverride = unitDisplayOverrideByApiName.get(apiName);
      const zhName = displayOverride?.zhName ?? unit.zhName ?? official?.name ?? unit.displayName ?? apiName;
      const enName = displayOverride?.enName ?? deriveEnglishEntityName({ ...unit, aliases }, apiName);
      const roleZh = localizedRoleLabel(official?.role, "zh-CN") || null;
      const roleEn = localizedRoleLabel(official?.role, "en-US") || null;
      const traitNamesZh = localizedTraitNames(official?.traitNames, catalog, "zh-CN");
      const traitNamesEn = localizedTraitNames(official?.traitNames, catalog, "en-US");
      const entry = {
        entityType: "unit",
        apiName,
        name: locale === "en-US" ? enName : zhName,
        zhName,
        enName,
        cost: official?.cost ?? unit.cost ?? null,
        role: locale === "en-US" ? roleEn : roleZh,
        roleZh,
        roleEn,
        traitNames: locale === "en-US" ? traitNamesEn : traitNamesZh,
        traitNamesZh,
        traitNamesEn,
        iconUrl: official?.iconUrl ?? options.assetResolver?.resolveUnit?.(apiName)?.iconUrl ?? null,
        hasDetails: Boolean(official),
        source: publicSource(official?.source)
      };
      return { entry, aliases: [...new Set([...(aliases ?? []), ...(unit.aliases ?? [])])] };
    }))
    .filter(({ entry, aliases }) => {
      const entryCost = Number(entry.cost);
      if (Number.isFinite(entryCost) && entryCost <= 0) return false;
      if (Number.isFinite(cost) && Number(entry.cost) !== cost) return false;
      if (role && !normalizedText(entry.role).includes(role)) return false;
      if (trait && !entry.traitNames.some((name) => normalizedText(name).includes(trait))) return false;
      return includesQuery([
        entry.apiName,
        entry.name,
        entry.role,
        ...entry.traitNames,
        ...aliases
      ], query);
    })
    .map(({ entry }) => entry)
    .sort((left, right) => {
      const costDifference = Number(left.cost ?? 99) - Number(right.cost ?? 99);
      return costDifference || compareNames(left.name, right.name) || compareNames(left.apiName, right.apiName);
    });
}

function traitEntries(catalog, details, options = {}) {
  const locale = normalizeDisplayLocale(options.locale);
  const query = normalizedText(options.query);
  const traitType = normalizedText(options.traitType ?? options.typeFilter);
  const byApiName = new Map();

  for (const trait of catalog?.traits ?? []) {
    if (!trait?.apiName || trait.current === false) continue;
    const existing = byApiName.get(trait.apiName);
    if (!existing) {
      byApiName.set(trait.apiName, {
        catalogTrait: trait,
        aliases: [...(trait.aliases ?? [])],
        filterIds: [trait.filterId].filter(Boolean)
      });
      continue;
    }
    existing.aliases.push(...(trait.aliases ?? []));
    if (trait.filterId) existing.filterIds.push(trait.filterId);
  }

  return [...byApiName.entries()]
    .map(([apiName, grouped]) => {
      const official = details?.traits?.get?.(apiName) ?? null;
      const catalogTrait = grouped.catalogTrait;
      const displayOverride = traitDisplayOverrideByApiName.get(apiName);
      const zhName = displayOverride?.zhName ?? catalogTrait.zhName ?? official?.name ?? catalogTrait.displayName ?? apiName;
      const enName = displayOverride?.enName ?? deriveEnglishEntityName({
        ...catalogTrait,
        aliases: [...new Set([...(catalogTrait.aliases ?? []), ...grouped.aliases])]
      }, apiName);
      const entry = {
        entityType: "trait",
        apiName,
        name: locale === "en-US" ? enName : zhName,
        zhName,
        enName,
        traitType: official?.type ?? null,
        tierCounts: [...new Set((official?.levels ?? []).map((level) => Number(level.units)).filter(Number.isFinite))]
          .sort((left, right) => left - right),
        iconUrl: official?.iconUrl ?? null,
        hasDetails: Boolean(official),
        source: publicSource(official?.source)
      };
      return {
        entry,
        aliases: [...new Set(grouped.aliases)],
        filterIds: [...new Set(grouped.filterIds)]
      };
    })
    .filter(({ entry, aliases, filterIds }) => {
      if (traitType && normalizedText(entry.traitType) !== traitType) return false;
      return includesQuery([
        entry.apiName,
        entry.name,
        entry.traitType,
        ...entry.tierCounts,
        ...aliases,
        ...filterIds
      ], query);
    })
    .map(({ entry }) => entry)
    .sort((left, right) => {
      const typeDifference = compareNames(left.traitType, right.traitType);
      return typeDifference || compareNames(left.name, right.name) || compareNames(left.apiName, right.apiName);
    });
}

export function normalizeEntityCatalogType(value) {
  const normalized = normalizedText(value);
  if (["unit", "units", "champion", "champions", "hero", "heroes", "棋子", "英雄"].includes(normalized)) {
    return "unit";
  }
  if (["trait", "traits", "羁绊"].includes(normalized)) return "trait";
  return null;
}

export function buildEntityCatalog(catalog, details, options = {}) {
  const entityType = normalizeEntityCatalogType(options.entityType ?? options.type);
  if (!ENTITY_TYPES.has(entityType)) {
    throw Object.assign(new TypeError("entityType must be unit or trait"), {
      statusCode: 400,
      code: "invalid_entity_catalog_type"
    });
  }

  const page = integer(options.page, 1, 1, 1000);
  const limit = integer(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const entries = entityType === "unit"
    ? unitEntries(catalog, details, options)
    : traitEntries(catalog, details, options);
  const start = (page - 1) * limit;
  const items = entries.slice(start, start + limit);

  return {
    type: "entity_catalog",
    entityType,
    items,
    pagination: {
      page,
      limit,
      total: entries.length,
      returned: items.length,
      pages: Math.max(1, Math.ceil(entries.length / limit))
    },
    filters: {
      query: String(options.query ?? "").trim() || null,
      ...(entityType === "unit"
        ? {
          cost: options.cost === undefined || options.cost === null || options.cost === ""
            ? null
            : Number(options.cost),
          role: String(options.role ?? "").trim() || null,
          trait: String(options.trait ?? "").trim() || null
        }
        : {
          traitType: String(options.traitType ?? options.typeFilter ?? "").trim() || null
        })
    }
  };
}
