/**
 * Phase 2 aggregation: per-player recent-N window (current patch only) and
 * pro-pool trends over comp family signatures, units, items and patches.
 *
 * Window ordering per MVP doc:
 *   NA filter -> current patch filter -> per-player recent N -> merge pool.
 */

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

function round(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function representativeBoardKey(row) {
  if (row.exactBoardSignature) {
    return row.exactBoardSignature;
  }
  return JSON.stringify(
    (row.units ?? [])
      .map((unit) => ({
        id: unit?.characterId ?? unit?.name ?? "",
        tier: Number(unit?.tier ?? 1),
        items: [...(unit?.itemNames ?? [])].sort()
      }))
      .filter((unit) => unit.id)
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

function compRating({ avgPlacement, top4Rate, winRate, eighthRate, sampleCount }) {
  if (!sampleCount || !Number.isFinite(avgPlacement)) {
    return { grade: null, score: null };
  }
  const score = Math.max(
    0,
    Math.min(
      100,
      100 - ((avgPlacement - 1) / 7) * 50
        + (top4Rate ?? 0) * 22
        + (winRate ?? 0) * 12
        - (eighthRate ?? 0) * 10
    )
  );
  const grade = score >= 82
    ? "S"
    : score >= 72
      ? "A"
      : score >= 62
        ? "B"
        : score >= 52
          ? "C"
          : "D";
  return { grade, score: round(score, 1) };
}

function playerSampleTier(count) {
  if (count <= 0) return "no_data";
  if (count <= 2) return "recent_only";
  if (count <= 4) return "recent_attempts";
  if (count <= 9) return "insufficient";
  return "full";
}

function compSampleTier(count) {
  if (count <= 2) return "recent_attempt";
  if (count <= 4) return "frequency_only";
  if (count <= 9) return "caution";
  return "confident";
}

function getCurrentPatch(database, { poolId, region = "na" }) {
  const row = database
    .prepare(
      `SELECT m.patch_label
       FROM match_record m
       JOIN player_match_fact f ON f.match_id = m.match_id
       JOIN tracked_player p ON p.id = f.player_id
       JOIN pool_player pp ON pp.player_id = p.id AND pp.pool_id = ?
       WHERE p.region = ? AND p.active = 1
         AND m.patch_label IS NOT NULL
       ORDER BY m.game_datetime DESC
       LIMIT 1`
    )
    .get(poolId, region);
  return row?.patch_label ?? null;
}

function rowToFact(row) {
  return {
    playerId: row.player_id,
    matchId: row.match_id,
    placement: row.placement,
    level: row.level,
    goldLeft: row.gold_left,
    lastRound: row.last_round,
    playersEliminated: row.players_eliminated,
    traits: parseJsonArray(row.traits_json),
    units: parseJsonArray(row.units_json),
    augments: row.augments_json ? parseJsonArray(row.augments_json) : null,
    compFamilySignature: row.comp_family_signature ?? null,
    exactBoardSignature: row.exact_board_signature ?? null,
    gameDatetime: row.game_datetime,
    gameVersion: row.game_version,
    patchLabel: row.patch_label,
    setNumber: row.set_number,
    queueId: row.queue_id,
    playerDisplayName: row.display_name,
    playerGameName: row.game_name,
    playerTagLine: row.tag_line
  };
}

/**
 * Per-player recent-N window on the current (or given) patch.
 */
function getPoolWindow(
  database,
  { poolId, region = "na", patch = null, perPlayerLimit = 10 } = {}
) {
  const effectivePatch = patch ?? getCurrentPatch(database, { poolId, region });
  if (!effectivePatch) {
    return { patch: null, rows: [] };
  }

  const rows = database
    .prepare(
      `WITH ranked AS (
         SELECT f.player_id, f.match_id, f.placement, f.level, f.gold_left,
                f.last_round, f.players_eliminated, f.traits_json,
                f.units_json, f.augments_json, f.comp_family_signature,
                f.exact_board_signature,
                m.game_datetime, m.game_version, m.patch_label,
                m.set_number, m.queue_id,
                p.display_name, p.game_name, p.tag_line,
                ROW_NUMBER() OVER (
                  PARTITION BY f.player_id
                  ORDER BY m.game_datetime DESC
                ) AS player_match_rank
         FROM player_match_fact f
         JOIN match_record m ON m.match_id = f.match_id
         JOIN tracked_player p ON p.id = f.player_id
         JOIN pool_player pp ON pp.player_id = p.id AND pp.pool_id = ?
         WHERE p.region = ? AND p.active = 1 AND m.patch_label = ?
       )
       SELECT * FROM ranked WHERE player_match_rank <= ?`
    )
    .all(poolId, region, effectivePatch, perPlayerLimit);

  return {
    patch: effectivePatch,
    rows: rows.map(rowToFact)
  };
}

function countActivePoolPlayers(database, { poolId, region = "na" }) {
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) AS n
         FROM tracked_player t
         JOIN pool_player pp ON pp.player_id = t.id AND pp.pool_id = ?
         WHERE t.region = ? AND t.active = 1`
      )
      .get(poolId, region).n
  );
}

function countCurrentPatchPlayerMatches(
  database,
  { poolId, region = "na", patch }
) {
  if (!patch) {
    return 0;
  }
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) AS n
         FROM player_match_fact f
         JOIN match_record m ON m.match_id = f.match_id
         JOIN tracked_player p ON p.id = f.player_id
         JOIN pool_player pp ON pp.player_id = p.id AND pp.pool_id = ?
         WHERE p.region = ? AND p.active = 1 AND m.patch_label = ?`
      )
      .get(poolId, region, patch).n
  );
}

