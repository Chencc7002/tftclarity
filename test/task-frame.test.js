import test from "node:test";
import assert from "node:assert/strict";
import {
  createTaskFrame,
  migrateTaskFrame,
  TASK_FRAME_SCHEMA_VERSION,
  validateTaskFrame
} from "../src/understanding/task-frame.js";

test("task-frame.v1 normalizes, validates and rejects unsupported schema values", () => {
  const frame = createTaskFrame({
    domain: "tft",
    action: "compare",
    subjects: [{ rawText: "霞", expectedType: "champion" }],
    candidates: [
      { rawText: "炼刀", expectedType: "item" },
      { rawText: "巨九", expectedType: "item" }
    ],
    constraints: { patch: "current" },
    goal: "choose_best",
    expectedOutput: ["recommendation", "comparison", "evidence"],
    confidence: 0.94,
    understandingStatus: "understood_and_supported"
  });

  assert.equal(frame.schemaVersion, TASK_FRAME_SCHEMA_VERSION);
  assert.equal(validateTaskFrame(frame).valid, true);
  assert.equal(validateTaskFrame({ ...frame, action: "invented_intent" }).valid, false);
  assert.equal(validateTaskFrame({
    ...frame,
    subjects: [{ ...frame.subjects[0], expectedType: "made_up_entity" }]
  }).valid, false);
});

test("task frame migration keeps IntentEnvelope as a compatibility protocol", () => {
  const migrated = migrateTaskFrame({
    schemaVersion: "intent_envelope.v1",
    intent: "unit_item_comparison",
    confidence: 0.93,
    entities: [
      { type: "unit", mention: "霞", apiName: "TFT17_Xayah", confidence: 1 },
      { type: "item", mention: "巨九", apiName: "TFT_Item_Artifact_TitanicHydra", confidence: 1 }
    ],
    constraints: { patch: "current" },
    requestedMetrics: ["top4Rate"],
    needsClarification: false,
    warnings: []
  });

  assert.equal(migrated.action, "compare");
  assert.equal(migrated.subjects[0].expectedType, "champion");
  assert.equal(migrated.candidates[0].resolvedId, "TFT_Item_Artifact_TitanicHydra");
  assert.equal(validateTaskFrame(migrated).valid, true);
  assert.throws(() => migrateTaskFrame({ schemaVersion: "task-frame.v0" }), /Unsupported task frame schema/u);
});
