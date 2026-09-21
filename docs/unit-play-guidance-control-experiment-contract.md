# Unit Play Guidance Control Experiment Contract — PR1C-Contract

Status: **contract approved; isolated/offline implementation completed for product review**. The contract itself did not authorize implementation; a later separate product approval authorized only the bounded PR1C harness described here. Neither approval authorizes a feature flag, production Prompt/ReAct injection, production rollout, or any runtime behavior change.

PR1A proved that `unit_play_guidance` can be selected and projected in telemetry without changing production behavior. PR1B and PR1B.5 closed the separate MetaTFT probe POC. Product review then selected an isolated/offline `unit_play_guidance` control experiment as the next priority, approved this PR1C-Contract with four methodology amendments, and separately authorized the bounded offline implementation after those amendments were incorporated.

## 1. Experiment question

The experiment may answer one question only:

> Can TaskFrame-selected `unit_play_guidance` professional guidance replace the existing hard-coded unit-play semantic guidance without weakening routing safety, Tool/Evidence policy, grounding, fallback reliability, latency budgets, or professional facet coverage?

It must not answer whether Skills should control other goals, whether MetaTFT guide data should be productized, or whether a general Skill Router should exist.

## 2. A/B boundary

### A — version-pinned production baseline

The existing eligible broad-unit-play behavior owned by `semanticAdvisory` and `semanticGuidance()` at the experiment's frozen baseline revision.

### B — isolated future candidate

The same request and runtime with the eligible `unit_play_guidance` SkillContext as the sole source of professional unit-play guidance.

Candidate B must replace the relevant hard-coded guidance for the assigned run. It must never double-inject:

```text
semanticAdvisory + semanticGuidance + SkillContext + Skill instructions
```

The experiment variable is the professional guidance source. A and B must share:

- the exact raw user request and message history;
- the same resolved `task-frame.v1` object and parse Promise;
- runtime version, season context, Tool Registry, handler availability, Tool Catalog and Tool policy;
- Evidence contracts, freshness/temporal policy, grounding validators and finish validators;
- server-scoped arguments, permissions, approval policy and side-effect policy;
- run deadline, decision/Tool budgets and deterministic `nextActionAffordance` priority.

Assignment must be deterministic, observable and external to model reasoning. No LLM may select the arm.

The A/B fork exists only inside a dedicated offline experiment harness. Both arms use the same ReAct implementation, version and configuration after the fork, but every mutable execution object is arm-local. No production request handler may read the assignment, SkillContext, Skill instructions, or candidate result. The experiment must not create a third runtime.

The injection boundary is:

```text
same raw request + history
  -> one deterministic parse Promise
  -> one resolved TaskFrame
  -> deterministic eligibility and arm assignment
     -> A: version-pinned semantic guidance
     -> B: version-pinned unit_play_guidance Skill content
  -> same ReAct Runtime / Tool policy / Evidence rules / budgets
```

### Methodology amendments required before implementation

The canonical offline run is a **paired evaluation**: every eligible frozen case runs A and B from the same immutable pre-fork input. Deterministic split assignment may remain a harness capability, but the PR1C value report must not use a split population.

Arms may share immutable inputs only: parsed TaskFrame, registry snapshot, Tool definitions, runtime configuration and frozen Tool observations. They must not share WorkingState, EvidenceLedger, DuplicateCallGuard, termination state, SkillProgress, telemetry, conversation writes, temporary cache mutations or any other mutable execution state. Same Tool plus arguments must replay the same frozen Observation in both arms. Fallback starts A from a clean pre-fork snapshot, never from B's mutated state.

The experiment reports candidate results twice:

- **B-native** — candidate completion before any fallback; all Evidence/Answer/value gates use this view;
- **B-end-to-end** — final result after fallback; reported only as the safety and user-impact view.

Normal frozen-corpus runs require unforced fallback rate `0`. Fault-injection runs separately require fallback to pinned A at `100%`.

## 3. Pilot population

Candidate eligibility requires all of:

```text
taskFrame.schemaVersion = task-frame.v1
domain = tft
action = recommend
goal = recommend_unit_play
expectedOutput contains unit_play_guidance
exactly one resolved champion
understandingStatus = understood_and_supported
no result-affecting or Tool-selection-affecting ambiguity
```

Exclusions win over eligibility. The following remain no-Skill/control-ineligible:

- equipment lookup or unit-build rankings;
- item/statistical comparison;
- composition ranking or a single composition lookup;
- positioning-only query;
- augment-only query;
- video/guide search;
- multi-entity, unresolved, unsupported or ambiguous TaskFrame;
- Quick Task and every stable parameterized query.

The Matcher consumes only the existing TaskFrame. Raw-text parsing, regex routing and an LLM Skill Router remain forbidden.