function getPoolOverview(
  database,
  { poolId, region = "na", patch = null, perPlayerLimit = 10 } = {}
) {
  const window = getPoolWindow(database, {
    poolId,
    region,
    patch,
    perPlayerLimit
  });
  const trackedPlayers = countActivePoolPlayers(database, { poolId, region });
  const currentPatchPlayerMatches = countCurrentPatchPlayerMatches(database, {
    poolId,
    region,
    patch: window.patch
  });

  const perPlayer = new Map();
  for (const row of window.rows) {
    const entry = perPlayer.get(row.playerId) ?? {
      playerId: row.playerId,
      displayName: row.playerDisplayName,
      count: 0
    };
    entry.count += 1;
    perPlayer.set(row.playerId, entry);
  }

  const playerSamples = [...perPlayer.values()]
    .map((sample) => ({
      ...sample,
      tier: playerSampleTier(sample.count)
    }))
    .sort((a, b) => b.count - a.count || a.playerId.localeCompare(b.playerId));

  return {
    poolId,
    region,
    currentPatch: window.patch,
    trackedPlayers,
    playersWithData: perPlayer.size,
    playersMeetingTarget: [...perPlayer.values()].filter(
      (sample) => sample.count >= perPlayerLimit
    ).length,
    perPlayerMatchWindow: perPlayerLimit,
    availablePlayerMatches: window.rows.length,
    maximumPlayerMatches: trackedPlayers * perPlayerLimit,
    uniqueMatches: new Set(window.rows.map((row) => row.matchId)).size,
    currentPatchPlayerMatches,
    playerSamples
  };
}

