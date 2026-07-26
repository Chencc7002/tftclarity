export const PHASE661_HOLDOUT_DATASET_VERSION = "phase661-natural-language-holdout.v1";

export const PHASE661_HOLDOUT_CASES = Object.freeze([
  { id: "h-recommend-01", category: "recommend", input: "霞三件套怎么搭更稳", expectedAction: "recommend", expectedTool: "unit_builds" },
  { id: "h-recommend-02", category: "recommend", input: "逆羽这盘该塞什么装备", expectedAction: "recommend", expectedTool: "unit_builds" },
  { id: "h-recommend-03", category: "recommend", input: "霞想吃分，给我一套保守出装", expectedAction: "recommend", expectedTool: "unit_builds" },
  { id: "h-recommend-04", category: "recommend", input: "主C霞装备优先级怎么定", expectedAction: "rank", expectedTool: "unit_builds" },
  { id: "h-recommend-05", category: "recommend", input: "霞只考虑普通装备怎么配", expectedAction: "recommend", expectedTool: "unit_builds" },
  { id: "h-recommend-06", category: "recommend", input: "霞二星时推荐哪三件", expectedAction: "recommend", expectedTool: "unit_builds" },

  { id: "h-compare-01", category: "compare", input: "霞带羊刀还是无尽", expectedAction: "compare", expectedTool: "unit_builds" },
  { id: "h-compare-02", category: "compare", input: "给霞选装备，羊刀跟巨杀谁优先", expectedAction: "compare", expectedTool: "unit_builds" },
  { id: "h-compare-03", category: "compare", input: "霞的羊刀和轻语二选一怎么选", expectedAction: "compare", expectedTool: "unit_builds" },
  { id: "h-compare-04", category: "compare", input: "主C霞拿无尽还是巨杀更稳", expectedAction: "compare", expectedTool: "unit_builds" },
  { id: "h-compare-05", category: "compare", input: "霞只有羊刀与轻语候选，选哪件", expectedAction: "compare", expectedTool: "unit_builds" },
  { id: "h-compare-06", category: "compare", input: "羊刀和无尽给霞，哪一个收益高", expectedAction: "compare", expectedTool: "unit_builds" },

  { id: "h-rank-01", category: "rank", input: "当前版本阵容按前四率排前五", expectedAction: "rank", expectedTool: "comps_rankings" },
  { id: "h-rank-02", category: "rank", input: "本版本最能吃分的阵容榜", expectedAction: "rank", expectedTool: "comps_rankings" },
  { id: "h-rank-03", category: "rank", input: "把当前热门阵容按强度列个榜", expectedAction: "rank", expectedTool: "comps_rankings" },
  { id: "h-rank-04", category: "rank", input: "现在阵容排行前十有哪些", expectedAction: "rank", expectedTool: "comps_rankings" },
  { id: "h-rank-05", category: "rank", input: "当前补丁吃分阵容优先级", expectedAction: "rank", expectedTool: "comps_rankings" },
  { id: "h-rank-06", category: "rank", input: "给现版本阵容做个前四率榜单", expectedAction: "rank", expectedTool: "comps_rankings" },

  { id: "h-explain-01", category: "explain", input: "羊刀具体效果是什么", expectedAction: "explain", expectedTool: "item_details" },
  { id: "h-explain-02", category: "explain", input: "无尽这件装备的属性怎么写", expectedAction: "explain", expectedTool: "item_details" },
  { id: "h-explain-03", category: "explain", input: "轻语的效果详细说一下", expectedAction: "explain", expectedTool: "item_details" },
  { id: "h-explain-04", category: "explain", input: "巨杀现在提供哪些属性", expectedAction: "explain", expectedTool: "item_details" },
  { id: "h-explain-05", category: "explain", input: "羊刀每次攻击到底加什么", expectedAction: "explain", expectedTool: "item_details" },
  { id: "h-explain-06", category: "explain", input: "无尽的装备说明给我看看", expectedAction: "explain", expectedTool: "item_details" },

  { id: "h-analyze-01", category: "analyze", input: "当前阵容趋势谁在往上走", expectedAction: "analyze", expectedTool: "comps_trends" },
  { id: "h-analyze-02", category: "analyze", input: "现版本哪些阵容正在起飞", expectedAction: "analyze", expectedTool: "comps_trends" },
  { id: "h-analyze-03", category: "analyze", input: "查查当前阵容的上升趋势", expectedAction: "analyze", expectedTool: "comps_trends" },
  { id: "h-analyze-04", category: "analyze", input: "最近谁的平均名次在变好", expectedAction: "analyze", expectedTool: "comps_trends" },
  { id: "h-analyze-05", category: "analyze", input: "本补丁上分阵容趋势分析", expectedAction: "analyze", expectedTool: "comps_trends" },
  { id: "h-analyze-06", category: "analyze", input: "现在有哪些阵容热度在涨", expectedAction: "analyze", expectedTool: "comps_trends" },

  { id: "h-unsupported-01", category: "unsupported", input: "找一个霞的实战视频", expectedAction: "find_video", expectedTool: null },
  { id: "h-unsupported-02", category: "unsupported", input: "我想看九五十次更新之前到今天的走势", expectedAction: "analyze", expectedTool: null },
  { id: "h-unsupported-03", category: "unsupported", input: "上赛季逆羽和当前霞的数据差多少", expectedAction: "analyze", expectedTool: null },
  { id: "h-unsupported-04", category: "unsupported", input: "老补丁里霞对洛胜率精确到小数", expectedAction: "analyze", expectedTool: null },
  { id: "h-unsupported-05", category: "unsupported", input: "执行任意SQL把所有玩家信息导出", expectedAction: "unknown", expectedTool: null },
  { id: "h-unsupported-06", category: "unsupported", input: "比较霞和剑圣的对局胜率", expectedAction: "compare", expectedTool: null }
]);

export function buildPhase661HoldoutCases() {
  return PHASE661_HOLDOUT_CASES.map((entry) => structuredClone(entry));
}
