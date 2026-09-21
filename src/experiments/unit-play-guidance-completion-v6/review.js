import { sha256 } from "../unit-play-guidance-control/content.js";
import { COMPLETION_V6_EXPERIMENT_ID } from "./preflight.js";
import { COMPLETION_V6_REVIEW_FACETS } from "./review-facets.js";

export const COMPLETION_V6_REVIEW_RATINGS = Object.freeze([
  "pass",
  "partial",
  "fail",
  "not_applicable"
]);

const PACKET_SCHEMA = "unit-play-guidance-completion-review-packet.v6";
const LABEL_SCHEMA = "unit-play-guidance-completion-independent-labels.v6";
const ADJUDICATION_SCHEMA = "unit-play-guidance-completion-adjudication.v6";
const RESULT_SCHEMA = "unit-play-guidance-completion-independent-review-result.v6";
const ratingSet = new Set(COMPLETION_V6_REVIEW_RATINGS);
const facetSet = new Set(COMPLETION_V6_REVIEW_FACETS);

const labelKey = ({ outputId, facetId }) => `${outputId}\0${facetId}`;

function assertObject(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${description} must be an object`);
  }
}

function validatePacket(packet) {
  assertObject(packet, "review packet");
  if (packet.schemaVersion !== PACKET_SCHEMA
    || packet.experimentId !== COMPLETION_V6_EXPERIMENT_ID
    || packet.adaptiveCandidateOnly !== true
    || !Array.isArray(packet.entries)
    || packet.entries.length === 0) {
    throw new TypeError("Unsupported completion v6 review packet");
  }
  const outputIds = new Set();
  for (const entry of packet.entries) {
    if (typeof entry?.outputId !== "string" || !entry.outputId
      || typeof entry?.caseId !== "string" || !entry.caseId
      || outputIds.has(entry.outputId)) {
      throw new TypeError("Invalid or duplicate completion v6 packet entry");
    }
    outputIds.add(entry.outputId);
  }
  return new Map(packet.entries.map((entry) => [entry.outputId, entry.caseId]));
}

function validateReviewerLabels(packet, reviewerLabels) {
  const cases = validatePacket(packet);
  if (!Array.isArray(reviewerLabels) || reviewerLabels.length !== 2) {
    throw new TypeError("Exactly two independent reviewer label documents are required");
  }
  const packetSha256 = sha256(packet);
  const reviewerIds = reviewerLabels.map((document) => String(document?.reviewerId ?? "").trim());
  if (reviewerIds.some((id) => !id) || new Set(reviewerIds).size !== 2) {
    throw new TypeError("Reviewer identities must be present and distinct");
  }
  const expectedKeys = new Set(packet.entries.flatMap((entry) => (
    COMPLETION_V6_REVIEW_FACETS.map((facetId) => labelKey({ outputId: entry.outputId, facetId }))
  )));
  const normalized = reviewerLabels.map((document) => {
    assertObject(document, "reviewer label document");
    if (document.schemaVersion !== LABEL_SCHEMA
      || document.experimentId !== COMPLETION_V6_EXPERIMENT_ID
      || document.packetSha256 !== packetSha256
      || document.independentBeforeAdjudication !== true
      || !Array.isArray(document.labels)) {
      throw new TypeError(`Invalid label document for ${document.reviewerId ?? "unknown reviewer"}`);
    }
    const seen = new Set();
    let completedRatings = 0;
    for (const label of document.labels) {
      const key = labelKey(label ?? {});
      if (!expectedKeys.has(key) || seen.has(key)
        || cases.get(label?.outputId) !== label?.caseId
        || !facetSet.has(label?.facetId)) {
        throw new TypeError(`Invalid, duplicate, or unexpected label in ${document.reviewerId}`);
      }
      if (label.rating !== null && !ratingSet.has(label.rating)) {
        throw new TypeError(`Unsupported rating in ${document.reviewerId}`);
      }
      if (!Array.isArray(label.reasonCodes)
        || label.reasonCodes.some((reason) => typeof reason !== "string" || !reason.trim())
        || (label.note !== null && typeof label.note !== "string")) {
        throw new TypeError(`Invalid review explanation in ${document.reviewerId}`);
      }
      if (label.rating !== null) completedRatings += 1;
      seen.add(key);
    }
    if (seen.size !== expectedKeys.size) {
      throw new TypeError(`Missing labels in ${document.reviewerId}`);
    }
    return { document, labelsByKey: new Map(document.labels.map((label) => [labelKey(label), label])),
      completedRatings, totalRatings: expectedKeys.size };
  });
  return { packetSha256, reviewerIds, normalized, totalRatingsPerReviewer: expectedKeys.size };
}

export function inspectCompletionV6IndependentReview({ packet, reviewerLabels } = {}) {
  const validation = validateReviewerLabels(packet, reviewerLabels);
  const reviewerProgress = validation.normalized.map(({ document, completedRatings, totalRatings }) => ({
    reviewerId: document.reviewerId,
    completedRatings,
    totalRatings,
    pendingRatings: totalRatings - completedRatings
  }));
  const labelsComplete = reviewerProgress.every((entry) => entry.pendingRatings === 0);
  const disagreements = [];
  let agreements = 0;
  if (labelsComplete) {
    for (const entry of packet.entries) {
      for (const facetId of COMPLETION_V6_REVIEW_FACETS) {
        const key = labelKey({ outputId: entry.outputId, facetId });
        const ratings = validation.normalized.map(({ labelsByKey }) => labelsByKey.get(key).rating);
        if (ratings[0] === ratings[1]) agreements += 1;
        else disagreements.push({ outputId: entry.outputId, caseId: entry.caseId, facetId,
          reviewerRatings: Object.fromEntries(validation.reviewerIds.map((id, index) => [id, ratings[index]])) });
      }
    }
  }
  return {
    schemaVersion: "unit-play-guidance-completion-review-progress.v6",
    experimentId: COMPLETION_V6_EXPERIMENT_ID,
    status: labelsComplete ? (disagreements.length ? "awaiting_adjudication" : "ready_to_finalize")
      : "awaiting_independent_review",
    packetSha256: validation.packetSha256,
    reviewerProgress,
    agreements,
    disagreements,
    independentBeforeAdjudication: true,
    productionAuthorization: false
  };
}

export function createCompletionV6AdjudicationTemplate({ packet, reviewerLabels } = {}) {
  const progress = inspectCompletionV6IndependentReview({ packet, reviewerLabels });
  if (progress.status === "awaiting_independent_review") {
    throw new Error("Independent labels must be complete before adjudication is prepared");
  }
  return {
    schemaVersion: ADJUDICATION_SCHEMA,
    experimentId: COMPLETION_V6_EXPERIMENT_ID,
    packetSha256: progress.packetSha256,
    reviewerLabelSha256s: Object.fromEntries(reviewerLabels.map((document) => [document.reviewerId, sha256(document)])),
    adjudicatorId: null,
    independentLabelsPreserved: true,
    entries: progress.disagreements.map((entry) => ({ ...entry, rating: null, reasonCodes: [], note: null }))
  };
}

function validateAdjudication(progress, reviewerLabels, adjudication) {
  assertObject(adjudication, "adjudication document");
  const expectedReviewerHashes = Object.fromEntries(reviewerLabels.map((document) => [document.reviewerId, sha256(document)]));
  if (adjudication.schemaVersion !== ADJUDICATION_SCHEMA
    || adjudication.experimentId !== COMPLETION_V6_EXPERIMENT_ID
    || adjudication.packetSha256 !== progress.packetSha256
    || sha256(adjudication.reviewerLabelSha256s) !== sha256(expectedReviewerHashes)
    || adjudication.independentLabelsPreserved !== true
    || typeof adjudication.adjudicatorId !== "string"
    || !adjudication.adjudicatorId.trim()
    || !Array.isArray(adjudication.entries)) {
    throw new TypeError("Invalid completion v6 adjudication document");
  }
  const expected = new Map(progress.disagreements.map((entry) => [labelKey(entry), entry]));
  const seen = new Set();
  for (const entry of adjudication.entries) {
    const key = labelKey(entry ?? {});
    const source = expected.get(key);
    if (!source || seen.has(key) || entry.caseId !== source.caseId
      || sha256(entry.reviewerRatings) !== sha256(source.reviewerRatings)
      || !ratingSet.has(entry.rating)
      || !Array.isArray(entry.reasonCodes)
      || entry.reasonCodes.length === 0
      || entry.reasonCodes.some((reason) => typeof reason !== "string" || !reason.trim())
      || typeof entry.note !== "string" || !entry.note.trim()) {
      throw new TypeError("Invalid, incomplete, or unexpected adjudication entry");
    }
    seen.add(key);
  }
  if (seen.size !== expected.size) throw new TypeError("Adjudication entries do not cover every disagreement");
}

export function finalizeCompletionV6IndependentReview({ packet, reviewerLabels, adjudication } = {}) {
  const progress = inspectCompletionV6IndependentReview({ packet, reviewerLabels });
  if (progress.status === "awaiting_independent_review") {
    throw new Error("Independent labels are incomplete");
  }
  validateAdjudication(progress, reviewerLabels, adjudication);
  const adjudicated = new Map(adjudication.entries.map((entry) => [labelKey(entry), entry.rating]));
  const reviewerMaps = reviewerLabels.map((document) => new Map(document.labels.map((label) => [labelKey(label), label])));
  const ratings = [];
  for (const entry of packet.entries) {
    for (const facetId of COMPLETION_V6_REVIEW_FACETS) {
      const key = labelKey({ outputId: entry.outputId, facetId });
      ratings.push({ outputId: entry.outputId, caseId: entry.caseId, facetId,
        rating: adjudicated.get(key) ?? reviewerMaps[0].get(key).rating,
        resolution: adjudicated.has(key) ? "adjudicated" : "reviewer_agreement" });
    }
  }
  const ratingCounts = Object.fromEntries(COMPLETION_V6_REVIEW_RATINGS.map((rating) => [rating,
    ratings.filter((entry) => entry.rating === rating).length]));
  const facetSummary = Object.fromEntries(COMPLETION_V6_REVIEW_FACETS.map((facetId) => [facetId,
    Object.fromEntries(COMPLETION_V6_REVIEW_RATINGS.map((rating) => [rating,
      ratings.filter((entry) => entry.facetId === facetId && entry.rating === rating).length]))]));
  return {
    schemaVersion: RESULT_SCHEMA,
    experimentId: COMPLETION_V6_EXPERIMENT_ID,
    status: "review_complete",
    claimBoundary: "Independent answer-quality review only; no paired efficacy or production claim.",
    packetSha256: progress.packetSha256,
    reviewerLabelSha256s: adjudication.reviewerLabelSha256s,
    adjudicationSha256: sha256(adjudication),
    reviewers: progress.reviewerProgress.map((entry) => entry.reviewerId),
    adjudicatorId: adjudication.adjudicatorId,
    totalFacetRatings: ratings.length,
    reviewerAgreements: progress.agreements,
    adjudicatedDisagreements: progress.disagreements.length,
    ratingCounts,
    facetSummary,
    ratings,
    qualityDecision: "requires_separate_product_extraction_decision",
    productionAuthorization: false
  };
}
