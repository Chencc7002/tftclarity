import { ITEM_ALIAS_OVERRIDES } from "./item-alias-overrides.js";
import { ITEM_AVAILABILITY_OVERRIDES } from "./item-availability-overrides.js";
import { isVerifiedLocalizationName } from "./item-localization.js";

function compact(values) {
  return [...new Set((values ?? []).filter(Boolean).map(String))];
}

function overrideMetadata(item) {
  const alias = ITEM_ALIAS_OVERRIDES.find((entry) => entry.apiName === item.apiName) ?? null;
  const availability = ITEM_AVAILABILITY_OVERRIDES.find((entry) => entry.apiName === item.apiName) ?? null;
  return {
    alias: alias ? {
      source: alias.source ?? null,
      patch: alias.patch ?? null,
      season: alias.season ?? null,
      generatedAt: alias.generatedAt ?? null,
      expiresWhen: alias.expiresWhen ?? null
    } : null,
    availability: availability ? {
      source: availability.source ?? null,
      patch: availability.patch ?? null,
      season: availability.season ?? null,
      generatedAt: availability.generatedAt ?? null,
      expiresWhen: availability.expiresWhen ?? null
    } : null
  };
}

function detailCompleteness(detail, detailsState) {
  if (detailsState?.status === "error") {
    return {
      status: "source_error",
      hasEffect: null,
      recipeStatus: "source_error",
      recipeComponentsResolved: null,
      sourceError: detailsState.error ?? "official detail source failed"
    };
  }
  if (!detail) {
    return {
      status: "missing",
      hasEffect: false,
      recipeStatus: "unknown",
      recipeComponentsResolved: null,
      sourceError: null
    };
  }
  const recipe = detail.recipe ?? [];
  return {
    status: detail.effect ? "complete" : "missing_effect",
    hasEffect: Boolean(detail.effect),
    recipeStatus: detail.craftable ? (recipe.length ? "craftable" : "missing_recipe") : "not_craftable",
    recipeComponentsResolved: detail.craftable
      ? recipe.length > 0 && recipe.every((component) => component.apiName && component.name)
      : true,
    sourceError: null
  };
}

function auditIssues(item, detail, detailsState, overrides, catalogState) {
  const issues = [];
  if (!isVerifiedLocalizationName(item.zhName)) issues.push("missing_canonical_zh_name");
  if (item.category === "unknown") issues.push("unknown_category");
  if (!detail && detailsState?.status !== "error") issues.push("missing_official_details");
  if (detail && !detail.effect) issues.push("missing_official_effect");
  if (detail?.craftable && !(detail.recipe ?? []).length) issues.push("missing_recipe_components");
  if (overrides.availability && ["current", "*"].includes(String(overrides.availability.patch ?? "").toLowerCase())) {
    issues.push("unversioned_availability_override");
  }
  if (item.manualNameCandidate && item.zhName && item.manualNameCandidate !== item.zhName) {
    issues.push("official_manual_name_conflict");
  }
  if (catalogState?.status === "stale" || catalogState?.status === "fallback") issues.push("catalog_cache_fallback");
  if (detailsState?.status === "error") issues.push("official_details_source_error");
  return issues;
}

export function buildItemCatalogAudit(catalog, officialDetails = new Map(), options = {}) {
  const catalogState = options.catalogState ?? {};
  const detailsState = options.detailsState ?? { status: "fresh" };
  const records = (catalog?.items ?? []).map((item) => {
    const detail = officialDetails.get(item.apiName) ?? null;
    const overrides = overrideMetadata(item);
    const canonical = item.zhName ?? item.displayName ?? item.apiName;
    const aliases = compact(item.aliases).filter((alias) => ![canonical, item.shortName, item.apiName].includes(alias));
    return {
      patch: item.patch ?? options.patch ?? "current",
      catalogStatus: catalogState.status ?? "fresh",
      catalogSource: catalogState.source ?? item.source ?? "unknown",
      catalogUpdatedAt: catalogState.updatedAt ?? null,
      apiName: item.apiName,
      canonicalName: canonical,
      shortName: item.shortName ?? null,
      historicalAliases: aliases,
      category: item.category ?? "unknown",
      current: Boolean(item.current),
      obtainable: Boolean(item.obtainable),
      iconUrl: detail?.iconUrl ?? null,
      nameSource: item.nameSource ?? item.source ?? null,
      nameSourceUrl: item.nameSourceUrl ?? null,
      namePatch: item.namePatch ?? null,
      detailsSource: detail?.sourceUrl ?? null,
      detailsStatus: detailsState.status ?? "fresh",
      completeness: detailCompleteness(detail, detailsState),
      overrides,
      issues: auditIssues(item, detail, detailsState, overrides, catalogState)
    };
  });
  return {
    patch: options.patch ?? records[0]?.patch ?? "current",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    catalog: catalogState,
    officialDetails: detailsState,
    records
  };
}

export function filterItemCatalogAudit(records = [], filters = {}) {
  const query = String(filters.query ?? "").trim().toLowerCase();
  const patch = String(filters.patch ?? "").trim().toLowerCase();
  const category = String(filters.category ?? "").trim();
  const source = String(filters.source ?? "").trim().toLowerCase();
  const status = String(filters.status ?? "").trim().toLowerCase();
  const availability = String(filters.availability ?? "").trim().toLowerCase();
  const issues = String(filters.issues ?? "").trim().toLowerCase();
  return records.filter((record) => {
    const searchable = [
      record.apiName,
      record.canonicalName,
      record.shortName,
      ...(record.historicalAliases ?? [])
    ].filter(Boolean).join(" ").toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (patch && String(record.patch ?? "").toLowerCase() !== patch) return false;
    if (category && record.category !== category) return false;
    const sources = [
      record.catalogSource,
      record.nameSource,
      record.detailsSource,
      record.overrides?.alias?.source,
      record.overrides?.availability?.source
    ].filter(Boolean).join(" ").toLowerCase();
    if (source && !sources.includes(source)) return false;
    if (status && ![record.catalogStatus, record.detailsStatus].includes(status)) return false;
    if (availability === "available" && !(record.current && record.obtainable)) return false;
    if (availability === "unavailable" && record.current && record.obtainable) return false;
    if (issues === "with_issues" && record.issues.length === 0) return false;
    if (issues === "clean" && record.issues.length > 0) return false;
    return true;
  });
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function itemCatalogAuditToCsv(records = []) {
  const columns = [
    "patch", "catalogStatus", "catalogSource", "apiName", "canonicalName", "shortName",
    "historicalAliases", "category", "current", "obtainable", "iconUrl", "nameSource",
    "namePatch", "detailsStatus", "effectStatus", "recipeStatus", "overridePatch", "overrideSeason", "issues"
  ];
  const lines = [columns.map(csvCell).join(",")];
  for (const record of records) {
    const availability = record.overrides?.availability ?? {};
    const row = {
      ...record,
      effectStatus: record.completeness?.status,
      recipeStatus: record.completeness?.recipeStatus,
      overridePatch: availability.patch,
      overrideSeason: availability.season
    };
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
