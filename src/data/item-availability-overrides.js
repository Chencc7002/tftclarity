// Availability exceptions are historical facts, not permanent namespaced-ID rules.
// Every future entry must bind to an explicit patch and season so it expires when
// Riot reuses an API id. The current S17 official catalog needs no deny rule.
export const ITEM_AVAILABILITY_OVERRIDES = Object.freeze([]);

function normalizePatch(value) {
  return String(value ?? "current").trim().toLowerCase() || "current";
}

export function findItemAvailabilityOverride(apiName, patch = "current") {
  const normalizedApiName = String(apiName ?? "");
  const normalizedPatch = normalizePatch(patch);

  return ITEM_AVAILABILITY_OVERRIDES.find((override) => (
    override.apiName === normalizedApiName
    && (override.patch === "*" || normalizePatch(override.patch) === normalizedPatch)
  )) ?? null;
}

export function applyItemAvailabilityOverride(item, options = {}) {
  if (!item?.apiName) return item;

  const patch = options.patch ?? item.patch ?? "current";
  const override = findItemAvailabilityOverride(item.apiName, patch);
  if (!override) return item;

  return {
    ...item,
    category: override.category,
    current: override.current,
    obtainable: override.obtainable,
    availabilityOverride: true,
    availabilityReason: override.reason,
    availabilitySource: override.source
  };
}

export function removedOrLegacyItemApiNamesForPatch(patch = "current") {
  const normalizedPatch = normalizePatch(patch);
  return new Set(
    ITEM_AVAILABILITY_OVERRIDES
      .filter((override) => (
        override.category === "removed_or_legacy"
        && (override.patch === "*" || normalizePatch(override.patch) === normalizedPatch)
      ))
      .map((override) => override.apiName)
  );
}
