# Unit Play Guidance PR1D Zero-call Preflight Report

Status: **PASSED**

Mode: **dry-run / zero real-provider calls**

Real-provider canonical run: **NOT AUTHORIZED**

## Result

The bounded PR1D harness, guidance-renderer seam, deterministic routing/fallback checks, canonical 180-run plan, redacted manifest, and secret policy passed without issuing a real Provider HTTP request.

This report does not establish real-model compliance, stability, tokens, latency, value, or production suitability. It is only the evidence requested for Provider-call Authorization Review.

## Reproducibility

| Field | Value |
| --- | --- |
| Implementation commit SHA | `a8cd5b312551e25bbac8e770da50a93c7b2cbd82` |
| Worktree before runner wrote artifacts | clean |
| Runtime | `unit-play-guidance-real-provider-preflight.v1` |
| Experiment | `unit-play-guidance-real-provider-offline.2026-08-18.v1` |
| Planned pairs | 90 |
| Planned complete Agent runs | 180 |
| Actual real Provider HTTP calls | 0 |
| Pair-order SHA-256 | `94dbd2bd32461e996b36ed28265b0a5baba76af7694ce02dd52fba441fdc826a` |

## Redacted Provider manifest

| Field | Value |
| --- | --- |
| Provider/config | `chat` / `openai-compatible-chat` |
| Endpoint class | `chat_completions` |
| Endpoint | `https://api.deepseek.com/chat/completions` |
| Model | `deepseek-v4-flash` |
| Decision prompt | `react-decision-contract.v5` |
| Message layout | `append_only` |
| Temperature / top_p | `0` / `omitted_provider_default` |
| Output tokens | 1800; repair 700 |
| Timeout / attempts / transport retries | 25000 ms / 2 / 0 |
| Thinking / response format | `disabled` / `json_object` |
| Cache namespace / client response cache | `null` / `false` |
| API key configured | false (boolean only; secret not persisted) |

## Frozen hashes

| Artifact | SHA-256 |
| --- | --- |
| Corpus | `49f74b710b3bb1bbad04c2aa9656752738b55ba80c22e0aa4f5bd3d68929ee7a` |
| Tool observations | `7c4ef33836284b0970fa241f1ba9151512e4b78a45f535a3f8464c99f5a1f338` |
| A guidance | `7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123` |
| B content | `8a28b75dcb32909970aaf7b63681b6acf4ccf7d1ee440e300412363a01e5ccfc` |
| B rendered context | `c0f5395e9266b65ecb50eccde93112eb964cd1cf3e1df9993d21b960eb2637f9` |
| Pre-seam default messages | `45eb4dd0b17540e2aa5cb5284c42862da6336f8d3601c8af8ce71102e4007cb0` |

## Provider seam

- Default serialized messages byte-identical to the pre-seam pinned hash: PASS.
- Candidate capture differs only at `semanticGuidance`: PASS.
- Local fake-transport capture requests: 2.
- Actual Provider HTTP calls: 0.
- Production experiment imports: 0.
- Production renderer references outside the Provider implementation: 0.

Production `createReactDecisionProvider` call sites:

- `src/app/small-window-server.js:4111` — renderer option absent

## Deterministic checks

- Positive selection: 30/30.
- Negative false takeover: 0/20.
- Boundary forced takeover: 0/10.
- Second TaskFrame parses: 0.
- Skill routing/completion model calls: 0.
- Fault fallback to pinned A: 5/5; wrong destination 0.
- Secret material persisted: 0.

## Clean-clone verification

| Check | Result |
| --- | --- |
| Focused Agent / Skill / ReAct / PR1C / PR1D suites | 105 passed, 0 failed |
| Main CI lane | 1125 passed, 1 failed, 7 skipped; no new failure |
| Main CI baseline comparison | The same `PR1B raw fixture bytes remain immutable through PR1B.5` fixture-hash test fails at pre-PR1D commit `3c05f9e` with the same actual and expected hashes |
| Integration CI lane | 231 passed, 0 failed, 1 skipped |
| Offline Agent evaluation | 50 passed, 0 failed, 0 skipped; task success rate 1.0 |

The sole main-lane failure is therefore an existing PR1B/PR1B.5 fixture-integrity discrepancy, not a regression introduced by the PR1D implementation.

## Gates

| Gate | Result |
| --- | --- |
| implementationAuthorized | PASS |
| providerCallsNotAuthorized | PASS |
| zeroActualProviderHttpCalls | PASS |
| plannedAgentRuns | PASS |
| plannedPairs | PASS |
| routingPositive | PASS |
| routingNegative | PASS |
| routingBoundary | PASS |
| oneTaskFrameParse | PASS |
| noRoutingOrCompletionModelCalls | PASS |
| faultFallback | PASS |
| corpusHash | PASS |
| fixtureHash | PASS |
| baselineGuidanceHash | PASS |
| candidateContentHash | PASS |
| candidateRenderedContextHash | PASS |
| defaultMessagesByteIdentity | PASS |
| candidateOnlyGuidanceDiffers | PASS |
| providerRequestConfig | PASS |
| noProductionExperimentImports | PASS |
| productionRendererOptionAbsent | PASS |
| secretRedaction | PASS |

## Decision

PR1D zero-call implementation preflight: **PASSED**. Request architecture/product review for canonical Provider-call authorization. Until that authorization is explicit, the 180-run real-provider experiment remains blocked and production control/PR2 remain unauthorized.
