function baseTrait(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}
function weighted(accumulator, stats = {}) {
  const games = Math.max(0, Number(stats.games ?? 0));
  accumulator.games += games;
  accumulator.placement += Number(stats.avgPlacement ?? 0) * games;
  accumulator.top4 += Number(stats.top4Rate ?? 0) * games;
  accumulator.wins += Number(stats.winRate ?? 0) * games;
}

export function aggregateExternalUnits(compositions = [], options = {}) {
  const trait = baseTrait(options.trait);
  const traitMembers = new Set(options.traitMembers ?? []);
  const matching = compositions.filter((comp) => (
    (comp.traits ?? []).some((entry) => baseTrait(entry.apiName ?? entry.filterId ?? entry) === trait)
  ));
  const totalGames = matching.reduce((sum, comp) => sum + Math.max(0, Number(comp.stats?.games ?? 0)), 0);
  const byUnit = new Map();
  for (const comp of matching) {
    for (const unit of comp.units ?? []) {
      const apiName = String(unit.apiName ?? unit);
      if (!apiName || traitMembers.has(apiName)) continue;
      const entry = byUnit.get(apiName) ?? {
        unit: apiName,
        name: unit.name ?? apiName,
        games: 0,
        placement: 0,
        top4: 0,
        wins: 0
      };
      weighted(entry, comp.stats);
      byUnit.set(apiName, entry);
    }
  }
  const minSamples = Math.max(0, Number(options.minSamples ?? 0));
  const limit = Math.max(1, Math.min(50, Number(options.limit ?? 10)));
  return [...byUnit.values()]
    .filter((entry) => entry.games >= minSamples)
    .map((entry) => ({
      unit: entry.unit,
      name: entry.name,
      games: entry.games,
      pickRateWithinTraitComps: totalGames > 0 ? entry.games / totalGames : 0,
      avgPlacement: entry.games > 0 ? entry.placement / entry.games : null,
      top4Rate: entry.games > 0 ? entry.top4 / entry.games : null,
      winRate: entry.games > 0 ? entry.wins / entry.games : null
    }))
    .sort((left, right) => right.games - left.games || left.avgPlacement - right.avgPlacement)
    .slice(0, limit);
}