## 4. Fallback contract

Any future candidate failure returns to the version-pinned A behavior for that request:

- Skill subsystem unavailable or statically invalid;
- no deterministic selection or selection disagreement;
- SkillContext/Progress/Completion projection failure;
- Prompt/context construction failure;
- runtime exception or candidate budget exhaustion;
- grounding, finish or safety validator rejection.

Fallback must not produce a generic answer, broaden the Tool Catalog, retry through a third runtime, or silently switch to another Skill. Disabling the future candidate must require no data migration.

Static contract failure is fail-visible at subsystem level. Request-time candidate failure is fail-open to A and must emit a stable reason code.

## 5. Candidate Skill content

PR1C may be the first implementation to author complete `unit_play_guidance` Skill content, but only for candidate B in the isolated harness. The content must be version-pinned before results are inspected and must preserve the registered facet contract:

- `unit_role` — explain the resolved champion's role before recommendations, using official/mechanism Evidence where available;
- `equipment_logic` — explain why supported items fit the role and distinguish current statistical observations from mechanism reasoning;
- `composition_context` — explain the supported lineup context without turning composition membership into a carry/tank claim;
- `positioning` — `required_if_supported`: cover it when validated/observed Evidence already exists or an existing permitted Tool can reliably obtain it; otherwise mark it unsupported, allow qualified completion and never invent it;
- `when_to_play` — optional; state only Evidence-supported conditions and never invent tempo, opener, augment, or economy requirements.

Candidate instructions must additionally require:

- current facts, source recommendations, mechanism knowledge, heuristics, and inference remain visibly distinguishable;
- unavailable facets are qualified instead of fabricated;
- historical Evidence is never described as current;
- source recommendation membership is not promoted into a statistical ranking or causal claim;
- professional guidance cannot add Tool permissions, fixed Tool arguments, Tool order, budgets, finish authority, or approval authority.

The frozen candidate Skill definition, rendered candidate context, and content hash must be recorded per experiment run. No candidate content may be persisted into conversation state.

## 6. Facet measurement

Evidence coverage and answer coverage are separate evaluation layers.

### Evidence Facet Coverage

Computed only from Evidence already accepted by existing validators and claim-use policy:

- `unit_role` — required by the registered Skill definition;
- `equipment_logic` — required;
- `composition_context` — required;
- `positioning` — conditional-required (`required_if_supported` in the experiment rubric; the shared registry schema remains unchanged in PR1C);
- `when_to_play` — optional but measured.

SkillProgress may consume Evidence-usability results. It must not revalidate source, freshness, temporal status, grounding, or claim legitimacy.

### Answer Facet Coverage

Evaluated outside CompletionValidation with a frozen rubric. It asks whether the final user-facing answer clearly communicates each supported facet and appropriately qualifies unavailable facets.

Primary gating labels must come from deterministic rubric checks and/or blinded human review. Model self-evaluation may be reported only as a supplemental metric and cannot be the sole promotion gate.

Missing Evidence must never be converted into invented answer coverage.

## 7. Tool-call invariants

A and B are not required to have identical Tool-call sequences. Candidate B may make a reasonable additional call only when all of these are recorded:

```text
missing required facet
  -> existing permitted Tool capability
  -> validated new Evidence
  -> newly covered facet
```

Every arm must preserve:

- Tool Catalog expansion: zero;
- unauthorized or unregistered Tool calls: zero;
- unsupported Tool calls: zero;
- server-scoped argument violations: zero;
- duplicate deterministic calls: zero;
- Tool calls exceeding existing budgets: zero;
- Skill-authored Tool arguments or fixed Tool sequences: zero;
- overrides of deterministic `nextActionAffordance`: zero.

SkillContext may describe the intersection of Skill-allowed and runtime-available Tools. It may not rank Tools, select a best Tool, or plan the next call.

## 8. Pre-control evaluation gates

These gates must pass before a separate request to enable any candidate control behavior.

### Frozen offline corpus

- at least 30 positive broad-unit-play cases across Chinese, English and supported conversation forms;
- at least 20 required negative-boundary cases covering every exclusion category;
- at least 10 ambiguity, deictic-reference, unresolved-entity, or conversation-context boundary cases;
- canonical offline mode runs every eligible case as paired A/B from isolated pre-fork snapshots;
- identical TaskFrame/Registry inputs produce byte-identical Skill selection/context projections;
- all cases are versioned under `eval/skills/` before candidate results are inspected.

### Routing and safety — zero tolerance

- negative false takeover: 0;
- unsupported or ambiguous takeover: 0;
- LLM router calls: 0;
- second TaskFrame parses: 0;
- unauthorized/unsupported Tool calls: 0;
- Evidence grounding violations: 0;
- historical-as-current violations: 0;
- invented numeric statistics: 0;
- server-scoped argument violations: 0;
- duplicate deterministic Tool calls: 0.

