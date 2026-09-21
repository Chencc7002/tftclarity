import { createHash } from "node:crypto";

import { buildSkillContext } from "./context.js";
import { matchSkill } from "./matcher.js";

export const UNIT_PLAY_CANDIDATE_CONTROL_SELECTOR = "unit_play_guidance@1.5.11";
export const UNIT_PLAY_CANDIDATE_SKILL_SHA256 = "7df0d4830a8221150a49ecf251e86ad7c25980e2468650cba4b4e718cd95be8a";
export const UNIT_PLAY_CANDIDATE_RENDERED_CONTEXT_SHA256 = "730f637d005537e023b9c92e56c18f93798e8b67a69c84853f004819bb2cd80b";
export const UNIT_PLAY_CANDIDATE_DECISION_PROFILE_SCHEMA_VERSION = "unit-play-candidate-decision-profile.v1";

const OFF_VALUES = new Set(["", "0", "false", "off", "disabled"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function resolveUnitPlayCandidateControl(rawValue, skill) {
  const selector = String(rawValue ?? "off").trim().toLowerCase();
  if (OFF_VALUES.has(selector)) {
    return Object.freeze({ enabled: false, selector: "off", diagnostic: null });
  }
  if (selector !== UNIT_PLAY_CANDIDATE_CONTROL_SELECTOR) {
    return Object.freeze({ enabled: false, selector, diagnostic: "invalid_candidate_control_selector" });
  }
  if (!skill || skill.id !== "unit_play_guidance" || skill.version !== "1.5.11"
    || sha256(JSON.stringify(skill)) !== UNIT_PLAY_CANDIDATE_SKILL_SHA256) {
    return Object.freeze({ enabled: false, selector, diagnostic: "candidate_skill_identity_mismatch" });
  }
  return Object.freeze({ enabled: true, selector, diagnostic: null });
}

export function prepareUnitPlayCandidateControl({ taskFrame, registry, runtimeAvailableTools }) {
  const selection = matchSkill(taskFrame, registry);
  if (selection.status !== "selected" || selection.selected.skillId !== "unit_play_guidance") {
    return Object.freeze({ active: false, reason: "candidate_not_selected", selection });
  }
  const skill = registry.get(selection.selected.skillId);
  if (!skill || skill.version !== "1.5.11"
    || sha256(JSON.stringify(skill)) !== UNIT_PLAY_CANDIDATE_SKILL_SHA256) {
    return Object.freeze({ active: false, reason: "candidate_skill_identity_mismatch", selection });
  }
  const actualTools = [...new Set((runtimeAvailableTools ?? []).map(String))];
  const scopedTools = skill.allowedTools.filter((name) => actualTools.includes(name));
  const skillContext = buildSkillContext({
    skill,
    selection,
    taskFrame,
    runtimeAvailableTools: scopedTools
  });
  const renderedGuidance = JSON.stringify({
    schemaVersion: "unit-play-browser-candidate.v1",
    contentHash: UNIT_PLAY_CANDIDATE_SKILL_SHA256,
    skillContext
  });
  const renderedContextSha256 = sha256(renderedGuidance);
  if (renderedContextSha256 !== UNIT_PLAY_CANDIDATE_RENDERED_CONTEXT_SHA256) {
    return Object.freeze({
      active: false,
      reason: "candidate_runtime_profile_mismatch",
      selection,
      skillVersion: skill.version,
      skillContentSha256: UNIT_PLAY_CANDIDATE_SKILL_SHA256,
      renderedContextSha256,
      effectiveTools: Object.freeze([...skillContext.toolPolicy.effectiveTools])
    });
  }
  const subject = taskFrame.subjects.find((entry) => entry.expectedType === "champion");
  if (!subject?.resolvedId) {
    return Object.freeze({ active: false, reason: "candidate_subject_unavailable", selection });
  }
  return Object.freeze({
    active: true,
    reason: null,
    selection,
    skill,
    skillContext,
    skillVersion: skill.version,
    skillContentSha256: UNIT_PLAY_CANDIDATE_SKILL_SHA256,
    renderedContextSha256,
    renderedGuidance,
    effectiveTools: Object.freeze([...skillContext.toolPolicy.effectiveTools]),
    subject: Object.freeze({
      resolvedId: String(subject.resolvedId),
      canonicalName: String(subject.canonicalName ?? subject.name ?? subject.resolvedId)
    }),
    decisionProfile: Object.freeze({
      schemaVersion: UNIT_PLAY_CANDIDATE_DECISION_PROFILE_SCHEMA_VERSION,
      guidance: renderedGuidance,
      decisionMessages: "action",
      tacticalPresentationScope: true,
      observationProjection: Object.freeze({
        schemaVersion: "unit-play-model-observation-projection.v1",
        targetUnitId: String(subject.resolvedId)
      })
    })
  });
}
