import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceLedger } from "../src/react/evidence-ledger.js";
import { validateFinishAction } from "../src/react/termination-policy.js";
import {
  UNIT_PLAY_GUIDANCE_SKILL as skill, SKILL_DEPENDENCY_TOOLS,
  buildSkillContext, projectSkillProgress, validateSkillCompletion,
  validateSkillDefinition, validateSkillProgress, validateSkillDataAvailability
} from "../src/skills/index.js";
import { UNIT_PLAY_GUIDANCE_SKILL_V1, UNIT_PLAY_GUIDANCE_SKILL_V1_1 } from "../src/skills/definitions/unit-play-guidance.js";
import { CANDIDATE_SKILL_CONTENT } from "../src/experiments/unit-play-guidance-control/content.js";

const NOW = "2026-08-30T00:00:00.000Z";
const SUBJECT = "fixture-unit";
const selection = { selected: { skillId: skill.id, skillVersion: skill.version, score: 100, reasons: ["goal_match"] } };
const taskFrame = { schemaVersion: "task-frame.v1" };
const required = skill.facets.filter(({ requirement }) => requirement !== "optional");
const toolFor = (facet) => SKILL_DEPENDENCY_TOOLS[facet.dataDependenciesAny[0]];
const limitation = (id) => `${id}：当前来源缺少对应证据，无法提供建议。`;

function observation(dependencyId, status = "available", reasonCode = "observed_data") {
  return { schemaVersion: "skill-data-availability.v1", dependencyId, status, reasonCode,
    observedAt: NOW, sourceIds: [SKILL_DEPENDENCY_TOOLS[dependencyId]] };
}

function context(options = {}) {
  return buildSkillContext({ skill, selection, taskFrame, runtimeAvailableTools: skill.allowedTools, ...options });
}

function fixture(options = {}) {
  let nextId = 0;
  const evidenceLedger = new EvidenceLedger({ now: () => Date.parse(NOW), createId: () => `e-${++nextId}` });
  const claimEvidenceUses = [];
  const answerFacets = [];
  for (const facet of required) {
    if ((options.omit ?? []).includes(facet.id)) continue;
    const toolName = toolFor(facet);
    const text = `${facet.id}：来自当前工具的明确事实。`;
    const entry = evidenceLedger.add({ toolName, definition: { name: toolName, source: "fixture", evidenceType: "fixture-fact" },
      evidenceContract: { requiredFields: ["subject", "facet", "text", "updatedAt"], allowModelGeneratedStatistics: false },
      toolResult: { status: "completed", toolCallId: `call-${facet.id}`, toolName,
        metadata: { source: "fixture", evidenceType: "fixture-fact", updatedAt: NOW },
        value: { subject: SUBJECT, facet: facet.id, text } }
    }).entry;
    assert.ok(entry);
    claimEvidenceUses.push({ schemaVersion: "claim-evidence-use.v1", claimId: `claim-${facet.id}`,
      evidenceId: entry.evidenceId, tier: "A", claimKind: "current_fact", role: "supports", reasonCode: "direct_current_stat",
      supportsFacets: [facet.id], freshnessStatus: "fresh", provenance: "tool" });
    answerFacets.push({ facetId: facet.id, status: "supported", text, evidenceIds: [entry.evidenceId] });
  }
  const input = {
    skill, context: context(options.context), evidenceLedger, claimEvidenceUses, answerFacets,
    // Frozen fixture adjudication, not a production semantic assessor. Explicitly
    // inspect scope, current freshness and the fact's facet rather than keywords.
    assessEvidenceUse: ({ entry, facet }) => ({ valid: true,
      scopeValid: entry.value.subject === SUBJECT,
      freshnessValid: entry.updatedAt === NOW,
      supportValid: entry.value.facet === facet.id && Boolean(entry.value.text) }),
    assessAnswerFacet: ({ facet, text, status, evidence }) => ({ valid: status === "unavailable"
      ? text === limitation(facet.id)
      : evidence.some((entry) => entry.value.facet === facet.id && entry.value.text === text) }),
    finishValidation: ({ answer, citedEvidenceIds, evidenceLedger: ledger }) => validateFinishAction({
      answer, evidenceIds: citedEvidenceIds, reasonCode: "sufficient_evidence"
    }, ledger)
  };
  return refreshAnswer(input);
}

function refreshAnswer(input) {
  input.answer = input.answerFacets.map(({ text }) => text).join("\n");
  input.citedEvidenceIds = [...new Set(input.answerFacets.flatMap(({ evidenceIds }) => evidenceIds))];
  return input;
}

