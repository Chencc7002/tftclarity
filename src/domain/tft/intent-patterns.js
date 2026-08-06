import { normalizeText } from "../../core/normalizer.js";

export const ITEM_CARRIER_REQUEST_PATTERN = /(?:(?:适合|推荐|应该|优先|最好).{0,8}(?:(?:给|放给|装给|给到|让).{0,4})?(?:谁|哪个(?:英雄|棋子)|哪些(?:英雄|棋子))|(?:给|放给|装给|给到|让).{0,6}(?:谁|哪个(?:英雄|棋子)|哪些(?:英雄|棋子))|(?:谁|哪个(?:英雄|棋子)|哪些(?:英雄|棋子)).{0,10}(?:(?:适合|推荐|应该|优先|最好).{0,6})?(?:带|携带|用|装备)|(?:谁|哪个(?:英雄|棋子)|哪些(?:英雄|棋子)).{0,8}(?:适合|推荐)|(?:适配|适合)(?:的)?(?:英雄|棋子)|(?:英雄|棋子)(?:携带者|推荐)|(?:携带者|适配棋子))/u;

export const HERO_COMP_REQUEST_PATTERN = /(?:可以|适合|能够|能).{0,5}(?:玩|进|加入).{0,5}(?:什么|哪些)?阵容|(?:什么|哪些|所有).{0,4}阵容|阵容.{0,6}(?:有哪些|是什么|推荐)/u;

export function isItemCarrierRequest(input) {
  return ITEM_CARRIER_REQUEST_PATTERN.test(normalizeText(input));
}

export function isHeroCompRequest(input) {
  return HERO_COMP_REQUEST_PATTERN.test(normalizeText(input));
}