function getCompTrends(
  windowRows,
  { trackedPlayers, totalPlayerMatches }
) {
  const groups = new Map();
  let unknownCount = 0;

  for (const row of windowRows) {
    const signature = row.compFamilySignature;
    if (!signature) {
      unknownCount += 1;
      continue;
    }
    const group = groups.get(signature) ?? {
      compSignature: signature,
      playerMatchCount: 0,
      players: new Set(),
      placements: [],
      top4Count: 0,
      winCount: 0,
      eighthCount: 0,
      boards: new Map(),
      latestSeenAt: null
    };
    group.playerMatchCount += 1;
    group.players.add(row.playerId);
    if (Number.isFinite(row.placement)) {
      group.placements.push(row.placement);
      if (row.placement <= 4) {
        group.top4Count += 1;
      }
      if (row.placement === 1) {
        group.winCount += 1;
      }
      if (row.placement === 8) {
        group.eighthCount += 1;
      }
    }
    const boardKey = representativeBoardKey(row);
    const board = group.boards.get(boardKey) ?? {
      key: boardKey,
      count: 0,
      units: row.units ?? [],
      latestSeenAt: null
    };
    board.count += 1;
    if (!board.latestSeenAt || row.gameDatetime > board.latestSeenAt) {
      board.latestSeenAt = row.gameDatetime;
      board.units = row.units ?? board.units;
    }
    group.boards.set(boardKey, board);
    if (!group.latestSeenAt || row.gameDatetime > group.latestSeenAt) {
      group.latestSeenAt = row.gameDatetime;
    }
    groups.set(signature, group);
  }

  const denominator = totalPlayerMatches > 0 ? totalPlayerMatches : 1;
  const trends = [...groups.values()]
    .map((group) => {
      const sampleCount = group.placements.length;
      const canComparePerformance = group.playerMatchCount >= 5;
      const observedAvgPlacement = sampleCount
        ? round(group.placements.reduce((a, b) => a + b, 0) / sampleCount)
        : null;
      const observedTop4Rate = sampleCount > 0
        ? round(group.top4Count / sampleCount)
        : null;
      const observedWinRate = sampleCount > 0
        ? round(group.winCount / sampleCount)
        : null;
      const observedEighthRate = sampleCount > 0
        ? round(group.eighthCount / sampleCount)
        : null;
      const representativeBoard = [...group.boards.values()].sort(
        (a, b) => b.count - a.count
          || String(b.latestSeenAt ?? "").localeCompare(String(a.latestSeenAt ?? ""))
          || a.key.localeCompare(b.key)
      )[0] ?? null;
      const rating = compRating({
        avgPlacement: observedAvgPlacement,
        top4Rate: observedTop4Rate,
        winRate: observedWinRate,
        eighthRate: observedEighthRate,
        sampleCount
      });
      return {
        compSignature: group.compSignature,
        playerMatchCount: group.playerMatchCount,
        playerMatchShare: round(group.playerMatchCount / denominator),
        playerCoverage: group.players.size,
        playerCoverageRate: round(
          trackedPlayers > 0 ? group.players.size / trackedPlayers : 0
        ),
        avgPlacement: canComparePerformance ? observedAvgPlacement : null,
        top4Rate:
          canComparePerformance && sampleCount > 0
            ? observedTop4Rate
            : null,
        winRate: canComparePerformance ? observedWinRate : null,
        eighthRate: canComparePerformance ? observedEighthRate : null,
        observedAvgPlacement,
        observedTop4Rate,
        observedWinRate,
        observedEighthRate,
        ratingGrade: rating.grade,
        ratingScore: rating.score,
        performanceComparable: canComparePerformance,
        representativeBoardCount: representativeBoard?.count ?? 0,
        representativeUnits: representativeBoard?.units ?? [],
        sampleCount,
        sampleTier: compSampleTier(group.playerMatchCount),
        latestSeenAt: group.latestSeenAt
      };
    })
    .sort(
      (a, b) =>
        b.playerMatchCount - a.playerMatchCount ||
        (a.avgPlacement ?? 99) - (b.avgPlacement ?? 99) ||
        a.compSignature.localeCompare(b.compSignature)
    );

  return {
    compTrends: trends,
    unclassifiedPlayerMatches: unknownCount,
    denominatorPlayerMatches: totalPlayerMatches
  };
}

