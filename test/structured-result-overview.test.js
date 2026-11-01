import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../src/app/small-window-ui/app.js", import.meta.url), "utf8");
const functionSource = (name) => {
  const start = app.indexOf(`function ${name}(`);
  return app.slice(start, app.indexOf("\nfunction ", start + 1));
};
const prose = "**完整模型回答** | 棋子 | 样本 |\n|---|---|\n".repeat(30);
const query = { patch: "18.4", days: 3, rankFilter: ["MASTER"] };
function render(name, data) {
  let html;
  const context = {
    state: {}, t: (key, args) => `${key}${args?.value ?? ""}`,
    escapeHtml: (value) => String(value ?? ""),
    rankChip: (ranks) => ranks.join("/"),
    localizedName: (entity, fallback) => entity?.name ?? fallback ?? "",
    formatNumber: String, metric: (label, value) => `${label}:${value}`,
    setResponseHtml: (value) => { html = value; },
    assetThumb: () => "", itemPill: () => "",
    conditionPanel: () => "", sourceAndRisk: () => "",
    generatedConclusionCard: () => "", rankingInsightBadges: () => "",
    itemRankingModeControl: () => "", itemRankingDisplayLimit: () => 10,
    itemRankingIsMixed: () => false
  };
  runInNewContext(["resultHeader", "structuredQueryScope", name].map(functionSource).join("\n") + `\n${name}(data)`, { ...context, data });
  return html;
}
const stats = { top4: 56.4, win: 24, avg: 4.02, games: 69950 };
const base = { text: prose, answer: { summary: prose }, query };

test("carrier results show scope and data cards without copying model tables into the header", () => {
  const html = render("renderItemCarrierRankings", { ...base, item: { name: "羊刀" },
    carriers: [{ unit: { name: "德莱文" }, stats, placementUplift: 0.185 }] });
  assert.match(html, /18\.4.*daysRecent3.*MASTER/u);
  assert.match(html, /德莱文/u);
  assert.match(html, /69950/u);
  assert.doesNotMatch(html, /完整模型回答|\|---/u);
});

test("equipment rankings and performance checks have compact headers", () => {
  const item = { name: "羊刀", stats };
  for (const extra of [{}, { itemPerformance: { item, rank: 1, conclusion: prose } }]) {
    const html = render("renderItemRankings", { ...base, itemRankings: [item], ...extra });
    assert.match(html, /18\.4/u);
    assert.match(html, /羊刀/u);
    assert.match(html, /69950/u);
    assert.doesNotMatch(html, /完整模型回答|\|---/u);
  }
});

test("empty carriers retain the reason for missing results", () => {
  const html = render("renderItemCarrierRankings", { ...base, carriers: [], text: "当前筛选条件没有足够样本" });
  assert.match(html, /当前筛选条件没有足够样本/u);
});