### Fallback

- injected candidate failure fallback success: 100%;
- fallback target differs from version-pinned A: 0;
- candidate failure causing request failure when A can answer: 0.
- unforced fallback in the normal frozen corpus: 0.

### Effect and non-degradation

- required Evidence Facet Coverage for B-native is greater than or equal to A;
- required Answer Facet Coverage for B-native is greater than or equal to A;
- grounding, safety, clarification correctness and fallback rate do not regress;
- any additional B Tool call is attributable to a newly covered required facet;
- optional/total Answer Facet Coverage for B-native improves by at least 10 percentage points, **or** B-native missing-required-facet rate decreases by at least 20% relative to A.

Required Evidence and Answer coverage are non-degradation gates. The numeric value gate above is not a generic answer-quality score: it is computed only from the frozen facet rubric with per-facet numerators, denominators and failures reported. Candidate text that merely restyles A without measurable facet value fails promotion.

### Runtime reporting

Report A, B-native and B-end-to-end distributions for Tool calls, decisions, latency, context bytes/tokens, model calls, completion status and fallback reasons. Both arms remain within existing runtime budgets. Before candidate results are unblinded, freeze these additional non-regression thresholds:

- mean Tool calls for B `<= A + 0.5`;
- p95 Tool calls for B `<= A + 1`;
- mean end-to-end latency for B `<= A × 1.20`;
- mean input plus output tokens for B `<= A × 1.20`;
- model calls added for Skill routing or completion judgment: `0`.

If the candidate later demonstrates material value, changing a cost threshold requires a new contract review; results cannot retroactively move the gate.

## 9. Promotion and rollback

Passing offline gates authorizes only a new architecture review request. It does not authorize production rollout or a production canary.

A future controlled run requires a separately approved, reversible allowlist and must start with a bounded cohort. Immediate rollback to A is required for:

- any zero-tolerance routing, permission, Tool, Evidence, temporal or grounding violation;
- fallback success below 100%;
- Prompt/context leakage outside the eligible population;
- a new model call used for routing or completion judgment;
- an unexplained Tool-call increase or budget breach;
- loss of deterministic `nextActionAffordance` priority;
- inability to disable candidate behavior without migration.

Rollback must preserve telemetry and stable reason codes without retaining candidate instructions in conversation state.

## 10. PR1C-Contract Definition of Done

This docs-only PR is complete when:

- this contract freezes population, A/B boundary, fallback, facet metrics, Tool/safety invariants, promotion gates and rollback conditions;
- this contract freezes candidate Skill content, the isolated injection boundary, the 30/20/10 corpus minimums, value gates and cost gates;
- paired A/B, arm-local mutable state, clean pre-fork fallback, B-native gating, B-end-to-end reporting and conditional positioning are explicit;
- production code changes are zero;
- feature-flag behavior changes are zero;
- production Prompt, ReAct and Tool Catalog changes are zero;
- runtime behavior changes are zero;
- added Tool or model calls are zero;
- no control implementation, production rollout, production canary, PR2 data implementation, DB, scheduler, Manual Overlay or Effective View is included.

## 11. Explicit non-authorization

This contract does not approve:

- `AGENT_SKILLS_CONTROL_V1` or any equivalent flag;
- SkillContext/Skill instructions in the ReAct decision input or Prompt;
- replacement or removal of existing semantic guidance;
- Skill-driven Tool scoping, planning, finish blocking, permissions or budgets;
- production A/B assignment or rollout;
- production canary;
- PR2, a production MetaTFT data pipeline, database change, scheduler, daily snapshot change, Manual Overlay, Effective View or new Tool;
- any Skill beyond `unit_play_guidance`.

After PR1C-Contract approval, the next separately scoped engineering proposal is an isolated/offline PR1C experiment. It may let `unit_play_guidance` affect candidate B inside the harness only. It must return for architecture review before any production canary or before reconsidering PR2 priority.

## 12. Separately authorized implementation record

The subsequent implementation approval was limited to the dedicated experiment harness, version-pinned candidate content, frozen `eval/skills/` corpus and observations, runner, tests and report. The completed result is recorded in `docs/unit-play-guidance-control-experiment-report.md`.

No production request handler imports the experiment. Production semantic guidance, ReAct prompts, Tool Catalog, permissions, budgets, conversation persistence and feature flags remain unchanged. Passing the offline gates is evidence for architecture/product review only and does not authorize control mode or rollout.

The deterministic PR1C result is qualified accordingly: it validates the isolated harness and deterministic guidance-value replay, not real-model compliance, output stability, actual provider tokens/latency, or production-control suitability. Those claims remain untested and require separate approval.
