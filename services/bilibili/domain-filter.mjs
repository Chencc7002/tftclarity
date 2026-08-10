const TFT_STRONG = Object.freeze([
  { id: "teamfight_tactics_zh", pattern: /云顶之弈/iu },
  { id: "teamfight_tactics_en", pattern: /teamfight\s+tactics/iu },
  { id: "tft", pattern: /(?:^|[^a-z])tft(?:[^a-z]|$)/iu }
]);

const GOLDEN_STRONG = Object.freeze([
  { id: "golden_spatula", pattern: /金铲铲(?:之战)?/iu }
]);

const WEAK_POSITIVE = Object.freeze([
  ["composition", /阵容|羁绊/iu],
  ["unit", /弈子/iu],
  ["augment", /强化符文|海克斯|强化/iu],
  ["reroll", /d牌|搜牌|赌狗/iu],
  ["leveling", /上人口|升人口|拉人口|八人口|九人口/iu],
  ["transition", /过渡/iu],
  ["economy", /运营/iu],
  ["positioning", /站位/iu],
  ["itemization", /装备|出装|主c|副c|前排/iu],
  ["ranking", /版本答案|九五|(?:^|\D)95(?:\D|$)|吃鸡|前四/iu]
]);

const STRATEGY_EVIDENCE = /攻略|教学|阵容|羁绊|运营|过渡|站位|装备|出装|主c|副c|强化|海克斯|上人口|升人口|搜牌|d牌/iu;
const NEGATIVE_GAMEPLAY = /召唤师峡谷|对线教学|连招教学|技能连招|打野路线|打野教学|adc教学|中单教学|上单教学|辅助教学|补刀教学|符文天赋|英雄联盟手游|lol手游|峡谷手游/iu;
const NEGATIVE_CONTENT = /赛事集锦|比赛集锦|高光集锦|操作集锦|精彩集锦|五杀集锦|精彩操作合集/iu;
const EXPLICIT_NON_STRATEGY = /电影|电视剧|动漫|番剧|音乐|歌曲|舞蹈|美食|旅游|足球|篮球|编程|代码|宠物|猫咪|猫猫|狗狗|汽车|数码评测|召唤师峡谷|峡谷|英雄联盟手游|lol手游/iu;
const EXPLICIT_VIDEO_REQUEST = /视频|bilibili|哔哩哔哩|b站|搜索|帮我找|给我找/iu;
const BOTH_INTENT = /两边|两个.{0,4}都|分别|云顶.{0,8}金铲铲|金铲铲.{0,8}云顶/iu;
const GENERIC_QUERY = new Set([
  "找", "搜索", "搜", "视频", "攻略", "教学", "最近", "最新", "当前", "版本", "一个", "几个",
  "b站", "bilibili", "云顶之弈", "tft", "teamfight", "tactics", "金铲铲", "金铲铲之战"
]);

