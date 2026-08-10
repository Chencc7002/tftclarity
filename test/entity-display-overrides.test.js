import test from "node:test";
import assert from "node:assert/strict";
import {
  S18_PBE_TRAIT_DISPLAY_OVERRIDES,
  S18_PBE_UNIT_DISPLAY_OVERRIDES,
  traitDisplayOverrideByApiName,
  unitDisplayOverrideByApiName
} from "../src/data/entity-display-overrides.js";
import {
  buildTraitCatalogFromExplorerRows,
  buildUnitCatalogFromExplorerRows,
  mergeCatalogTraits,
  mergeCatalogUnits
} from "../src/data/domain-catalog.js";

test("S18 PBE bilingual display overrides cover the complete current roster", () => {
  assert.equal(S18_PBE_UNIT_DISPLAY_OVERRIDES.length, 65);
  assert.equal(S18_PBE_TRAIT_DISPLAY_OVERRIDES.length, 36);
  assert.equal(unitDisplayOverrideByApiName.size, 65);
  assert.equal(traitDisplayOverrideByApiName.size, 36);

  for (const entry of [...S18_PBE_UNIT_DISPLAY_OVERRIDES, ...S18_PBE_TRAIT_DISPLAY_OVERRIDES]) {
    assert.match(entry.zhName, /\p{Script=Han}/u, entry.apiName);
    assert.doesNotMatch(entry.enName, /\p{Script=Han}/u, entry.apiName);
    assert.doesNotMatch(entry.zhName, /…/u, entry.apiName);
  }
});

test("S18 PBE display overrides remove internal form and unique-trait tokens", () => {
  assert.deepEqual(unitDisplayOverrideByApiName.get("DA_18_Elise"), {
    apiName: "DA_18_Elise",
    zhName: "伊莉丝",
    enName: "Elise",
    aliases: ["伊莉丝", "Elise"],
    source: "communitydragon_pbe_2026_08_10_bilingual"
  });
  assert.equal(unitDisplayOverrideByApiName.get("DA_Nidalee18_AP").enName, "Nidalee");
  assert.equal(unitDisplayOverrideByApiName.get("DA_18_GnarSmall").enName, "Gnar");
  assert.equal(traitDisplayOverrideByApiName.get("DA_18_LuxUniqueTrait").enName, "Avatar");
  assert.equal(traitDisplayOverrideByApiName.get("DA_FloraFatalis18").enName, "Flora Fatalis");
  assert.equal(traitDisplayOverrideByApiName.get("DA_18_Sprykin").zhName, "约德尔人");
});

test("S18 PBE generated and persisted catalogs retain curated bilingual names", () => {
  const generatedUnits = buildUnitCatalogFromExplorerRows({
    data: [
      { units_unique: "DA_18_Elise-1", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
      { units_unique: "DA_Nidalee18_AP-1", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
    ]
  }, { includeSeeds: false });
  const generatedTraits = buildTraitCatalogFromExplorerRows({
    data: [
      { traits: "DA_18_LuxUniqueTrait_1", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
      { traits: "DA_18_Sprykin_1", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
    ]
  }, { includeSeeds: false });

  assert.equal(generatedUnits.find((entry) => entry.apiName === "DA_18_Elise").enName, "Elise");
  assert.equal(generatedUnits.find((entry) => entry.apiName === "DA_Nidalee18_AP").enName, "Nidalee");
  assert.equal(generatedTraits.find((entry) => entry.apiName === "DA_18_LuxUniqueTrait").enName, "Avatar");
  assert.equal(generatedTraits.find((entry) => entry.apiName === "DA_18_Sprykin").zhName, "约德尔人");

  const mergedUnits = mergeCatalogUnits([
    { apiName: "DA_18_Elise", zhName: "旧名称", aliases: ["old"] }
  ], generatedUnits);
  const mergedTraits = mergeCatalogTraits([
    { apiName: "DA_18_Sprykin", filterId: "DA_18_Sprykin_1", zhName: "约德尔人…", displayName: "约德尔人…" }
  ], generatedTraits);
  assert.equal(mergedUnits.find((entry) => entry.apiName === "DA_18_Elise").zhName, "伊莉丝");
  assert.equal(mergedTraits.find((entry) => entry.apiName === "DA_18_Sprykin").zhName, "约德尔人");
});
