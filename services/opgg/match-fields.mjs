// Missing upstream fields are unknown, never numeric zero.
export function matchNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function matchUnitCost(unit, fallbackCost = null) {
  const cost = matchNumber(unit?.cost) ?? matchNumber(fallbackCost);
  if (cost !== null && cost >= 0) return cost;
  const rarity = matchNumber(unit?.rarity);
  return rarity !== null && Number.isInteger(rarity) && rarity >= 0 ? rarity + 1 : null;
}
