# Agent Skills Architecture Contract — PR0

Status: frozen design contract for PR1A/PR1B. PR0 adds no runtime module, feature flag, route, prompt, tool, data source, or production behavior. PR1A, PR1B/PR1B.5, and the deterministic PR1C experiment are now closed; their completion does not revise these contracts or authorize production Skill control.

The unit-play control boundary is frozen separately in `docs/unit-play-guidance-control-experiment-contract.md`, with the qualified deterministic result in `docs/unit-play-guidance-control-experiment-report.md`. The separately authorized next phase is currently limited to the docs-only `docs/unit-play-guidance-real-provider-offline-acceptance-contract.md`; it does not authorize a real-provider harness, real model calls, production control, or PR2.

The handoff in `docs/tftclarity-agent-skills-architecture-development-handoff-v2.md` is the product baseline. This document records what the repository actually does today and narrows the next implementation to that reality.

## 1. Audited production architecture

The repository has two production execution runtime families. Conversation Bridge can share bounded cross-turn context and Evidence between them, but it is not a runtime router, orchestrator, or third execution path. There is no linear TaskFrame-to-ReAct runtime.

### 1.1 Deterministic recommendation and Quick Task path

```text
request / Quick Task
  -> deterministic quick/static fast paths where eligible
  -> parser or ConversationState v2 / TurnDelta
  -> resolved task-frame.v1
  -> capability-match.v1
  -> execution-plan.v1
       single tool: deterministic_fast_path
       composite: controlled_planner
  -> ExecutionPlanExecutor
  -> ToolRegistry + ToolExecutor
  -> result policy
  -> evidence-validation.v2
  -> response and conversation persistence
```

Code ownership:

- `src/understanding/task-frame.js` owns the normalized intent contract; it never names a tool.
- `src/understanding/context-resolver.js`, `turn-interpreter.js`, and `context-reducer.js` form or complete the current task before execution.
- `src/understanding/capability-matcher.js` scores registered tool capabilities from TaskFrame fields.
- `src/agent/execution-plan.js` is the only active deterministic-path protocol that can name tools, complete arguments, dependencies, result policy, and Evidence contracts.
- `src/agent/execution-plan-executor.js` revalidates the plan, materializes dependency bindings, executes at most three registered steps, applies result policy, and validates final Evidence.
- `src/agent/tools/registry.js` and `definitions.js` derive a strict registered, read-only tool surface; unknown fields and unknown tools fail closed.
- `src/agent/tools/executor.js` enforces the registered source, strict input schema, timeout/cancellation/retry policy, and creates `agent_tool_result.v1` metadata.
- `src/agent/takeover-controller.js` retains semantic rollout/fallback trace logic for the recommendation path. A Skill must not replace it.

Quick Task is a product shortcut around open-ended interpretation, not a lesser form of Skill. Its stable parameterized operations stay deterministic.

### 1.2 Independent ReAct chat path

```text
/api/react-chat/stream
  -> normalize request
  -> optional deterministic TaskFrame parse for existing unit-play shadow/control
  -> Conversation Bridge context
  -> ChatAgent + AgentRuntime
  -> ReactLoop
  -> registered ToolRegistry / ToolExecutor
  -> EvidenceLedger
  -> deterministic action, workflow, finish and grounding validators
  -> answer or evidence-backed system fallback
```

Important current behavior:

- ReAct does not call Capability Matcher, ExecutionPlan, ExecutionPlanExecutor, or TakeoverController.
- TaskFrame is currently advisory to ReAct only for the narrow `recommend_unit_play` experiment.
- With unit-play control off, the legacy broad-play route rewrites the first turn to a scoped equipment query. With control on, the original request reaches normal ReAct with bounded `semanticAdvisory`.
- `ReactWorkingState` contains task anchor, bridge context, semantic advisory, transcript, observations and Evidence. It has no SkillContext or SkillProgress yet.
- The public tool catalog contains only registered tools that also have handlers for the run.
- `ReactLoop` validates every action and strict tool input before execution, blocks duplicate/no-progress loops, and contains deterministic prerequisite guards for several multi-tool workflows.
- A deterministic `nextActionAffordance`, when present, has priority over model-selected continuation. Skill guidance must never override it.
- `EvidenceLedger` accepts only completed, validated, non-empty ToolResults and deduplicates them by content fingerprint.
- Finish validation prevents missing, unrelated, historical, or semantic-only Evidence from supporting stronger current-statistical claims; safe system fallbacks preserve usable deterministic Evidence.

