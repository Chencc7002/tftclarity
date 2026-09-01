# Unit Play Guidance 1.5.9 adaptive reliability preflight

Status: **PASSED**

This is a candidate-only reliability experiment derived from the completed v3 formal run. It does not make a paired efficacy claim and does not authorize production.

## Why v4 exists

The v3 formal run for Skill 1.5.8 stopped early on `f76cbbb50dccaab044fce851020e71ca1364efe6` with status `inconclusive`: 20/30 native model completions, 30/30 exact frozen Tool sequences, 7 cases with at least two native completions, 298 Provider requests, and 4,405,158 observed tokens. The bounded action trace showed that retrieval sequencing was reliable, while completion failed when the model tried to write or repair composition/positioning prose after card evidence existed.

## Frozen scope

- Experiment: `unit-play-guidance-completion.2026-09-01.v4`.
- Candidate: Skill 1.5.9, SHA-256 `8f96107e182ac0347aee7adbb57e90d89ab609d44cd18f96a7d9f593af07fb36`.
- Source population: the unchanged v2 30-case corpus and frozen registered-Tool observations.
- Plan: 30 cases, 3 repetitions, B arm only, 90 Agent runs, concurrency 1.
- Reliability gates: at least 81 native model completions and at least 27 cases with two native completions.
- Tool adherence is reported separately and must not replace native-completion reliability.
- Provider request hard cap: 1,000. Aggregate token cap: none. Per-response output cap: 1,800 tokens.
- Checked-in Provider and production authorization remain false. Production default remains Skill 1.3.0.

## Candidate change

Skill 1.5.9 preserves all 1.5.8 tools, schemas, data dependencies, Evidence rules, server-produced equipment plans, source composition cards, and card-owned positioning. It narrows model prose to official unit role, equipment interpretation, and the general when-to-play condition. Composition names, members, statistics, coordinates, row/column words, front/mid/back-row prose, raw cells, and positioning explanations are reserved for the cited cards. If finish repair mentions positioning or tactical evidence errors, the Skill instructs the model to remove composition/positioning prose and finish instead of making new composition or tactical calls.

No answer text from incomplete or inconclusive attempts was used. Only bounded action types, Tool names, termination reasons, rejection codes, request counts, and token usage informed this completion repair.

## Zero-call verification

- Preflight gates: 11/11 passed.
- Actual Provider model calls: 0.
- Scripted run: 90/90 native completions, 90/90 exact frozen Tool sequences, 30/30 cases with two native completions.
- Scripted requests: 810; actual Provider model calls: 0.
- Review artifacts: 90 candidate outputs and two independent 540-facet label templates.
- Formal CLI remains locked without a commit-bound authorization artifact.

The scripted run verifies wiring only. A real v4 run requires a new explicit authorization bound to the final commit because the candidate differs from v3.
