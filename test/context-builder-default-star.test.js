import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQueryContext,
  buildUnitCatalogFromCompsData,
  createCatalog
} from "../src/index.js";

function parsed(unit, starLevel) {
  return {
    rawInput: "fixture",
    intent: "unit_build_rankings",
    unit,
    ...(starLevel ? { starLevel } : {})
  };
}

test("units costing three or less default to three stars", () => {
  const catalog = createCatalog({
    units: [
      { apiName: "TFT17_OneCost", aliases: [], cost: 1 },
      { apiName: "TFT17_TwoCost", aliases: [], cost: 2 },
      { apiName: "TFT17_ThreeCost", aliases: [], cost: 3 },
      { apiName: "TFT17_FourCost", aliases: [], cost: 4 }
    ]
  });

  assert.deepEqual(buildQueryContext(parsed("TFT17_OneCost"), { catalog }).starLevel, [3]);
  assert.deepEqual(buildQueryContext(parsed("TFT17_TwoCost"), { catalog }).starLevel, [3]);
  assert.deepEqual(buildQueryContext(parsed("TFT17_ThreeCost"), { catalog }).starLevel, [3]);
  assert.deepEqual(buildQueryContext(parsed("TFT17_FourCost"), { catalog }).starLevel, [2]);
});

test("an explicit star level is never replaced by the cost-based default", () => {
  const catalog = createCatalog({
    units: [{ apiName: "TFT17_OneCost", aliases: [], cost: 1 }]
  });

  const query = buildQueryContext(parsed("TFT17_OneCost", [2]), { catalog });
  assert.deepEqual(query.starLevel, [2]);
  assert.equal(query.assumptions.find((entry) => entry.key === "star_level").source, "current_input");
});

test("the live unit catalog carries patch-scoped costs used by default-star decisions", () => {
  const units = buildUnitCatalogFromCompsData({
    compOptions: [{ units_list: "TFT17_Veigar&TFT17_Xayah" }]
  });
  const catalog = createCatalog({ units });

  assert.equal(catalog.unitByApiName.get("TFT17_Veigar").cost, 1);
  assert.equal(catalog.unitByApiName.get("TFT17_Xayah").cost, 4);
  assert.deepEqual(buildQueryContext(parsed("TFT17_Veigar"), { catalog }).starLevel, [3]);
  assert.deepEqual(buildQueryContext(parsed("TFT17_Xayah"), { catalog }).starLevel, [2]);
});
