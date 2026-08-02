/**
 * Phase 3 review CLI.
 *
 *   node scripts/opgg-review.mjs --player broseph-lab
 *   node scripts/opgg-review.mjs --player broseph-lab --match NA1_5603228956
 *   node scripts/opgg-review.mjs --player broseph-lab --json
 *
 * Deterministic conclusions only; no PUUIDs or other-player identities.
 */

import process from "node:process";
import {
  DEFAULT_DB_PATH,
  openDatabase,
  initSchema,
  backfillSignatures,
  backfillPatchLabels,
  listPlayerMatches
} from "../services/opgg/collector.mjs";
import {
  buildMatchReview,
  buildPlayerReview
} from "../services/opgg/review.mjs";

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const flagIndex = process.argv.indexOf(`--${name}`);
  if (flagIndex !== -1 && process.argv[flagIndex + 1] !== undefined) {
    return process.argv[flagIndex + 1];
  }
  return null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printPlayerReview(review) {
  console.log(`=== ${review.accumulatedLabel} ===`);
  console.log(
    `样本: ${review.sampleTier} | ` +
      `均名次 ${review.stats.avgPlacement ?? "-"} | ` +
      `前四率 ${review.stats.top4Rate ?? "-"} | ` +
      `平均人口 ${review.stats.avgLevel ?? "-"} | ` +
      `最佳/最差 ${review.stats.bestPlacement ?? "-"}/${review.stats.worstPlacement ?? "-"} | ` +
      `完整对局 ${review.stats.completeMatches}/${review.accumulatedMatches}`
  );
  console.log(`提示: ${review.styleNote}`);
  if (review.compPreferences.length > 0) {
    console.log("常玩阵容:");
    for (const comp of review.compPreferences) {
      console.log(
        `  ${comp.count} 场 (${(comp.share * 100).toFixed(0)}%) | ${comp.compSignature}`
      );
    }
  }
  console.log("\n=== 单场复盘 ===");
  for (const match of review.matches) {
    const facts = match.facts;
    console.log(
      `\n[${facts.matchId}] ${facts.gameDatetime ?? "?"} ` +
        `patch=${facts.patchLabel ?? "?"} | ` +
        `第${facts.placement ?? "?"}名 Lv${facts.level ?? "?"} ` +
        `金币${facts.goldLeft ?? "?"} 回合${facts.lastRound ?? "?"} ` +
        `淘汰${facts.playersEliminated ?? "?"}人`
    );
    console.log(`  阵容: ${facts.compFamilySignature ?? "未分类"}`);
    if (facts.vsRecentAverage.placementDiff !== null) {
      console.log(
        `  对比近期平均: ${facts.vsRecentAverage.placementDiff > 0 ? "+" : ""}${facts.vsRecentAverage.placementDiff} 名次`
      );
    }
    for (const conclusion of match.conclusions) {
      console.log(`  - ${conclusion.conclusion}`);
    }
    console.log(`  [数据边界] ${match.dataBoundaryNote}`);
  }
}

function printSingleMatch(review, playerId) {
  const facts = review.facts;
  console.log(`=== 单场复盘 ${playerId} ===`);
  console.log(
    `[${facts.matchId}] ${facts.gameDatetime ?? "?"} ` +
      `patch=${facts.patchLabel ?? "?"} | ` +
      `第${facts.placement ?? "?"}名 Lv${facts.level ?? "?"} ` +
      `金币${facts.goldLeft ?? "?"} 回合${facts.lastRound ?? "?"} ` +
      `淘汰${facts.playersEliminated ?? "?"}人`
  );
  console.log(`阵容: ${facts.compFamilySignature ?? "未分类"}`);
  console.log(`棋子:`);
  for (const unit of facts.units) {
    const items =
      unit.itemNames.length > 0 ? ` [${unit.itemNames.join(", ")}]` : "";
    console.log(
      `  ${unit.characterId} (${unit.rarity}费 ${unit.tier}星)${items}`
    );
  }
  console.log(`羁绊:`);
  for (const trait of facts.traits) {
    console.log(
      `  ${trait.name} x${trait.numUnits} (层级${trait.style})`
    );
  }
  for (const conclusion of review.conclusions) {
    console.log(`- ${conclusion.conclusion}`);
  }
  console.log(`[数据边界] ${review.dataBoundaryNote}`);
}

async function main() {
  const dbPath = argument("db") ?? DEFAULT_DB_PATH;
  const playerId = argument("player");
  const matchId = argument("match");
  const limit = Number(argument("limit") ?? "10");
  if (!playerId) {
    throw new Error("--player <id> is required");
  }

  const database = await openDatabase(dbPath);
  initSchema(database);
  backfillSignatures(database);
  backfillPatchLabels(database);

  const matches = listPlayerMatches(database, playerId, { limit: 50 });
  if (matches.length === 0) {
    console.log(`No accumulated matches for player "${playerId}".`);
    return;
  }

  if (matchId) {
    const target = matches.find((match) => match.matchId === matchId);
    if (!target) {
      throw new Error(
        `Match ${matchId} not found for player ${playerId}. Available: ` +
          matches.map((match) => match.matchId).join(", ")
      );
    }
    const others = matches.filter((match) => match.matchId !== matchId);
    const review = buildMatchReview(target, {
      recentPlacements: others.map((match) => match.placement),
      recentLevels: others.map((match) => match.level)
    });
    if (hasFlag("json")) {
      console.log(JSON.stringify(review, null, 2));
    } else {
      printSingleMatch(review, playerId);
    }
    return;
  }

  const review = buildPlayerReview(matches, { windowSize: limit });
  if (hasFlag("json")) {
    console.log(JSON.stringify(review, null, 2));
  } else {
    printPlayerReview(review);
  }
}

main().catch((error) => {
  console.error(`OP.GG review failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