### 1.3 Conversation Bridge

Quick Task success is stored as a versioned terminal record plus an integrity-checked Evidence snapshot. ReAct receives a bounded, explicitly untrusted context view. Conversation Bridge owns only cross-turn and cross-execution-path context/Evidence transfer; it never chooses an execution runtime.

Only a dependent `continue` or `return_to_previous` turn may promote one valid snapshot, and only when the new input is not a current-statistics request. Promoted entries are marked `temporalStatus: "historical"`. They cannot expand tools, budgets, or permissions and cannot support current/latest claims.

The future SkillContext must reuse these entries through the existing EvidenceLedger. It must not create a parallel memory store or silently rerun the same still-valid, same-scope retrieval.

## 2. Document-to-code discrepancies

| Assumption in earlier docs or diagrams | Code reality and PR0 ruling |
| --- | --- |
| A single `TaskFrame -> Capability -> ReAct -> Tool` chain exists. | There are deterministic ExecutionPlan and independent ReAct paths. Skills must integrate with both boundaries without merging them or creating a third path. |
| ReAct is already TaskFrame-driven. | Only broad unit-play has deterministic TaskFrame shadow/control advisory. PR1A reuses that parse point for shadow matching; it does not make TaskFrame mandatory for all chat. |
| Broad unit play already produces complete guidance. | The default legacy first answer is intentionally equipment-scoped. The existing control experiment supplies the valid comparison baseline for `unit_play_guidance`. |
| Evidence Tier is already represented by tool `evidenceType`. | `evidenceType`, source and required fields exist; a cross-Skill A-E tier does not. Tier is an additional claim-use annotation, not a replacement for current validators. |
| Skill progress can reuse generic ReAct completion state. | ReAct has no facet progress object and has workflow-specific guards. PR1A must add a deterministic, read-only progress projection before any control integration. |
| Current architecture docs are uniformly current. | `agent-runtime-tools-evaluation.md` describes the older fixed stage-1 boundary; Phase 6.6, ReAct R1, ConversationState v2 and current code are authoritative for their respective paths. |
| MetaTFT guide fields are ready for production storage. | Current repository changes include daily snapshot work, but no audited two-patch normalized comp-guide product. PR1B must probe real payloads before schema/pipeline work. |

## 3. Normative Skill contracts

All contracts are plain serializable data. Unknown fields fail validation. Schema versions are exact. Definitions are immutable after registration. PR1A may implement these under `src/skills/`; PR0 does not.

### 3.1 SkillDefinition

```js
{
  schemaVersion: "agent-skill.v1",
  id: "unit_play_guidance",                 // stable snake_case identifier
  version: "1.0.0",                         // semantic version
  description: "...",

  triggers: {
    domains: ["tft"],
    actions: ["recommend"],
    goals: ["recommend_unit_play"],
    requiredEntityTypes: ["champion"],
    expectedOutputsAny: ["unit_play_guidance"]
  },
  exclusions: {
    goals: ["unit_build_rankings", "recommend_best_option"]
  },

  dataDependencies: [
    { id: "official_tft_entity_catalog", requirement: "required" },
    { id: "current_unit_build_statistics", requirement: "required" },
    { id: "current_composition_statistics", requirement: "optional" },
    { id: "current_composition_tactical_details", requirement: "optional" },
    { id: "mechanism_knowledge_index", requirement: "optional" }
  ],
  requiredCapabilities: ["unit_build_statistics"],
  optionalCapabilities: [
    "composition_positioning",
    "composition_augment_references"
  ],
  allowedTools: [
    "entity_catalog_query",
    "unit_builds",
    "comps_rankings",
    "composition_tactical_details",
    "semantic_search"
  ],

  facets: [
    { id: "unit_role", requirement: "required" },
    { id: "equipment_logic", requirement: "required" },
    { id: "composition_context", requirement: "required" },
    { id: "positioning", requirement: "required" },
    { id: "when_to_play", requirement: "optional" }
  ],
  evidencePolicy: {
    minimumTierByFacet: {},
    requireFreshForCurrentClaims: true,
    distinguishFactAdviceInference: true,
    neverTreatAbsenceAsNegativeEvidence: true
  },
  instructions: ["bounded professional method instructions"],
  completionPolicy: {
    allowQualifiedIncomplete: true,
    rejectRecoverableMissingRequiredFacets: true,
    neverInventMissingEvidence: true
  }
}
```

