import test from "node:test";
import assert from "node:assert/strict";
import {
  S18_TRAIT_DISPLAY_OVERRIDES,
  S18_UNIT_DISPLAY_OVERRIDES,
  traitDisplayOverrideByApiName,
  unitDisplayOverrideByApiName
} from "../src/data/entity-display-overrides.js";
import {
  buildTraitCatalogFromExplorerRows,
  buildUnitCatalogFromExplorerRows,
  mergeCatalogTraits,
  mergeCatalogUnits
} from "../src/data/domain-catalog.js";
import { queryEntityCatalog } from "../src/domain/tft/entity-catalog-query.js";

test("S18 live bilingual display overrides cover the complete current roster", () => {
  assert.equal(S18_UNIT_DISPLAY_OVERRIDES.length, 65);
  assert.equal(S18_TRAIT_DISPLAY_OVERRIDES.length, 36);
  assert.equal(unitDisplayOverrideByApiName.size, 65);
  assert.equal(traitDisplayOverrideByApiName.size, 36);

  for (const entry of [...S18_UNIT_DISPLAY_OVERRIDES, ...S18_TRAIT_DISPLAY_OVERRIDES]) {
    assert.match(entry.zhName, /\p{Script=Han}/u, entry.apiName);
    assert.doesNotMatch(entry.enName, /\p{Script=Han}/u, entry.apiName);
    assert.doesNotMatch(entry.zhName, /…/u, entry.apiName);
  }
});

test("S18 live display overrides remove internal form and unique-trait tokens", () => {
  assert.deepEqual(unitDisplayOverrideByApiName.get("DA_18_Elise"), {
    apiName: "DA_18_Elise",
    zhName: "伊莉丝",
    enName: "Elise",
    aliases: ["伊莉丝", "Elise"],
    source: "metatft_live_2026_08_27_bilingual"
  });
  assert.equal(unitDisplayOverrideByApiName.get("DA_Nidalee18_AP").enName, "Nidalee");
  assert.equal(unitDisplayOverrideByApiName.get("DA_18_GnarSmall").enName, "Gnar");
  assert.equal(traitDisplayOverrideByApiName.get("DA_18_LuxUniqueTrait").enName, "Avatar");
  assert.equal(traitDisplayOverrideByApiName.get("DA_FloraFatalis18").enName, "Flora Fatalis");
  assert.equal(traitDisplayOverrideByApiName.get("DA_18_Sprykin").zhName, "约德尔人");
});

test("S18 live generated and persisted catalogs retain curated bilingual names", () => {
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

test("Aphelios spelling alias resolves through generated and cached catalogs without changing display names", () => {
  const generated = buildUnitCatalogFromExplorerRows({ data: [
    { units_unique: "DA_18_Aphelios-2", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
  ] }, { includeSeeds: false });
  for (const units of [generated, mergeCatalogUnits([
    { apiName: "DA_18_Aphelios", zhName: "厄斐琉斯", aliases: ["Aphelios"], current: true }
  ], generated)]) {
    const result = queryEntityCatalog({ catalog: { units, items: [], traits: [] },
      input: { entityType: "unit", filters: { names: ["厄飞流斯"] } }
    });
    assert.equal(result.resolution.requests[0].status, "resolved");
    assert.equal(result.results[0].apiName, "DA_18_Aphelios");
    assert.equal(result.results[0].name, "厄斐琉斯");
  }
});

test("Aphelios nicknames remain fuzzy confirmations with one stable canonical candidate", () => {
  const units = buildUnitCatalogFromExplorerRows({ data: [
    { units_unique: "DA_18_Aphelios-2", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] },
    { units_unique: "DA_18_Ornn-2", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }
  ] }, { includeSeeds: false });
  for (const nickname of ["月男", "efls", "EFLS", " ｅｆｌｓ "]) {
    const result = queryEntityCatalog({ catalog: { units, items: [], traits: [] },
      input: { entityType: "unit", filters: { names: [nickname] } }
    });
    assert.equal(result.resolution.requests[0].status, "ambiguous", nickname);
    assert.deepEqual(result.resolution.requests[0].candidates.map((candidate) => ({
      apiName: candidate.apiName,
      name: candidate.name,
      matchType: candidate.matchType
    })), [{
      apiName: "DA_18_Aphelios",
      name: "厄斐琉斯",
      matchType: "curated_fuzzy_alias"
    }]);
    assert.equal(result.results[0].name, "厄斐琉斯");
  }
  const ornnItems = queryEntityCatalog({ catalog: { units, items: [], traits: [] },
    input: { entityType: "unit", filters: { names: ["奥恩"] } }
  });
  assert.equal(ornnItems.resolution.requests[0].status, "resolved");
  assert.equal(ornnItems.results[0].apiName, "DA_18_Ornn");
});
