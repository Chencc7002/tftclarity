function finiteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeMetaTftDailyTrends(value) {
  return (Array.isArray(value) ? value : []).map((row) => ({
    day: row?.day ?? row?.date ?? null,
    avgPlacement: finiteNumber(row?.avg ?? row?.avg_placement ?? row?.avgPlacement),
    games: finiteNumber(row?.count ?? row?.games, 0),
    patch: row?.patch,
    bPatchVersion: row?.b_patch_version ?? row?.bPatchVersion
  })).filter((row) => Number.isFinite(Date.parse(row.day))
    && Number.isFinite(row.avgPlacement));
}

// Mirrors MetaTFT's comp-card calculation. The newest partial day is ignored
// when the previous day has over four times its samples in the same patch.
export function calculateMetaTftPagePlacementChange(value) {
  const trends = normalizeMetaTftDailyTrends(value)
    .sort((left, right) => Date.parse(left.day) - Date.parse(right.day));
  if (trends.length <= 2) return null;
  const baseline = trends[trends.length - Math.min(trends.length, 4)];
  const latest = trends.at(-1);
  const previous = trends.at(-2);
  const endpoint = previous.games > latest.games * 4
    && previous.patch === latest.patch
    && previous.bPatchVersion === latest.bPatchVersion
    ? previous
    : latest;
  return {
    avgPlacementChange: endpoint.avgPlacement - baseline.avgPlacement,
    comparedAt: baseline.day,
    endpointAt: endpoint.day,
    baselineAvgPlacement: baseline.avgPlacement,
    endpointAvgPlacement: endpoint.avgPlacement
  };
}
