import test from "node:test";
import assert from "node:assert/strict";
import {
  itemDisplayName,
  localizeMatch,
  localizeSignature,
  traitDisplayName,
  unitDisplayName
} from "../services/opgg/localization.mjs";

test("OP.GG identifiers are localized for UI responses", () => {
  assert.equal(unitDisplayName("TFT17_AurelionSol"), "奥瑞利安·索尔");
  assert.equal(traitDisplayName("TFT17_DRX"), "新星特工队");
  assert.equal(itemDisplayName("TFT_Item_StatikkShiv"), "虚空之杖");

  const signature = localizeSignature(
    "set17|trait:TFT17_DRX|carry:TFT17_AurelionSol|tank:TFT17_Leona"
  );
  assert.equal(signature.traits[0].name, "新星特工队");
  assert.equal(signature.carry.name, "奥瑞利安·索尔");
  assert.equal(signature.tank.name, "蕾欧娜");
});

test("localized match facts expose one-based costs and readable item names", () => {
  const localized = localizeMatch({
    compFamilySignature: "set17|trait:TFT17_DRX|carry:TFT17_Leona",
    traits: [{ name: "TFT17_DRX", numUnits: 2 }],
    units: [{
      characterId: "TFT17_Leona",
      rarity: 0,
      tier: 2,
      itemNames: ["TFT_Item_WarmogsArmor"]
    }]
  });
  assert.equal(localized.units[0].displayName, "蕾欧娜");
  assert.equal(localized.units[0].cost, 1);
  assert.deepEqual(localized.units[0].itemDisplayNames, ["狂徒铠甲"]);
  assert.ok(localized.units[0].iconUrl);
  assert.match(localized.units[0].iconUrl, /^https:\/\//u);
  assert.equal(localized.units[0].items[0].displayName, "狂徒铠甲");
  assert.ok(localized.units[0].items[0].iconUrl);
  assert.equal(localized.traits[0].displayName, "新星特工队");
});

test("item localization uses the official catalog before API-token fallback", () => {
  assert.equal(itemDisplayName("TFT_Item_SpearOfShojin"), "朔极之矛");
  assert.equal(
    itemDisplayName("TFT17_Item_FlexTraitEmblemItem"),
    "旅人纹章"
  );
  assert.equal(itemDisplayName("TFT17_Item_UnknownCamelCase"), "Unknown Camel Case");
});

test("MetaTFT PBE match payloads localize DA units, items, traits, and assets", () => {
  const localized = localizeMatch({
    matchId: "PBE1_4532568219",
    traits: [
      { id: "DA_18_Greenfather" },
      { id: "DA_18_Emerald" },
      { id: "DA_18_Juggernaut" }
    ],
    units: [{
      characterId: "DA_18_ElderDragon",
      starLevel: 2,
      items: ["DA_InfinityEdge", "DA_GiantSlayer", "DA_Component_RecurveBow"]
    }]
  });

  assert.equal(localized.units[0].displayName, "远古巨龙");
  assert.match(localized.units[0].iconUrl, /champions\/da_18_elderdragon\.png$/u);
  assert.deepEqual(
    localized.units[0].items.map((item) => item.displayName),
    ["无尽之刃", "巨人杀手", "反曲之弓"]
  );
  assert.ok(localized.units[0].items.every((item) => item.iconUrl?.includes("/items/da_")));
  assert.deepEqual(
    localized.traits.map((trait) => trait.displayName),
    ["翠神", "宝石骑士", "主宰"]
  );
});

test("MetaTFT summary trait tier suffixes still resolve to localized names", () => {
  const localized = localizeMatch({
    traits: [
      { id: "DA_18_Inferno_1" },
      { id: "DA_FloraFatalis18_2" }
    ],
    units: []
  });
  assert.deepEqual(
    localized.traits.map((trait) => trait.displayName),
    ["地狱火", "绝命花妖"]
  );
});
