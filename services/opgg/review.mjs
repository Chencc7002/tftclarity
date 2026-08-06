/**
 * Phase 3 structured review: single-match review and player recent-N review.
 *
 * Only deterministic, field-traceable conclusions are generated (MVP doc
 * section 11). Round-by-round operations (level-up timings, roll timings,
 * transition boards, positioning) are NEVER generated because the data
 * source only exposes final board state.
 */

import { playerSampleTier } from "./aggregator.mjs";

const DATA_BOUNDARY_NOTE =
  "当前复盘基于对局结束时的最终状态，不包含逐回合经济、搜牌、升级和站位记录。";

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return (
    values.reduce((sum, value) => sum + value, 0) / values.length
  );
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unitItemCount(unit) {
  return Array.isArray(unit?.itemNames)
    ? unit.itemNames.filter((item) => typeof item === "string").length
    : 0;
}

function unitCost(unit) {
  if (Number.isFinite(Number(unit?.cost))) {
    return Number(unit.cost);
  }
  return Number.isFinite(Number(unit?.rarity))
    ? Number(unit.rarity) + 1
    : null;
}

/**
 * Pick the most likely carry (most items, then highest rarity/star) and
 * tank (second-best item-carrying unit), mirroring signature logic.
 */
function pickCarryAndTank(units) {
  const ordered = [...units]
    .map((unit) => ({
      unit,
      id: unit?.characterId ?? unit?.name ?? null,
      displayName: unit?.displayName ?? unit?.characterId ?? unit?.name ?? null,
      itemCount: unitItemCount(unit),
      cost: unitCost(unit) ?? 0,
      tier: Number(unit?.tier ?? 1)
    }))
    .filter((entry) => entry.id)
    .sort(
      (a, b) =>
        b.itemCount - a.itemCount ||
        b.cost - a.cost ||
        b.tier - a.tier ||
        String(a.id).localeCompare(String(b.id))
    );

  return {
    carry: ordered[0] ?? null,
    tank: ordered[1] ?? null
  };
}

function buildMatchReview(
  match,
  { recentPlacements = [], recentLevels = [] } = {}
) {
  const traits = Array.isArray(match.traits) ? match.traits : [];
  const units = Array.isArray(match.units) ? match.units : [];
  const dataComplete =
    match.placement !== null &&
    match.placement !== undefined &&
    match.level !== null &&
    match.level !== undefined &&
    traits.length > 0 &&
    units.length > 0;

  const { carry, tank } = pickCarryAndTank(units);
  const highCostCount = units.filter(
    (unit) => (unitCost(unit) ?? 0) >= 4
  ).length;
  const recentAvgPlacement = mean(recentPlacements);
  const recentAvgLevel = mean(recentLevels);

  const conclusions = [];

  if (recentAvgPlacement !== null && match.placement !== null) {
    const diff = round(match.placement - recentAvgPlacement);
    if (match.placement < recentAvgPlacement) {
      conclusions.push({
        conclusion: `该局最终名次高于该玩家近期平均名次（本局第${match.placement}名 vs 近期平均${round(recentAvgPlacement)}名）。`,
        evidence: ["placement", "recentAvgPlacement"]
      });
    } else if (match.placement > recentAvgPlacement) {
      conclusions.push({
        conclusion: `该局最终名次低于该玩家近期平均名次（本局第${match.placement}名 vs 近期平均${round(recentAvgPlacement)}名）。`,
        evidence: ["placement", "recentAvgPlacement"]
      });
    }
  }

  if (match.lastRound !== null && match.lastRound !== undefined) {
    if (match.lastRound <= 10) {
      conclusions.push({
        conclusion: `第${match.lastRound}回合出局，属于早期淘汰局；当前数据只能展示最终状态，无法复盘运营过程。`,
        evidence: ["lastRound"]
      });
    }
  }

  if (!dataComplete) {
    conclusions.push({
      conclusion:
        "该局缺少完整棋子/羁绊数据（极早淘汰或数据缺失），不纳入阵容趋势。",
      evidence: ["traits", "units", "placement", "level"]
    });
  } else {
    if (match.placement !== null && match.placement <= 4) {
      conclusions.push({
        conclusion: `该局进入前四（第${match.placement}名）。`,
        evidence: ["placement"]
      });
    }

    if (match.level !== null && match.level >= 9 && carry && carry.tier < 2) {
      conclusions.push({
        conclusion: `该局达到高人口（Lv${match.level}），但核心 ${carry.displayName} 未达到两星。`,
        evidence: ["level", "carry"]
      });
    }

    if (tank && tank.itemCount === 3) {
      conclusions.push({
        conclusion: `核心 ${tank.displayName} 装备完整（三件套）。`,
        evidence: ["tank"]
      });
    }

    if (carry && carry.itemCount < 3) {
      conclusions.push({
        conclusion: `核心 ${carry.displayName} 第三件输出装不完整（仅 ${carry.itemCount} 件）。`,
        evidence: ["carry"]
      });
    }

    if (highCostCount >= 3) {
      conclusions.push({
        conclusion: `该局属于高费运营阵容（${highCostCount} 名 4 费以上棋子）。`,
        evidence: ["units"]
      });
    }

    if (recentAvgLevel !== null && match.level !== null) {
      if (match.level > recentAvgLevel + 0.5) {
        conclusions.push({
          conclusion: `该局人口高于玩家近期平均水平（Lv${match.level} vs 平均Lv${round(recentAvgLevel)}）。`,
          evidence: ["level", "recentAvgLevel"]
        });
      }
    }
  }

  const facts = {
    matchId: match.matchId,
    gameDatetime: match.gameDatetime,
    patchLabel: match.patchLabel ?? null,
    gameVersion: match.gameVersion ?? null,
    placement: match.placement ?? null,
    level: match.level ?? null,
    goldLeft: match.goldLeft ?? null,
    lastRound: match.lastRound ?? null,
    playersEliminated: match.playersEliminated ?? null,
    traits: traits.map((trait) => ({
      name: trait?.name ?? null,
      displayName: trait?.displayName ?? trait?.name ?? null,
      numUnits: trait?.numUnits ?? null,
      style: trait?.style ?? null
    })),
    units: units.map((unit) => ({
      characterId: unit?.characterId ?? unit?.name ?? null,
      displayName: unit?.displayName ?? unit?.characterId ?? unit?.name ?? null,
      rarity: unit?.rarity ?? null,
      cost: unitCost(unit),
      tier: unit?.tier ?? null,
      iconUrl: unit?.iconUrl ?? null,
      fallbackIconUrl: unit?.fallbackIconUrl ?? null,
      assetFallback: Boolean(unit?.assetFallback),
      itemNames: Array.isArray(unit?.itemNames) ? unit.itemNames : [],
      items: Array.isArray(unit?.items)
        ? unit.items.map((item) => ({
            apiName: item?.apiName ?? null,
            displayName: item?.displayName ?? item?.apiName ?? null,
            iconUrl: item?.iconUrl ?? null,
            assetFallback: Boolean(item?.assetFallback)
          }))
        : [],
      itemDisplayNames: Array.isArray(unit?.itemDisplayNames)
        ? unit.itemDisplayNames
        : Array.isArray(unit?.itemNames)
          ? unit.itemNames
          : []
    })),
    compFamilySignature: match.compFamilySignature ?? null,
    exactBoardSignature: match.exactBoardSignature ?? null,
    dataComplete,
    vsRecentAverage: {
      placementDiff: round(
        match.placement !== null && recentAvgPlacement !== null
          ? match.placement - recentAvgPlacement
          : null
      ),
      recentAvgPlacement: round(recentAvgPlacement),
      recentAvgLevel: round(recentAvgLevel)
    }
  };

  return {
    facts,
    conclusions,
    dataBoundaryNote: DATA_BOUNDARY_NOTE
  };
}

