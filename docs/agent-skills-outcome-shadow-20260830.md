# Skills finished-run shadow — 2026-08-30

Status: implemented, shadow only; validation results below. Continues the core
contracts in `agent-skills-core-convergence-20260830.md`. No production Skill
control, paid Provider experiment, or guide ingestion is enabled by this change.

Content follow-up: `agent-skills-tool-guidance-20260830.md` records the user's
explicit retrieval requirements in Skill 1.2.0. The adapter also accepts that
version because its facet/data contracts are unchanged; this report records the
original 1.1.0 outcome-observer implementation and verification.

## Integration and rollback

The existing default-off `AGENT_SKILLS_SHADOW_V1` flag gates both observations.
The initial `agent-skill-shadow.v1` event is unchanged. Its selected Skill,
TaskFrame and runtime tool intersection are reused for one
`agent-skill-outcome-shadow.v1` event after ReAct finishes. The new event is emitted
after the legacy equipment summary and answer persistence, so it observes the
delivered answer rather than a superseded model conclusion. A failed request is
also observed without exposing the raw error. `success` describes the observer;
the separate allowlisted `runStatus` describes the run.

The domain adapter is `src/domain/tft/unit-play-skill-evidence.js`, version
`unit-play-evidence-shadow.v1`, pinned to Skill `unit_play_guidance@1.1.0`.
The application owns invocation and current request scope. It projects the
finished run's existing EvidenceLedger snapshot and ToolResult observations;
it never retrieves data, registers tools, or feeds instructions to the model.

Quick Task, ReAct decisions, strict schemas, server arguments, approvals, budgets,
finish validation, grounding and Conversation Bridge retain their existing paths.
The new observation cannot rescue unavailable tools or authorize completion.
Observer exceptions/rejections fail open; the finished request does not await an
observer Promise. Turning the existing flag off removes both observations and
their additional parsing. No new control flag or runtime is introduced.

## Production fields and limits

| Input | What the adapter can establish | What it cannot establish |
| --- | --- | --- |
| `comps_rankings`: `composition-resolution.v1`, resolved/unfiltered results, explicit target membership | Source composition membership and other named members for `composition_context` | Main carry/tank role, strength explanation or causality |
| `composition_tactical_details`: available formation with board coordinates | Literal source positioning for the target, linked to a current accepted composition query plan | Generic optimal positioning, historical-patch guide validity or invented missing units |
| `unit_builds`: matching unit/query and nonempty item cards with positive games | Equipment statistics were observed; source availability becomes available | `equipment_logic` coverage merely because statistics exist |
| Current `semantic_search` hits | Diagnostic that authoritative champion/facet bindings are absent | Role or timing inferred from keywords in free text |
| Current `entity_catalog_query` unit projection | Existing runtime entity grounding remains intact | Role inferred from identity, cost or traits |

Before mapping, each entry must match a registered permitted tool, its Evidence
contract, a validated Ledger entry, and a completed valid observation with the
same tool/call/Evidence IDs. Explicit season and patch scope, source timestamps,
cache expiry and historical/stale markers are checked. Epoch milliseconds from
MetaTFT and ISO timestamps are both recognized; missing or future times are not
fresh. The app supplies its existing 30-minute statistics and default 5-minute
tactical freshness windows. These are conservative shadow policies, not a change
to production finish validation.

Tactical evidence must match the exact server-authored composition ID, cluster,
season and complete roster. Its own formation source timestamp and endpoint are
required. Board coordinates must agree with the source cell. The current-pointer
guide is linked to current accepted rankings; it is not relabeled as a
patch-pinned guide. Partial/ambiguous/unrelated results do not supply coverage.

Only positive mapped observations mark dependencies available. Unqueried tools
remain unknown; transient failures remain unknown/source_failed; stale data stays
recoverable missing. Empty results alone do not prove source exhaustion or field
unavailability. Runtime-blocked tools remain unavailable.

Processing selects at most 64 Ledger entries, 128 observations, 20 composition
rows per entry and 12 formation units; entries exceeding 256 KiB serialized size
are rejected. Oversized/truncated inputs cannot manufacture completion. Telemetry
contains only bounded IDs from contracts, counts, statuses and fixed reason codes;
no user text, answers, names, raw errors, source sentences or snapshots are emitted.

## Answer observation is deliberately incomplete

`coveredFacets` describes supporting source facts, not delivered answer quality.
`equipmentStatisticsObserved` separately records retrieval success.
`answerCoverage` uses `exact_source_statements_lower_bound`: it looks for complete
Chinese/English canonical source sentences and citations to their actual Evidence.
It does not use keyword hits, model-provided labels or entity co-occurrence.

`verifiedFacets` in this mode means an exact cited source statement was found.
It is not whole-answer semantic validation: paraphrases, surrounding discourse,
retractions, role explanations and causal equipment explanations remain outside
this matcher. `completionEvaluated` is always false. No strict
`validateSkillCompletion` call or finish approval is derived from this projection.

With the unchanged legacy broad-unit-play tool scope, the end observation normally
sees equipment statistics only. Composition and positioning mapping is tested
offline against existing production adapters; this work does not widen the live
tool set to collect them.

## Verification

The new offline fixtures run the production composition rankings adapter, tactical
detail handler, semantic handler, ToolRegistry and EvidenceLedger. MetaTFT data is
supplied by existing saved fixtures and injected source responses; no live fetch
or paid model call is involved. Source time is explicitly advanced in the fixture.

New coverage includes scope/freshness rejection, historical Evidence, missing
source timestamps, stale inner timestamps, roster/cluster/position mismatches,
empty/failing sources, Chinese/English citations, negations and unrelated text.
End-to-end request comparisons exercise real entity grounding before unit builds,
not a bypass of production validation. Random Ledger IDs are normalized only in
cross-run test comparisons. Observer ordering, privacy, failures, unavailable
tools, version drift and unchanged prompt/stream/persistence behavior are checked.

Validation used bundled Node 24.19.0 (the default shell Node 18 is below the
repository requirement), against the existing dirty working tree without
reverting or modifying unrelated work:

| Check | Result |
| --- | --- |
| New production-shape adapter and end-observer tests | 18 passed |
| Focused Agent/Skills/experiment/probe suites | 306 passed |
| Canonical main CI lane | 1,260 passed, 0 failed, 7 skipped |
| Canonical integration CI lane | 232 passed, 0 failed, 1 skipped |
| Agent offline evaluation | 50/50 passed |
| Diff whitespace check | Passed |

The CI runner selects exactly the repository's documented main/integration lanes.
JUnit reports: `.cache/eval/skills-outcome-focused.xml`,
`.cache/eval/skills-outcome-main.xml`, and
`.cache/eval/skills-outcome-integration.xml`. Agent reports are under
`.cache/eval/agent-eval.*`. Frozen experiment replay and zero-call preflight remain
in the passing focused/main suites. No archived Provider acceptance data changed.

## Still required before a control proposal

1. A maintained role/mechanism and equipment-explanation data contract. Current
   free semantic hits and statistics do not supply these facets. Extend actual
   Tool/data contracts through review rather than introducing fixture-only tags.
2. An audited answer-facet semantic assessor and composition with the existing
   finish/grounding validators. Exact source sentences are only an observation
   subset; a general user answer is not declared complete by this work.
3. A newly versioned representative replay/candidate, then review of Provider
   conditions and costs before any new real-model run. The archived PR1D result
   remains inconclusive/not_passed; its frozen files and gates are unchanged.
4. Separate approval for production Control, canary rollout, guide productization
   or other Skills. No transition/game-state/timeline Skill is added here.
