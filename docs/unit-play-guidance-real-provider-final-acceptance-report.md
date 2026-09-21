# Unit Play Guidance PR1D Final Acceptance Report

Status: **CLOSED AS INCONCLUSIVE / NOT PASSED after the zero-call finalization fix.**

This report is the qualified archive disposition for the two canonical PR1D
real-provider attempts. It does not alter either attempt's raw artifacts and
does not authorize another paid attempt, PR2, production Skill control, canary,
rollout, database or scheduler work, new Tools, or other Skills.

## Final classification

| Field | Result |
| --- | --- |
| Attempt status | `inconclusive` |
| Acceptance | `not_passed` |
| Reason | `insufficient_valid_provider_pairs` |
| Safety / architecture | `passed` for the observed attempt-02 execution |
| Analyzability | `failed` |
| Value | `not_evaluated` |
| Stability | `not_evaluated` |
| Cost acceptance | `not_evaluated` |
| Facet adjudication required | `false` |

The result is not a Candidate safety failure and is not a pass with
limitations. The frozen minimums were `81/90` valid paired repetitions and
`27/30` cases with at least two valid pairs. Attempt-02 produced only `17/90`
and `6/30`, so the acceptance pipeline stops before facet adjudication, Value,
Stability, and Cost Acceptance.

## Attempt archive

| Attempt | Disposition | Evidence use |
| --- | --- | --- |
| `canonical-eb6ba94-01` | `FAIL` — execution hard-cap enforcement defect; secondary analysis inconclusive | Immutable postmortem only |
| `canonical-ce0f710-02` | `INCONCLUSIVE / NOT PASSED` — insufficient normal Provider completions | Immutable PR1D archive; not promotion evidence |

Attempt-02 ran from clean detached commit
`ce0f710c6720df8d8f186ba4f940c3ae851eb9b5`, completed all `180/180` planned
Agent run records in `90/90` complete A/B pair groups, used the frozen pair-order
hash `94dbd2bd32461e996b36ed28265b0a5baba76af7694ce02dd52fba441fdc826a`,
and imported zero samples from attempt-01.

## Attempt-02 execution evidence

- Normal Provider completions: A `17/90`, B `17/90`; completion parity passed.
- Failed runs: `146/180`, all with `decision_provider_failed`.
- Persisted Provider errors: `145` `fetch failed`, `1` decision timeout.
- Candidate Skill failures: `0`.
- Provider HTTP requests: `406/1,800`.
- Provider-reported tokens: `1,500,789/10,000,000`.
- Pre-dispatch blocked requests: `0`; reservation underflows: `0`; fuse not exhausted.
- Provider identity: `260` observations with baseline
  `deepseek-v4-flash` / `a26a7955944dc5c60445bff77fac9c8e`; no drift.
- All aggregated zero-tolerance counters were `0`: unauthorized or unsupported
  Tool calls, server-scope violations, historical-as-current use, grounding
  violations, invented numeric statistics, duplicate deterministic calls,
  `nextActionAffordance` priority violations, and budget overruns.

The evidence supports only the narrow statement that the current execution
environment and Provider transport conditions did not yield enough normal
completions. It does not establish a more specific network or Provider root
cause, and the symmetric A/B completion counts do not support attributing the
transport failures to the Candidate Skill.

## Immutable attempt-02 artifact hashes

| Artifact | SHA-256 |
| --- | --- |
| `authorization-manifest.v1.json` | `6bc42125a0e06eed70a9c1c3d12f8d70f8422d1a31771b08878cad55be0bf6b1` |
| `checkpoint.jsonl` | `cd9b8f12d3f4281098c6ba50a4405297ad1af64a5dfe5494c819dfbecbf8b757` |
| `canonical-result.v1.json` | `3d109147da4d4cfa83ddfd05504a85f27e7459789e7e3b73b081e346f0710cc6` |
| `canonical-report.md` | `315f6938d1f4db035346036c88316f258c81a28e6846ad8c5300c7280b0dbdf6` |
| `facet-label-packet.blinded.v1.json` | `4c24c0097fee6ade3dba89925b1edfa428bf7820503d0f051c4ba4ed544e5521` |
| `facet-label-key.v1.json` | `b34920512f6c70a8f48124804ad67e8d44aefa434d8ad01dc68c4d1dbb2968c8` |

The original result and report retain their pre-finalization
`awaiting_facet_adjudication` text. They remain immutable evidence of the
status-mapping defect. This final report supplies the corrected archive
classification without rewriting those artifacts. The blinded packet and key
are retained but must not be adjudicated for PR1D acceptance.

## What is and is not established

Established within the declared offline boundary:

- deterministic harness isolation and frozen input identity;
- recovery token reservation and global fuse behavior;
- no observed Provider identity drift;
- no confirmed zero-tolerance violation in attempt-02.

Not established:

- real-model Candidate value;
- real-model Candidate stability;
- real-model cost acceptance;
- production-control suitability.

## Zero-call finalization verification

Verification on 2026-08-30 used workspace Node 24 against the current working
tree (base commit `5e36453`, including unrelated user changes that are not part
of the finalization commit):

- Canonical/preflight focused tests: `19 passed`, `0 failed`.
- Agent/TaskFrame/ReAct/Conversation/Skills focused suites: `211 passed`, `0 failed`.
- Canonical main CI lane: `1,173 passed`, `0 failed`, `7 skipped`.
- Canonical integration CI lane: `232 passed`, `0 failed`, `1 skipped`.
- Agent offline evaluation: `50/50 passed`.
- Read-only finalization of the original attempt-02 result: `inconclusive`,
  `not_passed`, `facetAdjudicationRequired=false`; Value, Stability, and Cost
  Acceptance all `not_evaluated`.
- All six artifact SHA-256 values above matched before and after finalization;
  all `180` run records and `146` Provider failures remained intact.
- Finalization HTTP calls: `0`. No canonical paid runner or facet adjudicator
  was executed. No original result, checkpoint, packet, or report was rewritten.

Tests additionally cover either analyzability gate failing independently,
missing gates failing closed, hard-failure precedence, preservation of an entire
180-run fake transport-failure population, and stale derived metadata being
unable to override the gate facts in rendered reports.

## Closure boundary

Attempt-03 is not authorized. Any future real-provider experiment requires a
new reviewed contract that explains the attempt-02 Provider execution failures
and freezes materially changed, auditable execution conditions. PR2 and every
production-control path remain separately gated and unauthorized.
