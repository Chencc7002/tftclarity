import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTeachingEvidence,
  resolveChampionPlaceholders,
  validateEvidenceRefs,
  validateAnswerShape,
  detectBannedClaims,
  generateTeaching
} from "../services/opgg/teaching.mjs";

function sampleReview() {
  return {
    windowSize: 10,
    accumulatedMatches: 2,
    accumulatedLabel: "当前已积累 2/10 场",
    sampleTier: "recent_only",
    styleNote: "样本不足（2/10 场），不输出长期稳定风格结论。",
    stats: {
      avgPlacement: 3.5,
      top4Rate: 0.5,
      avgLevel: 8,
      bestPlacement: 1,
      worstPlacement: 6,
      completeMatches: 2
    },
    compPreferences: [
      {
        compSignature: "set17|trait:TFT17_DRX|carry:TFT17_Karma",
        count: 2,
        share: 1
      }
    ],
    matches: [
      {
        facts: {
          matchId: "NA1_1",
          gameDatetime: "2026-07-28T12:00:00.000Z",
          patchLabel: "16.14",
          placement: 2,
          level: 9,
          goldLeft: 1,
          lastRound: 31,
          playersEliminated: 1,
          compFamilySignature: "set17|trait:TFT17_DRX|carry:TFT17_Karma",
          traits: [{ name: "TFT17_DRX", numUnits: 4, style: 3 }],
          units: [
            {
              characterId: "TFT17_Karma",
              rarity: 4,
              tier: 2,
              itemNames: ["A", "B", "C"]
            }
          ],
          vsRecentAverage: {
            placementDiff: -1.5,
            recentAvgPlacement: 3.5,
            recentAvgLevel: 8
          }
        },
        conclusions: [
          { conclusion: "该局进入前四。", evidence: ["placement"] }
        ]
      },
      {
        facts: {
          matchId: "NA1_2",
          gameDatetime: "2026-07-27T12:00:00.000Z",
          patchLabel: "16.14",
          placement: 5,
          level: 7,
          goldLeft: 0,
          lastRound: 28,
          playersEliminated: 0,
          compFamilySignature: "set17|trait:TFT17_DRX|carry:TFT17_Karma",
          traits: [{ name: "TFT17_DRX", numUnits: 4, style: 3 }],
          units: [
            {
              characterId: "TFT17_Karma",
              rarity: 4,
              tier: 1,
              itemNames: ["A", "B"]
            }
          ],
          vsRecentAverage: {
            placementDiff: 1.5,
            recentAvgPlacement: 3.5,
            recentAvgLevel: 8
          }
        },
        conclusions: []
      }
    ],
    dataBoundaryNote:
      "当前复盘基于对局结束时的最终状态，不包含逐回合经济、搜牌、升级和站位记录。"
  };
}

test("evidence bundle contains no identities and exposes stable evidenceIds", () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });

  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes("puuid"));
  assert.ok(!serialized.includes("OtherPlayer"));
  assert.equal(evidence.matches.length, 2);
  assert.deepEqual(
    evidence.matches.map((match) => match.evidenceId),
    ["match:NA1_1", "match:NA1_2"]
  );
  assert.deepEqual(
    evidence.compPreferences.map((comp) => comp.evidenceId),
    ["comp:0"]
  );
  assert.equal(evidence.sample.accumulatedLabel, "当前已积累 2/10 场");
});

test("OP.GG play style comment templates are excluded from teaching evidence", () => {
  const withComments = buildTeachingEvidence(
    sampleReview(),
    {
      playerId: "p1",
      displayName: "P1",
      poolId: "pool-a",
      region: "na",
      playStyleComments: [
        { name: "Aggressive", description: "Prefers early tempo." }
      ]
    }
  );
  assert.deepEqual(withComments.opggPlayStyleComments, []);

  const valid = validateEvidenceRefs(
    {
      reasons: [{ dimension: "d", evidenceIds: ["opggstyle:0"], text: "t" }],
      alternatives: [],
      currentRecommendation: null,
      citations: []
    },
    withComments
  );
  assert.deepEqual(valid.missingRefs, ["opggstyle:0"]);
});

