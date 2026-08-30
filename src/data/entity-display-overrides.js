const S18_LIVE_SOURCE = "metatft_live_2026_08_27_bilingual";
export const ENTITY_DISPLAY_VERSION = "s18-live-bilingual-2026-08-27";

function displayOverride(apiName, zhName, enName, options = {}) {
  return Object.freeze({
    apiName,
    zhName,
    enName,
    aliases: Object.freeze([zhName, enName]),
    ...(options.fuzzyAliases?.length ? {
      fuzzyAliases: Object.freeze([...options.fuzzyAliases])
    } : {}),
    source: S18_LIVE_SOURCE
  });
}

export const S18_UNIT_DISPLAY_OVERRIDES = Object.freeze([
  displayOverride("DA_18_Akali_AD", "阿卡丽", "Akali"),
  displayOverride("DA_18_Ornn", "奥恩", "Ornn"),
  displayOverride("DA_18_Sentry", "苍蓝哨戒", "Pebbles"),
  displayOverride("DA_Cinderling18", "绯红树怪", "Cinderling"),
  displayOverride("DA_Karma18", "卡尔玛", "Karma"),
  displayOverride("DA_18_Camille", "卡蜜尔", "Camille"),
  displayOverride("DA_18_Kobuko", "可酷伯", "Kobuko"),
  displayOverride("DA_18_RekSai", "雷克塞", "Rek'Sai"),
  displayOverride("DA_18_Leona", "蕾欧娜", "Leona"),
  displayOverride("DA_18_Rakan", "洛", "Rakan"),
  displayOverride("DA_18_Varus", "韦鲁斯", "Varus"),
  displayOverride("DA_18_Veigar", "维迦", "Veigar"),
  displayOverride("DA_18_Xayah", "霞", "Xayah"),
  displayOverride("DA_18_Yorick", "约里克", "Yorick"),
  displayOverride("DA_18_Alistar", "阿利斯塔", "Alistar"),
  displayOverride("DA_Murkwolf18", "暗影狼", "Murkwolf"),
  displayOverride("DA_18_Kayle", "凯尔", "Kayle"),
  displayOverride("DA_18_Caitlyn", "凯特琳", "Caitlyn"),
  displayOverride("DA_18_LeBlanc", "乐芙兰", "LeBlanc"),
  displayOverride("DA_Gromp18_AP", "魔沼蛙", "Gromp"),
  displayOverride("DA_18_Sejuani", "瑟庄妮", "Sejuani"),
  displayOverride("DA_18_Shen", "慎", "Shen"),
  displayOverride("DA_18_Teemo", "提莫", "Teemo"),
  displayOverride("DA_18_Warwick", "沃里克", "Warwick"),
  displayOverride("DA_Scuttlecrab18", "峡谷迅捷蟹", "Scuttlecrab"),
  displayOverride("DA_18_Elise", "伊莉丝", "Elise"),
  displayOverride("DA_18_Yunara", "芸阿娜", "Yunara"),
  displayOverride("DA_18_Azir", "阿兹尔", "Azir"),
  displayOverride("DA_18_Tristana", "崔丝塔娜", "Tristana"),
  displayOverride("DA_18_Diana", "黛安娜", "Diana"),
  displayOverride("DA_Fiddlesticks18", "费德提克", "Fiddlesticks"),
  displayOverride("DA_18_Hecarim", "赫卡里姆", "Hecarim"),
  displayOverride("DA_18_Cassiopeia", "卡西奥佩娅", "Cassiopeia"),
  displayOverride("DA_18_KhaZix", "卡兹克", "Kha'Zix"),
  displayOverride("DA_KogMaw18_AD", "克格莫", "Kog'Maw"),
  displayOverride("DA_18_Rammus", "拉莫斯", "Rammus"),
  displayOverride("DA_18_Rengar", "雷恩加尔", "Rengar"),
  displayOverride("DA_CrimsonRaptor18", "深红锋喙鸟", "Mama Beak"),
  displayOverride("DA_Vi18", "蔚", "Vi"),
  displayOverride("DA_18_MasterYi_AD", "易", "Master Yi"),
  displayOverride("DA_Krug18", "远古石甲虫", "Krug"),
  displayOverride("DA_18_Ahri", "阿狸", "Ahri"),
  displayOverride("DA_Amumu18", "阿木木", "Amumu"),
  displayOverride("DA_Sentinel18", "苍蓝雕纹魔像", "Sentinel"),
  displayOverride("DA_18_Aphelios", "厄斐琉斯", "Aphelios", {
    fuzzyAliases: ["月男", "efls"]
  }),
  displayOverride("DA_Brambleback18", "绯红印记树怪", "Brambleback"),
  displayOverride("DA_18_Zyra", "婕拉", "Zyra"),
  displayOverride("DA_18_Lillia", "莉莉娅", "Lillia"),
  displayOverride("DA_18_Morgana", "莫甘娜", "Morgana"),
  displayOverride("DA_18_Malphite", "墨菲特", "Malphite"),
  displayOverride("DA_Nidalee18_AP", "奈德丽", "Nidalee"),
  displayOverride("DA_18_Sett", "瑟提", "Sett"),
  displayOverride("DA_18_Soraka", "索拉卡", "Soraka"),
  displayOverride("DA_18_Sivir", "希维尔", "Sivir"),
  displayOverride("DA_18_Ezreal", "伊泽瑞尔", "Ezreal"),
  displayOverride("DA_18_Ivern", "艾翁", "Ivern"),
  displayOverride("DA_18_Ashe", "艾希", "Ashe"),
  displayOverride("DA_Draven18", "德莱文", "Draven"),
  displayOverride("DA_18_Kennen", "凯南", "Kennen"),
  displayOverride("DA_Lux18_Base", "拉克丝", "Lux"),
  displayOverride("DA_18_Alune", "拉露恩", "Alune"),
  displayOverride("DA_18_Maokai", "茂凯", "Maokai"),
  displayOverride("DA_18_GnarSmall", "纳尔", "Gnar"),
  displayOverride("DA_Taric18", "塔里克", "Taric"),
  displayOverride("DA_18_ElderDragon", "远古巨龙", "Elder Dragon")
]);