The sample above freezes the pilot boundary, not a production prompt. `equipment_decision_reasoning`, `comp_play_guidance`, and `augment_decision_reasoning` reserve IDs only in PR1A. They do not get definitions, tools, data adapters, or routes until their gates pass.

Validation requirements:

- unique ID and valid semantic version;
- known trigger enums and unique facet IDs;
- known canonical data dependency IDs;
- every allowed tool exists in ToolRegistry;
- required capabilities are provided by at least one allowed registered tool;
- completion policy cannot permit invented Evidence;
- a definition cannot grant a permission, source, tool, budget, side effect, or server-scoped argument.

### 3.2 SkillSelection

```js
{
  schemaVersion: "skill-selection.v1",
  status: "selected" | "none" | "ambiguous",
  mode: "deterministic",
  selected: null | {
    skillId: "unit_play_guidance",
    skillVersion: "1.0.0",
    score: 0,
    reasons: ["goal_match", "expected_output_match", "single_resolved_champion"]
  },
  alternatives: [],
  reasonCodes: [],
  semanticFallback: {
    eligible: false,
    invoked: false
  }
}
```

Matcher inputs are only the already-produced TaskFrame plus immutable registry metadata and feature options. It must not receive raw user text, parse intent again, or call an LLM router. V1 is deterministic. It returns `none` for narrow parameterized queries and defaults to no Skill on uncertainty. A future semantic fallback requires a separate evaluated flag and may suggest a Skill only; it may not name tools or arguments.

### 3.3 DataAvailability

```js
{
  schemaVersion: "skill-data-availability.v1",
  dependencyId: "current_unit_build_statistics",
  status: "available" | "unavailable" | "stale" | "unknown",
  reasonCode: "available_registered_tool" | "source_unavailable" | "freshness_failed" | "not_probed",
  observedAt: "ISO-8601 or null",
  sourceIds: []
}
```

This distinguishes an unsupported Skill from a supported Skill whose current data is unavailable. Availability is derived from registered runtime/data facts, never asserted by instructions.

### 3.4 SkillContext

```js
{
  schemaVersion: "skill-context.v1",
  skillId: "unit_play_guidance",
  skillVersion: "1.0.0",
  selection: { /* skill-selection.v1 selected summary */ },
  taskFrameSchemaVersion: "task-frame.v1",
  facets: [],
  evidencePolicy: {},
  instructions: [],
  dataAvailability: [],
  toolPolicy: {
    skillAllowedTools: [],
    runtimeAvailableTools: [],
    effectiveTools: []
  },
  completionPolicy: {}
}
```

`effectiveTools` is computed as:

```text
registered tools
intersection runtime tools with handlers
intersection Skill allowedTools
intersection existing permission / side-effect policy
```

The intersection can only remove access. An empty intersection yields unavailable/qualified completion or existing fallback; it never falls back to an unregistered tool. Only the selected Skill's bounded context is injected.

### 3.5 Evidence Tier and claim-use annotation

Existing `ToolResult`, EvidenceLedger validation, `evidenceType`, source, `updatedAt`, temporal status and final grounding validation remain authoritative. Skill Tier annotates how a specific Evidence item is used for a specific claim:

```js
{
  schemaVersion: "claim-evidence-use.v1",
  claimId: "answer-claim-1",
  evidenceId: "existing-ledger-id",
  tier: "A" | "B" | "C" | "D" | "E",
  claimKind: "current_fact" | "source_recommendation" | "mechanism" | "heuristic" | "inference",
  role: "supports" | "qualifies" | "context",
  reasonCode: "direct_current_stat" | "source_recommendation" | "maintained_mechanism" | "general_heuristic" | "model_inference",
  supportsFacets: ["equipment_logic"],
  freshnessStatus: "fresh" | "historical" | "stale" | "not_applicable",
  provenance: "tool" | "source_guide" | "manual_overlay" | "manual_knowledge" | "model_inference"
}
```

