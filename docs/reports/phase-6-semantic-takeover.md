# Phase 6 Semantic Route Takeover

- status: PASS
- baseline: `3fedad8`
- implementation: `bcaeeee`
- evaluation dataset: `semantic-takeover-phase6.v1` (120 cases × 5 runs)

## Delivered

- Ordered takeover policy for `search → rank → recommend → compare → explain → analyze`.
- Offline and shadow gates before traffic eligibility, deterministic request bucketing for canary traffic, and a 0–100% per-action rollout.
- A strict compatibility gate: the semantic TaskPlan must contain exactly the same registered tool set as the validated legacy RetrievalPlan.
- Immediate legacy fallback for failed gates, shadow differences, clarification, unsupported capability, invalid plans, unresolved execution entities, tool-set mismatch or non-selected canary buckets.
- `agent-route-trace.v1` localization across parsing, entity, context, planning, tool and conclusion layers.
- Internal, non-enumerable routing metadata so the serialized user-visible response remains backward compatible.

## Evaluation

Final `npm run eval:phase6`:

- 120 cases across all six actions, repeated five times (600 runs)
- effective-answer rate: 100% (600/600; gate at least 90%)
- wrong-tool-call rate: 0% (0/600; gate below 1%)
- new/legacy shadow difference rate: 0%
- Pass@5: 100%
- Pass^5: 100%
- full-rollout fallback rate on supported contract cases: 0%
- routing latency P50/P95: 0.041ms / 0.137ms
- input Token P50/P95: 143 / 207
- cached input Token P50/P95: 120 / 120
- output Token P50/P95: 49 / 73

Every action slice, entity/style/version/tool slice reached 100% quality. At a simulated 10% canary, every action observed both semantic traffic and legacy fallback before expanding to the full offline replay.

## Tests

- targeted takeover/shadow tests: 7 passed, 0 failed, 0 skipped
- full `npm test`: 611 total, 591 passed, 0 failed, 20 existing conditional skips
- 50-case Agent evaluation: 50 passed, 0 failed; tool selection 100%
- phase 0–5 evaluations: all passed
- `npm run smoke:small-window`: passed; hot cache 3ms, reopened local cache 4ms
- `npm run smoke:comps`: passed
- `npm run smoke:sqlite`: conditional skip under Node 18 because neither `node:sqlite` nor optional `better-sqlite3` is available

The budgeted real-LLM T2 smoke also passed: 20/20 successful structured requests, 95% domain accuracy, 95% action accuracy, 92.31% entity mention recall, all Token/latency budgets passed, and zero retries.

## Behavior difference and rollback

The semantic route now authorizes deterministic execution only when its registered-tool plan exactly matches the existing validated RetrievalPlan. Existing statistics, filtering, ranking, evidence and conclusions remain deterministic. Any incompatibility uses the old route.

For immediate rollback, set all action `rolloutPercent` values to `0`; this preserves shadow traces while sending all traffic through the legacy route. Revert `bcaeeee` to remove the phase-6 controller entirely. No production data rollback is required.

## Known limits

- Canary traffic was simulated with deterministic local replay; no production deployment or real traffic shift was performed.
- The true-model run is a 20-case T2 smoke. The 600-run phase evaluation is deterministic offline replay, not a paid 100–500 case T3 production-candidate evaluation.
- SQLite remains conditionally unavailable in the current Node 18 runtime.
