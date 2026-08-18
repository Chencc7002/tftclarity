# Unit Play Guidance PR1C Control Experiment Report

Status: **PASSED**  
Mode: **paired isolated offline replay**  
Production behavior: **unchanged; this report does not authorize rollout**

## Result qualification

This PR1C result establishes a narrower claim: **in a frozen ReAct/Tool/Evidence environment using the deterministic experiment decision provider, version-pinned candidate Skill guidance increased target facet coverage without increasing Tool calls**.

It does **not** establish real production-model instruction compliance, real-model output stability, actual provider token usage, actual provider latency, or production-control suitability. The 100 ms replay measurement is harness latency, and the token values are a shared deterministic estimator rather than provider billing telemetry. Those questions require a separately authorized real-provider offline acceptance phase. Product has authorized only its docs-only architecture contract in `docs/unit-play-guidance-real-provider-offline-acceptance-contract.md`; the real-provider harness and real calls remain unauthorized pending review.

## Reproducibility

| Field | Value |
| --- | --- |
| Base commit SHA | `03570d36740786b976c2b969c9762da84e126043` |
| Worktree | clean |
| Runtime | `unit-play-guidance-control-harness.v1` |
| ReAct implementation | `src/react/react-loop.js` |
| Provider | `deterministic_offline_experiment` |
| Grounding | `strict` |
| Corpus version | `unit-play-guidance-control-corpus.2026-08-18.v1` |
| Corpus normalized SHA-256 | `49f74b710b3bb1bbad04c2aa9656752738b55ba80c22e0aa4f5bd3d68929ee7a` |
| Corpus file SHA-256 | `14e9e8635f7188cee62b68e54058d6a16e89c823ae0aaa1ebc656d44c6eb65c5` |
| Fixture version | `unit-play-guidance-frozen-observations.2026-08-18.v1` |
| Fixture normalized SHA-256 | `7c4ef33836284b0970fa241f1ba9151512e4b78a45f535a3f8464c99f5a1f338` |
| Fixture file SHA-256 | `3c8adfc3f4eb3f2118ed11970eb1aa216177d798e9d4451f482f56d2f8e3ab64` |
| Baseline guidance | `react-semantic-guidance.unit-play.v1` / `7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123` |
| Candidate content | `unit_play_guidance.experiment.v1` / `8a28b75dcb32909970aaf7b63681b6acf4ccf7d1ee440e300412363a01e5ccfc` |
| Candidate rendered context hashes | `c0f5395e9266b65ecb50eccde93112eb964cd1cf3e1df9993d21b960eb2637f9` |

The corpus was frozen for the reported run after harness bring-up and before this promotion-gate execution. Tool observations are local fixtures; identical Tool plus arguments replay byte-identical values in A and B. No live network data is part of the primary result.

## Boundary and routing

- Positive eligible: 30/30
- Negative false takeover: 0/20
- Boundary forced takeover: 0/10
- Second TaskFrame parses: 0
- LLM Skill Router calls: 0
- Added routing/completion model calls: 0
- Production imports of the experiment: 0

The two arms reuse `ReactLoop` with the same tool definitions, budgets, grounding mode, deterministic provider implementation and frozen observations. WorkingState, EvidenceLedger, duplicate-call guard, termination state, telemetry and run IDs are created independently. A sentinel mutation injected into A was absent from B. Conversation persistence writes were zero.

## Gates

| Gate | Result |
| --- | --- |
| requiredEvidenceNonDegradation | PASS |
| requiredAnswerNonDegradation | PASS |
| realValue | PASS |
| meanToolCalls | PASS |
| p95ToolCalls | PASS |
| latency | PASS |
| tokens | PASS |
| unforcedFallback | PASS |
| safety | PASS |

## Answer facet coverage

| Facet | A | B-native | B-end-to-end |
| --- | ---: | ---: | ---: |
| unit_role | 0/30 | 30/30 | 30/30 |
| equipment_logic | 30/30 | 30/30 | 30/30 |
| composition_context | 30/30 | 30/30 | 30/30 |
| positioning | 24/24 | 24/24 | 24/24 |
| when_to_play | 19/19 | 19/19 | 19/19 |

- Required answer coverage: A 73.68%, B-native 100.00%, B-end-to-end 100.00%.
- Total supported-facet answer coverage: A 77.44%, B-native 100.00%, B-end-to-end 100.00%.
- B-native total gain: 22.56%; missing-required-facet relative reduction: 100.00%.

Positioning is `required_if_supported`: unsupported fixture cases are excluded from its coverage denominator and must carry a qualification instead of a fabricated recommendation.

## Evidence facet coverage

| Facet | A | B-native | B-end-to-end |
| --- | ---: | ---: | ---: |
| unit_role | 30/30 | 30/30 | 30/30 |
| equipment_logic | 30/30 | 30/30 | 30/30 |
| composition_context | 30/30 | 30/30 | 30/30 |
| positioning | 24/24 | 24/24 | 24/24 |
| when_to_play | 19/19 | 19/19 | 19/19 |

## Cost