test("play style comments replace {championName} with the most played unit", () => {
  const review = sampleReview();
  review.matches[0].facts.units = [
    { characterId: "TFT17_Karma", rarity: 4, tier: 2, itemNames: [] },
    { characterId: "TFT17_Karma", rarity: 4, tier: 2, itemNames: [] }
  ];
  review.matches[1].facts.units = [
    { characterId: "TFT17_Sona", rarity: 6, tier: 2, itemNames: [] }
  ];
  const resolved = resolveChampionPlaceholders(
    [
      {
        name: "{championName} One Trick",
        description: "Always forces {championName} comps."
      }
    ],
    review
  );
  assert.equal(resolved[0].name, "Karma One Trick");
  assert.equal(resolved[0].description, "Always forces Karma comps.");

  const evidence = buildTeachingEvidence(review, {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na",
    playStyleComments: [
      { name: "{championName} One Trick", description: "Forces {championName}." }
    ]
  });
  assert.ok(!JSON.stringify(evidence).includes("{championName}"));
});

test("evidence reference validation flags missing refs and citations", () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });

  const valid = validateEvidenceRefs(
    {
      reasons: [
        { dimension: "d", evidenceIds: ["match:NA1_1", "stat:avgPlacement"], text: "t" }
      ],
      alternatives: [],
      currentRecommendation: { evidenceId: "comp:0", label: "x" },
      citations: ["NA1_1"]
    },
    evidence
  );
  assert.deepEqual(valid.missingRefs, []);
  assert.deepEqual(valid.badCitations, []);

  const invalid = validateEvidenceRefs(
    {
      reasons: [
        { dimension: "d", evidenceIds: ["match:NA1_999", "stat:none"], text: "t" }
      ],
      alternatives: [],
      currentRecommendation: null,
      citations: ["NA1_999"]
    },
    evidence
  );
  assert.deepEqual(invalid.missingRefs.sort(), ["match:NA1_999", "stat:none"]);
  assert.deepEqual(invalid.badCitations, ["NA1_999"]);
});

test("all exposed placement statistics are valid teaching evidence refs", () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });
  const validation = validateEvidenceRefs(
    {
      reasons: [{
        dimension: "名次区间",
        evidenceIds: ["stat:bestPlacement", "stat:worstPlacement"],
        text: "名次波动"
      }],
      alternatives: [],
      currentRecommendation: null,
      citations: []
    },
    evidence
  );
  assert.deepEqual(validation.missingRefs, []);
});

test("banned claim detector catches round-by-round hallucination patterns", () => {
  const hits = detectBannedClaims("他4-2拉8后搜牌，并调整了站位，中期过渡阵容很强");
  assert.ok(hits.some((hit) => hit.label === "round level-up/roll timing"));
  assert.ok(hits.some((hit) => hit.label === "rolling claim"));
  assert.ok(hits.some((hit) => hit.label === "positioning claim"));
  assert.ok(hits.some((hit) => hit.label === "transition board claim"));

  const clean = detectBannedClaims("该局第4名 Lv9，核心三件套完整，属于高费运营阵容。");
  assert.deepEqual(clean, []);

  const negated = detectBannedClaims(
    "当前数据不包含逐回合搜牌、站位和升级记录，也不含过渡阵容信息。"
  );
  assert.deepEqual(negated, []);

  const answerObject = detectBannedClaims({
    headline: "h",
    text: "该局高人口但核心未两星。",
    reasons: [{ text: "装备分配合理。" }],
    warnings: ["不包含搜牌、站位记录。"]
  });
  assert.deepEqual(answerObject, []);
});

test("answer shape validation requires the coach schema fields", () => {
  const missing = validateAnswerShape({
    schemaVersion: "coach_answer.v1",
    headline: "h",
    text: "t"
  });
  assert.ok(missing.includes("status"));
  assert.ok(missing.includes("reasons"));
  assert.ok(missing.includes("warnings"));

  const complete = validateAnswerShape({
    schemaVersion: "coach_answer.v1",
    status: "ok",
    headline: "h",
    text: "t",
    currentRecommendation: null,
    reasons: [],
    alternatives: [],
    citations: [],
    warnings: []
  });
  assert.deepEqual(complete, []);
});

test("generateTeaching falls back to deterministic rules when LLM is disabled", async () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });
  const result = await generateTeaching({ evidence, provider: null });

  assert.equal(result.source, "deterministic_fallback");
  assert.equal(result.validated, true);
  assert.equal(result.reason, "llm_disabled");
  assert.ok(result.text.includes("当前已积累 2/10 场"));
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("不输出长期稳定风格结论")
    )
  );
  assert.ok(result.warnings.some((warning) => warning.includes("逐回合")));

  const refs = result.reasons.flatMap((reason) => reason.evidenceIds);
  const valid = validateEvidenceRefs(result, evidence);
  assert.deepEqual(valid.missingRefs, []);
  assert.ok(refs.length > 0);
});

