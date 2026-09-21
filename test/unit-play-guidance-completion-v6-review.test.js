import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "../src/experiments/unit-play-guidance-control/content.js";
import { COMPLETION_V6_EXPERIMENT_ID } from "../src/experiments/unit-play-guidance-completion-v6/preflight.js";
import { COMPLETION_V6_REVIEW_FACETS } from "../src/experiments/unit-play-guidance-completion-v6/review-facets.js";
import { createCompletionV6AdjudicationTemplate, finalizeCompletionV6IndependentReview,
  inspectCompletionV6IndependentReview } from "../src/experiments/unit-play-guidance-completion-v6/review.js";

const packet = {
  schemaVersion: "unit-play-guidance-completion-review-packet.v6",
  experimentId: COMPLETION_V6_EXPERIMENT_ID,
  adaptiveCandidateOnly: true,
  entries: [
    { outputId: "output-a", caseId: "case-a", input: "A", answer: "A", compositionCards: [], evidenceSummary: [] },
    { outputId: "output-b", caseId: "case-b", input: "B", answer: "B", compositionCards: [], evidenceSummary: [] }
  ]
};

function reviewer(reviewerId, rating = null) {
  return {
    schemaVersion: "unit-play-guidance-completion-independent-labels.v6",
    experimentId: COMPLETION_V6_EXPERIMENT_ID,
    reviewerId,
    packetSha256: sha256(packet),
    independentBeforeAdjudication: true,
    labels: packet.entries.flatMap((entry) => COMPLETION_V6_REVIEW_FACETS.map((facetId) => ({
      outputId: entry.outputId,
      caseId: entry.caseId,
      facetId,
      rating,
      reasonCodes: [],
      note: null
    })))
  };
}

test("v6 review progress preserves incomplete independent labels without semantic auto-scoring", () => {
  const progress = inspectCompletionV6IndependentReview({ packet,
    reviewerLabels: [reviewer("reviewer-1"), reviewer("reviewer-2")] });
  assert.equal(progress.status, "awaiting_independent_review");
  assert.deepEqual(progress.reviewerProgress.map((entry) => entry.pendingRatings), [14, 14]);
  assert.equal(progress.productionAuthorization, false);
  assert.equal(progress.disagreements.length, 0);
});

test("v6 review rejects duplicate, missing, foreign, and non-independent labels", () => {
  const one = reviewer("reviewer-1", "pass");
  const two = reviewer("reviewer-2", "pass");
  one.labels.pop();
  assert.throws(() => inspectCompletionV6IndependentReview({ packet, reviewerLabels: [one, two] }), /Missing labels/u);
  const duplicate = reviewer("reviewer-1", "pass");
  duplicate.labels[1] = structuredClone(duplicate.labels[0]);
  assert.throws(() => inspectCompletionV6IndependentReview({ packet, reviewerLabels: [duplicate, two] }), /duplicate/u);
  const sameIdentity = reviewer("reviewer-1", "pass");
  assert.throws(() => inspectCompletionV6IndependentReview({ packet,
    reviewerLabels: [reviewer("reviewer-1", "pass"), sameIdentity] }), /distinct/u);
});

test("v6 adjudication is prepared only after both reviewers finish and contains disagreements only", () => {
  const one = reviewer("reviewer-1", "pass");
  const two = reviewer("reviewer-2", "pass");
  two.labels[0].rating = "partial";
  const progress = inspectCompletionV6IndependentReview({ packet, reviewerLabels: [one, two] });
  assert.equal(progress.status, "awaiting_adjudication");
  assert.equal(progress.agreements, 13);
  assert.equal(progress.disagreements.length, 1);
  const adjudication = createCompletionV6AdjudicationTemplate({ packet, reviewerLabels: [one, two] });
  assert.equal(adjudication.entries.length, 1);
  assert.equal(adjudication.entries[0].rating, null);
  assert.throws(() => createCompletionV6AdjudicationTemplate({ packet,
    reviewerLabels: [reviewer("reviewer-1"), reviewer("reviewer-2")] }), /must be complete/u);
});

test("v6 finalization requires substantive adjudication and reports quality without authorizing production", () => {
  const one = reviewer("reviewer-1", "pass");
  const two = reviewer("reviewer-2", "pass");
  two.labels[0].rating = "fail";
  const reviewerLabels = [one, two];
  const adjudication = createCompletionV6AdjudicationTemplate({ packet, reviewerLabels });
  adjudication.adjudicatorId = "adjudicator-1";
  assert.throws(() => finalizeCompletionV6IndependentReview({ packet, reviewerLabels, adjudication }), /incomplete/u);
  adjudication.entries[0].rating = "partial";
  adjudication.entries[0].reasonCodes = ["bounded_difference"];
  adjudication.entries[0].note = "The answer is directionally supported but omits one condition.";
  const result = finalizeCompletionV6IndependentReview({ packet, reviewerLabels, adjudication });
  assert.equal(result.status, "review_complete");
  assert.equal(result.totalFacetRatings, 14);
  assert.equal(result.reviewerAgreements, 13);
  assert.equal(result.adjudicatedDisagreements, 1);
  assert.deepEqual(result.ratingCounts, { pass: 13, partial: 1, fail: 0, not_applicable: 0 });
  assert.equal(result.productionAuthorization, false);
  assert.equal(result.qualityDecision, "requires_separate_product_extraction_decision");
});