function normalized(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/<[^>]+>/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function anchors(entries, text) {
  return entries.filter((entry) => entry.pattern.test(text)).map((entry) => entry.id);
}

function weakAnchors(text) {
  return WEAK_POSITIVE.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
}

function targetTerms(query) {
  return normalized(query).split(/\s+/u)
    .filter((term) => term && !GENERIC_QUERY.has(term))
    .slice(0, 10);
}

function plan(ecosystem, query, hasAnchor) {
  const anchor = ecosystem === "golden_spatula" ? "金铲铲之战" : "云顶之弈";
  return {
    ecosystem,
    effectiveQuery: hasAnchor ? query : `${query} ${anchor}`.trim()
  };
}

export function gateStrategyVideoRequest(query) {
  const value = String(query ?? "").trim();
  const hasTft = anchors(TFT_STRONG, value).length > 0;
  const hasGolden = anchors(GOLDEN_STRONG, value).length > 0;
  const weak = weakAnchors(value);
  const terms = targetTerms(value);

  if (EXPLICIT_NON_STRATEGY.test(value) && ((!hasTft && !hasGolden) || !STRATEGY_EVIDENCE.test(value))) {
    return {
      allowed: false,
      status: "unsupported_scope",
      reason: "non_strategy_video_request",
      requestedEcosystem: "non_tft"
    };
  }

  if (!hasTft && !hasGolden && weak.length === 0 && EXPLICIT_VIDEO_REQUEST.test(value)) {
    return {
      allowed: false,
      status: "unsupported_scope",
      reason: "tft_strategy_signal_required",
      requestedEcosystem: "non_tft"
    };
  }

  if (!hasTft && !hasGolden && terms.length === 0) {
    return {
      allowed: false,
      status: "unsupported_scope",
      reason: "strategy_subject_required",
      requestedEcosystem: "unknown"
    };
  }

  const both = hasTft && hasGolden && BOTH_INTENT.test(value);
  const requestedEcosystem = both ? "both" : hasGolden ? "golden_spatula" : "tft_pc";
  const ecosystemSource = hasTft || hasGolden ? "explicit" : "default";
  const neutralQuery = both
    ? value.replace(/云顶之弈|teamfight\s+tactics|(?:^|\s)tft(?:\s|$)|金铲铲(?:之战)?|分别|两边/giu, " ")
      .replace(/帮我|给我|找一下|一起|几个|和|都|找/gu, " ")
      .replace(/\s+/gu, " ").trim()
    : value;
  const searchPlans = both
    ? [plan("tft_pc", neutralQuery, false), plan("golden_spatula", neutralQuery, false)]
    : [plan(requestedEcosystem, value, requestedEcosystem === "golden_spatula" ? hasGolden : hasTft)];
  return {
    allowed: true,
    status: "allowed",
    reason: null,
    requestedEcosystem,
    ecosystemSource,
    targetTerms: terms,
    searchPlans,
    effectiveQuery: searchPlans[0].effectiveQuery
  };
}

export function classifyStrategyVideoDomain(video, query, requestedEcosystem = "tft_pc") {
  const title = String(video.title ?? "");
  const description = String(video.description ?? "");
  const tags = Array.isArray(video.tags) ? video.tags.join(" ") : String(video.tags ?? "");
  const text = `${title} ${description} ${tags}`;
  const tftAnchors = anchors(TFT_STRONG, text);
  const goldenAnchors = anchors(GOLDEN_STRONG, text);
  const weak = weakAnchors(text);
  const targets = targetTerms(query);
  const normalizedText = normalized(text);
  const entityMatches = targets.filter((term) => normalizedText.includes(term));
  const hasStrategyEvidence = STRATEGY_EVIDENCE.test(text);
  const resultEcosystem = tftAnchors.length && goldenAnchors.length
    ? "cross_ecosystem"
    : goldenAnchors.length ? "golden_spatula" : tftAnchors.length ? "tft_pc" : "unknown";
  const base = {
    tftAnchors,
    goldenSpatulaAnchors: goldenAnchors,
    matchedTftAnchors: tftAnchors,
    matchedGoldenSpatulaAnchors: goldenAnchors,
    weak,
    entityMatches,
    resultEcosystem
  };

  if (NEGATIVE_CONTENT.test(text) && !hasStrategyEvidence) {
    return { ...base, domainStatus: "rejected", reason: "non_strategy_content" };
  }
  if (NEGATIVE_GAMEPLAY.test(text) && ((!tftAnchors.length && !goldenAnchors.length) || !hasStrategyEvidence)) {
    return { ...base, domainStatus: "rejected", reason: "non_tft_gameplay" };
  }
  if (requestedEcosystem === "tft_pc" && resultEcosystem === "golden_spatula") {
    return { ...base, domainStatus: "rejected", reason: "wrong_ecosystem" };
  }
  if (requestedEcosystem === "golden_spatula" && resultEcosystem === "tft_pc") {
    return { ...base, domainStatus: "rejected", reason: "wrong_ecosystem" };
  }
  if (resultEcosystem !== "unknown") {
    return { ...base, domainStatus: "confirmed", reason: null };
  }
  if (requestedEcosystem === "tft_pc" && entityMatches.length > 0 && new Set(weak).size >= 2) {
    return { ...base, resultEcosystem: "tft_pc", domainStatus: "inferred", reason: null };
  }
  return { ...base, domainStatus: "rejected", reason: "insufficient_ecosystem_evidence" };
}

export function filterStrategyVideoDomain(videos, query, requestedEcosystem = "tft_pc") {
  const accepted = [];
  const rejected = [];
  for (const video of videos) {
    const domainEvidence = classifyStrategyVideoDomain(video, query, requestedEcosystem);
    const value = {
      ...video,
      ecosystem: domainEvidence.resultEcosystem,
      crossEcosystem: domainEvidence.resultEcosystem === "cross_ecosystem",
      domainEvidence
    };
    if (domainEvidence.domainStatus === "rejected") rejected.push(value);
    else accepted.push(value);
  }
  return {
    accepted,
    rejected,
    rejectionCounts: Object.fromEntries([...new Set(rejected.map((video) => video.domainEvidence.reason))]
      .map((reason) => [reason, rejected.filter((video) => video.domainEvidence.reason === reason).length]))
  };
}

export const bilibiliDomainFilterInternals = Object.freeze({
  tftAnchors: (text) => anchors(TFT_STRONG, text),
  goldenSpatulaAnchors: (text) => anchors(GOLDEN_STRONG, text),
  weakAnchors,
  targetTerms
});
