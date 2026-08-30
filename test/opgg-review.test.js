import test from "node:test";
import assert from "node:assert/strict";
import { localizeMatch } from "../services/opgg/localization.mjs";
import {
  buildMatchReview,
  buildPlayerReview
} from "../services/opgg/review.mjs";

function match({
  matchId = "NA1_1",
  placement = 4,
  level = 9,
  goldLeft = 5,
  lastRound = 30,
  playersEliminated = 2,
  gameDatetime = "2026-07-28T12:00:00.000Z",
  patchLabel = "16.14",
  traits = [
    { name: "TFT17_DRX", numUnits: 4, style: 3 },
    { name: "TFT17_ResistTank", numUnits: 2, style: 2 }
  ],
  units = [
    {
      characterId: "TFT17_Karma",
      rarity: 5,
      tier: 1,
      itemNames: ["Sword", "Tear", "Glove"]
    },
    {
      characterId: "TFT17_Galio",
      rarity: 4,
      tier: 2,
      itemNames: ["Vest", "Belt", "Cloak"]
    },
    {
      characterId: "TFT17_Ahri",
      rarity: 4,
      tier: 2,
      itemNames: ["Rod"]
    }
  ],
  compFamilySignature = "set17|trait:TFT17_DRX|carry:TFT17_Karma|tank:TFT17_Galio"
}) {
  return {
    matchId,
    placement,
    level,
    goldLeft,
    lastRound,
    playersEliminated,
    gameDatetime,
    patchLabel,
    traits,
    units,
    compFamilySignature
  };
}

test("unknown unit cost remains unknown through localization and review", () => {
  const review = buildMatchReview(localizeMatch(match({ units: [
    { characterId: "DA_18_Aphelios", cost: null, rarity: null, tier: 2 },
    { characterId: "DA_18_Morgana", rarity: 3, tier: 2 },
    { characterId: "DA_18_Diana", cost: "", rarity: 2, tier: 2 },
    { characterId: "Unknown_Summon", cost: 0, rarity: null, tier: 1 }
  ] })));
  assert.deepEqual(review.facts.units.map((unit) => unit.cost), [null, 4, 3, 0]);
  assert.equal(review.facts.traits[0].tierCurrent, null);
});

test("single match review generates deterministic field-traceable conclusions", () => {
  const review = buildMatchReview(
    match({ placement: 3 }),
    { recentPlacements: [5, 6], recentLevels: [8, 8] }
  );

  const statements = review.conclusions.map((item) => item.conclusion);

  assert.ok(
    statements.some((text) => text.includes("高于该玩家近期平均名次"))
  );
  assert.ok(
    statements.some((text) => text.includes("高人口") && text.includes("未达到两星"))
  );
  assert.ok(statements.some((text) => text.includes("装备完整")));
  assert.ok(statements.some((text) => text.includes("高费运营阵容")));
  assert.ok(statements.some((text) => text.includes("进入前四")));

  assert.equal(review.facts.dataComplete, true);
  assert.equal(review.facts.vsRecentAverage.placementDiff, -2.5);
  assert.equal(review.facts.vsRecentAverage.recentAvgPlacement, 5.5);
  assert.ok(review.dataBoundaryNote.includes("不包含逐回合"));

  for (const conclusion of review.conclusions) {
    assert.ok(conclusion.evidence.length > 0);
    for (const field of conclusion.evidence) {
      assert.ok(
        field in review.facts ||
          field === "carry" ||
          field === "tank" ||
          field === "recentAvgPlacement" ||
          field === "recentAvgLevel"
      );
    }
  }
});

test("core unit with missing third item is flagged", () => {
  const review = buildMatchReview(
    match({
      units: [
        {
          characterId: "TFT17_Karma",
          rarity: 5,
          tier: 2,
          itemNames: ["Sword", "Tear"]
        },
        {
          characterId: "TFT17_Galio",
          rarity: 4,
          tier: 2,
          itemNames: ["Vest", "Belt"]
        }
      ]
    }),
    { recentPlacements: [4] }
  );

  assert.ok(
    review.conclusions.some((item) =>
      item.conclusion.includes("第三件输出装不完整")
    )
  );
});

