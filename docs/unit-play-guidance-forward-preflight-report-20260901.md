# Unit Play Guidance v2 Forward Zero-call Preflight

Status: **PASSED**

This is a forward-evaluation readiness check for Skill 1.5.7. Two earlier Warwick HTTP diagnostics are disclosed in the frozen corpus metadata, so this is not described as a pristine pre-candidate corpus. No formal paired output existed before this freeze.

## Frozen identity

| Field | Value |
| --- | --- |
| Experiment | `unit-play-guidance-forward.2026-09-01.v2` |
| Corpus SHA-256 | `b02792c1aa541048d7a56c0cfeacb8a6f7fa94c6124caf298d7d0aa0f6322ce6` |
| Observation SHA-256 | `a947e591138a317dece306c0226e590f3278dbbd5e3bc85b0ccde7b6a9a54de5` |
| Candidate Skill SHA-256 | `a71442c1b012d49f36ab14cabaf8810f4e2fe7689a498ebeaff5d3218047beb8` |
| Baseline guidance SHA-256 | `2c92d3db9898725d98acb303831fa9e863b045009a1bcfa6ba6e6b6f46b1182f` |
| Candidate rendered context SHA-256 | `26283e7abff27244ee659db81de1e30211cef06e356d63106cee4e78497d7be7` |
| Default Provider messages SHA-256 | `c34df4d9955a853b69b4593a7a77290cfd36d000a15e72ade4ac361c72b9a19e` |

## Population and evidence

- 30 eligible prompts across 10 current Set 18 units, with 10 English cases.
- 20 negative and 10 boundary routing cases.
- Each unit has one three-item server plan, one matching official item batch, two distinct composition candidates, and two complete tactical formations.
- Cost distribution is 1-cost=2, 2-cost=2, 3-cost=2, 4-cost=2, 5-cost=2.

## Zero-call checks

- Planned pairs: 90; planned complete Agent runs: 180.
- Actual Provider model calls: 0.
- Positive routing: 30/30; negative false takeover: 0; boundary forced takeover: 0.
- The locally captured Provider payload differs only at the professional-guidance field.
- Model-observation projection is deterministic, leaves the source object unchanged, and reduces the representative frozen observation.
- Canonical replay is pinned to frozen Observation only and evaluates receipt freshness at `frozenAt + 1 ms`; live Tool retrieval is disabled.
- Production source has no import of the v2 experiment module.
- Production default remains Skill 1.3.0. Both arms pin cards-only positioning, exact composition queries, item batching, official item receipts, and projection as common runtime conditions.

## Boundary

zero-call forward-evaluation readiness only; no formal paired result or production authorization. The canonical real-provider runner for this v2 population has not been authorized or executed. Browser DOM/layout review is also still outstanding because the user is connected remotely.

## Canonical runner scripted verification

The v2 canonical runner is now implemented behind a fail-closed authorization boundary. The checked-in config still has `realProviderPairedRun: false`; supplying CLI, environment, credential, clean-worktree, and commit inputs cannot override that lock. The production default remains Skill 1.3.0 and production source does not import this experiment.

The runner reuses the frozen TaskFrame identity, registered Tool definitions, ToolExecutor, ReAct loop, tactical prompt, action-shaped transcript, and model-observation projection. Every replayed query must exactly match the frozen server plan. Entity re-resolution, individual item lookups, widened build queries, unknown composition mentions, and tactical argument drift fail closed.

Execution control is frozen at one pair at a time, 1,800 Provider HTTP requests, and 10,000,000 total tokens. Each request reserves prompt and output capacity before dispatch; missing usage, reservation underflow, an opened fuse, or model/system-fingerprint drift aborts the run.

The local scripted transport exercised the entire order without a Provider model call:

| Check | Result |
| --- | --- |
| Planned/completed Agent runs | 180 / 180 |
| Frozen tool calls per run | 8 |
| Scripted transport requests | 1620 |
| Maximum transport concurrency | 1 |
| Actual Provider model calls | 0 |
| Blinded output entries | 180 |
| Independent label slots | 1080 per reviewer |

Each blinded entry contains two distinct composition cards with its own complete formation. Raw Evidence IDs, pair IDs, arm, repetition, Provider usage, and guidance hashes are excluded from packet entries; the blind key is a separate artifact. The review schema requires two independent reviewers, preserves both original label sets, and requires adjudication on disagreement. Keyword presence alone is not accepted as facet coverage.

This verification proves runner wiring, deterministic replay, output blinding, and failure locks only. The scripted answers are not formal efficacy evidence. No formal paired Provider output has been created, no review has started, and production promotion remains unauthorized.