Tier semantics:

- A — direct current statistics, official facts, or direct current-task factual Evidence.
- B — source-level recommendation or current-patch structured guide data.
- C — maintained mechanism knowledge or explicit explainable rules.
- D — general TFT heuristic.
- E — model inference.

Rules:

- Tier is claim-relative; it is not a global quality score on an entire ToolResult.
- Missing A/B Evidence is not contrary Evidence.
- Lower tiers do not silently override higher tiers.
- Facts, source advice, maintained knowledge, heuristics and inference remain visibly distinct.
- Current/latest claims require current freshness under the existing policy; historical Bridge Evidence stays historical regardless of tier.
- `freshnessStatus` is derived/non-authoritative. Claim use may further restrict an Evidence item's authoritative freshness/temporal qualification, but it can never promote it. Effective freshness is the stricter of Evidence-owned freshness and claim-use qualification.
- Tier is a closed categorical enum describing use/distance, not an ordinal score. Code must not compare A-E to decide validity.
- Causal claims require an explicit causal evidence policy; correlation, before/after movement, or recommendation membership alone is insufficient.
- MetaTFT `recommendedAugments` is positive source-recommendation Evidence, never a complete ranking or negative evidence for unmatched candidates.

Claim validity is conjunctive and remains owned by the existing validators:

```text
claim support = existing Evidence validation passes
  AND freshness / temporal policy allows the claim
  AND grounding policy allows the claim
  AND Skill claim-evidence-use policy allows this use
```

Tier alone never makes Evidence valid. In particular, Tier A historical Bridge Evidence remains historical and cannot support a current/latest claim.

### 3.6 SkillProgress

```js
{
  schemaVersion: "skill-progress.v1",
  skillId: "unit_play_guidance",
  requiredFacets: [],
  coveredFacets: [
    { facetId: "equipment_logic", evidenceIds: [], tierSummary: ["A"] }
  ],
  missingFacets: [],
  unsupportedFacets: [
    { facetId: "positioning", reasonCode: "data_unavailable" }
  ],
  status: "in_progress" | "complete" | "qualified_incomplete"
}
```

Progress is a deterministic projection from validated Evidence, data availability and facet coverage rules. It records missing outcomes, not a mechanical list of future tool calls. ReAct decides which permitted tool, if any, can fill a missing facet. Historical Evidence can cover only facets and claim types allowed by freshness policy.

### 3.7 Completion validation

```js
validateSkillCompletion({
  skill,
  context,
  progress,
  evidenceLedger,
  answer,
  citedEvidenceIds,
  reasonCode
})

// ->
{
  schemaVersion: "skill-completion-validation.v1",
  valid: true,
  status: "complete" | "qualified_incomplete" | "rejected",
  errors: [],
  missingFacets: [],
  reasonCodes: []
}
```

The validator rejects finish when a required facet is missing and a permitted available source can still address it. It permits `qualified_incomplete` only when the definition allows it and the answer names the limitation without inventing Evidence. Existing ReAct action, finish, narrative and grounding validators still run; Skill completion is an additional guard, never a bypass.

## 4. Routing boundary

Pilot positive boundary:

```text
"英雄 XX 怎么玩？"
"这个英雄应该怎么理解？"
"XX 怎么玩，不要只说装备"
-> unit_play_guidance
```

Mandatory negatives:

```text
"查 XX 装备"
"XX 推荐三件套"
"A 和 B 哪个统计更好"
"查阵容排名"
"查站位"
"找攻略视频"
-> no Skill
```

Selection requires one resolved champion, TFT domain, supported understanding, the broad unit-play goal/output, and no blocking ambiguity. Exclusions win over positive score. `none` is a successful conservative result.

## 5. Mode, fallback and priority contract

Proposed flags for PR1A/PR5:

```text
AGENT_SKILLS_SHADOW_V1=false
AGENT_SKILLS_CONTROL_V1=false
AGENT_SKILL_ALLOWLIST=unit_play_guidance
```

Modes:

- off — no matching, context construction, telemetry or behavior change.
- shadow — compute selection, data availability and predicted context/progress; emit telemetry; production request and answer are byte-for-byte owned by the existing path.
- control — future gated injection after evaluation; only allowlisted Skills can affect ReAct guidance/completion.

PR1A shadow output is telemetry only. `SkillContext`, `SkillProgress`, and completion projections must not enter the ReAct decision input, model prompt, tool catalog, finish validator, response payload, or persisted conversation state. Shadow adds zero LLM calls and does not double-inject the existing `semanticAdvisory` / `semanticGuidance` path.

Priority is fixed:

```text
server/deterministic nextActionAffordance
  > strict tool and argument policy
  > Evidence/freshness/grounding policy
  > runtime budget, approval and side-effect policy
  > Skill completion/progress guidance
  > model autonomous tool choice
```

Fallback distinguishes two failure classes:

- request-time matcher/context/telemetry failures in shadow fail open to current production behavior;
- static SkillDefinition/Registry initialization failures disable the Skill shadow subsystem and surface a stable runtime diagnostic while the production Agent remains healthy.

Invalid static contracts must not be silently caught on every request. Invalid future control context fails closed to the existing legacy path. Disabling control must require no data migration. Skill failure must not make Quick Task slower or unavailable.

## 6. Observability and evaluation contract

No private reasoning is recorded. Stable reason codes and runtime facts only:

```js
skill: {
  mode: "shadow",
  selected: true,
  skillId: "unit_play_guidance",
  skillVersion: "1.0.0",
  matchScore: 0,
  matchReasons: [],
  selectionStatus: "selected",
  dataDependencies: [],
  dataAvailability: {},
  requiredFacets: [],
  coveredFacets: [],
  missingFacets: [],
  unsupportedFacets: [],
  completionStatus: "in_progress",
  evidenceTierSummary: {},
  effectiveTools: [],
  fallbackReason: null,
  matcherDurationMs: 0,
  contextBytes: 0
}
```

PR1A datasets live under `eval/skills/`:

- `skill-routing.jsonl` — positive broad unit-play variants.
- `skill-negative-boundary.jsonl` — Quick Task/narrow-query protection.
- `skill-completion.jsonl` — complete, recoverable missing, unavailable and qualified-incomplete cases.
- `skill-conversation-bridge.jsonl` — same-scope reuse, historical freshness and no duplicate retrieval.

Required reports: routing precision/recall, no-Skill precision, false positives/negatives by goal, tool-call delta, answer facet coverage, completion status, latency delta, token/context delta, and matcher failure/fallback counts. No rollout on aggregate accuracy alone; Quick Task false-positive takeover must be zero in the required boundary set.

## 7. PR1A — Skill Runtime Shadow POC

One PR, no data scraping, no new tool, no control behavior:

1. Add `src/skills/contracts.js` with strict constructors/validators for the contracts above.
2. Add `registry.js`; validate uniqueness, versions, tools, capabilities, facets, data dependency names and completion policy at startup/test construction.
3. Add deterministic `matcher.js`; implement exclusions-first scoring and conservative `none`.
4. Register only `definitions/unit-play-guidance.js`. Reserve other Skill IDs in docs/tests, not Registry.
5. Add `context.js`; compute data availability and the tool-policy intersection without mutating the runtime catalog.
6. Add deterministic `progress.js` and `validator.js`; no LLM self-evaluation.
7. Add telemetry serialization with bounded payloads and observer failures isolated from behavior.
8. Normalize `AGENT_SKILLS_SHADOW_V1` once in runtime setup, default off. Reuse the existing ReAct deterministic TaskFrame parse promise; do not add another LLM route or parse.
9. In shadow only, run matcher/context/progress observation beside the current unit-play route. Do not inject Skill instructions, alter input, alter available tools, reject finish, or change response payload.
10. Add the four evaluation datasets, contract/matcher/progress tests, shadow default-off/fail-open tests, and negative Quick Task tests.
11. Compare shadow selection with both legacy broad-play detection and the existing TaskFrame control eligibility signal.
12. Report tool-call, latency and answer-coverage deltas before proposing control.

Ownership invariants:

