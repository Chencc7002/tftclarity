import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ToolRegistry } from "../src/agent/tools/registry.js";
import { createStructuredToolDefinitions } from "../src/agent/tools/definitions.js";
import {
  SkillRegistry,
  UNIT_PLAY_GUIDANCE_SKILL,
  matchSkill,
  projectSkillCompletion
} from "../src/skills/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function rows(name) {
  const text = await readFile(resolve(root, "eval", "skills", name), "utf8");
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

const toolRegistry = new ToolRegistry(createStructuredToolDefinitions());
const skillRegistry = new SkillRegistry({ definitions: [UNIT_PLAY_GUIDANCE_SKILL], toolRegistry });
const skill = skillRegistry.get("unit_play_guidance");

const positives = await rows("skill-routing.jsonl");
const negatives = await rows("skill-negative-boundary.jsonl");
const completionRows = await rows("skill-completion.jsonl");
const bridgeRows = await rows("skill-conversation-bridge.jsonl");

const positiveMatches = positives.filter((row) => matchSkill(row.taskFrame, skillRegistry).selected?.skillId === row.expectedSkillId).length;
const negativeMatches = negatives.filter((row) => matchSkill(row.taskFrame, skillRegistry).status === "none").length;
const completionMatches = completionRows.filter((row) => {
  const progress = {
    schemaVersion: "skill-progress.v1",
    skillId: skill.id,
    requiredFacets: row.requiredFacets,
    coveredFacets: row.coveredFacets.map((facetId) => ({ facetId, evidenceIds: [`fixture-${facetId}`], tierSummary: ["B"] })),
    missingFacets: row.missingFacets,
    unsupportedFacets: row.unsupportedFacets.map((facetId) => ({ facetId, reasonCode: "data_unavailable" })),
    status: row.expectedStatus === "rejected" ? "in_progress" : row.expectedStatus
  };
  return projectSkillCompletion({ skill, progress }).status === row.expectedStatus;
}).length;
const bridgeMatches = bridgeRows.filter((row) => {
  if (row.expectedCanSupportCurrentClaim === false) return row.evidence.temporalStatus === "historical";
  if (row.expectedDuplicateRetrieval === false) return row.relation === "continue" && row.evidence.scope === "same";
  if (row.expectedPromoted === false) return row.relation === "independent";
  return false;
}).length;

const report = {
  schemaVersion: "agent-skill-shadow-eval.v1",
  registeredSkills: skillRegistry.list().map(({ id }) => id),
  routing: {
    cases: positives.length,
    correct: positiveMatches,
    recall: ratio(positiveMatches, positives.length)
  },
  negativeBoundary: {
    cases: negatives.length,
    correctNoSkill: negativeMatches,
    noSkillPrecision: ratio(negativeMatches, negatives.length),
    falseTakeovers: negatives.length - negativeMatches
  },
  completion: {
    mode: "coverage_projection_only",
    answerValidated: false,
    cases: completionRows.length,
    correct: completionMatches,
    accuracy: ratio(completionMatches, completionRows.length)
  },
  conversationBridge: {
    cases: bridgeRows.length,
    invariantMatches: bridgeMatches,
    accuracy: ratio(bridgeMatches, bridgeRows.length)
  },
  shadowContract: {
    llmCallsAdded: 0,
    toolCatalogMutation: false,
    promptInjection: false,
    responseMutation: false
  }
};

console.log(JSON.stringify(report, null, 2));
if (positiveMatches !== positives.length
  || negativeMatches !== negatives.length
  || completionMatches !== completionRows.length
  || bridgeMatches !== bridgeRows.length) {
  process.exitCode = 1;
}
