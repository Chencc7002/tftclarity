import { createHash } from "node:crypto";

export const EXPERIMENT_CONTENT_SCHEMA_VERSION = "unit-play-guidance-experiment-content.v1";
export const BASELINE_GUIDANCE_VERSION = "react-semantic-guidance.unit-play.v1";
export const CANDIDATE_SKILL_CONTENT_VERSION = "unit_play_guidance.experiment.v1";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

// Version-pinned copy of the current broad unit-play semantic guidance. It is
// experiment input only; production decision-provider code remains untouched.
export const BASELINE_GUIDANCE = Object.freeze({
  schemaVersion: EXPERIMENT_CONTENT_SCHEMA_VERSION,
  version: BASELINE_GUIDANCE_VERSION,
  source: "src/react/react-decision-provider.js:semanticGuidance",
  instructions: Object.freeze([
    "Recommend how to play one resolved unit broadly.",
    "Treat guidance as semantic context, not an execution plan.",
    "Keep the original question authoritative and choose permitted tools autonomously.",
    "Do not reduce the request to equipment only.",
    "Cover equipment, composition context, positioning, and when/how to play when supported.",
    "Do not invent statistics; qualify unavailable facets.",
    "Do not search for video unless explicitly requested."
  ])
});

export const CANDIDATE_SKILL_CONTENT = Object.freeze({
  schemaVersion: EXPERIMENT_CONTENT_SCHEMA_VERSION,
  version: CANDIDATE_SKILL_CONTENT_VERSION,
  skillId: "unit_play_guidance",
  facets: Object.freeze([
    Object.freeze({ id: "unit_role", requirement: "required" }),
    Object.freeze({ id: "equipment_logic", requirement: "required" }),
    Object.freeze({ id: "composition_context", requirement: "required" }),
    Object.freeze({ id: "positioning", requirement: "required_if_supported" }),
    Object.freeze({ id: "when_to_play", requirement: "optional" })
  ]),
  instructions: Object.freeze([
    "Explain validated unit role before recommendations.",
    "Explain equipment logic and composition context from validated Evidence.",
    "Cover positioning only when supported; otherwise qualify it as unsupported.",
    "Never invent when-to-play tempo, opener, augment, or economy requirements.",
    "Separate current fact, source recommendation, mechanism, heuristic, and inference.",
    "Never promote composition membership into a role claim or recommendation into causality.",
    "Historical Evidence is never current; unavailable facets are never fabricated.",
    "Do not add tools, arguments, order, budgets, finish authority, or approval authority."
  ])
});

export const BASELINE_GUIDANCE_SHA256 = sha256(BASELINE_GUIDANCE);
export const CANDIDATE_SKILL_CONTENT_SHA256 = sha256(CANDIDATE_SKILL_CONTENT);

export const PINNED_BASELINE_GUIDANCE_SHA256 = "7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123";
export const PINNED_CANDIDATE_SKILL_CONTENT_SHA256 = "8a28b75dcb32909970aaf7b63681b6acf4ccf7d1ee440e300412363a01e5ccfc";

if (BASELINE_GUIDANCE_SHA256 !== PINNED_BASELINE_GUIDANCE_SHA256) {
  throw new Error("version-pinned baseline guidance content drifted");
}
if (CANDIDATE_SKILL_CONTENT_SHA256 !== PINNED_CANDIDATE_SKILL_CONTENT_SHA256) {
  throw new Error("version-pinned candidate Skill content drifted");
}

export function renderCandidateSkillContext(skillContext) {
  return stableJson({
    schemaVersion: "unit-play-guidance-rendered-context.v1",
    skillId: CANDIDATE_SKILL_CONTENT.skillId,
    skillVersion: CANDIDATE_SKILL_CONTENT.version,
    contentHash: CANDIDATE_SKILL_CONTENT_SHA256,
    selection: skillContext.selection,
    facets: CANDIDATE_SKILL_CONTENT.facets,
    instructions: CANDIDATE_SKILL_CONTENT.instructions,
    evidencePolicy: skillContext.evidencePolicy,
    toolPolicy: skillContext.toolPolicy,
    completionPolicy: skillContext.completionPolicy
  });
}
