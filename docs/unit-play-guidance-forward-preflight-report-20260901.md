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

The v2 canonical runner is now implemented behind a fail-closed authorization boundary. The checked-in config remains frozen with `realProviderPairedRun: false`. A real run additionally requires a separate, uncommitted authorization artifact created only after explicit user approval. That artifact is limited to one formal paired run and binds the exact implementation commit, normalized frozen config, 180-Agent-run cap, Provider hostname, and model. CLI opt-in, environment opt-in, credential presence, a clean worktree, and the matching commit are still independently required. The production default remains Skill 1.3.0 and production source does not import this experiment.

The runner reuses the frozen TaskFrame identity, registered Tool definitions, ToolExecutor, ReAct loop, tactical prompt, action-shaped transcript, and model-observation projection. Every replayed query must exactly match the frozen server plan. Entity re-resolution, individual item lookups, widened build queries, unknown composition mentions, and tactical argument drift fail closed.

Execution control remains one pair at a time with a hard limit of 1,800 Provider HTTP requests. The user removed the aggregate token limit after the first incomplete attempt showed that 10,000,000 tokens could not cover 180 Agent runs; actual usage is still recorded for every response and each response retains the frozen 1,800-output-token limit. Missing usage, an opened request fuse, or model/system-fingerprint drift aborts the run.

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

Every arm is audited before blinding. It must finish through the native model ReAct completion path, contain no runtime error, keep transport concurrency at one, and retain Provider usage for every decision request. Exact eight-step Tool adherence is reported separately by arm as an experimental outcome: requiring it for both arms would pre-exclude the baseline behavior that the Skill is intended to improve. A pair enters the blind packet only when both distinct arms pass the completion audit. The run is analyzable only with at least 81 valid paired repetitions and at least 27 cases having two valid pairs; otherwise its status is `inconclusive`, invalid outputs remain in the private result for diagnosis, and no reviewer templates are emitted.

The formal CLI writes bounded, append-only per-arm checkpoints and refuses to overwrite an existing output directory. Credentials are held only in memory and are not written to results, checkpoints, the blind packet, or the authorization artifact. Checkpoints preserve partial progress for diagnosis; the runner intentionally does not resume a partial formal attempt.

This verification proves runner wiring, deterministic replay, analyzability filtering, output blinding, and failure locks only. The scripted answers are not formal efficacy evidence. An authorized attempt on commit `40e4c1286a8bcaf5170801103972de0ef7c33205` was stopped after 7 completed arms because 693,199 observed tokens projected beyond its then-authorized 10,000,000-token cap. It produced 56 Provider requests, 1 native completion, 1 duplicate-call fallback, and 5 no-progress fallbacks. It created checkpoints only, no completed result or blind-review packet, and is disclosed as an incomplete diagnostic attempt rather than efficacy evidence. No review has started, and production promotion remains unauthorized.

A second authorized attempt on `842579f2b3a16944770f02a5af96f4e8db7efdfc` used no aggregate token cap and was stopped after 26 arms, 207 Provider requests, and 2,449,197 observed tokens. Across five reached cases, A had 0 native model completions; B completed the exact eight-step Tool sequence in all 13 attempted arms but only 4 passed the native-completion audit. Four fully attempted cases had zero valid pairs, so the required 27-of-30 case coverage was already mathematically unreachable. This attempt also produced checkpoints only. The bounded action traces motivated a new Skill 1.5.8 candidate that stops retrieval after the fixed two-card source set and repairs a rejected finish without starting new retrieval; no answer content was used to tune facts or recommendations. A new evaluation must be declared as adaptive and cannot reuse either incomplete attempt as efficacy evidence.