test("pilot successor aligns professional content while the archived definition remains frozen", () => {
  assert.equal(skill.version, "1.3.0");
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL_V1.version, "1.0.0");
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL_V1_1.version, "1.1.0");
  assert.deepEqual(UNIT_PLAY_GUIDANCE_SKILL_V1_1.instructions, CANDIDATE_SKILL_CONTENT.instructions);
  for (const field of ["facets", "allowedTools", "dataDependencies", "evidencePolicy", "completionPolicy"]) {
    assert.deepEqual(skill[field], UNIT_PLAY_GUIDANCE_SKILL_V1_1[field]);
  }
  assert.deepEqual(skill.facets.map(({ id, requirement }) => ({ id, requirement })), CANDIDATE_SKILL_CONTENT.facets);
  assert.equal(UNIT_PLAY_GUIDANCE_SKILL_V1.facets.find(({ id }) => id === "positioning").requirement, "required");
  assert.deepEqual(skill.facets.find(({ id }) => id === "unit_role").dataDependenciesAny, ["mechanism_knowledge_index"]);
  assert.throws(() => validateSkillDefinition({ ...skill, facets: [{ id: "role", requirement: "required", dataDependenciesAny: ["not_declared"] }] }), /undeclared/u);
  assert.throws(() => validateSkillDefinition({ ...skill, instructions: [42] }), /strings/u);
});

test("callable tools start unknown; observations distinguish usable, failed, stale and partial data", () => {
  assert.ok(context().dataAvailability.every(({ status, reasonCode }) => status === "unknown" && reasonCode === "not_probed"));
  const observations = [
    observation("official_tft_entity_catalog"),
    observation("current_unit_build_statistics", "stale", "freshness_failed"),
    observation("current_composition_statistics", "unknown", "source_failed"),
    observation("current_composition_tactical_details", "unavailable", "field_unavailable")
  ];
  const observed = context({ dataAvailability: observations });
  assert.deepEqual(observed.dataAvailability.slice(0, 4), observations);
  const denied = context({ runtimeAvailableTools: ["entity_catalog_query"], dataAvailability: observations });
  assert.equal(denied.dataAvailability[1].status, "unavailable");
  assert.equal(denied.dataAvailability[1].reasonCode, "source_unavailable");
});

test("availability rejects incompatible status, unknown dependencies, wrong sources and undated observations", () => {
  const entry = observation("current_unit_build_statistics");
  assert.throws(() => context({ dataAvailability: [entry, entry] }), /duplicate/u);
  assert.throws(() => context({ dataAvailability: [{ ...entry, dependencyId: "other" }] }), /Unknown/u);
  assert.throws(() => context({ dataAvailability: [{ ...entry, sourceIds: ["other_tool"] }] }), /source/u);
  assert.throws(() => validateSkillDataAvailability({ ...entry, observedAt: null }), /observedAt/u);
  assert.throws(() => validateSkillDataAvailability({ ...entry, status: "stale" }), /reasonCode/u);
  assert.throws(() => context({ dataAvailability: [{ ...entry, reasonCode: "available_registered_tool" }] }), /observed data/u);
});

test("partial tool availability marks only affected facets unsupported and never plans calls", () => {
  const input = fixture({ omit: required.map(({ id }) => id), context: { runtimeAvailableTools: ["entity_catalog_query", "unit_builds"] } });
  const progress = projectSkillProgress(input);
  assert.deepEqual(progress.missingFacets, ["equipment_logic"]);
  assert.deepEqual(progress.unsupportedFacets.map(({ facetId }) => facetId), ["unit_role", "composition_context", "positioning"]);
  assert.equal(Object.hasOwn(progress, "nextTool"), false);
  assert.equal(progress.requiredFacets.includes("when_to_play"), false);
});

test("observed missing positioning allows qualification; unknown and stale remain recoverable", () => {
  for (const [status, reasonCode] of [["unknown", "not_probed"], ["unknown", "source_failed"], ["stale", "freshness_failed"], ["unavailable", "field_unavailable"], ["unavailable", "source_exhausted"]]) {
    const input = fixture({ omit: ["positioning"], context: { dataAvailability: [observation("current_composition_tactical_details", status, reasonCode)] } });
    const progress = projectSkillProgress(input);
    assert.equal(progress.status, status === "unavailable" ? "qualified_incomplete" : "in_progress");
    if (status !== "unavailable") assert.ok(progress.missingFacets.includes("positioning"));
  }
});

