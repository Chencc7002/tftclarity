/**
 * Phase 2 trends CLI: aggregate a pool into comp/unit/item trends.
 *
 *   node scripts/opgg-trends.mjs                                   # default pool
 *   node scripts/opgg-trends.mjs --pool my-favorites
 *   node scripts/opgg-trends.mjs --patch 15.16.1 --per-player 10
 *   node scripts/opgg-trends.mjs --json                           # raw JSON output
 *
 * Output is desensitized (no PUUIDs, no other-player identities).
 */

import process from "node:process";
import {
  DEFAULT_DB_PATH,
  DEFAULT_POOL_ID,
  openDatabase,
  initSchema,
  backfillSignatures,
  backfillPatchLabels
} from "../services/opgg/collector.mjs";
import { aggregatePool } from "../services/opgg/aggregator.mjs";

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

function printOverview(overview) {
  console.log("=== 职业池概览 ===");
  console.log(
    `池: ${overview.poolId} | 区服: ${overview.region} | 当前补丁: ${overview.currentPatch ?? "无数据"}`
  );
  console.log(
    `追踪选手: ${overview.trackedPlayers} | 有数据: ${overview.playersWithData} | ` +
      `达标(≥${overview.perPlayerMatchWindow}场): ${overview.playersMeetingTarget}`
  );
  console.log(
    `当前样本: ${overview.availablePlayerMatches}/${overview.maximumPlayerMatches} player-match | ` +
      `唯一对局: ${overview.uniqueMatches} | 当前补丁全部: ${overview.currentPatchPlayerMatches}`
  );
  for (const sample of overview.playerSamples) {
    console.log(
      `  ${sample.displayName}: ${sample.count}/${overview.perPlayerMatchWindow} 场 [${sample.tier}]`
    );
  }
}

function printPatchDistribution(rows) {
  console.log("\n=== 补丁分布 ===");
  for (const row of rows) {
    console.log(
      `  ${row.patch}: ${row.matches} 场 / ${row.players} 名选手 ` +
        `(最新 ${row.latest ?? "-"}, 构建 ${row.latestVersion ?? "-"})`
    );
  }
}

function printCompTrends(rows, unclassified, denominator) {
  console.log("\n=== 阵容趋势 ===");
  if (rows.length === 0) {
    console.log("  (无已分类阵容)");
  }
  for (const comp of rows) {
    const tierMark =
      comp.sampleTier === "confident"
        ? ""
        : ` [${comp.sampleTier}]`;
    console.log(
      `  ${comp.playerMatchCount.toString().padStart(2)} 场 | ` +
        `${(comp.playerMatchShare * 100).toFixed(1).padStart(4)}% | ` +
        `覆盖 ${comp.playerCoverage}/${denominator} | ` +
        `均名次 ${comp.avgPlacement ?? "-"} | 前四率 ${comp.top4Rate ?? "-"}` +
        ` | ${comp.compSignature}${tierMark}`
    );
  }
  if (unclassified > 0) {
    console.log(`  (未分类: ${unclassified} 场)`);
  }
}

function printUnitTrends(rows) {
  console.log("\n=== 单位出场率 ===");
  if (rows.length === 0) {
    console.log("  (无数据)");
  }
  for (const unit of rows) {
    const items = unit.topItems
      .map((entry) => `${entry.item}(${entry.count})`)
      .join(", ");
    console.log(
      `  ${unit.appearances.toString().padStart(2)} 次 | ` +
        `覆盖 ${unit.playerCoverage} | ` +
        `均名次 ${unit.avgPlacement ?? "-"} | 前四率 ${unit.top4Rate ?? "-"}` +
        ` | ${unit.unitId}${items ? ` | 装: ${items}` : ""}`
    );
  }
}

function printItemTrends(itemTrends) {
  console.log("\n=== 装备统计 ===");
  console.log("单件:");
  for (const row of itemTrends.items.slice(0, 10)) {
    console.log(
      `  ${row.count.toString().padStart(2)} 次 | 均名次 ${row.avgPlacement ?? "-"} | ${row.key}`
    );
  }
  console.log("两件套:");
  for (const row of itemTrends.pairs.slice(0, 10)) {
    console.log(
      `  ${row.count.toString().padStart(2)} 次 | 均名次 ${row.avgPlacement ?? "-"} | ${row.key}`
    );
  }
  console.log("三件套:");
  for (const row of itemTrends.triples.slice(0, 10)) {
    console.log(
      `  ${row.count.toString().padStart(2)} 次 | 均名次 ${row.avgPlacement ?? "-"} | ${row.key}`
    );
  }
}

function printSampleWarnings(overview) {
  const warnings = [];
  for (const sample of overview.playerSamples) {
    if (sample.tier === "no_data") {
      warnings.push(`${sample.displayName}: 暂无数据`);
    } else if (sample.tier === "recent_only") {
      warnings.push(`${sample.displayName}: 仅 ${sample.count} 场，只展示最近对局`);
    } else if (sample.tier === "recent_attempts") {
      warnings.push(`${sample.displayName}: 仅 ${sample.count} 场，展示近期尝试，不做稳定风格判断`);
    } else if (sample.tier === "insufficient") {
      warnings.push(`${sample.displayName}: 仅 ${sample.count} 场，样本不足`);
    }
  }
  if (warnings.length > 0) {
    console.log("\n=== 样本提示 ===");
    for (const warning of warnings) {
      console.log(`  ${warning}`);
    }
  }
}

async function main() {
  const dbPath = argument("db") ?? DEFAULT_DB_PATH;
  const poolId = argument("pool") ?? DEFAULT_POOL_ID;
  const region = argument("region") ?? "na";
  const patch = argument("patch") ?? null;
  const perPlayerLimit = Number(argument("per-player") ?? "10");
  const topComps = Number(argument("top-comps") ?? "20");
  const topUnits = Number(argument("top-units") ?? "20");
  const topItems = Number(argument("top-items") ?? "30");

  const database = await openDatabase(dbPath);
  initSchema(database);
  const backfilled = backfillSignatures(database);
  if (backfilled > 0) {
    console.log(`Backfilled signatures for ${backfilled} fact(s).`);
  }
  const patchBackfilled = backfillPatchLabels(database);
  if (patchBackfilled > 0) {
    console.log(`Backfilled patch labels for ${patchBackfilled} match(es).`);
  }

  const result = aggregatePool(database, {
    poolId,
    region,
    patch,
    perPlayerLimit,
    topComps,
    topUnits,
    topItems
  });
  database.close();

  if (hasFlag("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printOverview(result.overview);
  printPatchDistribution(result.patchDistribution);
  printCompTrends(
    result.compTrends,
    result.unclassifiedPlayerMatches,
    result.overview.trackedPlayers
  );
  printUnitTrends(result.unitTrends);
  printItemTrends(result.itemTrends);
  printSampleWarnings(result.overview);
}

main().catch((error) => {
  console.error(`OP.GG trends failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