/**
 * Player review over the most recent N matches (input should already be
 * limited to the desired window, sorted newest first).
 */
function buildPlayerReview(matches, { windowSize = 10 } = {}) {
  const window = matches.slice(0, windowSize);
  const count = window.length;
  const placements = window
    .map((match) => match.placement)
    .filter((value) => Number.isFinite(value));
  const levels = window
    .map((match) => match.level)
    .filter((value) => Number.isFinite(value));
  const completeCount = window.filter(
    (match) =>
      match.placement !== null &&
      match.placement !== undefined &&
      Array.isArray(match.traits) &&
      match.traits.length > 0 &&
      Array.isArray(match.units) &&
      match.units.length > 0
  ).length;

  const compPreferences = new Map();
  for (const match of window) {
    if (!match.compFamilySignature) {
      continue;
    }
    compPreferences.set(
      match.compFamilySignature,
      (compPreferences.get(match.compFamilySignature) ?? 0) + 1
    );
  }

  const sampleTier = playerSampleTier(count);
  const styleNote =
    count < 5
      ? `样本不足（${count}/${windowSize} 场），不输出长期稳定风格结论。`
      : count < windowSize
        ? `样本有限（${count}/${windowSize} 场），趋势结论仅供参考。`
        : `样本充足（${count}/${windowSize} 场）。`;

  const matchReviews = window.map((match) => {
    const otherPlacements = window
      .filter((candidate) => candidate.matchId !== match.matchId)
      .map((candidate) => candidate.placement)
      .filter((value) => Number.isFinite(value));
    const otherLevels = window
      .filter((candidate) => candidate.matchId !== match.matchId)
      .map((candidate) => candidate.level)
      .filter((value) => Number.isFinite(value));
    return buildMatchReview(match, {
      recentPlacements: otherPlacements,
      recentLevels: otherLevels
    });
  });

  return {
    playerId: window[0]?.playerId ?? null,
    windowSize,
    accumulatedMatches: count,
    accumulatedLabel: `当前已积累 ${count}/${windowSize} 场`,
    sampleTier,
    styleNote,
    stats: {
      avgPlacement: placements.length
        ? round(placements.reduce((a, b) => a + b, 0) / placements.length)
        : null,
      top4Rate:
        placements.length > 0
          ? round(
              placements.filter((placement) => placement <= 4).length /
                placements.length
            )
          : null,
      avgLevel: levels.length
        ? round(levels.reduce((a, b) => a + b, 0) / levels.length)
        : null,
      bestPlacement: placements.length ? Math.min(...placements) : null,
      worstPlacement: placements.length ? Math.max(...placements) : null,
      completeMatches: completeCount
    },
    compPreferences: [...compPreferences.entries()]
      .map(([compSignature, countValue]) => ({
        compSignature,
        count: countValue,
        share: count > 0 ? round(countValue / count) : 0
      }))
      .sort((a, b) => b.count - a.count),
    matches: matchReviews,
    dataBoundaryNote: DATA_BOUNDARY_NOTE
  };
}

export {
  DATA_BOUNDARY_NOTE,
  buildMatchReview,
  buildPlayerReview
};
