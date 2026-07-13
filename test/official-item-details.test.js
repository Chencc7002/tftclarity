import assert from "node:assert/strict";
import test from "node:test";
import { buildItemCatalogFromItemsResponse, buildOfficialTftItemDetailsCatalog, mergeCatalogItems } from "../src/index.js";

test("official TFT equipment details preserve effects and resolve recipe component IDs", () => {
  const catalog = buildOfficialTftItemDetailsCatalog(JSON.stringify([
    {
      equipId: "100",
      englishName: "TFT_Item_TearOfTheGoddess",
      name: "女神之泪",
      effect: "+15 法力回复",
      formula: "",
      imagePath: "https://example.test/tear.png"
    },
    {
      equipId: "200",
      englishName: "TFT_Item_SparringGloves",
      name: "拳套",
      effect: "+20% 暴击几率",
      formula: "",
      imagePath: "https://example.test/glove.png"
    },
    {
      equipId: "300",
      englishName: "TFT_Item_UnstableConcoction",
      name: "正义之手",
      effect: "+1 法力回复;<br>获得 2 个效果：<li>伤害增幅<li>全能吸血",
      formula: "100,200",
      imagePath: "https://example.test/hoj.png"
    }
  ]));

  const handOfJustice = catalog.get("TFT_Item_UnstableConcoction");
  assert.equal(handOfJustice.name, "正义之手");
  assert.equal(handOfJustice.craftable, true);
  assert.deepEqual(handOfJustice.recipe.map((item) => item.apiName), [
    "TFT_Item_TearOfTheGoddess",
    "TFT_Item_SparringGloves"
  ]);
  assert.match(handOfJustice.effect, /伤害增幅/);
  assert.doesNotMatch(handOfJustice.effect, /<br>|<li>/);
});

test("current Hand of Justice uses 正义 as its display name while retaining 合剂 as a historical alias", () => {
  const item = buildItemCatalogFromItemsResponse({
    data: [{ items: "TFT_Item_UnstableConcoction", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }]
  }).find((entry) => entry.apiName === "TFT_Item_UnstableConcoction");

  assert.equal(item.shortName, "正义");
  assert.equal(item.zhName, "正义之手");
  assert.equal(item.aliases.includes("合剂"), true);
});

test("a refreshed manual display alias replaces an obsolete persisted short name", () => {
  const fresh = buildItemCatalogFromItemsResponse({
    data: [{ items: "TFT_Item_UnstableConcoction", placement_count: [1, 1, 1, 1, 1, 1, 1, 1] }]
  });
  const merged = mergeCatalogItems([{
    apiName: "TFT_Item_UnstableConcoction",
    zhName: "正义之手",
    shortName: "合剂",
    aliases: ["合剂"]
  }], fresh).find((item) => item.apiName === "TFT_Item_UnstableConcoction");

  assert.equal(merged.shortName, "正义");
});
