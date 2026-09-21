const TRAIT_STYLES = new Set(["bronze", "silver", "gold", "chromatic", "unique"]);

export function normalizeTraitStyle(value) {
  if (Number.isInteger(Number(value))) {
    return ({ 1: "bronze", 2: "silver", 3: "gold", 4: "chromatic" })[Number(value)] ?? null;
  }
  const style = String(value ?? "").trim().toLowerCase().replace(/^k/u, "");
  return TRAIT_STYLES.has(style) ? style : null;
}

export function resolveTraitStyle(trait, entityDetails) {
  const explicit = normalizeTraitStyle(trait?.style ?? trait?.traitStyle);
  if (explicit) return explicit;

  const apiName = String(trait?.apiName ?? trait?.filterId ?? "").replace(/_\d+$/u, "");
  const tier = Number(trait?.tier ?? String(trait?.filterId ?? "").match(/_(\d+)$/u)?.[1]);
  const official = entityDetails?.traits?.get?.(apiName);
  const officialStyle = Number.isInteger(tier) && tier > 0
    ? normalizeTraitStyle(official?.levels?.[tier - 1]?.style)
    : null;

  return officialStyle ?? normalizeTraitStyle(tier);
}