test("ledger-backed coverage is deterministic, current, facet-specific and nonmutating", () => {
  const input = fixture();
  const before = input.evidenceLedger.snapshot();
  assert.equal(projectSkillProgress(input).status, "complete");
  assert.deepEqual(projectSkillProgress(input), projectSkillProgress({ ...input, claimEvidenceUses: [...input.claimEvidenceUses].reverse() }));
  assert.deepEqual(input.evidenceLedger.snapshot(), before);
  assert.throws(() => projectSkillProgress({ ...input, facetEvidence: { unit_role: [{ evidenceId: "fake", tier: "A" }] } }), /ledger-backed/u);
});

test("unknown IDs, context-only uses and a missing or failed assessor cannot provide coverage", () => {
  const base = fixture();
  for (const changed of [
    { evidenceLedger: undefined },
    { assessEvidenceUse: undefined },
    { assessEvidenceUse: () => ({ valid: true }) },
    { assessEvidenceUse: () => { throw new Error("policy unavailable"); } },
    { claimEvidenceUses: base.claimEvidenceUses.map((use) => ({ ...use, evidenceId: "missing" })) },
    { claimEvidenceUses: base.claimEvidenceUses.map((use) => ({ ...use, role: "context" })) }
  ]) assert.equal(projectSkillProgress({ ...base, ...changed }).coveredFacets.length, 0);
});

test("every existing policy decision must pass; a Tier label cannot override rejection", () => {
  const input = fixture();
  for (const field of ["valid", "scopeValid", "freshnessValid", "supportValid"]) {
    const assessEvidenceUse = () => ({ valid: true, scopeValid: true, freshnessValid: true, supportValid: true, [field]: false });
    assert.equal(projectSkillProgress({ ...input, assessEvidenceUse }).coveredFacets.length, 0);
  }
  input.evidenceLedger.get("e-1").value.subject = "other-unit";
  assert.ok(projectSkillProgress(input).missingFacets.includes("unit_role"));
  input.evidenceLedger.get("e-1").value.subject = SUBJECT;
  input.evidenceLedger.get("e-1").value.facet = "composition_context";
  assert.ok(projectSkillProgress(input).missingFacets.includes("unit_role"));
});

test("historical Bridge evidence cannot become current even with approving policy and fresh annotation", () => {
  const input = fixture();
  const historical = new EvidenceLedger();
  for (const entry of input.evidenceLedger.snapshot().entries) historical.addHistorical({ ...entry, temporalStatus: "historical" });
  const allow = () => ({ valid: true, scopeValid: true, freshnessValid: true, supportValid: true });
  assert.equal(projectSkillProgress({ ...input, evidenceLedger: historical, assessEvidenceUse: allow }).coveredFacets.length, 0);
  input.evidenceLedger.get("e-1").metadata.temporalStatus = "historical";
  input.evidenceLedger.get("e-2").metadata.stale = true;
  const progress = projectSkillProgress({ ...input, assessEvidenceUse: allow });
  assert.ok(progress.missingFacets.includes("unit_role"));
  assert.ok(progress.missingFacets.includes("equipment_logic"));
});

test("claim-use qualification can restrict freshness and disallowed tools never cover facets", () => {
  const input = fixture();
  input.claimEvidenceUses[0].freshnessStatus = "stale";
  assert.ok(projectSkillProgress(input).missingFacets.includes("unit_role"));
  const limited = fixture({ context: { runtimeAvailableTools: ["unit_builds"] } });
  assert.deepEqual(projectSkillProgress(limited).coveredFacets.map(({ facetId }) => facetId), ["equipment_logic"]);
  const roleFromComp = { ...input.claimEvidenceUses[2], supportsFacets: ["unit_role"] };
  assert.equal(projectSkillProgress({ ...input, claimEvidenceUses: [roleFromComp] }).coveredFacets.length, 0);
});

test("progress rejects context identity drift, fabricated partitions and empty Evidence coverage", () => {
  const input = fixture();
  assert.throws(() => projectSkillProgress({ ...input, context: { ...input.context, skillVersion: "9.0.0" } }), /identity|match/iu);
  const progress = projectSkillProgress(input);
  assert.throws(() => validateSkillProgress({ ...progress, missingFacets: ["unit_role"] }), /partition/u);
  assert.throws(() => validateSkillProgress({ ...progress, coveredFacets: progress.coveredFacets.map((entry) => ({ ...entry, evidenceIds: [] })) }), /non-empty/u);
  assert.throws(() => validateSkillProgress({ ...progress, requiredFacets: [], coveredFacets: [] , status: "in_progress" }), /status/u);
});

test("completion requires grounded cited text for every required facet", () => {
  const input = fixture();
  assert.equal(validateSkillCompletion(input).status, "complete");
  input.answerFacets = input.answerFacets.filter(({ facetId }) => facetId !== "unit_role");
  refreshAnswer(input);
  const result = validateSkillCompletion(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("answer_facet_missing:unit_role"));
});

