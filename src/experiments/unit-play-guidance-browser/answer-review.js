import { createHash } from "node:crypto";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Offline artifact builder only: no provider, tools, network or runtime import.
// Structural observations are never semantic labels or acceptance decisions.
export function createUnitPlayAnswerReviewPacket({ responseText, manifestText, rubricText, recordedAt = null }) {
  const manifest = JSON.parse(manifestText);
  const rubric = JSON.parse(rubricText);
  if (rubric.schemaVersion !== "unit-play-answer-rubric.v1" || !Array.isArray(rubric.criteria)
    || !rubric.criteria.length || rubric.automaticSemanticScoring !== false) throw new TypeError("Unsupported answer rubric");
  const ids = rubric.criteria.map((criterion) => criterion.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new TypeError("Invalid criterion identities");
  const lines = responseText.split(/\r?\n/u).filter((line) => line.trim());
  const stream = lines.map((line) => JSON.parse(line));
  const completions = stream.filter((entry) => entry.type === "complete");
  // Do not choose a convenient output when an invalid stream completed twice.
  const payload = completions.length === 1 ? completions[0].payload : null;
  const events = stream.filter((entry) => entry.type === "event").map((entry) => entry.event);
  const answer = typeof payload?.answer === "string" ? payload.answer : null;
  const evidence = Array.isArray(payload?.evidence) ? payload.evidence : [];
  const references = Array.isArray(payload?.evidenceIds) ? payload.evidenceIds : [];
  const knownIds = new Set(evidence.map((entry) => entry.evidenceId));
  const issues = [];
  if (completions.length !== 1) issues.push("completion_count_not_one");
  if (!answer?.trim()) issues.push("no_delivered_answer");
  if (references.some((id) => !knownIds.has(id))) issues.push("unresolved_evidence_reference");
  const terminationIndex = events.findIndex((event) => event?.type === "termination");
  const rejections = events.filter((event) => event?.type === "decision_rejected");
  return {
    schemaVersion: "unit-play-answer-review-packet.v1",
    mode: "diagnostic_review_only",
    blinded: false,
    productionRollout: false,
    formalPairedAcceptance: "not_evaluated",
    recordedAt,
    originalClockPolicy: "Use recorded request time and original receipts; never refresh source timestamps during review.",
    sourceHashes: { response: sha256(responseText), manifest: sha256(manifestText), rubric: sha256(rubricText) },
    candidate: manifest,
    rubric,
    delivered: {
      status: payload?.status ?? null,
      runStatus: payload?.run?.status ?? null,
      terminationReason: payload?.terminationReason ?? null,
      answer,
      answerSha256: answer === null ? null : sha256(answer),
      evidenceIds: references,
      cardEvidenceIds: payload?.cardEvidenceIds ?? [],
      evidence,
      evidenceSha256: sha256(JSON.stringify(evidence))
    },
    modelProposal: payload?.modelConclusion ? {
      status: payload.modelConclusion.status ?? null,
      answer: payload.modelConclusion.answer ?? null,
      answerSha256: typeof payload.modelConclusion.answer === "string" ? sha256(payload.modelConclusion.answer) : null,
      evidenceIds: payload.modelConclusion.evidenceIds ?? [],
      validationErrors: payload.modelConclusion.validationErrors ?? []
    } : null,
    runtimeObservations: {
      modelStatus: payload?.modelConclusion?.status ?? null,
      reasonCode: payload?.modelConclusion?.reasonCode ?? null,
      systemFallback: events.some((event) => event?.type === "answer" && event.data?.systemFallback === true),
      validationErrors: payload?.modelConclusion?.validationErrors ?? [],
      durationMs: payload?.run?.durationMs ?? null,
      toolCalls: payload?.run?.toolCallCount ?? null,
      rejectedActions: rejections,
      completionCount: completions.length,
      terminationCount: events.filter((event) => event?.type === "termination").length,
      eventsAfterTermination: terminationIndex < 0 ? null : events.length - terminationIndex - 1,
      structuralIssues: issues
    },
    answerReview: {
      status: answer?.trim() ? "pending_review" : "not_reviewable",
      semanticCorrectness: "unassessed",
      completionEvaluated: false,
      independentHumanReviewRequiredForFormalAcceptance: true,
      note: "Runtime acceptance and Evidence coverage do not establish answer correctness. This unblinded diagnostic is not formal adjudication.",
      labels: rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        facets: criterion.facets,
        reviewerId: null,
        reviewerKind: null,
        verdict: null,
        answerExcerpt: null,
        evidenceIds: [],
        reason: null
      }))
    }
  };
}
