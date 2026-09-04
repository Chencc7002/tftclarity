# Agent Skills PR1A — Shadow POC Report

Date: 2026-08-18
Status: product-approved Shadow POC milestone; no control rollout requested.

## Outcome

PR1A implements one default-off, telemetry-only Skill shadow for `unit_play_guidance`. It does not implement the complete Skill system and does not start PR1B.

The implementation preserves the two existing runtime families. It reuses the existing deterministic ReAct TaskFrame parse promise, consumes only the resolved `task-frame.v1`, and never treats Conversation Bridge as a router.

## Included

- Strict, versioned, serializable Skill contracts with unknown-field rejection.
- Claim-local Evidence-use annotation with `claimId`, `role`, `reasonCode`, tier, provenance, and temporal status.
- Immutable Skill Registry containing only `unit_play_guidance`.
- Deterministic exclusions-first Matcher; raw user text and LLM routing are not inputs.
- SkillContext tool intersection: registered/available runtime tools intersect Skill `allowedTools`.
- Deterministic facet-only SkillProgress and coverage-only CompletionValidation.
- `AGENT_SKILLS_SHADOW_V1`, normalized once and default off.
- Bounded `agent-skill-shadow.v1` telemetry with observer failures isolated from the request.
- Four offline datasets under `eval/skills/` and a deterministic evaluation runner.

## Explicitly unchanged

- No SkillContext or SkillProgress enters ReAct WorkingState, decision input, prompt, tool catalog, finish validator, answer, response payload, or conversation persistence.
- No new LLM call, tool, data source, network access, database schema, scheduler, budget, permission, approval rule, or execution runtime.
- Quick Task, CapabilityMatcher, ExecutionPlan, ReAct guards, Evidence validation, freshness, grounding, and deterministic `nextActionAffordance` remain authoritative.
- Existing `semanticAdvisory` / `semanticGuidance` is not replaced or double-injected.
- PR1B MetaTFT probing and the user's separate daily-snapshot work are untouched.

## Evaluation

Focused Skill/TaskFrame tests:

- 24 passed, 0 failed.
- Shadow off: zero parser calls and zero telemetry.
- Shadow on: decision-input hash, tool catalog, answer, safety metrics, and suggested actions match the legacy baseline; model calls remain 1 vs 1.
- Skill and existing TaskFrame shadows share one parse call.
- Parser/matcher/observer failures preserve the legacy request path.
- Narrow parameterized queries emit `none` and retain their original request.

Skill offline evaluation:

- routing recall: 2/2 (100%);
- required negative boundary: 3/3 no-Skill, false takeovers 0;
- completion-state accuracy: 3/3 (100%);
- Conversation Bridge invariants: 3/3 (100%).

Repository regression:

- `npm run test:ci:main`: 1101 tests, 1088 passed, 0 failed, 13 skipped;
- `npm run test:ci:integration`: 232 tests, 231 passed, 0 failed, 1 skipped;
- `npm run eval:agent`: 50/50 passed; intent, clarification, tool selection, and tool-input validity remain 100%.

## Review request

Please review the following before any control proposal:

1. Is the claim-local `claim-evidence-use.v1` boundary sufficient for PR1A, while existing validators remain the sole owners of Evidence validity/freshness/grounding?
2. Is the telemetry-only integration point after runtime handler availability is known acceptable?
3. May PR1A be considered complete with control still off, leaving semantic guidance replacement and live answer-facet measurement for a separately approved control experiment?

No PR1B or production rollout should begin from this report without a separate decision.

## Product review disposition

Product verdict: `APPROVED — SHADOW POC MILESTONE ONLY`.

The Review explicitly did not approve control, semantic guidance replacement, Skill instructions in ReAct prompts, Skill-driven Tool scoping, production rollout, PR1B, PR2, or a new MetaTFT data pipeline.

Two non-blocking hardening points were applied before closing PR1A:

- claim-use freshness is derived/non-authoritative and can only restrict, never promote, Evidence-owned freshness/temporal authority; A-E remains a closed categorical enum, not an ordinal validity score;
- request-time shadow failures remain fail-open, while invalid static Skill definitions disable the Skill subsystem with a stable runtime diagnostic and leave the production Agent healthy.
