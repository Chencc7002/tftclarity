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

export function isPlausiblePlacementStats(stats) {
  const games = Number(stats?.games);
  const average = Number(stats?.avgPlacement);
  const top4Rate = Number(stats?.top4Rate);
  const winRate = Number(stats?.winRate);
  if (![games, average, top4Rate, winRate].every(Number.isFinite)) return true;
  if (average < 1 || average > 8 || top4Rate < 0 || top4Rate > 1 || winRate < 0 || winRate > 1) {
    return false;
  }
  // MetaTFT can briefly retain legacy Set-id rows beside their replacements.
  // Large samples concentrated almost entirely in first place are not a valid
  // current-patch placement distribution and must never enter a ranking.
  return !(games >= 100 && average < 1.5 && top4Rate >= 0.98 && winRate >= 0.75);
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
