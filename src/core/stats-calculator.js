export function calculatePlacementStats(placementCount) {
  const counts = Array.isArray(placementCount) ? placementCount.map((value) => Number(value) || 0) : [];
  const games = counts.reduce((sum, count) => sum + count, 0);
  if (games <= 0) {
    return {
      games: 0,
      winRate: 0,
      top4Rate: 0,
      avgPlacement: 0
    };
  }

  const winRate = counts[0] / games;
  const top4Rate = counts.slice(0, 4).reduce((sum, count) => sum + count, 0) / games;
  const avgPlacement = counts.reduce((sum, count, index) => sum + count * (index + 1), 0) / games;

  return {
    games,
    winRate,
    top4Rate,
    avgPlacement
  };
}

export function parseBuildItems(row) {
  if (Array.isArray(row.items)) return row.items;
  const rawBuild = row.unit_builds ?? row.unit_build ?? row.build ?? row.name ?? "";
  const [, itemPart = ""] = String(rawBuild).split("&");
  if (!itemPart) return [];
  return itemPart
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function attachStats(row) {
  const placementCount = row.placement_count ?? row.placementCount ?? [];
  return {
    raw: row,
    items: parseBuildItems(row),
    stats: calculatePlacementStats(placementCount)
  };
}
