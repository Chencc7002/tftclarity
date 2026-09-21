# Unit Play Guidance 1.5.8 adaptive reliability preflight

Status: **PASSED**

This is a new adaptive candidate-only reliability experiment. It was designed after two incomplete v2 Provider attempts exposed completion-loop failures. It does not reuse those attempts as efficacy evidence and cannot support an A/B or production claim.

## Frozen scope

- Experiment: `unit-play-guidance-completion.2026-09-01.v3`.
- Candidate: Skill 1.5.8, SHA-256 `7d2e6ca88c8c8300ab6bdbf28d3a5a567198993c489e0d3a73984a29d48ff405`.
- Source population: the unchanged v2 30-case corpus and frozen registered-Tool observations.
- Plan: 30 cases, 3 repetitions, B arm only, 90 Agent runs, concurrency 1.
- Reliability gates: at least 81 native model completions and at least 27 cases with two native completions.
- Tool adherence is reported separately and must not replace native-completion reliability.
- Provider request hard cap: 1,000. Aggregate token cap: none. Per-response output cap: 1,800 tokens.
- Checked-in Provider and production authorization remain false. Production default remains Skill 1.3.0.

## Candidate change

Skill 1.5.8 preserves all 1.5.7 tools, permissions, Evidence rules, server-produced equipment plans, source composition cards, and card-owned positioning. It freezes the first source-returned candidate set for the turn, processes each candidate once, then requires `finish`. If `finish` is rejected, it repairs only the answer contract unless the rejection explicitly identifies an unexecuted fixed-candidate action.

No answer text from the incomplete attempts was used. Only bounded action types, Tool names, termination reasons, request counts, and token usage informed this completion repair.

## Zero-call verification

- Preflight gates: 11/11 passed.
- Actual Provider model calls: 0.
- Scripted run: 90/90 native completions, 90/90 exact frozen Tool sequences, 30/30 cases with two native completions.
- Scripted requests: 810; actual Provider model calls: 0.
- Review artifacts: 90 candidate outputs and two independent 540-facet label templates.
- Formal CLI without a commit-bound authorization artifact exits nonzero before creating output.

The scripted run verifies wiring only. A real v3 run requires a new explicit authorization because its candidate-only adaptive scope differs from the previously authorized paired experiment.

The first v3 attempt on `a198fef2d072f3622d66fe8d72cd022e31a363c4` was stopped after 3 runs, 33 Provider requests, and 478,556 observed tokens. It showed that the native-completion audit was stricter than the existing PR1D contract: model answers accepted after a recoverable warning were being marked invalid. The audit now accepts `completed_with_warning` only when the termination reason is `completed`, the answer origin is `model`, runtime errors are absent, usage is complete, and transport concurrency remains one. That attempt produced checkpoints only and is not reliability evidence.

The commit-bound v3 formal attempt on `f76cbbb50dccaab044fce851020e71ca1364efe6` stopped early after 30 Agent runs because the native model completion gate became mathematically unreachable. It used 298 Provider requests and 4,405,158 observed tokens. The final result is `inconclusive`: 20 native model completions, 30 exact frozen Tool sequences, and 7 cases with at least two native completions. This result is valid evidence that 1.5.8 retained deterministic retrieval but did not meet completion reliability.
