import test from "node:test";
import assert from "node:assert/strict";
import {
  openDatabase,
  initSchema,
  createPool,
  registerPlayer,
  backfillSignatures,
  backfillPatchLabels
} from "../services/opgg/collector.mjs";
import {
  buildCompFamilySignature,
  buildExactBoardSignature,
  normalizeTraitName
} from "../services/opgg/signature.mjs";
import {
  aggregatePool,
  compSampleTier,
  playerSampleTier
} from "../services/opgg/aggregator.mjs";

function traitsFor(names) {
  return names.map((name, index) => ({
    name,
    numUnits: 4 - index,
    style: 3 - index,
    tierCurrent: 3 - index,
    tierTotal: 3
  }));
}

function unit(id, { rarity = 4, tier = 2, items = [] } = {}) {
  return {
    characterId: id,
    name: id.replace("TFT17_", ""),
    rarity,
    tier,
    itemNames: items
  };
}

function factInput({ traits, units, setNumber = 17 }) {
  return {
    traitsJson: JSON.stringify(traits),
    unitsJson: JSON.stringify(units),
    setNumber
  };
}

function insertMatch(
  database,
  {
    playerId,
    matchId,
    version,
    datetime,
    placement,
    traits,
    units
  }
) {
  database
    .prepare(
      `INSERT INTO match_record (
         match_id, game_datetime, game_version, set_number, queue_id,
         source, fetched_at
       ) VALUES (?, ?, ?, 17, 1100, 'opgg', ?)
       ON CONFLICT(match_id) DO NOTHING`
    )
    .run(matchId, datetime, version, datetime);
  database
    .prepare(
      `INSERT INTO player_match_fact (
         player_id, match_id, placement, level, gold_left, last_round,
         players_eliminated, traits_json, units_json, augments_json,
         comp_family_signature, exact_board_signature, source,
         first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, 8, 1, 30, 2, ?, ?, NULL, NULL, NULL, 'opgg', ?, ?)
       ON CONFLICT(player_id, match_id) DO NOTHING`
    )
    .run(
      playerId,
      matchId,
      placement,
      JSON.stringify(traits),
      JSON.stringify(units),
      datetime,
      datetime
    );
}

test("normalizeTraitName strips numeric tier suffixes", () => {
  assert.equal(normalizeTraitName("TFT17_Astronaut_2"), "TFT17_Astronaut");
  assert.equal(normalizeTraitName("TFT17_Astronaut"), "TFT17_Astronaut");
});

test("comp family signature groups variants by the dominant active trait", () => {
  const signature = buildCompFamilySignature(
    factInput({
      traits: [
        { name: "TFT17_Hunter_1", numUnits: 2, style: 2, tierCurrent: 2 },
        { name: "TFT17_Astronaut", numUnits: 4, style: 3, tierCurrent: 3 },
        { name: "TFT17_Inactive", numUnits: 6, style: 0, tierCurrent: 0 },
        {
          name: "TFT17_BlitzcrankUniqueTrait",
          numUnits: 1,
          style: 3,
          tierCurrent: 3
        }
      ],
      units: [
        unit("TFT17_NoItems5Cost", { rarity: 5, tier: 1, items: [] }),
        unit("TFT17_Karma", { rarity: 4, tier: 2, items: ["A", "B", "C"] }),
        unit("TFT17_Galio", { rarity: 5, tier: 2, items: ["A", "B"] })
      ]
    })
  );

  assert.equal(
    signature,
    "set17|trait:TFT17_Astronaut"
  );
});

test("comp family signature ignores secondary traits and carry variations", () => {
  const first = buildCompFamilySignature(
    factInput({
      traits: traitsFor(["TFT17_Astronaut", "TFT17_Hunter"]),
      units: [unit("TFT17_Karma", { items: ["A", "B", "C"] })]
    })
  );
  const second = buildCompFamilySignature(
    factInput({
      traits: traitsFor(["TFT17_Astronaut", "TFT17_Sorcerer"]),
      units: [unit("TFT17_Ahri", { items: ["X", "Y", "Z"] })]
    })
  );

  assert.equal(first, "set17|trait:TFT17_Astronaut");
  assert.equal(second, first);
});

test("comp family signature returns null when nothing is classifiable", () => {
  assert.equal(
    buildCompFamilySignature(
      factInput({
        traits: [{ name: "TFT17_X", numUnits: 1, style: 0, tierCurrent: 0 }],
        units: [unit("TFT17_Bare", { rarity: 5, tier: 1, items: [] })]
      })
    ),
    null
  );
});

