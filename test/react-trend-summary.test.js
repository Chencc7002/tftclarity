import test from "node:test";
import assert from "node:assert/strict";
import { validateFinishAction } from "../src/react/termination-policy.js";

const entry = { evidenceId: "trend", toolName: "comps_trends", type: "composition_trends", value: {
  query: { days: 3 },
  rising: [{ name: "永恒之森 · 乐芙兰", trend: { avgPlacementChange: -0.37 } },
    { name: "神谕 · 奈德丽", trend: { avgPlacementChange: -0.32 } }],
  falling: [{ name: "法师 · 卡西奥佩娅", trend: { avgPlacementChange: 0.21 } }],
  rankings: { popularity: [{ name: "裁决使 · 索拉卡", stats: { selectionRate: 0.597 } },
    { name: "峡谷野怪 · 苍蓝哨戒", stats: { selectionRate: 0.533 } }] }
} };
const answer = "近3天上升最快的是永恒之森·乐芙兰（平均名次改善0.37）与神谕·奈德丽（改善0.32）；最卷的是裁决使·索拉卡（选取率59.7%）与峡谷野怪·苍蓝哨戒（53.3%）。";
const validate = (text = answer, evidence = entry, options = {}) => validateFinishAction({
  reasonCode: "sufficient_evidence", answer: text, evidenceIds: ["trend"]
}, { resolve: () => [evidence], snapshot: () => ({ entries: [evidence] }) }, options);

test("screenshot summary passes grounding; omitted decline section is an observation, not an answer error", () => {
  const result = validate();
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.coverageWarnings, ["composition trend overview must include an available falling result"]);
  assert.equal(validate(answer, entry, { trendCoverageMode: "strict" }).valid, false);
});

test("formatting-equivalent names match without weakening entity identity", () => {
  for (const separator of ["·", " · ", "・", " • "]) {
    assert.equal(validate(answer.replaceAll("·", separator)).valid, true);
  }
  assert.equal(validate("永恒之森·另一英雄正在上升。").valid, false);
});

test("coverage tolerance does not excuse invented metrics, absent citations or historical-as-current statistics", () => {
  assert.equal(validate(answer.replace("59.7%", "99.9%")).valid, false);
  assert.equal(validate(answer, { ...entry, temporalStatus: "historical" }).valid, false);
  const invalid = validateFinishAction({ reasonCode: "sufficient_evidence", answer, evidenceIds: ["missing"] }, { resolve: () => [] });
  assert.equal(invalid.valid, false);
});

test("explicit rising-only tool scope still requires a rising result", () => {
  const scoped = { ...entry, value: { ...entry.value, requestedDirection: "rising" } };
  assert.equal(validate("裁决使·索拉卡选取率59.7%。", scoped).valid, false);
  assert.equal(validate("永恒之森·乐芙兰平均名次改善0.37。", scoped).valid, true);
});

test("a full overview still passes and records no coverage gap", () => {
  const result = validate(`${answer}法师·卡西奥佩娅平均名次变差0.21。`);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.deepEqual(result.coverageWarnings, []);
});
