import assert from "node:assert/strict";
import test from "node:test";

import {
  UNIT_PLAY_GUIDANCE_SKILL,
  UNIT_PLAY_GUIDANCE_SKILL_V1_5_7,
  UNIT_PLAY_GUIDANCE_SKILL_V1_5_8,
  UNIT_PLAY_GUIDANCE_SKILL_V1_5_9
} from "../src/skills/definitions/unit-play-guidance.js";

test("1.5.8 stops retrieval after the fixed source-card set without widening authority", () => {
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.version, "1.5.8");
  assert.deepEqual(UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.allowedTools,
    UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.allowedTools);
  assert.deepEqual(UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.dataDependencies,
    UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.dataDependencies);
  assert.deepEqual(UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.facets,
    UNIT_PLAY_GUIDANCE_SKILL_V1_5_7.facets);
  const prompt = UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.instructions.join("\n");
  assert.match(prompt, /固定候选集合/u);
  assert.match(prompt, /不寻找第三张卡/u);
  assert.match(prompt, /下一动作必须是 react-action\.v1 的 finish/u);
  assert.match(prompt, /不得用新检索代替答案修正/u);
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL.version, "1.3.0");
});

test("1.5.8 retains the server-owned equipment and card-positioning contracts", () => {
  const prompt = UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.instructions.join("\n");
  assert.match(prompt, /mechanismQueryPlan/u);
  assert.match(prompt, /item_details_batch/u);
  assert.match(prompt, /tacticalDetailQueryPlan/u);
  assert.match(prompt, /界面生成多个各带自身棋盘的阵容卡片/u);
  assert.match(prompt, /正文不写阵容或站位/u);
});

test("1.5.9 reserves all composition positioning prose for cards", () => {
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL_V1_5_9.version, "1.5.9");
  assert.deepEqual(UNIT_PLAY_GUIDANCE_SKILL_V1_5_9.allowedTools,
    UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.allowedTools);
  assert.deepEqual(UNIT_PLAY_GUIDANCE_SKILL_V1_5_9.dataDependencies,
    UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.dataDependencies);
  assert.deepEqual(UNIT_PLAY_GUIDANCE_SKILL_V1_5_9.facets,
    UNIT_PLAY_GUIDANCE_SKILL_V1_5_8.facets);
  const prompt = UNIT_PLAY_GUIDANCE_SKILL_V1_5_9.instructions.join("\n");
  assert.match(prompt, /正文不得写任何阵容名、坐标、行列、前排\/中排\/后排、cell 或站位解释/u);
  assert.match(prompt, /正文绝不写阵容或站位/u);
  assert.match(prompt, /删除正文中的阵容\/站位文字/u);
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL.version, "1.3.0");
});