test("exact board signature is deterministic and complete", () => {
  const exact = buildExactBoardSignature(
    factInput({
      traits: [{ name: "TFT17_B", numUnits: 2, style: 2 }, { name: "TFT17_A", numUnits: 4, style: 3 }],
      units: [
        unit("TFT17_Karma", { tier: 2, items: ["C", "A"] }),
        unit("TFT17_Aatrox", { tier: 1, items: [] })
      ]
    })
  );
  const parsed = JSON.parse(exact);
  assert.deepEqual(parsed.traits, ["TFT17_A", "TFT17_B"]);
  assert.deepEqual(parsed.units, [
    { id: "TFT17_Aatrox", tier: 1, items: [] },
    { id: "TFT17_Karma", tier: 2, items: ["A", "C"] }
  ]);
  assert.equal(parsed.set, "set17");
});

test("sample tiers follow the MVP thresholds", () => {
  assert.equal(playerSampleTier(0), "no_data");
  assert.equal(playerSampleTier(2), "recent_only");
  assert.equal(playerSampleTier(4), "recent_attempts");
  assert.equal(playerSampleTier(9), "insufficient");
  assert.equal(playerSampleTier(10), "full");
  assert.equal(compSampleTier(2), "recent_attempt");
  assert.equal(compSampleTier(4), "frequency_only");
  assert.equal(compSampleTier(9), "caution");
  assert.equal(compSampleTier(10), "confident");
});

