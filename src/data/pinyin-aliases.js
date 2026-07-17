const PINYIN_ALIASES = {
  unit: new Map([
    ["TFT17_Xayah", ["xia", "niyu"]],
    ["TFT17_Aatrox", ["jianmo"]],
    ["TFT17_TwistedFate", ["kapai", "cuisite"]],
    ["TFT17_AurelionSol", ["longwang", "aoruiliansuoer"]],
    ["TFT17_Blitzcrank", ["jiqiren", "bulici"]],
    ["TFT17_Caitlyn", ["nvjing", "kaitelin"]],
    ["TFT17_Chogath", ["dachongzi", "kejiasi"]],
    ["TFT17_Fizz", ["xiaoyuren", "feizi"]],
    ["TFT17_Gragas", ["jiutong", "gulajiasi"]],
    ["TFT17_Graves", ["nanqiang", "geleifusi"]],
    ["TFT17_Jhin", ["ximingshi", "jin"]],
    ["TFT17_Kaisa", ["xukongzhinv", "kaisha"]],
    ["TFT17_MissFortune", ["nvqiang", "eyunxiaojie"]],
    ["TFT17_Nasus", ["goutou", "neisesi"]],
    ["TFT17_RekSai", ["wajueji", "leikesai"]],
    ["TFT17_Veigar", ["xiaofa", "weijia"]]
  ]),
  trait: new Map([
    ["TFT17_Stargazer", ["guanxing", "guanxingzhe"]],
    ["TFT17_DarkStar", ["anxing"]],
    ["TFT17_AnimaSquad", ["huanling", "huanlingzhandui"]],
    ["TFT17_Astronaut", ["yuhangyuan"]],
    ["TFT17_Mecha", ["jijia"]],
    ["TFT17_PsyOps", ["lingnengtegong"]],
    ["TFT17_SpaceGroove", ["taikonglvdong"]],
    ["TFT17_AssassinTrait", ["cike"]],
    ["TFT17_MeleeTrait", ["jinzhan"]],
    ["TFT17_RangedTrait", ["yuancheng"]],
    ["TFT17_ManaTrait", ["fali", "huilan"]],
    ["TFT17_SummonTrait", ["zhaohuan"]]
  ]),
  item: new Map([
    ["TFT_Item_GuinsoosRageblade", ["yangdao", "guisuo"]],
    ["TFT_Item_InfinityEdge", ["wujin"]],
    ["TFT_Item_MadredsBloodrazor", ["jusha"]],
    ["TFT_Item_RapidFireCannon", ["huopao"]],
    ["TFT_Item_LastWhisper", ["qingyu"]],
    ["TFT_Item_HextechGunblade", ["kejiqiang"]],
    ["TFT_Item_Quicksilver", ["shuiyin"]],
    ["TFT_Item_Deathblade", ["sharenjian"]],
    ["TFT_Item_SpearOfShojin", ["qinglongdao"]],
    ["TFT_Item_RunaansHurricane", ["fenliegong", "luanna"]],
    ["TFT_Item_JeweledGauntlet", ["fabao"]],
    ["TFT_Item_Bloodthirster", ["yinxue"]],
    ["TFT_Item_BlueBuff", ["lanbuff", "lanbafu"]],
    ["TFT_Item_BrambleVest", ["fanjia"]],
    ["TFT_Item_DragonsClaw", ["longya"]],
    ["TFT_Item_GargoyleStoneplate", ["shixianggui"]],
    ["TFT_Item_IonicSpark", ["lizi"]],
    ["TFT_Item_Morellonomicon", ["guishu"]],
    ["TFT_Item_RabadonsDeathcap", ["maozi"]]
  ])
};

function compact(values) {
  return [...new Set(values.filter(Boolean))];
}

export function pinyinAliasesForRecord(record, entityType) {
  const aliases = [];
  const lookup = PINYIN_ALIASES[entityType];
  if (!lookup) return aliases;
  for (const key of [record.apiName, record.filterId]) {
    aliases.push(...(lookup.get(key) ?? []));
  }
  return compact(aliases);
}

export function applyPinyinAliases(record, entityType) {
  const pinyinAliases = pinyinAliasesForRecord(record, entityType);
  if (pinyinAliases.length === 0) return record;
  return {
    ...record,
    aliases: compact([...(record.aliases ?? []), ...pinyinAliases]),
    pinyinAliasSource: "manual"
  };
}
