import { SKILL_SELECTION_SCHEMA_VERSION, validateSkillSelection } from "./contracts.js";

function none(reasonCodes) {
  return validateSkillSelection({
    schemaVersion: SKILL_SELECTION_SCHEMA_VERSION,
    status: "none",
    mode: "deterministic",
    selected: null,
    alternatives: [],
    reasonCodes,
    semanticFallback: { eligible: false, invoked: false }
  });
}

export function matchSkill(taskFrame, registry) {
  if (!taskFrame || taskFrame.schemaVersion !== "task-frame.v1") return none(["invalid_task_frame"]);
  if (taskFrame.understandingStatus !== "understood_and_supported") return none(["unsupported_understanding"]);
  const blocking = (taskFrame.ambiguities ?? []).some((entry) => entry?.affectsResult === true || entry?.affectsToolSelection === true || entry?.code === "missing_context_reference");
  if (blocking) return none(["blocking_ambiguity"]);

  const entities = [...(taskFrame.subjects ?? []), ...(taskFrame.candidates ?? []), ...(taskFrame.concepts ?? [])];
  const resolved = entities.filter((entry) => Boolean(entry?.resolvedId));
  const candidates = [];
  for (const skill of registry.list()) {
    if (skill.exclusions.goals.includes(taskFrame.goal)) continue;
    if (!skill.triggers.domains.includes(taskFrame.domain)) continue;
    if (!skill.triggers.actions.includes(taskFrame.action)) continue;
    if (!skill.triggers.goals.includes(taskFrame.goal)) continue;
    if (!skill.triggers.expectedOutputsAny.some((value) => (taskFrame.expectedOutput ?? []).includes(value))) continue;
    const requiredEntities = resolved.filter((entry) => skill.triggers.requiredEntityTypes.includes(entry.expectedType));
    if (requiredEntities.length !== skill.triggers.requiredEntityTypes.length || resolved.length !== requiredEntities.length) continue;
    candidates.push({
      skillId: skill.id,
      skillVersion: skill.version,
      score: 100,
      reasons: ["goal_match", "expected_output_match", "single_resolved_champion"]
    });
  }
  if (candidates.length === 0) return none(["no_deterministic_match"]);
  if (candidates.length > 1) return validateSkillSelection({
    schemaVersion: SKILL_SELECTION_SCHEMA_VERSION,
    status: "ambiguous",
    mode: "deterministic",
    selected: null,
    alternatives: candidates,
    reasonCodes: ["multiple_equal_matches"],
    semanticFallback: { eligible: false, invoked: false }
  });
  return validateSkillSelection({
    schemaVersion: SKILL_SELECTION_SCHEMA_VERSION,
    status: "selected",
    mode: "deterministic",
    selected: candidates[0],
    alternatives: [],
    reasonCodes: [],
    semanticFallback: { eligible: false, invoked: false }
  });
}
