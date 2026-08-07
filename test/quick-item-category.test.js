import test from "node:test";
import assert from "node:assert/strict";
import { createCatalog, parseQuery } from "../src/index.js";

const catalog = createCatalog({
  units: [{ apiName: "TFT17_Xayah", zhName: "霞", current: true }],
  items: [],
  traits: []
});

test("single-item ranking categories cover standard, Artifact, and Emblem inputs", () => {
  const ordinary = parseQuery("霞的普通单装备排行", { catalog });
  const artifact = parseQuery("霞的神器单装备排行", { catalog });
  const emblem = parseQuery("霞的纹章单装备排行", { catalog });

  assert.equal(ordinary.intent, "unit_item_rankings");
  assert.deepEqual(ordinary.itemCategories, ["ordinary_completed"]);
  assert.equal(artifact.intent, "unit_item_rankings");
  assert.deepEqual(artifact.itemCategories, ["artifact"]);
  assert.equal(emblem.intent, "unit_emblem_rankings");
  assert.deepEqual(emblem.itemCategories, ["emblem"]);
});