test("strict mode replaces unvalidated LLM output with deterministic fallback", async () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });

  const fakeProvider = async () => ({
    schemaVersion: "coach_answer.v1",
    status: "ok",
    headline: "h",
    text: "他在4-2拉8搜牌。",
    currentRecommendation: null,
    reasons: [
      { dimension: "d", evidenceIds: ["match:NA1_999"], text: "r" }
    ],
    alternatives: [],
    citations: [],
    warnings: []
  });

  const strict = await generateTeaching({
    evidence,
    provider: fakeProvider,
    strict: true
  });
  assert.equal(strict.source, "deterministic_fallback");
  assert.equal(strict.reason, "llm_validation_failed");
  assert.ok(strict.validation.missingRefs.includes("match:NA1_999"));
  assert.ok(strict.validation.blockedClaims.length > 0);

  const lax = await generateTeaching({
    evidence,
    provider: fakeProvider,
    strict: false
  });
  assert.equal(lax.source, "llm");
  assert.equal(lax.validated, false);
});

test("LLM output with invented schema is treated as invalid and falls back", async () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });
  const inventedSchemaProvider = async () => ({
    player: "P1",
    assessment: "最近表现不错",
    teachingAdvice: "多玩当前阵容"
  });

  const strict = await generateTeaching({
    evidence,
    provider: inventedSchemaProvider,
    strict: true
  });
  assert.equal(strict.source, "deterministic_fallback");
  assert.equal(strict.reason, "llm_validation_failed");
  assert.ok(strict.validation.missingShape.includes("headline"));
  assert.ok(strict.validation.missingShape.includes("reasons"));
});

test("LLM errors fall back to deterministic teaching", async () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });
  const failingProvider = async () => {
    throw new Error("network down");
  };
  const result = await generateTeaching({ evidence, provider: failingProvider });
  assert.equal(result.source, "deterministic_fallback");
  assert.equal(result.reason, "llm_error");
  assert.ok(result.llmError.includes("network down"));
});

test("validation failure triggers one corrective retry that can pass", async () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });
  const calls = [];
  const retryProvider = async ({ question }) => {
    calls.push(question);
    if (calls.length === 1) {
      return {
        schemaVersion: "coach_answer.v1",
        status: "ok",
        headline: "h",
        text: "他在4-2拉8搜牌。",
        currentRecommendation: null,
        reasons: [
          { dimension: "d", evidenceIds: ["match:NA1_999"], text: "r" }
        ],
        alternatives: [],
        citations: [],
        warnings: []
      };
    }
    return {
      schemaVersion: "coach_answer.v1",
      status: "ok",
      headline: "修正后",
      text: "核心星级不足影响排名。",
      currentRecommendation: null,
      reasons: [
        { dimension: "d", evidenceIds: ["match:NA1_1"], text: "r2" }
      ],
      alternatives: [],
      citations: ["NA1_1"],
      warnings: ["样本不足"]
    };
  };

  const result = await generateTeaching({
    evidence,
    provider: retryProvider,
    strict: true
  });
  assert.equal(result.source, "llm");
  assert.equal(result.validated, true);
  assert.equal(result.retried, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("上轮输出未通过校验"));
  assert.ok(result.text.includes("核心星级不足"));
});

test("corrective retry that still fails falls back safely", async () => {
  const evidence = buildTeachingEvidence(sampleReview(), {
    playerId: "p1",
    displayName: "P1",
    poolId: "pool-a",
    region: "na"
  });
  const calls = [];
  const badProvider = async () => {
    calls.push(1);
    return {
      schemaVersion: "coach_answer.v1",
      status: "ok",
      headline: "h",
      text: "他搜牌调整站位。",
      currentRecommendation: null,
      reasons: [],
      alternatives: [],
      citations: [],
      warnings: []
    };
  };

  const result = await generateTeaching({
    evidence,
    provider: badProvider,
    strict: true
  });
  assert.equal(result.source, "deterministic_fallback");
  assert.equal(result.reason, "llm_validation_failed");
  assert.equal(result.validation.retried, true);
  assert.equal(calls.length, 2);
  assert.ok(result.validation.blockedClaims.length > 0);
});
