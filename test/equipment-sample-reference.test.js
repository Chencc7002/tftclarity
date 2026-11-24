import { test } from "node:test";
import assert from "node:assert/strict";
import { equipmentSampleReference, sampleReferenceText } from "../src/app/equipment-sample-reference.js";
import { classifyItemApiName } from "../src/data/item-catalog.js";

test("S19 emblems remain outside the ordinary item pool", () => {
  for (const id of ["DA_IonicSpark19_Emblem","DA_Mosher19_Emblem","DA_Pentakill19_Emblem","DA_Renegade19_Emblem"]) assert.equal(classifyItemApiName(id),"emblem");
  assert.equal(classifyItemApiName("DA_IonicSpark"),"ordinary_completed");
});

const row = (apiName, games) => ({ apiName, excludedReason: "below_min_samples", stats: { games, avgPlacement: 3.91, top4Rate: .59, winRate: .19 } });
const fixture = { type: "unit_item_rankings", query: { minSamples: 100 }, itemRankings: [row("A", 300), row("B", 150)],
  itemRankingReferences: [row("C", 27), row("D", 91), row("E", 0), { ...row("F", 95), excludedReason: "special_item_outlier_sample" }] };
const query = (value, text, explicit = false) => equipmentSampleReference(value, text, name => name, explicit);

test("supplement fills the shortfall from the highest observed samples with the original rows intact", () => {
  const ref = query(fixture, "列出前三件");
  assert.deepEqual(ref.rows.map(x => [x.name, x.games]), [["D", 91]]);
  assert.equal(ref.referenceMinimum, 91);
  assert.equal(query(fixture, "取前五件").referenceMinimum, 27);
  assert.match(sampleReferenceText(ref, "泽丽", "zh-CN"), /100 场降至 91 场/u);
  assert.equal(query(fixture, "前两件"), null);
  assert.equal(fixture.itemRankings.length, 2);
});
test("targeted lookups retain the unit and item and honor strict or unavailable samples", () => {
  const target = { ...fixture, query: { ...fixture.query, performanceItem: "C" } };
  assert.equal(query(target, "C表现怎么样").referenceMinimum, 27);
  for (const [text, explicit] of [["只看至少100场",false], ["不要降低样本门槛",false], ["看看同条件",true]]) {
    assert.equal(query(target,text,explicit),null);
  }
  assert.equal(query(target, "样本不足时可以降低门槛", true).referenceMinimum, 27);
  assert.equal(query({ ...target, cache: { query: { stale: true } } },"数据"),null);
  assert.equal(query({ ...target, query: { ...target.query, performanceItem: "E" } },"数据"),null);
});
test("a comparison or complete build uses only its matching positive samples", () => {
  const base = { query: { minSamples: 100 } };
  const cmp = { ...base, comparison: { entries: [row("A", 120), row("C", 27)] } };
  assert.deepEqual(query(cmp, "比较").rows.map(x => x.name), ["C"]);
  const builds = { ...base, type: "unit_build_completion", rankedBuilds: [], filteredBuilds: [{ ...row("C", 16), items: ["A","B","C"] }] };
  assert.equal(query(builds, "补齐").rows[0].name, "A + B + C");
});
