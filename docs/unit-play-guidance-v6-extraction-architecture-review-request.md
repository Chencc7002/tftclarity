# Unit-play guidance v6 extraction architecture review request

Status: **Stage 1 implemented and verified; default off; no control or production activation**

## Decision being carried forward

The adaptive v6 candidate run is recorded in
`unit-play-guidance-completion-v6-formal-report-20260903.md`. Candidate Skill 1.5.11
completed 90/90 Agent runs with exact frozen tool sequences, complete card-owned
formations, and guarded answer-language completion. On 2026-09-03 the user accepted
the preliminary semantic deviations as tolerable and requested no additional prompt
revision. There will be no v7 candidate for those findings.

This product disposition does not complete the two independent review documents and
does not authorize production activation.

## Current production boundary

The repository currently has two relevant but separate mechanisms:

1. `AGENT_SKILLS_SHADOW_V1` constructs a `SkillRegistry`, matches a deterministic
   TaskFrame, projects context/progress, and emits bounded telemetry. It adds no Tool or
   model calls and never places Skill instructions in the ReAct prompt. Its default
   registered definition is the production `UNIT_PLAY_GUIDANCE_SKILL` at version 1.3.0.
2. `TFT_AGENT_REACT_TASK_FRAME_CONTROL_V1` can attach the existing broad unit-play
   `semanticAdvisory`. It does not consume `SkillContext` or candidate 1.5.11 instructions.

Candidate 1.5.11 is used by isolated evaluation and Browser diagnostic modules and is now
also imported directly by the small-window runtime for the separate default-off metadata
shadow. The production `src/skills/index.js` export remains 1.3.0. The fixed
card-completion and input-language affordances used by v6 already live in the existing
ReAct loop and termination policy, but the production runtime does not configure them as
a complete candidate mode.

Consequently, replacing only the definition observed by the current Skill shadow would
measure routing and projected context. It would not exercise the candidate instructions,
Tool sequence, cards, completion affordance, language guard, or answer. Calling that an
answer-quality shadow would be misleading.

## Proposed two-stage extraction

### Stage 1: candidate metadata shadow

Add a separately named, default-off candidate shadow configuration for
`unit_play_guidance@1.5.11`. It may reuse the existing deterministic TaskFrame parse and
Skill shadow observer, but it must remain telemetry-only:

- no Skill instructions in the model prompt;
- no change to input, available Tools, Tool arguments, finish validation, answer, cards,
  response payload, or conversation state;
- no additional Tool or model calls;
- no second execution runtime;
- no replacement of the production 1.3.0 definition;
- bounded telemetry containing candidate id, version, content hash, selection result,
  effective Tool intersection, missing facets, context bytes, and stable failure reason;
- fail-open isolation for registry, matcher, context, progress, and observer failures.

This stage answers only whether real eligible traffic reaches the same candidate boundary
and whether the required registered Tools are available. It makes no answer-quality claim.

Stage 1 exit gates:

- production request and answer are byte-identical with candidate shadow off and on;
- zero added Tool calls and zero added model calls;
- zero Quick Task or negative-boundary takeovers;
- candidate id/version/hash are stable in every selected event;
- observer or candidate-registry failure preserves the existing request result;
- no candidate content enters persisted conversation state.

### Stage 2: separately approved bounded control

Only a later explicit production-control authorization may let Skill 1.5.11 affect ReAct.
That implementation must use the existing ReAct runtime and registered Tool handlers. It
must not create a parallel Agent runtime or let the Skill authorize Tools.

The controlled path would need one atomic candidate configuration containing:

- the exact Skill 1.5.11 content hash accepted by v6;
- deterministic TaskFrame eligibility and a `unit_play_guidance` allowlist;
- the runtime Tool intersection, with server-owned arguments preserved;
- official unit and item evidence support;
- composition cards that own their corresponding positioning;
- fixed two-card completion affordance;
- input-language completion guard;
- strict Evidence, freshness, grounding, deadline, budget, and approval policies;
- a clean pre-candidate snapshot and fail-open fallback to the version-pinned legacy path;
- stable telemetry for candidate success, rejection, fallback, request counts, and latency.

Partial activation is forbidden. In particular, injecting the Skill prompt without the
card completion and language safeguards would not reproduce the evaluated candidate.

The first control cohort must be bounded, reversible without data migration, and stop on
any Tool-policy, Evidence, temporal, grounding, Quick Task, budget, or fallback violation.
Its cohort size and cost cap require a new approval. The v6 external-run authorization
cannot be reused.

## Review decision and remaining authorization

The user selected Stage 1 candidate metadata shadow for implementation after the scope
was explained. This decision did not select Stage 2.

Stage 2 is deliberately excluded from that choice and requires a later explicit
production-control authorization after Stage 1 evidence and the outstanding independent
review are considered.

## Stage 1 implementation record

On 2026-09-03 the user agreed to proceed with the default-off, zero-effect candidate
metadata shadow after clarifying that the application is primarily single-user. Natural
traffic volume is therefore not an exit dependency: repository boundary tests and a
small set of owner-triggered requests are sufficient to validate Stage 1 mechanics.

The implementation adds `AGENT_SKILLS_CANDIDATE_SHADOW_V1`, defaulting to off. When
enabled, it constructs a separate validated registry containing only accepted candidate
1.5.11, reuses the existing TaskFrame parse promise, and emits
`agent-skill-candidate-shadow.v1`. The event contains bounded selection/context metadata
and the accepted candidate content hash. Candidate telemetry dispatch is non-blocking, so
a pending observer cannot delay the normal response. It does not inject the Skill, call a
Tool or model, change the response, or produce a candidate outcome claim.