test("window keeps current patch and per-player recent N; trends aggregate pool", async () => {
  const database = await openDatabase(":memory:");
  initSchema(database);
  createPool(database, { id: "pool-a", name: "Pool A", region: "na" });
  registerPlayer(database, {
    id: "p1",
    displayName: "P1",
    gameName: "p1",
    tagLine: "NA1",
    region: "na",
    active: true
  }, "pool-a");
  registerPlayer(database, {
    id: "p2",
    displayName: "P2",
    gameName: "p2",
    tagLine: "NA2",
    region: "na",
    active: true
  }, "pool-a");

  const compX = {
    traits: traitsFor(["TFT17_Astronaut", "TFT17_Hunter"]),
    units: [
      unit("TFT17_Karma", { items: ["Sword", "Tear", "Glove"] }),
      unit("TFT17_Galio", { items: ["Vest", "Belt"] })
    ]
  };
  const compY = {
    traits: traitsFor(["TFT17_Emissary"]),
    units: [
      unit("TFT17_Jinx", { items: ["Bow", "Rod", "Sword"] }),
      unit("TFT17_Blitz", { items: ["Vest", "Cloak"] })
    ]
  };
  const compZ = {
    traits: traitsFor(["TFT17_RiftWalker", "TFT17_Sorcerer"]),
    units: [
      unit("TFT17_Ahri", { items: ["Rod", "Tear", "Spatula"] }),
      unit("TFT17_Shen", { items: ["Vest", "Belt"] })
    ]
  };

  const placementsX = [2, 3, 4, 5, 1, 3, 4, 6, 2, 7];
  const placementsY = [1, 2, 3, 8];
  const placementsZ = [5, 6, 7, 8, 4, 2];

  const day = 86_400_000;
  const base = Date.UTC(2026, 6, 20);

  for (let index = 0; index < 2; index += 1) {
    insertMatch(database, {
      playerId: "p1",
      matchId: `OLD1_${index}`,
      version: "15.15.1",
      datetime: new Date(base - index * day).toISOString(),
      placement: 5,
      traits: compX.traits,
      units: compX.units
    });
  }

  for (let index = 0; index < placementsX.length; index += 1) {
    insertMatch(database, {
      playerId: "p1",
      matchId: `X_${index}`,
      version: "15.16.1",
      datetime: new Date(base + index * day).toISOString(),
      placement: placementsX[index],
      traits: compX.traits,
      units: compX.units
    });
  }
  for (let index = 0; index < placementsY.length; index += 1) {
    insertMatch(database, {
      playerId: "p1",
      matchId: `Y_${index}`,
      version: "15.16.1",
      datetime: new Date(base + (10 + index) * day).toISOString(),
      placement: placementsY[index],
      traits: compY.traits,
      units: compY.units
    });
  }
  for (let index = 0; index < placementsZ.length; index += 1) {
    insertMatch(database, {
      playerId: "p2",
      matchId: `Z_${index}`,
      version: "15.16.1",
      datetime: new Date(base + index * day).toISOString(),
      placement: placementsZ[index],
      traits: compZ.traits,
      units: compZ.units
    });
  }
  for (let index = 0; index < 4; index += 1) {
    insertMatch(database, {
      playerId: "p2",
      matchId: `X2_${index}`,
      version: "15.16.1",
      datetime: new Date(base + (10 + index) * day).toISOString(),
      placement: 3 + index,
      traits: compX.traits,
      units: compX.units
    });
  }

  const backfilled = backfillSignatures(database);
  assert.equal(backfilled, 26); // 2 old + 24 current-patch facts
  const patchBackfilled = backfillPatchLabels(database);
  assert.equal(patchBackfilled, 26);

  const result = aggregatePool(database, {
    poolId: "pool-a",
    region: "na",
    perPlayerLimit: 10
  });

  // Window: p1 has 14 current-patch facts -> capped at 10;
  // p2 has 10 -> all kept. Old patch (2) excluded.
  const overview = result.overview;
  assert.equal(overview.currentPatch, "15.16");
  assert.equal(overview.trackedPlayers, 2);
  assert.equal(overview.playersWithData, 2);
  assert.equal(overview.playersMeetingTarget, 2);
  assert.equal(overview.availablePlayerMatches, 20);
  assert.equal(overview.maximumPlayerMatches, 20);
  assert.equal(overview.currentPatchPlayerMatches, 24);
  assert.equal(overview.uniqueMatches, 20);

  const comps = result.compTrends;
  const compXRow = comps.find((comp) => comp.compSignature.includes("TFT17_Astronaut"));
  const compYRow = comps.find((comp) => comp.compSignature.includes("TFT17_Emissary"));
  const compZRow = comps.find((comp) => comp.compSignature.includes("TFT17_RiftWalker"));

  assert.ok(compXRow);
  assert.equal(compXRow.playerMatchCount, 10);
  assert.equal(compXRow.playerCoverage, 2);
  assert.equal(compXRow.playerCoverageRate, 1);
  assert.equal(compXRow.playerMatchShare, 0.5);
  assert.equal(compXRow.sampleTier, "confident");
  // p1 window keeps its 6 newest X games + 4 newer Y games; p2 contributes
  // 4 X games. Combined 10 X games: avg 4.1, top4 6/10.
  assert.equal(compXRow.avgPlacement, 4.1);
  assert.equal(compXRow.top4Rate, 0.6);
  assert.equal(compXRow.observedWinRate, 0.1);
  assert.equal(compXRow.observedEighthRate, 0);
  assert.equal(compXRow.winRate, 0.1);
  assert.equal(compXRow.eighthRate, 0);
  assert.equal(compXRow.performanceComparable, true);
  assert.ok(["S", "A", "B", "C", "D"].includes(compXRow.ratingGrade));
  assert.equal(compXRow.representativeUnits.length, 2);
  assert.equal(compXRow.representativeBoardCount, 10);

  assert.equal(compYRow.playerMatchCount, 4);
  assert.equal(compYRow.sampleTier, "frequency_only");
  assert.equal(compYRow.avgPlacement, null);
  assert.equal(compYRow.top4Rate, null);
  assert.equal(compYRow.observedAvgPlacement, 3.5);
  assert.equal(compYRow.observedTop4Rate, 0.75);
  assert.equal(compYRow.observedWinRate, 0.25);
  assert.equal(compYRow.observedEighthRate, 0.25);
  assert.equal(compYRow.performanceComparable, false);
  assert.equal(compZRow.playerMatchCount, 6);

  assert.equal(result.compAnalysis.sampleMode, "observed");
  assert.equal(result.compAnalysis.mostPlayed.compSignature, compXRow.compSignature);
  assert.equal(result.compAnalysis.bestAveragePlacement.compSignature, compYRow.compSignature);
  assert.equal(result.compAnalysis.highestTop4Rate.compSignature, compYRow.compSignature);
  assert.equal(result.compAnalysis.highestWinRate.compSignature, compYRow.compSignature);

  const karma = result.unitTrends.find((unit) => unit.unitId === "TFT17_Karma");
  assert.ok(karma);
  assert.equal(karma.appearances, 10);
  assert.equal(karma.playerCoverage, 2);
  assert.deepEqual(karma.topItems[0], { item: "Glove", count: 10 });
  assert.ok(karma.topItems.some((entry) => entry.item === "Sword" && entry.count === 10));

  const swordPair = result.itemTrends.pairs.find((pair) => pair.key === "Sword+Tear");
  assert.ok(swordPair);
  assert.equal(swordPair.count, 10);
  const swordTriple = result.itemTrends.triples.find(
    (triple) => triple.key === "Glove+Sword+Tear"
  );
  assert.ok(swordTriple);
  assert.equal(swordTriple.count, 10);

  const patchRows = result.patchDistribution;
  assert.deepEqual(
    patchRows.map((row) => [row.patch, row.matches]),
    [
      ["15.16", 24],
      ["15.15", 2]
    ]
  );

  database.close();
});
