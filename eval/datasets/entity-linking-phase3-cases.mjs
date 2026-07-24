import { createCatalog } from "../../src/data/static-data.js";

export const PHASE3_ENTITY_DATASET_VERSION = "entity-linking-phase3.v1";

const EXTRA_UNITS = Object.freeze([
  {
    apiName: "TFT17_MasterYi",
    zhName: "易大师",
    aliases: ["易", "剑圣", "无极剑圣", "master yi", "yi"],
    current: true
  },
  {
    apiName: "TFT17_Kaisa",
    zhName: "卡莎",
    aliases: ["卡莎", "虚空之女", "kaisa"],
    current: true
  }
]);

const EXTRA_ITEMS = Object.freeze([
  {
    apiName: "TFT_Item_Artifact_TitanicHydra",
    zhName: "巨型九头蛇",
    shortName: "巨型九头蛇",
    aliases: ["巨九", "九头蛇", "巨型九头蛇", "hydra", "titanic hydra"],
    category: "artifact",
    current: true,
    obtainable: true
  }
]);

export function createPhase3EvaluationCatalog() {
  const base = createCatalog();
  return createCatalog({
    patch: "17.7",
    units: [...base.units, ...EXTRA_UNITS],
    traits: base.traits,
    items: [...base.items, ...EXTRA_ITEMS]
  });
}

const CORE_CASES = Object.freeze([
  ["霞", "champion", "TFT17_Xayah"],
  ["易大师", "champion", "TFT17_MasterYi"],
  ["卡莎", "champion", "TFT17_Kaisa"],
  ["观星者", "trait", "TFT17_Stargazer_1"],
  ["鬼索的狂暴之刃", "item", "TFT_Item_GuinsoosRageblade"],
  ["无尽之刃", "item", "TFT_Item_InfinityEdge"],
  ["最后的轻语", "item", "TFT_Item_LastWhisper"],
  ["强袭者的链枷", "item", "TFT_Item_PowerGauntlet"],
  ["海克斯科技枪刃", "item", "TFT_Item_HextechGunblade"],
  ["水银", "item", "TFT_Item_Quicksilver"],
  ["死亡之刃", "item", "TFT_Item_Deathblade"],
  ["朔极之矛", "item", "TFT_Item_SpearOfShojin"],
  ["光明版鬼索的狂暴之刃", "item", "TFT5_Item_GuinsoosRagebladeRadiant"],
  ["海妖之怒", "item", "TFT_Item_RunaansHurricane"],
  ["巨型九头蛇", "item", "TFT_Item_Artifact_TitanicHydra"]
]);

