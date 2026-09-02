import { FORWARD_REVIEW_FACETS } from "../unit-play-guidance-forward/canonical.js";

// V6 was adapted from reviewed answer defects, so language matching is an
// explicit human-review facet in addition to the frozen forward facets.
export const COMPLETION_V6_REVIEW_FACETS = Object.freeze([
  ...FORWARD_REVIEW_FACETS,
  "answer_language"
]);
