import { normalizeText } from "./normalizer.js";

const RISING_PATTERN = /(?:变强|走强|转强|上升|上涨|提升|改善|起飞|崛起|回暖|更强|越来越强|rising|improving|gettingstronger)/iu;
const FALLING_PATTERN = /(?:变弱|走弱|转弱|下降|下滑|降低|退步|变差|恶化|跌落|回落|更弱|越来越弱|falling|declining|gettingweaker)/iu;
const TREND_PATTERN = /(?:趋势|走势|变化|变动|升降|最近|近\d+天|今天|这几天)/iu;
const COMP_PATTERN = /(?:阵容|体系|版本|环境|comp|composition|meta)/iu;

export function parseCompTrendDirection(input) {
  const text = normalizeText(input);
  const rising = RISING_PATTERN.test(text);
  const falling = FALLING_PATTERN.test(text);
  if (rising === falling) return null;
  return rising ? "rising" : "falling";
}

export function isCompTrendRequest(input) {
  const text = normalizeText(input);
  const direction = parseCompTrendDirection(text);
  if (direction && COMP_PATTERN.test(text)) return true;
  return COMP_PATTERN.test(text) && TREND_PATTERN.test(text);
}
