import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
const renderSource = app.slice(
  app.indexOf("function renderItemRankings(data)"),
  app.indexOf("function renderItemCarrierRankings(data)")
);

test("item performance summary does not hide the full ranking payload", () => {
  let rendered = "";
  const context = vm.createContext({
    setResponseHtml: (value) => { rendered = value; },
    resultHeader: () => "",
    assetThumb: () => "",
    localizedName: (item) => item?.name ?? item?.apiName ?? "",
    escapeHtml: String,
    t: String,
    formatNumber: String,
    metric: () => "",
    conditionPanel: () => "",
    sourceAndRisk: () => "",
    itemRankingModeControl: () => "",
    itemRankingDisplayLimit: () => 10
  });
  vm.runInContext(renderSource, context);
  const rankings = Array.from({ length: 18 }, (_, index) => ({
    name: `装备${index + 1}`,
    stats: { top4: 50, win: 10, avg: 4, games: 100 - index }
  }));

  context.renderItemRankings({
    itemRankings: rankings,
    itemPerformance: {
      rank: 1,
      conclusion: "目标装备表现",
      item: rankings[0],
      topRankings: rankings.slice(0, 3)
    },
    answer: { methodology: "同条件聚合" }
  });

  assert.match(rendered, /同条件装备排行榜（前 10 \/ 共 18）/u);
  assert.doesNotMatch(rendered, /同条件装备 Top 3/u);
  assert.equal((rendered.match(/class="item-ranking-card/g) ?? []).length, 11);
  assert.match(rendered, /10\. 装备10/u);
});