- Skill Matcher consumes TaskFrame; it is not a second TaskFrame parser.
- Skill capability and `allowedTools` declarations express needs only. Runtime authorization remains `runtime available tools intersection Skill allowed tools`; a Skill never reimplements CapabilityMatcher or self-authorizes a tool.
- SkillProgress records covered, missing, and unsupported facets; it is not a tool-step planner.
- PR1A may compute SkillContext beside existing semantic advisory code, but only one can ever be injected in a future control experiment.
- CompletionValidation checks professional facet coverage only. Evidence validity, freshness, grounding, permissions, budgets, and approval remain owned by their existing validators.

PR1A exit gates:

- zero production behavior change with flag off or shadow on;
- deterministic results for identical TaskFrame/Registry inputs;
- zero required negative-boundary takeovers;
- observer/matcher failure preserves the legacy request;
- no added model call;
- only `unit_play_guidance` registered;
- no new data interface invented.

## 8. PR1B — MetaTFT Comp Guide Probe

Implementation evidence: [`metatft-comp-guide-probe-pr1b-report.md`](./metatft-comp-guide-probe-pr1b-report.md). The report records a developer-only POC and does not change this frozen scope.

Separate PR and ownership from PR1A:

1. Pick one real composition with a stable source identifier and capture at least two real patches through the actual patch-switch mechanism.
2. Store immutable fixtures under `fixtures/raw/<comp>-<patch>.json` with source URL/ID, source patch, capture time, parser version and payload kind.
3. Document whether the stable source is JSON, hydration, API or HTML and why the chosen extraction is least brittle.
4. Build a fail-closed parser for observed fields only: level boards, leveling timing, reroll, component priority, recommended augment IDs and positioning.
5. Normalize to `comp-guide.v1` fixtures under `fixtures/normalized/`; retain missing vs empty vs unsupported distinctions and field-level provenance.
6. Map champion, item and augment references to local IDs; unresolved, ambiguous and wrong-season mapping are explicit failures, not guessed IDs.
7. Verify source composition ID stability and patch switching; reject a response whose requested patch and observed source patch disagree.
8. Add parser, mapping, schema-change, missing-field and two-patch tests.
9. Add a POC report with captured fields, unavailable fields, breakage signals, legal/operational risks, and the evidence required before PR2 storage design.
10. Define the future Raw -> Normalized -> Manual Overlay -> Effective View boundary without building the PR2 database or Tool.

PR1B explicitly excludes full-site crawling, production scheduling, database migrations, Skill runtime changes, direct model consumption of page text, and treating recommendation membership as a statistical ranking.

PR1B.5 amendment: the real probe disproved the illustrative assumption that one top-level patch can bind both statistics and guide facets. [`current-only-comp-guide-data-contract-pr1b5.md`](./current-only-comp-guide-data-contract-pr1b5.md) supersedes the `comp-guide.v1` sketch above with `comp-guide-snapshot.v1`; statistics are patch-bound, while audited guide endpoints are current-unversioned or unavailable for the requested historical patch. This amendment changes no production behavior and does not authorize PR2.

## 9. PR0 verification baseline

Focused baseline command executed before PR0 file changes:

```powershell
node --test test/task-frame.test.js test/phase5-capability-planner.test.js test/phase66-architecture-convergence.test.js test/agent-tools.test.js test/agent-runtime.test.js test/react-loop-r1.test.js test/react-decision-provider.test.js test/react-task-frame-shadow.test.js test/conversation-bridge.test.js test/conversation-state-v2-integration.test.js
```

Result on 2026-08-18: 151 tests passed, 0 failed, 0 skipped.

Post-change verification:

- `npm run test:ci:main` — 1087 tests: 1074 passed, 0 failed, 13 conditionally skipped.
- `npm run test:ci:integration` — 232 tests: 231 passed, 0 failed, 1 skipped.
- `npm run eval:agent` — 50/50 passed; task, intent, clarification, tool selection and tool input validity all 100%.
- `npm test` — repository test discovery also entered `.cache/bilibili-mcp-js/test*`; 1304 passed, 7 cache-copy tests failed, 14 skipped. The failures are missing/unbuilt files and timeouts inside the ignored cache copy, not PR0 or `test/` failures. PR0 does not delete user cache or broaden scope by changing the test script; the explicit CI lanes above are the clean repository baseline.
