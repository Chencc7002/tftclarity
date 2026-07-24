# Phase 2 TaskFrame and Shadow Semantic Parser

- status: PASS
- baseline: `3c72699`
- implementation: `2d16226`
- evaluation dataset: `natural-language-agent-phase0.v1` (300 cases)

## Delivered

- `task-frame.v1` schema, validator and `intent_envelope.v1` migration.
- Semantic Task Parser for domain, action, subjects, candidates, concepts, constraints, goal, ambiguity, confidence and understanding status.
- Searchable few-shot store with at most four relevant examples per request.
- Stable prompt prefix, dynamic tail, structured state bar and retention-preserving context compression contract.
- Production shadow execution with sanitized new/old differences; the old parser remains authoritative.
- Separate cached-input, uncached-input and output Token telemetry plus explicit input/output/latency budgets.

## Evaluation

Final `npm run eval:phase2`:

- action accuracy: 96.00% (gate: at least 92%)
- domain accuracy: 97.67% (gate: at least 97%)
- unsupported capability understood correctly: 100%
- input/output/latency budget pass rate: 100% / 100% / 100%
- average/P95 deterministic latency: 0.26ms / 0.46ms
- average cached/uncached/output Token: 120.0 / 240.0 / 146.1

Observed iterations were retained in the JSON report: 82.67%/93.00%/88.00%, then 95.67%/97.00%/96.25%, then 95.67%/97.00%/97.50%, and finally the passing result.

## Tests

- targeted TaskFrame/parser/context/shadow tests: 10 passed, 0 failed, 0 skipped
- full `npm test`: 589 total, 569 passed, 0 failed, 20 existing conditional skips
- production compatibility test confirms shadow-enabled and shadow-disabled recommendation results are deeply equal

## Behavior difference and rollback

The new parser runs only in shadow mode and emits internal safe events. It does not alter response fields, tool selection, statistics, ranking, evidence, conclusions or clarification behavior. Revert `2d16226` to remove it; no production data rollback is needed.

## Known limits

- The deterministic parser is the phase-2 protocol baseline, not the final open-ended model parser.
- The 300-case startup set is not the independent 1000-case holdout required for a public 95% coverage claim.
- Canonical entity and concept linking is phase 3.