function getCompAnalysis(compTrends) {
  const rows = (compTrends ?? []).filter(
    (comp) => Number.isFinite(comp.observedAvgPlacement) && comp.playerMatchCount > 0
  );
  const comparable = rows.filter((comp) => comp.performanceComparable);
  // These summary cards describe the observed values shown in the table.
  // Do not silently remove low-sample rows here: that made a 20% top-four
  // comp appear as the leader while two visible 50% comps were ignored.
  const candidates = rows;
  const by = (selector, direction = "desc") => [...candidates].sort((a, b) => {
    const left = selector(a);
    const right = selector(b);
    const compared = direction === "asc" ? left - right : right - left;
    return compared || b.playerMatchCount - a.playerMatchCount
      || a.compSignature.localeCompare(b.compSignature);
  })[0] ?? null;
  return {
    sampleMode: rows.length ? "observed" : "none",
    comparableCompCount: comparable.length,
    mostPlayed: by((comp) => comp.playerMatchCount),
    bestAveragePlacement: by((comp) => comp.observedAvgPlacement, "asc"),
    highestTop4Rate: by((comp) => comp.observedTop4Rate ?? -1),
    highestWinRate: by((comp) => comp.observedWinRate ?? -1),
    highestEighthRate: by((comp) => comp.observedEighthRate ?? -1)
  };
}

function getUnitTrends(windowRows, { trackedPlayers, totalPlayerMatches }) {
  const groups = new Map();

  for (const row of windowRows) {
    for (const unit of row.units) {
      const unitId = unit?.characterId ?? unit?.name ?? null;
      if (!unitId) {
        continue;
      }
      const group = groups.get(unitId) ?? {
        unitId,
        appearances: 0,
        players: new Set(),
        placements: [],
        top4Count: 0,
        items: new Map(),
        latestSeenAt: null
      };
      group.appearances += 1;
      group.players.add(row.playerId);
      if (Number.isFinite(row.placement)) {
        group.placements.push(row.placement);
        if (row.placement <= 4) {
          group.top4Count += 1;
        }
      }
      const items = Array.isArray(unit.itemNames)
        ? unit.itemNames.filter((item) => typeof item === "string")
        : [];
      for (const item of items) {
        group.items.set(item, (group.items.get(item) ?? 0) + 1);
      }
      if (!group.latestSeenAt || row.gameDatetime > group.latestSeenAt) {
        group.latestSeenAt = row.gameDatetime;
      }
      groups.set(unitId, group);
    }
  }

  const denominator = totalPlayerMatches > 0 ? totalPlayerMatches : 1;
  return [...groups.values()]
    .map((group) => {
      const sampleCount = group.placements.length;
      return {
        unitId: group.unitId,
        appearances: group.appearances,
        playerMatchShare: round(group.appearances / denominator),
        playerCoverage: group.players.size,
        playerCoverageRate: round(
          trackedPlayers > 0 ? group.players.size / trackedPlayers : 0
        ),
        avgPlacement: sampleCount
          ? round(group.placements.reduce((a, b) => a + b, 0) / sampleCount)
          : null,
        top4Rate:
          sampleCount > 0 ? round(group.top4Count / sampleCount) : null,
        topItems: [...group.items.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([item, count]) => ({ item, count })),
        latestSeenAt: group.latestSeenAt
      };
    })
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        (a.avgPlacement ?? 99) - (b.avgPlacement ?? 99) ||
        a.unitId.localeCompare(b.unitId)
    );
}

