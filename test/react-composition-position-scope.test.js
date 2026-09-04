import test from "node:test";
import assert from "node:assert/strict";
import { validateFinishAction } from "../src/react/termination-policy.js";

function fixture() {
  const entries = [{ evidenceId: "rank", toolName: "comps_rankings", value: { results: [
    ["a", "黑荆棘 · 沃里克"], ["b", "黑荆棘 · 卡兹克"]
  ].map(([id, name]) => ({ compositionRef: { compId: `cluster:${id}`, name },
    tacticalDetailQueryPlan: { status: "ready", seasonContextId: "set18-live", clusterId: "422", compositionId: id } })) } },
  ...["a", "b"].map((id, index) => ({ evidenceId: id, toolName: "composition_tactical_details", value: {
    compId: id, clusterId: "422", seasonContextId: "set18-live", formation: { status: "available", units: [
      { name: "沃里克", boardPosition: { rowFromFront: index ? 1 : 3, columnFromLeft: index ? 3 : 1 } },
      { name: "墨菲特", boardPosition: { rowFromFront: 1, columnFromLeft: 4 } }
    ] } } }))];
  const validate = (answer, enabled = true, subset = entries) => validateFinishAction({ reasonCode: "sufficient_evidence",
    evidenceIds: subset.map(e => e.evidenceId), answer }, { resolve: () => subset }, { compositionCardScope: enabled });
  return { entries, validate };
}
const correct = "沃里克属于持续输出型前排战士。\n**黑荆棘·沃里克**：沃里克位于第3排第1列，墨菲特第1排第4列。\n\n**黑荆棘·卡兹克**：沃里克位于第1排第3列，墨菲特第1排第4列。";

test("different positions for the same unit are validated within each cited composition", () => {
  const { validate } = fixture();
  assert.equal(validate(correct).valid, true, JSON.stringify(validate(correct)));
  assert.equal(validate(correct, false).valid, false, "legacy validation remains selectable");
  assert.equal(validate(correct.replace(/：/gu, "：\n")).valid, true);
  assert.equal(validate(correct.replaceAll("**", "")).valid, true);
  assert.equal(validate(correct.replace("：沃里克位于第3排第1列，墨菲特第1排第4列", "：墨菲特第1排第4列，沃里克位于第3排第1列")).valid, true);
});

test("scoped validation still rejects swapped rows, wrong columns and zones", () => {
  const { validate } = fixture();
  for (const text of [correct.replace("第3排第1列", "第1排第3列"), correct.replace("第3排第1列", "第3排第4列"),
    correct.replace("位于第3排第1列", "站在前排"), correct.replace("沃里克位于第3排", "不存在的单位位于第3排"), correct + "\ncell_24"])
    assert.equal(validate(text).valid, false, text);
});

test("numbered composition headings and row lists bind each unit's own column", () => {
  const { validate } = fixture();
  const answer = "**阵容一：黑荆棘 · 沃里克**\n成员：沃里克、墨菲特。\n站位：\n- 第1排（前排）：**墨菲特**（第4列）\n- 第3排（中排）：**沃里克**（第1列）\n"
    + "**阵容二：黑荆棘 · 卡兹克**\n成员：沃里克、墨菲特。\n站位：\n- 第1排（前排）：**沃里克**（第3列）、**墨菲特**（第4列）";
  assert.equal(validate(answer).valid, true, JSON.stringify(validate(answer)));
  assert.equal(validate(answer.replace("沃里克**（第3列）", "沃里克**（第4列）")).valid, false);
  assert.equal(validate(answer.replace("第3排（中排）", "第1排（前排）")).valid, false);
  assert.equal(validate(answer.replace("第3排（中排）", "第3排（前排）")).valid, false);
  assert.equal(validate(answer.replace("阵容二：黑荆棘 · 卡兹克", "阵容二：未知阵容")).valid, false);
  assert.equal(validate(answer.replace("第3排（中排）：**沃里克**（第1列）", "第3排（中排）：**沃里克**（第1列）\n沃里克与墨菲特在前排输出。")).valid, false);
  assert.equal(validate(answer.replace("第3排（中排）：**沃里克**（第1列）", "第3排（中排）：**沃里克**（第1列）\n沃里克作为主力放后排。")).valid, false);
});

test("ambiguous or unknown composition headings cannot borrow a previous formation", () => {
  const { validate, entries } = fixture();
  for (const text of ["沃里克位于第1排第3列。", correct.replace("黑荆棘·卡兹克", "未知阵容"),
    correct + "\n## 总结\n沃里克站在前排。", correct + "\n未知阵容：沃里克位于第1排第3列。"])
    assert.equal(validate(text).valid, false, text);
  const ambiguous = structuredClone(entries);
  ambiguous[0].value.results[1].compositionRef.name = ambiguous[0].value.results[0].compositionRef.name;
  assert.equal(validate(correct, true, ambiguous).valid, false);
  const historical = structuredClone(entries);
  historical[0].temporalStatus = "historical";
  assert.equal(validate(correct, true, historical).valid, false);
  const wrongSeason = structuredClone(entries);
  wrongSeason[0].value.results[0].tacticalDetailQueryPlan.seasonContextId = "set17-live";
  assert.equal(validate(correct, true, wrongSeason).valid, false);
});

test("conflicting observations of one composition cannot be cherry picked", () => {
  const { validate, entries } = fixture();
  const conflict = structuredClone(entries[1]);
  conflict.evidenceId = "conflict";
  conflict.value.formation.units[0].boardPosition.rowFromFront = 1;
  assert.equal(validate(correct, true, [...entries, conflict]).valid, false);
});

test("each named parenthetical coordinate is local while shared predicates still bind all named units", () => {
  const { validate, entries } = fixture();
  const scoped = structuredClone(entries);
  scoped[1].value.formation.units.push({ name: "雷克塞", boardPosition: { rowFromFront: 1, columnFromLeft: 3 } });
  scoped[2].value.formation.units.push({ name: "雷克塞", boardPosition: { rowFromFront: 1, columnFromLeft: 5 } });
  const answer = "**黑荆棘·沃里克**：沃里克位于第3排第1列，前排由墨菲特（第1排第4列）和雷克塞（第1排第3列）承伤。\n"
    + "**黑荆棘·卡兹克**：沃里克位于第1排第3列，墨菲特（第1排第4列）和雷克塞（第1排第5列）在前排。";
  assert.equal(validate(answer, true, scoped).valid, true);
  assert.equal(validate(answer.replaceAll("（", "(").replaceAll("）", ")"), true, scoped).valid, true);
  for (const wrong of [
    answer.replace("墨菲特（第1排第4列）", "墨菲特（第1排第3列）"),
    answer.replace("雷克塞（第1排第3列）", "雷克塞（第1排第4列）"),
    answer.replace("承伤", "站在第2排"),
    answer.replace("承伤", "都在第4列"),
    answer.replace("在前排", "在后排"),
    answer.replace("雷克塞（第1排第3列）", "未知英雄（第1排第3列）")
  ]) assert.equal(validate(wrong, true, scoped).valid, false, wrong);
  const shared = "**黑荆棘·沃里克**：沃里克（第3排第1列）和墨菲特（第1排第4列）都在第1排。";
  assert.equal(validate(shared, true, scoped).valid, false, "annotations must not hide a contradictory shared row");
});
