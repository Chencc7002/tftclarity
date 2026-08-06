import {
  normalizeSystemInteractionInput,
  createSystemInteractionResult
} from "../system-interaction-contracts.js";
import { renderOutOfDomain } from "../renderers/system-interaction-renderers.js";

const OUT_OF_DOMAIN_PATTERNS = [
  /(?:帮我|替我|给我)?写(?:一篇|个)?(?:论文|作文|邮件|文案|代码|程序|简历)/u,
  /(?:今天天气|明天天气|天气怎么样|天气预报)/u,
  /(?:讲|编|写)(?:一个|个)?(?:故事|笑话|小说|诗)/u,
  /(?:翻译|英语作文|数学题|物理题|化学题)/u,
  /(?:菜谱|怎么做饭|旅游攻略|股票|基金|房价)/u,
  /\b(?:weather|write (?:an? )?(?:essay|story|email)|translate|stock price)\b/iu
];

export const outOfDomainHandler = Object.freeze({
  interactionType: "out_of_domain",
  matches({ input }) {
    const normalized = normalizeSystemInteractionInput(input);
    return OUT_OF_DOMAIN_PATTERNS.some((pattern) => pattern.test(normalized));
  },
  handle() {
    return createSystemInteractionResult({
      interactionType: "out_of_domain",
      answer: renderOutOfDomain()
    });
  }
});
