import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createUnitPlayAnswerReviewPacket } from "../src/experiments/unit-play-guidance-browser/answer-review.js";

const rubricText = readFileSync(new URL("../eval/skills/unit-play-guidance-answer-review/rubric.v1.json", import.meta.url), "utf8");
const manifestText = JSON.stringify({ skillVersion: "1.5.3", productionSkillControl: false });
const source = { evidenceId: "item-1", toolName: "item_details", updatedAt: "2026-08-27 17:19:45",
  value: { facts: { effect: "+45%攻击力;+300生命值;在60%生命值时，获得护盾，在4秒内快速衰减。" },
    source: { retrieval: { fetchedAt: "2026-08-31T15:36:57.221Z", contentHash: "a".repeat(64) } } } };
const payload = { status: "completed", terminationReason: "completed",
  answer: "血手在低生命时提供护盾并加攻击力，提升生存与输出。", evidence: [source], evidenceIds: ["item-1"],
  modelConclusion: { status: "accepted", reasonCode: "sufficient_evidence", validationErrors: [] } };
const encode = (value) => JSON.stringify(value) + "\n";
const packet = (responseText) => createUnitPlayAnswerReviewPacket({ responseText, manifestText, rubricText, recordedAt: "2026-08-31T15:40:20Z" });

test("runtime-accepted conditional misstatement remains unassessed with original answer and source hashes", () => {
  const raw = encode({ type: "complete", payload });
  const result = packet(raw);
  assert.equal(result.runtimeObservations.modelStatus, "accepted");
  assert.deepEqual(result.runtimeObservations.structuralIssues, []);
  assert.equal(result.answerReview.semanticCorrectness, "unassessed");
  assert.equal(result.answerReview.completionEvaluated, false);
  assert.equal(result.formalPairedAcceptance, "not_evaluated");
  assert.equal(result.delivered.answer, payload.answer);
  assert.equal(result.sourceHashes.response, createHash("sha256").update(raw).digest("hex"));
  assert.ok(result.answerReview.labels.every((label) => label.verdict === null && label.reviewerId === null));
});

test("archived source clocks and partial timeout results are preserved without certifying freshness or completion", () => {
  const result = packet(encode({ type: "complete", payload: { ...payload, status: "timed_out",
    terminationReason: "timeout", modelConclusion: null, answer: "部分资料缺失，仅保留已取得的卡片。" } }));
  assert.deepEqual(result.delivered.evidence, [source]);
  assert.equal(result.recordedAt, "2026-08-31T15:40:20Z");
  assert.equal(result.delivered.status, "timed_out");
  assert.equal(result.answerReview.status, "pending_review");
  assert.equal(result.answerReview.completionEvaluated, false);
});

test("incomplete or duplicate streams never silently select a successful answer", () => {
  for (const raw of [encode({ type: "event", event: { type: "termination" } }),
    encode({ type: "complete", payload }) + encode({ type: "complete", payload })]) {
    const result = packet(raw);
    assert.equal(result.answerReview.status, "not_reviewable");
    assert.equal(result.delivered.answer, null);
    assert.ok(result.runtimeObservations.structuralIssues.includes("completion_count_not_one"));
  }
});

test("unknown citations, illegal actions and late events remain visible rather than being repaired by review", () => {
  const result = packet(encode({ type: "event", event: { type: "decision_rejected", data: { reason: "prerequisite" } } })
    + encode({ type: "event", event: { type: "termination" } })
    + encode({ type: "event", event: { type: "tool_result" } })
    + encode({ type: "complete", payload: { ...payload, evidenceIds: ["unknown"] } }));
  assert.ok(result.runtimeObservations.structuralIssues.includes("unresolved_evidence_reference"));
  assert.equal(result.runtimeObservations.rejectedActions.length, 1);
  assert.equal(result.runtimeObservations.eventsAfterTermination, 1);
  assert.deepEqual(result.delivered.evidenceIds, ["unknown"]);
  assert.equal(result.answerReview.semanticCorrectness, "unassessed");
});

test("malformed records and automatic semantic rubrics fail closed", () => {
  assert.throws(() => packet("{broken"), SyntaxError);
  assert.throws(() => createUnitPlayAnswerReviewPacket({ responseText: "", manifestText,
    rubricText: JSON.stringify({ ...JSON.parse(rubricText), automaticSemanticScoring: true }) }), /Unsupported/);
  const rubric = JSON.parse(rubricText);
  rubric.criteria.push(rubric.criteria[0]);
  assert.throws(() => createUnitPlayAnswerReviewPacket({ responseText: "", manifestText,
    rubricText: JSON.stringify(rubric) }), /identities/);
});