test("stale progress summaries cannot hide newly missing Evidence", () => {
  const input = fixture();
  const progress = projectSkillProgress(input);
  const result = validateSkillCompletion({ ...input, progress, claimEvidenceUses: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("required_facet_coverage_missing"));
});

test("unavailable facets require explicit validated limitation text, not a label or hidden annotation", () => {
  const input = fixture({ omit: ["positioning"], context: { dataAvailability: [observation("current_composition_tactical_details", "unavailable", "field_unavailable")] } });
  assert.equal(validateSkillCompletion(input).valid, false);
  input.answerFacets.push({ facetId: "positioning", status: "unavailable", text: limitation("positioning"), evidenceIds: [] });
  refreshAnswer(input);
  assert.equal(validateSkillCompletion(input).status, "qualified_incomplete");
  input.answerFacets.at(-1).text = "positioning";
  refreshAnswer(input);
  assert.equal(validateSkillCompletion(input).valid, false);
});

test("a recoverable facet cannot be relabelled unavailable", () => {
  const input = fixture({ omit: ["positioning"] });
  input.answerFacets.push({ facetId: "positioning", status: "unavailable", text: limitation("positioning"), evidenceIds: [] });
  refreshAnswer(input);
  assert.equal(validateSkillCompletion(input).valid, false);
});

test("answer facet metadata must match delivered text and cite accepted Evidence", () => {
  for (const mutate of [
    (input) => { input.answer = input.answer.replace(input.answerFacets[0].text, ""); },
    (input) => { input.answerFacets[0].text = "unit_role：纯模型推测。"; refreshAnswer(input); },
    (input) => { input.answerFacets[0].evidenceIds = ["e-2"]; },
    (input) => { input.citedEvidenceIds = input.citedEvidenceIds.filter((id) => id !== "e-1"); },
    (input) => { input.answerFacets.push(input.answerFacets[0]); },
    (input) => { input.answerFacets.push({ facetId: "invented", status: "supported", text: "other", evidenceIds: [] }); }
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(validateSkillCompletion(input).valid, false);
  }
});

test("existing finish validation and semantic assessor cannot be bypassed by complete coverage", () => {
  for (const change of [
    { finishValidation: undefined }, { finishValidation: { valid: true } },
    { finishValidation: () => ({ valid: false }) },
    { finishValidation: () => { throw new Error("validator failed"); } },
    { assessAnswerFacet: undefined },
    { assessAnswerFacet: () => { throw new Error("assessor failed"); } }
  ]) assert.equal(validateSkillCompletion({ ...fixture(), ...change }).valid, false);
  const input = fixture();
  input.answer += "胜率 99%。";
  assert.equal(validateSkillCompletion(input).valid, false);
});

test("qualified completion remains disabled when the Skill disallows it", () => {
  const input = fixture({ omit: ["positioning"], context: { dataAvailability: [observation("current_composition_tactical_details", "unavailable", "empty_result")] } });
  input.skill = { ...skill, completionPolicy: { ...skill.completionPolicy, allowQualifiedIncomplete: false } };
  input.context = buildSkillContext({ skill: input.skill, selection, taskFrame, runtimeAvailableTools: skill.allowedTools,
    dataAvailability: [observation("current_composition_tactical_details", "unavailable", "empty_result")] });
  input.answerFacets.push({ facetId: "positioning", status: "unavailable", text: limitation("positioning"), evidenceIds: [] });
  refreshAnswer(input);
  assert.equal(validateSkillCompletion(input).valid, false);
});

test("optional advice may be omitted or explicitly qualified but cannot be invented", () => {
  const input = fixture();
  input.answerFacets.push({ facetId: "when_to_play", status: "unavailable", text: limitation("when_to_play"), evidenceIds: [] });
  refreshAnswer(input);
  assert.equal(validateSkillCompletion(input).status, "complete");
  input.answerFacets.at(-1).status = "supported";
  input.answerFacets.at(-1).evidenceIds = ["e-1"];
  assert.equal(validateSkillCompletion(input).valid, false);
});

test("async policy functions are not invoked and serialized approvals cannot finish", () => {
  let calls = 0;
  const asyncPolicy = async () => { calls += 1; throw new Error("must not execute"); };
  const input = fixture();
  assert.equal(projectSkillProgress({ ...input, assessEvidenceUse: asyncPolicy }).coveredFacets.length, 0);
  assert.equal(validateSkillCompletion({ ...input, assessAnswerFacet: asyncPolicy }).valid, false);
  assert.equal(validateSkillCompletion({ ...input, finishValidation: asyncPolicy }).valid, false);
  assert.equal(calls, 0);
});
