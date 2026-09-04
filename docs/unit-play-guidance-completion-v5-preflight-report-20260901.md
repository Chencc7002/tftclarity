# Unit Play Guidance 1.5.9 runtime-affordance reliability preflight

Status: **PASSED**

This is a candidate-only reliability experiment derived from the completed v4 formal run. It does not make a paired efficacy claim and does not authorize production.

## Why v5 exists

The v4 formal run for Skill 1.5.9 stopped early on `2d93413be806b92c38eee76484c63274b1705b8c` with status `inconclusive`: 27/37 native model completions, 37/37 exact frozen Tool sequences, 9 cases with at least two native completions, 360 Provider requests, and 5,340,089 observed tokens. The bounded action trace showed that card retrieval was exact, but some runs continued to call `comps_rankings` after the fixed card sequence was already satisfied.

## Frozen scope

- Experiment: `unit-play-guidance-completion.2026-09-01.v5`.
- Candidate Skill: 1.5.9, SHA-256 `8f96107e182ac0347aee7adbb57e90d89ab609d44cd18f96a7d9f593af07fb36`.
- Runtime affordance: after two current `composition_tactical_details` evidence entries are added, emit `recommendedAction=finish` with all current Evidence IDs and `positioningProseAllowed=false`.
- Source population: the unchanged v2 30-case corpus and frozen registered-Tool observations.
- Plan: 30 cases, 3 repetitions, B arm only, 90 Agent runs, concurrency 1.
- Reliability gates: at least 81 native model completions and at least 27 cases with two native completions.
- Tool adherence is reported separately and must not replace native-completion reliability.
- Provider request hard cap: 1,000. Aggregate token cap: none. Per-response output cap: 1,800 tokens.
- Checked-in Provider and production authorization remain false. Production default remains Skill 1.3.0.

## Candidate change

v5 keeps the v4 Skill text. The new behavior is a gated ReAct runtime affordance, enabled only by this experiment's context. It does not add tools, widen schemas, change server-scoped arguments, bypass Evidence validation, or auto-publish an answer. It only tells the model that the next action should be `finish` after the fixed card evidence is complete.

No answer text from incomplete or inconclusive attempts was used. Only bounded action types, Tool names, termination reasons, rejection codes, request counts, and token usage informed this runtime repair.

## Zero-call verification

- Preflight gates: 12/12 passed.
- Actual Provider model calls: 0.
- Scripted run: 90/90 native completions, 90/90 exact frozen Tool sequences, 30/30 cases with two native completions.
- Scripted requests: 810; actual Provider model calls: 0.
- Review artifacts: 90 candidate outputs and two independent 540-facet label templates.
- Formal CLI remains locked without a commit-bound authorization artifact.

The scripted run verifies wiring only. A real v5 run requires a new explicit authorization bound to the final commit because the runtime affordance differs from v4.

## Formal run result

The commit-bound v5 formal attempt on `c80d299629a42d6d4ea2cdf848932d3d70eb42de` completed all 90 Agent runs with status `awaiting_independent_review`. It used 810 Provider requests and 11,722,546 observed tokens.

The reliability result passed: 90 native model completions, 90 exact frozen Tool sequences, and 30 cases with at least two native completions. The bounded checkpoint audit found 0 invalid runs, 0 decision rejections, and 0 post-sequence `comps_rankings` over-calls. Review artifacts were written for 90 candidate outputs with two independent 540-facet reviewer templates.

This supports the candidate-only reliability claim for the v5 runtime affordance. It still does not make a paired efficacy claim and does not authorize production. The next gate is independent answer review, adjudication of disagreements, and then a separate product extraction decision.

The offline workflow for that gate is documented in [unit-play-guidance-completion-v5-review-guide.md](unit-play-guidance-completion-v5-review-guide.md). Its validator checks both complete 540-facet label sets, creates a disagreement-only adjudication template after independent review, and produces a hash-bound summary without making an automatic quality or production decision.