const ALIAS_CASES = Object.freeze([
  ["逆羽", "champion", "TFT17_Xayah"],
  ["xayah", "champion", "TFT17_Xayah"],
  ["xia", "champion", "TFT17_Xayah"],
  ["niyu", "champion", "TFT17_Xayah"],
  ["易", "champion", "TFT17_MasterYi"],
  ["剑圣", "champion", "TFT17_MasterYi"],
  ["无极剑圣", "champion", "TFT17_MasterYi"],
  ["master yi", "champion", "TFT17_MasterYi"],
  ["yi", "champion", "TFT17_MasterYi"],
  ["虚空之女", "champion", "TFT17_Kaisa"],
  ["kaisa", "champion", "TFT17_Kaisa"],
  ["观星", "trait", "TFT17_Stargazer_1"],
  ["3观星", "trait", "TFT17_Stargazer_1"],
  ["三观星", "trait", "TFT17_Stargazer_1"],
  ["guanxing", "trait", "TFT17_Stargazer_1"],
  ["guanxingzhe", "trait", "TFT17_Stargazer_1"],
  ["羊刀", "item", "TFT_Item_GuinsoosRageblade"],
  ["鬼索", "item", "TFT_Item_GuinsoosRageblade"],
  ["guinsoo", "item", "TFT_Item_GuinsoosRageblade"],
  ["yangdao", "item", "TFT_Item_GuinsoosRageblade"],
  ["guisuo", "item", "TFT_Item_GuinsoosRageblade"],
  ["无尽", "item", "TFT_Item_InfinityEdge"],
  ["ie", "item", "TFT_Item_InfinityEdge"],
  ["wujin", "item", "TFT_Item_InfinityEdge"],
  ["轻语", "item", "TFT_Item_LastWhisper"],
  ["qingyu", "item", "TFT_Item_LastWhisper"],
  ["力量手套", "item", "TFT_Item_PowerGauntlet"],
  ["科技枪", "item", "TFT_Item_HextechGunblade"],
  ["海克斯科技枪", "item", "TFT_Item_HextechGunblade"],
  ["kejiqiang", "item", "TFT_Item_HextechGunblade"],
  ["伏击水银", "item", "TFT_Item_Quicksilver"],
  ["shuiyin", "item", "TFT_Item_Quicksilver"],
  ["杀人剑", "item", "TFT_Item_Deathblade"],
  ["sharenjian", "item", "TFT_Item_Deathblade"],
  ["青龙刀", "item", "TFT_Item_SpearOfShojin"],
  ["shojin", "item", "TFT_Item_SpearOfShojin"],
  ["qinglongdao", "item", "TFT_Item_SpearOfShojin"],
  ["光明羊刀", "item", "TFT5_Item_GuinsoosRagebladeRadiant"],
  ["光明鬼索", "item", "TFT5_Item_GuinsoosRagebladeRadiant"],
  ["海妖", "item", "TFT_Item_RunaansHurricane"],
  ["分裂弓", "item", "TFT_Item_RunaansHurricane"],
  ["飓风", "item", "TFT_Item_RunaansHurricane"],
  ["卢安娜", "item", "TFT_Item_RunaansHurricane"],
  ["runaan", "item", "TFT_Item_RunaansHurricane"],
  ["fenliegong", "item", "TFT_Item_RunaansHurricane"],
  ["luanna", "item", "TFT_Item_RunaansHurricane"],
  ["巨九", "item", "TFT_Item_Artifact_TitanicHydra"],
  ["九头蛇", "item", "TFT_Item_Artifact_TitanicHydra"],
  ["hydra", "item", "TFT_Item_Artifact_TitanicHydra"],
  ["titanic hydra", "item", "TFT_Item_Artifact_TitanicHydra"]
]);

const CONCEPT_CASES = Object.freeze([
  ["九五", "concept.strategy.fast9_nine_five"],
  ["95", "concept.strategy.fast9_nine_five"],
  ["速九", "concept.strategy.fast9_nine_five"],
  ["赌狗", "concept.strategy.reroll"],
  ["D牌", "concept.strategy.reroll"],
  ["追三", "concept.strategy.reroll"],
  ["运营", "concept.strategy.economy_operation"],
  ["拉人口", "concept.strategy.economy_operation"],
  ["连败", "concept.economy.loss_streak"],
  ["卖血", "concept.economy.loss_streak"],
  ["前排装", "concept.item.frontline"],
  ["肉装", "concept.item.frontline"]
]);

const NONEXISTENT_CASES = Object.freeze(Array.from({ length: 100 }, (_, index) => (
  [`不存在实体${String(index + 1).padStart(3, "0")}月影星刃`, index % 3 === 0 ? "champion" : index % 3 === 1 ? "item" : "trait"]
)));

export function buildPhase3EntityCases() {
  return [
    ...CORE_CASES.map(([mention, type, expectedId], index) => ({
      id: `core-${String(index + 1).padStart(3, "0")}`,
      datasetVersion: PHASE3_ENTITY_DATASET_VERSION,
      group: "core",
      mention,
      type,
      expectedId
    })),
    ...ALIAS_CASES.map(([mention, type, expectedId], index) => ({
      id: `alias-${String(index + 1).padStart(3, "0")}`,
      datasetVersion: PHASE3_ENTITY_DATASET_VERSION,
      group: "alias",
      mention,
      type,
      expectedId
    })),
    ...CONCEPT_CASES.map(([mention, expectedId], index) => ({
      id: `concept-${String(index + 1).padStart(3, "0")}`,
      datasetVersion: PHASE3_ENTITY_DATASET_VERSION,
      group: "concept",
      mention,
      type: "game_concept",
      expectedId
    })),
    ...NONEXISTENT_CASES.map(([mention, type], index) => ({
      id: `nonexistent-${String(index + 1).padStart(3, "0")}`,
      datasetVersion: PHASE3_ENTITY_DATASET_VERSION,
      group: "nonexistent",
      mention,
      type,
      expectedId: null
    }))
  ];
}
