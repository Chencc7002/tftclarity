# R1 Progress-Based Safety Acceptance

Date: 2026-08-07 (Asia/Shanghai)

## Decision

`R1 Progress-Based ReAct Safety Contract — PASS`

The production ReAct path no longer treats tool-call count as a completion
budget. The legacy `AgentRuntime` default remains unchanged and is a separate
lifecycle contract.

## Effective ReAct safety contract

- `maxToolCalls: null` for every `/api/react-chat/stream` run.
- `maxDecisions: 24` as a last-resort `runaway_loop_fuse` only.
- `maxConsecutiveNoProgress: 3`.
- Wall-clock deadline and per-tool timeout remain hard limits.
- Canonical duplicate calls are blocked before execution.
- The same capability is stopped after two consecutive failures without
  progress; three consecutive tool failures open the global circuit.
- Unknown tools and invalid arguments remain hard rejected.
- Safety termination returns a visible limitation and preserves safe partial
  evidence instead of returning a generic agent failure.
- `safetyMetrics` records actual calls, unique fingerprints, blocked duplicates,
  decisions, progress decisions, maximum no-progress streak, and failures.

## Evidence

The real composition-oriented HTTP query previously terminated after:

```text
entity_catalog_query -> entity_catalog_query -> unit_builds_batch
-> tool_budget_exhausted
```

After the change it completed through:

```text
entity_catalog_query -> entity_catalog_query -> unit_builds_batch
-> item_details_batch -> finish
```

Observed metrics:

```json
{
  "actualToolCalls": 4,
  "uniqueToolFingerprints": 4,
  "duplicateCallsBlocked": 0,
  "decisions": 5,
  "progressDecisions": 3,
  "maxConsecutiveNoProgress": 1,
  "toolFailures": 0
}
```

Focused automated suites passed (42/42, then 69/69 after the visible-answer
safeguard). The full concurrent suite was not clean: 1081 passed, 14 skipped,
and 2 failed because of an old 10-second timeout and a shared JSON-cache read
race. The two affected files passed 20/20 when rerun separately. This does not
invalidate the focused safety acceptance, but it remains release-gate work.

## Browser combination matrix

| Area | Safe degradation | Full capability |
| --- | --- | --- |
| Composition | PASS | BLOCKED |
| Composition + unit | PASS | BLOCKED |
| Composition + item | PASS | BLOCKED |
| Conditional item recalculation | PASS | BLOCKED |

The stable build and two alternatives render from real evidence. Unsupported
entity replacement, item priority, and conditional allocation are disclosed or
clarified and are not fabricated.

Open capability gaps remain:

- G0: complete claim-level grounding for every final-answer type.
- G1: composition entity resolution and composition evidence.
- G2: composition member-role evidence.
- G3: deterministic replacement and trait-breakpoint analysis.
- G4: composition-aware item allocation.
- G5: conditional item ownership/exclusion/recalculation.

The reproduced G0 leak was mitigated: when a grounded build narrative is
rejected, its raw top-level model prose is no longer rendered. The UI now shows
a deterministic evidence-safe summary and preserves the build cards. A full
cross-domain `GroundedAnswer` claim contract is still future work.
