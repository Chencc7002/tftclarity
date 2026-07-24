# Phase 0: Baseline and Failure Samples

Status: passed

## Baseline

- commit: `d9416b0`
- initial `npm test`: 561 total, 541 passed, 0 failed, 20 skipped
- system runtime: Node 18.20.8
- skipped tests were recorded separately and were not counted as passed

## Dataset

- version: `natural-language-agent-phase0.v1`
- path: `eval/datasets/natural-language-agent-phase0.v1.jsonl`
- total and unique inputs: 300 / 300
- privacy-pattern violations: 0
- non-standard styles: 90%
- source mix: 1 anonymized runtime query, 9 derived runtime-style cases, 29 repository regressions, 261 deterministic real-style derivations
- all 11 failure labels and all 16 required phenomena have independent coverage

The local query-event store contained 60 records but only one unique privacy-clean question. Duplicate executions were not presented as distinct real questions. The remaining startup set therefore uses existing regression interactions plus deterministic colloquial, typo, terse, traditional, punctuation-free and gamer-slang variants. This is a startup evaluation set, not a claim that 300 independent production conversations were collected.

## Verification

- `npm run eval:phase0`: passed; JSON and Markdown reports generated under `.cache/eval/`
- `npm run eval:phase0:check`: passed; the checked-in JSONL is reproducible
- `node --test test/phase0-evaluation-dataset.test.js`: 3 passed, 0 failed
- final `npm test`: 564 total, 544 passed, 0 failed, 20 skipped

## Behavior difference

No production request behavior changed. Phase 0 adds only the dataset, deterministic validator, tests, reports and progress ledger.

## Known limitations and rollback

- A future claim of 95% or higher coverage still requires at least 1000 real-style samples and an isolated holdout set, as required by the master plan.
- System Node lacks `node:sqlite`; existing SQLite/provider/obsolete skips remain explicit.
- Rollback is file-only: remove the phase 0 dataset, runner, tests, reports and package scripts. No data migration or business rule is involved.

