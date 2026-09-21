# Unit Play Guidance PR1D Recovery Contract

Status: **Historical recovery contract. Attempt-02 executed and is archived as INCONCLUSIVE / NOT PASSED; only zero-call finalization is authorized.**

Archive note: the paid-call restriction below records the pre-attempt authorization
gate that was in force when this contract was written. A subsequent narrow review
authorized attempt-02 from commit
`ce0f710c6720df8d8f186ba4f940c3ae851eb9b5`. The attempt completed all 180
planned run records but failed both analyzability gates because Provider execution
yielded only `17/90` valid pairs and `6/30` cases with at least two valid pairs.
The immutable attempt evidence and final disposition are recorded in
`unit-play-guidance-real-provider-final-acceptance-report.md`. No attempt-03,
PR2, production control, canary, or rollout is authorized by this update.

This recovery contract amends only the execution controls of
`unit-play-guidance-real-provider-offline-acceptance-contract.md`. The frozen
corpus, Tool observations, A guidance, B candidate content, rendered context,
rubric, Provider/model/config, pair order, value gates, cost-ratio gates, and
production non-authorization remain unchanged.

## Attempt-01 disposition

`canonical-eb6ba94-01` is immutable and is classified on two axes:

- overall acceptance: `FAIL` because actual usage reached `4,004,504` against
  a `4,000,000` hard cap before the response-after accounting fuse stopped;
- secondary analysis: `INCONCLUSIVE` with `42/90` valid paired repetitions and
  `14/30` cases having at least two valid pairs.

The two `inventedNumericStatistics` machine flags are diagnostic false
positives caused by treating the Evidence-derived identifier `TFT18_Jinx` as a
numeric claim. Confirmed invented numeric/statistical claims in attempt-01 are
zero. The broad lexical auditor and its missing immediate-abort wiring are
nevertheless recovery defects. Attempt-01 artifacts may be used for
postmortem diagnostics only and must never be recalculated into canonical PASS
evidence.

Attempt-01 result provenance:

- implementation commit: `eb6ba94aa9d978679d54013de112b1e586e2fdd7`;
- result SHA-256: `7cbbfdc05290ac8b356e455cbc8567a77561e704f451ac8f5e41627a04718bb7`;
- Provider HTTP requests: `695`;
- maximum observed per-request token usage: `7,352`;
- attempt-01 samples imported into attempt-02 acceptance: `0`.

## Recovery execution identity

Attempt-02 is a fresh canonical execution:

- `30 cases × 2 arms × 3 repetitions = 180` new Agent runs;
- prior checkpoint continuation and cross-attempt sample merging are forbidden;
- pair order remains
  `94dbd2bd32461e996b36ed28265b0a5baba76af7694ce02dd52fba441fdc826a`;
- pair concurrency remains `1`;
- actual-token hard cap is `10,000,000`;
- Provider HTTP hard cap is `1,800`;
- Provider identity establishes a new baseline from the first successful
  attempt-02 response and preserves the existing drift rule.

The cap change must be disclosed as empirical recovery after attempt-01
capacity exhaustion. It does not change a value, safety, stability, or cost
ratio gate.

## Numeric/statistical claim audit

The authoritative zero-tolerance signal is Evidence-aware. Existing
grounding/termination diagnostics and deterministic comparison with cited
Evidence determine whether a numeric/statistical claim is unsupported.
Identifiers, set labels, item IDs, Evidence IDs, and URLs are advisory lexical
signals only.

The zero-call regression matrix must prove:

- `TFT18_Jinx`, `S18`, `item_123`, `evidence-42`, and a URL do not produce a
  numeric-statistical violation;
- Evidence-supported `52,886 场` does not produce a violation;
- unsupported `胜率 60%` produces a violation;
- when an identifier and a real unsupported statistic coexist, only the claim
  is authoritative;
- a confirmed violation aborts before the paired arm or any later run begins.

## Pre-dispatch token reservation

Every initial and repair request is independently reserved before HTTP
dispatch. For an exact serialized outbound body:

```text
reservedTokens = UTF8ByteLength(serializedBody)
               + request.max_tokens
               + 8192 protocol safety margin
```

The UTF-8 byte length is a conservative input-token bound. The fixed margin
covers Provider-side chat framing and exceeds the attempt-01 maximum observed
complete-request usage even before request bytes and output allowance are
added. Attempt averages are not used.

Dispatch is allowed only when:

```text
actualUsed + reservedTokens <= 10,000,000
providerHttpRequests + 1 <= 1,800
```

If either condition fails, the HTTP function must not be called. A response
whose actual usage exceeds its reservation is an execution-control failure and
immediately terminates the attempt. Missing usage remains reported and cannot
be silently estimated.

## Authorization gates

Recovery implementation and zero-call preflight are authorized. Paid
attempt-02 calls require a subsequent narrow review of:

- recovery implementation commit SHA;
- zero-call preflight artifact SHA;
- all frozen hashes and the unchanged pair-order hash;
- numeric-auditor and immediate-abort regression results;
- initial/repair near-cap simulations with zero HTTP dispatch;
- `10,000,000` token, `1,800` HTTP, concurrency `1` manifest;
- a fresh 180-run declaration with zero imported attempt-01 samples;
- secret scan showing no persisted credential or Authorization header.

Until that review explicitly authorizes calls, the canonical runner requires
both recovery CLI gates and both environment authorization gates and must not
be executed. Production Skill control, canary, rollout, PR2, live retrieval,
new Tools, other Skills, conversation writes, database changes, and scheduler
changes remain unauthorized.