| Metric | A | B-native | B-end-to-end | Gate |
| --- | ---: | ---: | ---: | --- |
| Mean Tool calls | 3.80 | 3.80 | 3.80 | B <= A + 0.5 |
| p95 Tool calls | 4.00 | 4.00 | 4.00 | B <= A + 1 |
| Mean frozen replay latency (ms) | 100.00 | 100.00 | 100.00 | B <= A x 1.20 |
| Mean estimated input+output tokens | 14328.53 | 15733.87 | 15733.87 | B <= A x 1.20 |

- Extra Tool calls per newly covered required facet: 0.00
- Tokens per covered supported facet: 3548.99

Latency is deterministic frozen-replay end-to-end latency, not live provider wall time. Token counts are the same deterministic character-based estimator in both arms.

## Safety

| Metric | A | B-native | B-end-to-end |
| --- | ---: | ---: | ---: |
| unauthorizedToolCalls | 0 | 0 | 0 |
| unsupportedToolCalls | 0 | 0 | 0 |
| serverScopeViolations | 0 | 0 | 0 |
| historicalAsCurrentViolations | 0 | 0 | 0 |
| groundingViolations | 0 | 0 | 0 |
| inventedNumericStatistics | 0 | 0 | 0 |
| duplicateDeterministicCalls | 0 | 0 | 0 |
| nextActionPriorityViolations | 0 | 0 | 0 |
| budgetOverruns | 0 | 0 | 0 |

## Fault injection and fallback

| Fault | B-native status | B-native termination | Destination | Fallback guidance hash | Result |
| --- | --- | --- | --- | --- | --- |
| skill_definition_failure | not_started | skill_definition_failure | A | 7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123 | PASS |
| skill_context_failure | not_started | skill_context_failure | A | 7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123 | PASS |
| candidate_runtime_failure | failed | decision_provider_failed | A | 7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123 | PASS |
| grounding_rejection | failed | missing_required_evidence | A | 7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123 | PASS |
| budget_failure | completed_with_warning | runaway_loop_fuse | A | 7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123 | PASS |

Fallback success: 5/5; wrong destination: 0. Normal unforced fallback: 0.

## Per-case compact results

| Case | A tools | B tools | A supported answer facets | B-native supported answer facets | Fallback |
| --- | ---: | ---: | ---: | ---: | --- |
| pos-01 | 4 | 4 | 4/5 | 5/5 | none |
| pos-02 | 4 | 4 | 4/5 | 5/5 | none |
| pos-03 | 4 | 4 | 3/4 | 4/4 | none |
| pos-04 | 4 | 4 | 4/5 | 5/5 | none |
| pos-05 | 4 | 4 | 3/4 | 4/4 | none |
| pos-06 | 3 | 3 | 3/4 | 4/4 | none |
| pos-07 | 4 | 4 | 4/5 | 5/5 | none |
| pos-08 | 4 | 4 | 3/4 | 4/4 | none |
| pos-09 | 4 | 4 | 4/5 | 5/5 | none |
| pos-10 | 3 | 3 | 3/4 | 4/4 | none |
| pos-11 | 4 | 4 | 3/4 | 4/4 | none |
| pos-12 | 4 | 4 | 4/5 | 5/5 | none |
| pos-13 | 4 | 4 | 4/5 | 5/5 | none |
| pos-14 | 4 | 4 | 3/4 | 4/4 | none |
| pos-15 | 4 | 4 | 4/5 | 5/5 | none |
| pos-16 | 3 | 3 | 2/3 | 3/3 | none |
| pos-17 | 4 | 4 | 4/5 | 5/5 | none |
| pos-18 | 4 | 4 | 4/5 | 5/5 | none |
| pos-19 | 4 | 4 | 3/4 | 4/4 | none |
| pos-20 | 3 | 3 | 3/4 | 4/4 | none |
| pos-21 | 4 | 4 | 4/5 | 5/5 | none |
| pos-22 | 4 | 4 | 3/4 | 4/4 | none |
| pos-23 | 4 | 4 | 4/5 | 5/5 | none |
| pos-24 | 4 | 4 | 4/5 | 5/5 | none |
| pos-25 | 4 | 4 | 3/4 | 4/4 | none |
| pos-26 | 3 | 3 | 3/4 | 4/4 | none |
| pos-27 | 4 | 4 | 3/4 | 4/4 | none |
| pos-28 | 4 | 4 | 4/5 | 5/5 | none |
| pos-29 | 4 | 4 | 4/5 | 5/5 | none |
| pos-30 | 3 | 3 | 2/3 | 3/3 | none |

Negative and boundary per-case routing outcomes are recorded in the machine result produced by the same runner. This report contains metrics and outputs only; it contains no hidden reasoning or chain-of-thought.

## Decision

PR1C deterministic isolated/offline control experiment: **PASSED / CLOSED**. Offline Control Harness and deterministic Skill-value replay passed; real-model Skill control behavior remains **NOT YET TESTED**. The next authorized work is PR1D-Contract documentation only. This is evidence for product review only. It does not enable Skill control, alter the production request handler, replace semantic guidance, authorize a real-provider harness/call, or authorize PR2/production rollout.
