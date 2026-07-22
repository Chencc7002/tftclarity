import { createCatalog } from "./static-data.js";
import { normalizeAlias } from "../core/normalizer.js";

function compact(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function cloneRecord(record, aliasEntry) {
  return {
    ...record,
    aliases: compact([...(record.aliases ?? []), aliasEntry.alias]),
    aliasMemorySource: compact([record.aliasMemorySource, aliasEntry.source]).join("+") || null,
    aliasMemoryUpdatedAt: aliasEntry.updatedAt ?? null
  };
}

function normalizeEntityType(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function applyEntityAliasesToCatalog(catalog = createCatalog(), aliases = []) {
  const overrideAliases = new Set((aliases ?? [])
    .filter((alias) => alias?.enabled && alias?.alias)
    .map((alias) => normalizeAlias(alias.alias))
    .filter(Boolean));
  const withoutOverriddenAliases = (record) => ({
    ...record,
    aliases: (record.aliases ?? []).filter((alias) => !overrideAliases.has(normalizeAlias(alias)))
  });
  const units = new Map((catalog.units ?? []).map((unit) => [unit.apiName, withoutOverriddenAliases(unit)]));
  const items = new Map((catalog.items ?? []).map((item) => [item.apiName, withoutOverriddenAliases(item)]));
  const traitsByFilterId = new Map((catalog.traits ?? []).map((trait) => [trait.filterId, withoutOverriddenAliases(trait)]));
  const traitFilterByApiName = new Map((catalog.traits ?? []).map((trait) => [trait.apiName, trait.filterId]));
  const applied = [];
  const ignored = [];

  for (const alias of aliases ?? []) {
    if (!alias?.enabled) {
      ignored.push({
        alias: alias?.alias,
        apiName: alias?.apiName,
        entityType: alias?.entityType,
        reason: "disabled"
      });
      continue;
    }

    const entityType = normalizeEntityType(alias.entityType);
    if (entityType === "unit") {
      const record = units.get(alias.apiName);
      if (!record) {
        ignored.push({ ...alias, reason: "unknown_unit" });
        continue;
      }
      units.set(alias.apiName, cloneRecord(record, alias));
      applied.push(alias);
      continue;
    }

    if (entityType === "item") {
      const record = items.get(alias.apiName);
      if (!record) {
        ignored.push({ ...alias, reason: "unknown_item" });
        continue;
      }
      items.set(alias.apiName, cloneRecord(record, alias));
      applied.push(alias);
      continue;
    }

    if (entityType === "trait") {
      const filterId = traitsByFilterId.has(alias.apiName)
        ? alias.apiName
        : traitFilterByApiName.get(alias.apiName);
      const record = filterId ? traitsByFilterId.get(filterId) : null;
      if (!record) {
        ignored.push({ ...alias, reason: "unknown_trait" });
        continue;
      }
      traitsByFilterId.set(filterId, cloneRecord(record, alias));
      applied.push(alias);
      continue;
    }

    ignored.push({ ...alias, reason: "unknown_entity_type" });
  }

  return {
    catalog: createCatalog({
      units: [...units.values()].sort((a, b) => a.apiName.localeCompare(b.apiName)),
      items: [...items.values()].sort((a, b) => a.apiName.localeCompare(b.apiName)),
      traits: [...traitsByFilterId.values()].sort((a, b) => a.filterId.localeCompare(b.filterId))
    }),
    applied,
    ignored
  };
}

export async function applyEnabledEntityAliasesFromStore(catalog, cacheStore, options = {}) {
  const aliases = await cacheStore?.listEntityAliases?.({
    enabled: true,
    seasonContextId: options.seasonContextId,
    limit: options.limit ?? 500
  }) ?? [];
  return applyEntityAliasesToCatalog(catalog, aliases);
}