function combinations(items, size) {
  const result = [];
  const sorted = [...items].sort();
  const pick = (start, chosen) => {
    if (chosen.length === size) {
      result.push([...chosen]);
      return;
    }
    for (let index = start; index < sorted.length; index += 1) {
      chosen.push(sorted[index]);
      pick(index + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return result;
}

function getItemTrends(windowRows) {
  const items = new Map();
  const pairs = new Map();
  const triples = new Map();

  const recordCombo = (map, key, placement) => {
    const entry = map.get(key) ?? {
      key,
      count: 0,
      placements: []
    };
    entry.count += 1;
    if (Number.isFinite(placement)) {
      entry.placements.push(placement);
    }
    map.set(key, entry);
  };

  for (const row of windowRows) {
    for (const unit of row.units) {
      const unitItems = Array.isArray(unit?.itemNames)
        ? unit.itemNames.filter((item) => typeof item === "string")
        : [];
      const uniqueItems = [...new Set(unitItems)];
      for (const item of uniqueItems) {
        recordCombo(items, item, row.placement);
      }
      for (const pair of combinations(uniqueItems, 2)) {
        recordCombo(pairs, pair.join("+"), row.placement);
      }
      for (const triple of combinations(uniqueItems, 3)) {
        recordCombo(triples, triple.join("+"), row.placement);
      }
    }
  }

  const summarize = (map) =>
    [...map.values()]
      .map((entry) => ({
        key: entry.key,
        count: entry.count,
        avgPlacement:
          entry.placements.length > 0
            ? round(
                entry.placements.reduce((a, b) => a + b, 0) /
                  entry.placements.length
              )
            : null
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          (a.avgPlacement ?? 99) - (b.avgPlacement ?? 99) ||
          a.key.localeCompare(b.key)
      );

  return {
    items: summarize(items),
    pairs: summarize(pairs),
    triples: summarize(triples)
  };
}

function getPatchDistribution(database, { poolId, region = "na" }) {
  return database
    .prepare(
      `SELECT m.patch_label, MAX(m.game_version) AS latest_version,
              COUNT(*) AS matches,
              COUNT(DISTINCT f.player_id) AS players,
              MAX(m.game_datetime) AS latest
       FROM player_match_fact f
       JOIN match_record m ON m.match_id = f.match_id
       JOIN tracked_player p ON p.id = f.player_id
       JOIN pool_player pp ON pp.player_id = p.id AND pp.pool_id = ?
       WHERE p.region = ? AND p.active = 1
         AND m.patch_label IS NOT NULL
       GROUP BY m.patch_label
       ORDER BY matches DESC, m.patch_label DESC`
    )
    .all(poolId, region)
    .map((row) => ({
      patch: row.patch_label,
      latestVersion: row.latest_version,
      matches: Number(row.matches),
      players: Number(row.players),
      latest: row.latest
    }));
}

function aggregatePool(
  database,
  {
    poolId,
    region = "na",
    patch = null,
    perPlayerLimit = 10,
    topComps = 20,
    topUnits = 20,
    topItems = 30
  } = {}
) {
  const overview = getPoolOverview(database, {
    poolId,
    region,
    patch,
    perPlayerLimit
  });
  const window = getPoolWindow(database, {
    poolId,
    region,
    patch: overview.currentPatch,
    perPlayerLimit
  });
  const totalPlayerMatches = window.rows.length;

  const comps = getCompTrends(window.rows, {
    trackedPlayers: overview.trackedPlayers,
    totalPlayerMatches
  });
  const units = getUnitTrends(window.rows, {
    trackedPlayers: overview.trackedPlayers,
    totalPlayerMatches
  });
  const items = getItemTrends(window.rows);
  const patchDistribution = getPatchDistribution(database, { poolId, region });

  return {
    overview,
    patchDistribution,
    compTrends: comps.compTrends.slice(0, topComps),
    compAnalysis: getCompAnalysis(comps.compTrends),
    unclassifiedPlayerMatches: comps.unclassifiedPlayerMatches,
    unitTrends: units.slice(0, topUnits),
    itemTrends: {
      items: items.items.slice(0, topItems),
      pairs: items.pairs.slice(0, topItems),
      triples: items.triples.slice(0, topItems)
    }
  };
}

export {
  playerSampleTier,
  compSampleTier,
  getCurrentPatch,
  getPoolWindow,
  getPoolOverview,
  getCompTrends,
  getCompAnalysis,
  getUnitTrends,
  getItemTrends,
  getPatchDistribution,
  aggregatePool
};
