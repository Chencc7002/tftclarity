import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import {
  CLAIM_EVIDENCE_USE_SCHEMA_VERSION,
  SkillRegistry,
  UNIT_PLAY_GUIDANCE_SKILL,
  validateClaimEvidenceUse,
  validateSkillDefinition
} from "../src/skills/index.js";

function toolRegistry() {
  return new ToolRegistry(createStructuredToolDefinitions());
}

test("SkillDefinition validation is strict, immutable, and registers only the pilot", () => {
  const definition = validateSkillDefinition(UNIT_PLAY_GUIDANCE_SKILL);
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.facets), true);
  assert.throws(() => validateSkillDefinition({ ...UNIT_PLAY_GUIDANCE_SKILL, unexpected: true }), /unknown fields/u);
  assert.throws(() => validateSkillDefinition({
    ...UNIT_PLAY_GUIDANCE_SKILL,
    completionPolicy: { ...UNIT_PLAY_GUIDANCE_SKILL.completionPolicy, neverInventMissingEvidence: false }
  }), /cannot permit invented Evidence/u);

  const registry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL], toolRegistry: toolRegistry() });
  assert.deepEqual(registry.list().map(({ id }) => id), ["unit_play_guidance"]);
  assert.throws(() => registry.register(UNIT_PLAY_GUIDANCE_SKILL), /already registered/u);
});

test("SkillRegistry rejects unknown tools, dependencies, and unmet required capabilities", () => {
  const tools = toolRegistry();
  assert.throws(() => new SkillRegistry({
    definitions: [{ ...UNIT_PLAY_GUIDANCE_SKILL, allowedTools: [...UNIT_PLAY_GUIDANCE_SKILL.allowedTools, "unregistered_tool"] }],
    toolRegistry: tools
  }), /not registered/u);
  assert.throws(() => new SkillRegistry({
    definitions: [{ ...UNIT_PLAY_GUIDANCE_SKILL, dataDependencies: [...UNIT_PLAY_GUIDANCE_SKILL.dataDependencies, { id: "unknown_feed", requirement: "required" }] }],
    toolRegistry: tools
  }), /Unknown Skill data dependency/u);
  assert.throws(() => new SkillRegistry({
    definitions: [{ ...UNIT_PLAY_GUIDANCE_SKILL, requiredCapabilities: ["self_authorized_capability"] }],
    toolRegistry: tools
  }), /not provided/u);
});

test("claim evidence-use is claim-local and tier never erases temporal status", () => {
  const use = validateClaimEvidenceUse({
    schemaVersion: CLAIM_EVIDENCE_USE_SCHEMA_VERSION,
    claimId: "claim-1",
    evidenceId: "evidence-1",
    tier: "A",
    claimKind: "current_fact",
    role: "qualifies",
    reasonCode: "historical_context_only",
    supportsFacets: ["equipment_logic"],
    freshnessStatus: "historical",
    provenance: "tool"
  });
  assert.equal(use.tier, "A");
  assert.equal(use.freshnessStatus, "historical");
  assert.equal(use.role, "qualifies");
  assert.throws(() => validateClaimEvidenceUse({ ...use, role: "authorizes" }), /role is invalid/u);
  assert.throws(() => validateClaimEvidenceUse({ ...use, tier: "AA" }), /tier is invalid/u);
});
