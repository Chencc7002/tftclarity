import { normalizeText } from "../core/normalizer.js";

const OUT_OF_DOMAIN_PATTERNS = [
  /请假.*(?:邮件|郵件)|(?:邮件|郵件).*请假/u,
  /天气|氣象|菜谱|食谱|翻译这段|写一首诗|机票|酒店/u,
  /(?:javascript|python|java|c\+\+).*(?:代码|程式)|(?:代码|程式).*(?:javascript|python|java|c\+\+)/iu
];

const TFT_PATTERNS = [
  /云顶|金铲铲|tft|阵容|陣容|羁绊|羈絆|赛季|版本|棋子|英雄|装备|裝備|转职|轉職/u,
  /出装|神装|三件套|单件榜|散件|前四率|吃鸡率|均名|登顶|上分|运营|運營|赌狗|賭狗|连败|連敗/u,
  /霞|逆羽|剑圣|劍聖|卡莎|羊刀|杨刀|羊到|巨九|巨9|炼刀|练刀|九五|95|观星|觀星/u,
  /样本|樣本|場|场|数据源|數據源|接口|接囗|新榜|最新|阵荣|玩家.*(?:数据|資料|数据库|資料庫|信息)|数剧库|數劇庫/u
];

export function classifyDomain(input, options = {}) {
  const text = normalizeText(input);
  const contextText = (options.conversation ?? [])
    .map((message) => normalizeText(message?.content))
    .join("");
  const combined = `${contextText}${text}`;
  if (OUT_OF_DOMAIN_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { domain: "out_of_domain", confidence: 0.99, source: "explicit_out_of_domain_pattern" };
  }
  if (TFT_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { domain: "tft", confidence: 0.99, source: "tft_domain_pattern" };
  }
  return {
    domain: options.defaultDomain === "tft" ? "tft" : "out_of_domain",
    confidence: options.defaultDomain === "tft" ? 0.55 : 0.7,
    source: "domain_default"
  };
}
