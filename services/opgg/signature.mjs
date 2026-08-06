/**
 * Two-level comp signatures (MVP doc section 7).
 *
 * comp_family_signature  - trend grouping: set + dominant active trait.
 *                          Secondary traits and carry choices are variants,
 *                          not separate comps.
 * exact_board_signature  - full final board: sorted units with star tier and
 *                          item names, plus trait ids (for variant review).
 */

const TRAIT_NUMERIC_SUFFIX = /_\d+$/u;

function parseJsonArray(text) {
  if (typeof text !== "string" || !text) {
    return [];
  }
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function normalizeTraitName(name) {
  if (typeof name !== "string") {
    return null;
  }
  return name.replace(TRAIT_NUMERIC_SUFFIX, "");
}

function getTraitActivation(trait) {
  return Math.max(
    Number(trait?.tierCurrent ?? 0),
    Number(trait?.style ?? 0)
  );
}

function getActiveTraits(traits) {
  const seen = new Map();
  for (const trait of traits) {
    if (!trait || typeof trait !== "object") {
      continue;
    }
    const name = normalizeTraitName(trait.name);
    if (
      !name ||
      getTraitActivation(trait) <= 0 ||
      /UniqueTrait|Unique$/iu.test(name)
    ) {
      continue;
    }
    const current = seen.get(name);
    const candidate = {
      name,
      activation: getTraitActivation(trait),
      numUnits: Number(trait.numUnits ?? 0)
    };
    if (
      !current ||
      candidate.activation > current.activation ||
      (candidate.activation === current.activation &&
        candidate.numUnits > current.numUnits)
    ) {
      seen.set(name, candidate);
    }
  }

  return [...seen.values()].sort(
    (a, b) =>
      b.activation - a.activation ||
      b.numUnits - a.numUnits ||
      a.name.localeCompare(b.name)
  );
}

function scoreUnit(unit) {
  const items = Array.isArray(unit?.itemNames)
    ? unit.itemNames.filter((item) => typeof item === "string" && item)
    : [];
  return {
    id: unit?.characterId ?? unit?.name ?? null,
    items,
    itemCount: items.length,
    rarity: Number(unit?.rarity ?? 0),
    tier: Number(unit?.tier ?? 1)
  };
}

function getCoreUnits(units) {
  const candidates = units
    .map(scoreUnit)
    .filter((unit) => unit.id && unit.itemCount >= 2)
    .sort(
      (a, b) =>
        b.itemCount - a.itemCount ||
        b.rarity - a.rarity ||
        b.tier - a.tier ||
        String(a.id).localeCompare(String(b.id))
    );

  return candidates.slice(0, 2).map((unit, index) => ({
    role: index === 0 ? "carry" : "tank",
    id: unit.id
  }));
}

function setLabel(setNumber) {
  const set = Number(setNumber ?? NaN);
  return Number.isFinite(set) && set > 0 ? `set${set}` : "set?";
}

/**
 * Build the trend-grouping signature, e.g.
 * "set17|trait:TFT17_Astronaut".
 * Returns null when there is nothing classifiable (no active traits and no
 * item-carrying core units).
 */
function buildCompFamilySignature(fact) {
  const traits = getActiveTraits(parseJsonArray(fact?.traitsJson));
  const units = getCoreUnits(parseJsonArray(fact?.unitsJson));

  if (traits.length === 0 && units.length === 0) {
    return null;
  }

  const parts = [setLabel(fact?.setNumber)];
  if (traits[0]) {
    parts.push(`trait:${traits[0].name}`);
  } else {
    // Traitless boards are uncommon, but keep them classifiable without
    // collapsing every such board into one generic bucket.
    parts.push(`${units[0].role}:${units[0].id}`);
  }
  return parts.join("|");
}

/**
 * Full final-board signature: deterministic JSON with sorted traits and
 * sorted units (id, star tier, sorted item names).
 */
function buildExactBoardSignature(fact) {
  const traits = parseJsonArray(fact?.traitsJson)
    .map((trait) => normalizeTraitName(trait?.name))
    .filter(Boolean)
    .sort();

  const units = parseJsonArray(fact?.unitsJson)
    .map((unit) => {
      const id = unit?.characterId ?? unit?.name ?? null;
      if (!id) {
        return null;
      }
      return {
        id,
        tier: Number(unit?.tier ?? 1),
        items: (Array.isArray(unit?.itemNames)
          ? unit.itemNames.filter((item) => typeof item === "string")
          : []
        ).sort()
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return JSON.stringify({
    set: setLabel(fact?.setNumber),
    traits,
    units
  });
}

export {
  normalizeTraitName,
  getActiveTraits,
  getCoreUnits,
  buildCompFamilySignature,
  buildExactBoardSignature
};