test("match review preserves localized unit and item assets for UI cards", () => {
  const review = buildMatchReview(match({
    units: [{
      characterId: "TFT17_Karma",
      displayName: "卡尔玛",
      rarity: 4,
      tier: 2,
      iconUrl: "https://cdn.metatft.com/unit.png",
      fallbackIconUrl: "https://ddragon.leagueoflegends.com/unit.png",
      itemNames: ["TFT_Item_SpearOfShojin"],
      itemDisplayNames: ["朔极之矛"],
      items: [{
        apiName: "TFT_Item_SpearOfShojin",
        displayName: "朔极之矛",
        iconUrl: "https://ddragon.leagueoflegends.com/item.png"
      }]
    }]
  }));

  assert.equal(review.facts.units[0].iconUrl, "https://cdn.metatft.com/unit.png");
  assert.equal(review.facts.units[0].fallbackIconUrl, "https://ddragon.leagueoflegends.com/unit.png");
  assert.equal(review.facts.units[0].items[0].displayName, "朔极之矛");
  assert.equal(review.facts.units[0].items[0].iconUrl, "https://ddragon.leagueoflegends.com/item.png");
});

test("early elimination match is flagged and excluded from trend conclusions", () => {
  const review = buildMatchReview(
    match({
      placement: 8,
      level: 1,
      lastRound: 5,
      traits: [],
      units: [],
      compFamilySignature: null
    }),
    { recentPlacements: [4, 5] }
  );

  assert.equal(review.facts.dataComplete, false);
  const statements = review.conclusions.map((item) => item.conclusion);
  assert.ok(statements.some((text) => text.includes("早期淘汰局")));
  assert.ok(statements.some((text) => text.includes("不纳入阵容趋势")));
  assert.ok(
    !statements.some((text) => text.includes("高费运营"))
  );
});

test("player review reports accumulation progress and sample tiers", () => {
  const small = buildPlayerReview(
    [
      match({ matchId: "NA1_1", placement: 2 }),
      match({ matchId: "NA1_2", placement: 5 }),
      match({ matchId: "NA1_3", placement: 4 })
    ],
    { windowSize: 10 }
  );

  assert.equal(small.accumulatedLabel, "当前已积累 3/10 场");
  assert.equal(small.sampleTier, "recent_attempts");
  assert.ok(small.styleNote.includes("不输出长期稳定风格结论"));
  assert.equal(small.stats.avgPlacement, 3.67);
  assert.equal(small.stats.top4Rate, 0.67);
  assert.equal(small.compPreferences.length, 1);
  assert.equal(small.compPreferences[0].count, 3);

  const full = buildPlayerReview(
    Array.from({ length: 10 }, (_, index) =>
      match({ matchId: `NA1_${index}`, placement: (index % 8) + 1 })
    ),
    { windowSize: 10 }
  );
  assert.equal(full.sampleTier, "full");
  assert.ok(full.styleNote.includes("样本充足"));
  assert.equal(full.accumulatedMatches, 10);
});

test("per-match recent average excludes the reviewed match itself", () => {
  const review = buildPlayerReview(
    [
      match({ matchId: "NA1_A", placement: 2 }),
      match({ matchId: "NA1_B", placement: 8 })
    ],
    { windowSize: 10 }
  );

  const first = review.matches.find((item) => item.facts.matchId === "NA1_A");
  const second = review.matches.find((item) => item.facts.matchId === "NA1_B");
  assert.equal(first.facts.vsRecentAverage.placementDiff, -6);
  assert.equal(second.facts.vsRecentAverage.placementDiff, 6);
});
