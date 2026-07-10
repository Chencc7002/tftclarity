function compact(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function normalizeEntityType(value) {
  return String(value ?? "").trim().toLowerCase();
}

function traitApiNameFromFilterId(value) {
  return String(value ?? "").replace(/_[0-9]+$/, "");
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    const apiCompare = String(a.apiName).localeCompare(String(b.apiName));
    if (apiCompare !== 0) return apiCompare;
    return String(a.aliases?.[0] ?? "").localeCompare(String(b.aliases?.[0] ?? ""));
  });
}

function groupAliases(aliases = [], options = {}) {
  const includeDisabled = options.includeDisabled ?? true;
  const groups = {
    unit: new Map(),
    item: new Map(),
    trait: new Map()
  };
  const ignored = [];

  for (const alias of aliases ?? []) {
    if (!includeDisabled && !alias.enabled) {
      ignored.push({
        ...alias,
        reason: "disabled"
      });
      continue;
    }

    const entityType = normalizeEntityType(alias.entityType);
    const group = groups[entityType];
    if (!group) {
      ignored.push({
        ...alias,
        reason: "unknown_entity_type"
      });
      continue;
    }

    const apiName = String(alias.apiName ?? "").trim();
    const aliasText = String(alias.alias ?? "").trim();
    if (!apiName || !aliasText) {
      ignored.push({
        ...alias,
        reason: "missing_api_name_or_alias"
      });
      continue;
    }

    const key = entityType === "trait"
      ? `${traitApiNameFromFilterId(apiName)}:${apiName}`
      : apiName;
    const existing = group.get(key) ?? {
      apiName: entityType === "trait" ? traitApiNameFromFilterId(apiName) : apiName,
      aliases: [],
      confidence: 0,
      source: "alias_memory_review",
      review: {
        ids: [],
        enabled: [],
        sources: [],
        patches: []
      }
    };

    if (entityType === "trait" && /_[0-9]+$/.test(apiName)) {
      existing.filterId = apiName;
    }

    existing.aliases = compact([...existing.aliases, aliasText]);
    existing.confidence = Math.max(existing.confidence, Number(alias.confidence) || 0);
    existing.review.ids = compact([...existing.review.ids, alias.id]).map(Number);
    existing.review.enabled = compact([...existing.review.enabled, alias.enabled ? "true" : "false"]);
    existing.review.sources = compact([...existing.review.sources, alias.source]);
    existing.review.patches = compact([...existing.review.patches, alias.patch]);
    group.set(key, existing);
  }

  return {
    unitOverrides: sortRecords([...groups.unit.values()]),
    itemOverrides: sortRecords([...groups.item.values()]),
    traitOverrides: sortRecords([...groups.trait.values()]),
    ignored
  };
}

function stringifyRecords(name, records) {
  return `export const ${name} = ${JSON.stringify(records, null, 2)};\n`;
}

export function buildEntityAliasOverrideDraft(aliases = [], options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const grouped = groupAliases(aliases, options);
  const text = [
    "// Generated from entity_aliases memory.",
    "// Review manually before copying entries into domain-alias-overrides.js or item-alias-overrides.js.",
    `// generatedAt: ${generatedAt}`,
    "",
    stringifyRecords("CANDIDATE_UNIT_ALIAS_OVERRIDES", grouped.unitOverrides),
    stringifyRecords("CANDIDATE_TRAIT_ALIAS_OVERRIDES", grouped.traitOverrides),
    stringifyRecords("CANDIDATE_ITEM_ALIAS_OVERRIDES", grouped.itemOverrides)
  ].join("\n");

  return {
    generatedAt,
    unitOverrides: grouped.unitOverrides,
    traitOverrides: grouped.traitOverrides,
    itemOverrides: grouped.itemOverrides,
    ignored: grouped.ignored,
    text
  };
}
