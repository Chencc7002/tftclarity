import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import {
  SkillRegistry,
  UNIT_PLAY_GUIDANCE_SKILL,
  buildSkillContext,
  matchSkill,
  projectSkillProgress,
  validateSkillCompletion
} from "../src/skills/index.js";

function registry() {
  return new SkillRegistry({
    definitions: [UNIT_PLAY_GUIDANCE_SKILL],
    toolRegistry: new ToolRegistry(createStructuredToolDefinitions())
  });
}

function frame(overrides = {}) {
  return {
    schemaVersion: "task-frame.v1",
    domain: "tft",
    action: "recommend",
    goal: "recommend_unit_play",
    expectedOutput: ["unit_play_guidance"],
    subjects: [{ expectedType: "champion", resolvedId: "DA_18_Warwick", canonicalName: "沃里克" }],
    candidates: [],
    concepts: [],
    ambiguities: [],
    understandingStatus: "understood_and_supported",
    ...overrides
  };
}

test("Skill Matcher consumes TaskFrame only and deterministically selects broad unit play", () => {
  const skills = registry();
  const input = frame();
  const first = matchSkill(input, skills);
  const second = matchSkill(structuredClone(input), skills);
  assert.deepEqual(first, second);
  assert.equal(first.status, "selected");
  assert.equal(first.selected.skillId, "unit_play_guidance");
  assert.equal(Object.isFrozen(first), true);
});

test("Skill Matcher exclusions and uncertainty win over positive signals", () => {
  const skills = registry();
  const negatives = [
    frame({ goal: "unit_build_rankings", expectedOutput: ["unit_play_guidance"] }),
    frame({ goal: "recommend_best_option" }),
    frame({ expectedOutput: ["unit_build_statistics"] }),
    frame({ subjects: [...frame().subjects, { expectedType: "champion", resolvedId: "TFT18_Ahri" }] }),
    frame({ ambiguities: [{ code: "missing_context_reference", affectsResult: true }] }),
    frame({ understandingStatus: "ambiguous" })
  ];
  for (const input of negatives) assert.equal(matchSkill(input, skills).status, "none");
});

test("SkillContext only intersects tools and progress never plans tool steps", () => {
  const skills = registry();
  const taskFrame = frame();
  const selection = matchSkill(taskFrame, skills);
  const skill = skills.get("unit_play_guidance");
  const context = buildSkillContext({
    skill,
    selection,
    taskFrame,
    runtimeAvailableTools: ["entity_catalog_query", "unit_builds", "item_details_batch"]
  });
  assert.deepEqual(context.toolPolicy.effectiveTools, ["entity_catalog_query", "unit_builds"]);
  assert.equal(context.toolPolicy.effectiveTools.includes("item_details_batch"), false);
  const progress = projectSkillProgress({ skill, context, facetEvidence: {} });
  assert.deepEqual(progress.requiredFacets, ["unit_role", "equipment_logic", "composition_context", "positioning"]);
  assert.equal(Object.hasOwn(progress, "nextTool"), false);
  assert.equal(progress.status, "in_progress");
  const completion = validateSkillCompletion({ skill, progress });
  assert.equal(completion.valid, false);
  assert.equal(completion.status, "rejected");
});

test("completion validation checks facet coverage, not Evidence validity or grounding", () => {
  const skill = registry().get("unit_play_guidance");
  const progress = {
    schemaVersion: "skill-progress.v1",
    skillId: skill.id,
    requiredFacets: ["unit_role", "equipment_logic", "composition_context", "positioning"],
    coveredFacets: [
      { facetId: "unit_role", evidenceIds: ["e1"], tierSummary: ["C"] },
      { facetId: "equipment_logic", evidenceIds: ["e2"], tierSummary: ["A"] },
      { facetId: "composition_context", evidenceIds: ["e3"], tierSummary: ["B"] },
      { facetId: "positioning", evidenceIds: ["e4"], tierSummary: ["B"] }
    ],
    missingFacets: [],
    unsupportedFacets: [],
    status: "complete"
  };
  const result = validateSkillCompletion({
    skill,
    progress,
    evidenceLedger: { invalid: true },
    grounding: { rejected: true }
  });
  assert.equal(result.valid, true);
  assert.equal(result.status, "complete");
});