export const S18_TRAIT_DISPLAY_OVERRIDES = Object.freeze([
  displayOverride("DA_18_Executioner", "裁决使", "Executioner"),
  displayOverride("DA_18_Greenfather", "翠神", "Greenfather"),
  displayOverride("DA_18_LuxUniqueTrait", "大元素使", "Avatar"),
  displayOverride("DA_18_Inferno", "地狱火", "Inferno"),
  displayOverride("DA_18_ApexPredator", "顶级掠食者", "Apex Predator"),
  displayOverride("DA_18_Brawler", "斗士", "Brawler"),
  displayOverride("DA_18_Spellweaver", "法师", "Spellweaver"),
  displayOverride("DA_Emerald18", "宝石骑士", "Emerald Aspect"),
  displayOverride("DA_18_Caustic", "帝王斑蝶", "Caustic"),
  displayOverride("DA_18_Blackthorn", "黑荆棘", "Blackthorn"),
  displayOverride("DA_18_Defender", "护卫", "Defender"),
  displayOverride("DA_18_Fae", "花仙子", "Fae"),
  displayOverride("DA_18_ZyraUniqueTrait", "荆棘之兴", "Thornmaiden"),
  displayOverride("DA_FloraFatalis18", "绝命花妖", "Flora Fatalis"),
  displayOverride("DA_18_Slayer", "狂战士", "Ravager"),
  displayOverride("DA_18_Hunter", "猎人", "Hunter"),
  displayOverride("DA_18_Blossom", "灵魂莲华", "Blossom"),
  displayOverride("DA_18_Coven", "魔女", "Coven"),
  displayOverride("DA_18_Battlemage", "魔石巨兽", "Monolith"),
  displayOverride("DA_18_Adaptor", "魔战士", "Adaptor"),
  displayOverride("DA_18_Vanguard", "重装战士", "Vanguard"),
  displayOverride("DA_18_Solar", "日蚀骑士", "Solar"),
  displayOverride("DA_18_Eclipse", "日月双蚀", "Eclipse"),
  displayOverride("DA_DravenUniqueTrait18", "赏金猎人", "Bounty Seeker"),
  displayOverride("DA_18_Invoker", "神谕", "Invoker"),
  displayOverride("DA_18_Rival", "宿敌", "Rival"),
  displayOverride("DA_Riftbeast18", "峡谷野怪", "Riftbeast"),
  displayOverride("DA_18_Sprykin", "约德尔人", "Sprykin"),
  displayOverride("DA_18_Rapidfire", "迅捷射手", "Rapidfire"),
  displayOverride("DA_Primal18", "野兽之灵", "Primal"),
  displayOverride("DA_18_Elderwood", "永恒之森", "Elderwood"),
  displayOverride("DA_18_Maokai_UniqueTrait", "远古树精", "Old Growth"),
  displayOverride("DA_AluneUniqueTrait18", "月华神女", "Attuned"),
  displayOverride("DA_18_Lunar", "月蚀骑士", "Lunar"),
  displayOverride("DA_18_Summoner", "召唤师", "Summoner"),
  displayOverride("DA_Juggernaut18", "主宰", "Juggernaut")
]);

export const unitDisplayOverrideByApiName = new Map(
  S18_UNIT_DISPLAY_OVERRIDES.map((entry) => [entry.apiName, entry])
);

export const traitDisplayOverrideByApiName = new Map(
  S18_TRAIT_DISPLAY_OVERRIDES.map((entry) => [entry.apiName, entry])
);
