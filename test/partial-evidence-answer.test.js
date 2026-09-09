import test from "node:test";
import assert from "node:assert/strict";
import { buildPartialEvidenceAnswer, partialEvidenceSummary } from "../src/react/partial-evidence-answer.js";
import { conclusionRichTextHtml } from "../src/app/small-window-ui/conclusion-rich-text.js";

const composition = (changes = {}) => ({ evidenceId: "comp-1", toolName: "comps_rankings", value: {
  resolution: { status: "resolved" }, results: [{ compositionRef: { name: "花仙子·崔丝塔娜" },
    members: [{ name: "伊莉丝" }, { name: "赫卡里姆" }, { name: "莉莉娅" }],
    stats: { games: 125993, top4Rate: 0.367 },
    tacticalDetailQueryPlan: { status: "ready", compositionId: "11", clusterId: "22", seasonContextId: "set18-live" }
  }] }, ...changes });

test("partial composition answer shows supported facts before specific gaps, without inferring strategy", () => {
  const entry = composition(), original = structuredClone(entry);
  const result = buildPartialEvidenceAnswer([entry]);
  assert.match(result.answer, /花仙子·崔丝塔娜.*伊莉丝、赫卡里姆、莉莉娅.*样本 125993，前四率 36.7%/u);
  assert.ok(result.answer.indexOf("36.7%") < result.answer.indexOf("还缺什么"));
  assert.match(result.answer, /尚未取得完整的站位明细/u);
  assert.doesNotMatch(result.answer, /已取得部分有效证据|最强|主C|可信度.*%/u);
  assert.deepEqual(result.evidenceIds, ["comp-1"]);
  assert.deepEqual(entry, original);
});

test("available tactical details are not falsely reported as missing for their own composition", () => {
  const detail = { evidenceId: "position-1", toolName: "composition_tactical_details", value: {
    compId: "11", clusterId: "22", seasonContextId: "set18-live", formation: { status: "available" }
  } };
  assert.doesNotMatch(buildPartialEvidenceAnswer([composition(), detail]).answer, /缺.*站位|尚未取得完整的站位/u);
  detail.value.compId = "other";
  assert.match(buildPartialEvidenceAnswer([composition(), detail]).answer, /尚未取得完整的站位/u);
});

test("null statistics are not converted to zero; ambiguous compositions remain candidates", () => {
  const entry = composition();
  entry.value.results[0].stats = { games: null, top4Rate: null };
  entry.value.resolution.status = "ambiguous";
  const result = buildPartialEvidenceAnswer([entry]);
  assert.doesNotMatch(result.answer, /样本 0|前四率 0/u);
  assert.match(result.answer, /缺少可展示的表现统计/u);
  assert.match(result.answer, /候选阵容/u);
  assert.match(result.answer, /尚未唯一确认/u);
});

test("batch partial result names actual items and identifies the missing member", () => {
  const result = buildPartialEvidenceAnswer([{ evidenceId: "batch", toolName: "unit_builds_batch", value: { results: [
    { unit: { displayName: "霞" }, available: true, buildOptions: [
      { items: [{ displayName: "鬼索的狂暴之刃" }, { displayName: "无尽之刃" }], metrics: { samples: 400, averagePlacement: 4.1, top4Rate: 0.6 } }
    ] }, { unit: { displayName: "洛" }, available: false, buildOptions: [] }
  ] } }]);
  assert.match(result.answer, /霞的已返回出装：鬼索的狂暴之刃、无尽之刃（样本 400，平均名次 4.1，前四率 60.0%）/u);
  assert.match(result.answer, /“洛”的出装统计本次不可用/u);
  assert.doesNotMatch(result.answer, /稳定方案/u);
});

test("historical and explicitly stale evidence cannot appear as current findings or citations", () => {
  for (const change of [{ temporalStatus: "historical" }, { metadata: { stale: true } }, { metadata: { temporalStatus: "historical" } }]) {
    const result = buildPartialEvidenceAnswer([composition(change)]);
    assert.doesNotMatch(result.answer, /125993|36.7|花仙子/u);
    assert.deepEqual(result.evidenceIds, []);
  }
});

test("catalog-only evidence confirms identity and discloses the lack of answer evidence", () => {
  const result = buildPartialEvidenceAnswer([{ evidenceId: "catalog", toolName: "entity_catalog_query", value: {
    resolution: { requests: [{ status: "resolved", candidates: [{ displayName: "崔丝塔娜" }] },
      { status: "ambiguous", candidates: [{ displayName: "不确定的对象" }] }] }
  } }]);
  assert.match(result.answer, /已确认查询对象：崔丝塔娜/u);
  assert.match(result.answer, /目前只有名称识别结果/u);
  assert.doesNotMatch(result.answer, /不确定的对象/u);
});

test("partial official facts are useful without claiming statistical performance", () => {
  const summary = partialEvidenceSummary([{ evidenceId: "details", toolName: "unit_details", value: {
    displayName: "测试英雄", status: "partial", facts: { cost: 2, traits: ["测试羁绊"], ability: { name: "测试技能" } }
  } }]);
  assert.match(summary.findings[0], /测试英雄：2费；测试羁绊；技能：测试技能/u);
  assert.match(summary.limitations[0], /详细资料不完整/u);
});

test("mixed composition and equipment fallback retains both findings and their evidence", () => {
  const result = buildPartialEvidenceAnswer([composition()], { fallback: {
    answer: "霞的出装：无尽之刃、鬼索的狂暴之刃。", evidenceIds: ["build-1"]
  } });
  assert.match(result.answer, /花仙子·崔丝塔娜/u);
  assert.match(result.answer, /霞的出装：无尽之刃/u);
  assert.deepEqual(result.evidenceIds, ["comp-1", "build-1"]);
});

test("a specialized build fallback is not mislabeled as catalog-only evidence", () => {
  const entries = [{ evidenceId: "catalog", toolName: "entity_catalog_query", value: { resolution: {
    requests: [{ status: "resolved", candidates: [{ name: "霞" }] }]
  } } }, { evidenceId: "build", toolName: "unit_builds", value: { cards: [{ items: [{ name: "无尽之刃" }] }] } }];
  const result = buildPartialEvidenceAnswer(entries, { fallback: { answer: "霞的出装：无尽之刃。", evidenceIds: ["build"] } });
  assert.match(result.answer, /霞的出装/u);
  assert.doesNotMatch(result.answer, /目前只有名称识别/u);
});

test("failed tool gaps use known capability labels and disappear after a successful retry", () => {
  const observations = [{ type: "tool_failed", tool: "unit_builds", error: { message: "secret internal error" } }];
  assert.match(buildPartialEvidenceAnswer([composition()], { observations }).answer, /英雄出装统计查询失败/u);
  assert.doesNotMatch(buildPartialEvidenceAnswer([composition()], { observations }).answer, /secret/u);
  observations.push({ type: "tool_result", tool: "unit_builds" });
  assert.doesNotMatch(buildPartialEvidenceAnswer([composition()], { observations }).answer, /查询失败/u);
});

test("rich-text presentation preserves findings/gaps ordering and escapes source HTML", () => {
  const entry = composition();
  entry.value.results[0].compositionRef.name = '<img src=x onerror="alert(1)">';
  const html = conclusionRichTextHtml(buildPartialEvidenceAnswer([entry]).answer);
  assert.ok(html.indexOf("已确认的信息") < html.indexOf("36.7%"));
  assert.ok(html.indexOf("36.7%") < html.indexOf("还缺什么"));
  assert.match(html, /&lt;img/u);
  assert.doesNotMatch(html, /<img/u);
});
