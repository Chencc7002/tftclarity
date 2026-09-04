# Unit-play guidance v6 candidate metadata shadow report

Status: **Stage 1 implemented and verified; default off; no control or production activation**

## Purpose

The application is primarily single-user, so Stage 1 does not depend on accumulating a
percentage-based production cohort. It provides a zero-effect runtime seam that can be
checked with repository fixtures and a small number of owner-triggered requests before a
separate one-user control decision.

## Implementation

`AGENT_SKILLS_CANDIDATE_SHADOW_V1` is normalized once by the small-window runtime and
defaults to off. When enabled, the runtime:

- creates a separate validated `SkillRegistry` containing only accepted candidate
  `unit_play_guidance@1.5.11`;
- reuses the existing deterministic TaskFrame parse promise;
- matches the candidate against the runtime Tool intersection;
- emits `agent-skill-candidate-shadow.v1` with version, accepted content hash, selection,
  data availability, facet progress, effective Tools, context byte count, and stable
  failure metadata;
- dispatches candidate telemetry without awaiting the observer, so a slow or pending
  telemetry sink cannot delay the production response;
- keeps candidate instructions and `SkillContext` out of telemetry, model input,
  response payload, and conversation state.

The production `UNIT_PLAY_GUIDANCE_SKILL` export remains 1.3.0. Candidate shadow does
not execute 1.5.11, call a Tool or model, run candidate completion, or emit an outcome
quality claim. Invalid candidate definitions and request-time observation failures fail
open to the existing request path.

The example environment files document both the existing production Skill shadow and
the new candidate shadow as off. Enabling the candidate shadow is therefore an explicit
runtime operation, not a side effect of deploying this code.

## Verification

- Focused TaskFrame/ReAct/Skill shadow suites: 210 passed, 0 failed.
- Canonical main lane: 1,397 tests; 1,390 passed, 0 failed, 7 skipped.
- Canonical integration lane: 236 tests; 235 passed, 0 failed, 1 skipped.
- Agent evaluation: 50/50 passed; task, intent, clarification, Tool selection, and Tool
  input validity remained 100%.

The focused checks prove that candidate shadow on/off produces the same Provider request
projection and user-visible answer, adds no model call, reuses one TaskFrame parse when
both shadows are enabled, rejects narrow parameterized queries, emits the exact accepted
1.5.11 content hash, preserves the existing response when candidate registry construction
fails, and returns normally even when the candidate telemetry observer never settles.

## Remaining boundary

No service configuration was changed and candidate shadow was not enabled on a running
deployment. A default-off one-user control path has since been implemented and verified
locally, but it has not been deployed or activated. Activating that path would change the
answer and Tool behavior, so it still requires bounded request/cost limits, rollback
behavior, and explicit production-control authorization.
