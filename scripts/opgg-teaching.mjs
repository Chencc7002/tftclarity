/**
 * Phase 4 teaching CLI.
 *
 *   node scripts/opgg-teaching.mjs --player broseph-lab
 *   node scripts/opgg-teaching.mjs --player broseph-lab --match NA1_5604142769
 *   node scripts/opgg-teaching.mjs --player broseph-lab --dry-run
 *   node scripts/opgg-teaching.mjs --player broseph-lab --json
 *
 * Uses the project's existing coach LLM provider (TFT_AGENT_COACH_MODE /
 * TFT_AGENT_CONCLUSION_MODE config). Falls back to deterministic rules when
 * the LLM is disabled or fails evidence validation.
 */

import "dotenv/config";
import process from "node:process";
import {
  resolveCoachProviderConfig,
  createOpenAICompatibleCoachProvider
} from "../src/coach/coach-provider.js";
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
import {
  buildTeachingEvidence,
  generateTeaching,
  TEACHING_SYSTEM_PROMPT
} from "../services/opgg/teaching.mjs";

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

function printTeaching(result) {
  console.log(`=== 教学点评 [${result.source}] ===`);
  console.log(`标题: ${result.headline}`);
  console.log(`\n${result.text}\n`);
  if (result.reasons?.length > 0) {
    console.log("理由:");
    for (const reason of result.reasons) {
      console.log(`  - [${reason.dimension}] ${reason.text}`);
      console.log(`    证据: ${reason.evidenceIds.join(", ")}`);
    }
  }
  if (result.alternatives?.length > 0) {
    console.log("替代建议:");
    for (const alternative of result.alternatives) {
      console.log(`  - ${alternative.text}`);
    }
  }
  if (result.warnings?.length > 0) {
    console.log("提示:");
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  if (result.source === "llm") {
    console.log(
      `校验: ${result.validated ? "通过" : "未通过"} ` +
        `(缺失引用=${result.validation?.missingRefs?.length ?? 0}, ` +
        `异常引用=${result.validation?.badCitations?.length ?? 0}, ` +
        `幻觉命中=${result.validation?.blockedClaims?.length ?? 0})`
    );
  } else if (result.reason) {
    console.log(`降级原因: ${result.reason}`);
  }
}

async function main() {
  const dbPath = argument("db") ?? DEFAULT_DB_PATH;
  const playerId = argument("player");
  const matchId = argument("match");
  const question =
    argument("question") ?? "请点评这名选手最近的战绩并给出教学建议。";
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

  let review;
  if (matchId) {
    const target = matches.find((match) => match.matchId === matchId);
    if (!target) {
      throw new Error(`Match ${matchId} not found for player ${playerId}.`);
    }
    const others = matches.filter((match) => match.matchId !== matchId);
    const single = buildMatchReview(target, {
      recentPlacements: others.map((match) => match.placement),
      recentLevels: others.map((match) => match.level)
    });
    review = {
      windowSize: 10,
      accumulatedMatches: 1,
      accumulatedLabel: `单场复盘（${matchId}）`,
      sampleTier: "recent_only",
      styleNote: "单场教学仅解释该局终局状态，不做长期风格判断。",
      stats: {
        avgPlacement: single.facts.vsRecentAverage.recentAvgPlacement,
        top4Rate: null,
        avgLevel: single.facts.vsRecentAverage.recentAvgLevel,
        bestPlacement: single.facts.placement,
        worstPlacement: single.facts.placement,
        completeMatches: single.facts.dataComplete ? 1 : 0
      },
      compPreferences: single.facts.compFamilySignature
        ? [
            {
              compSignature: single.facts.compFamilySignature,
              count: 1,
              share: 1
            }
          ]
        : [],
      matches: [single],
      dataBoundaryNote: single.dataBoundaryNote
    };
  } else {
    review = buildPlayerReview(matches, { windowSize: Number(argument("limit") ?? "10") });
  }

  const playerRow = database
    .prepare(`SELECT display_name, region FROM tracked_player WHERE id = ?`)
    .get(playerId);
  const evidence = buildTeachingEvidence(review, {
    playerId,
    displayName: playerRow?.display_name ?? playerId,
    poolId: argument("pool") ?? "default-na-pro",
    region: playerRow?.region ?? "na"
  });

  if (hasFlag("dry-run")) {
    console.log(JSON.stringify({ evidence, systemPrompt: TEACHING_SYSTEM_PROMPT }, null, 2));
    return;
  }

  const timeoutMs = Number(argument("timeout-ms") ?? "120000");
  const maxOutputTokens = Number(argument("max-tokens") ?? "8000");
  const config = resolveCoachProviderConfig(
    { timeoutMs, maxOutputTokens },
    process.env
  );
  const provider = config.enabled
    ? createOpenAICompatibleCoachProvider({
        ...config,
        systemPrompt: TEACHING_SYSTEM_PROMPT
      })
    : null;
  const result = await generateTeaching({
    evidence,
    provider,
    question,
    strict: !hasFlag("no-strict")
  });

  if (hasFlag("json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTeaching(result);
  }
}

main().catch((error) => {
  console.error(`OP.GG teaching failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
