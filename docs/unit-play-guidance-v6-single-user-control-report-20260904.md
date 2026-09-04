# Unit-play guidance v6 single-user control report

Status: **implemented and verified locally; default off; not deployed; no production Provider calls**

## Scope

The application is primarily owner-operated, so the control design uses one exact
candidate selector instead of percentage cohorts. This implementation does not activate
the candidate on a running service. It prepares a reversible one-user canary boundary for
a later separately authorized operation.

## Activation and rollback

`AGENT_SKILLS_UNIT_PLAY_CONTROL_V1` defaults to `off`. The only activating value is
`unit_play_guidance@1.5.11`. Values such as `on`, another Skill id, or another version fail
closed and expose a bounded runtime diagnostic. Setting the selector back to `off`
restores the existing path and requires no data migration.

Activation also requires all of the following to agree:

- a deterministic, understood broad unit-play TaskFrame with one resolved champion;
- the accepted Skill content hash
  `7df0d4830a8221150a49ecf251e86ad7c25980e2468650cba4b4e718cd95be8a`;
- the candidate Tool intersection and frozen rendered-context hash
  `730f637d005537e023b9c92e56c18f93798e8b67a69c84853f004819bb2cd80b`;
- the existing registered handlers and strict Tool schemas.

Missing or mismatched prerequisites do not partially activate the candidate. Narrow
equipment questions, ambiguous entities, unsupported requests, and Quick Tasks keep
their current behavior.

## Atomic candidate behavior

An active request keeps the user's original question and injects the bounded 1.5.11
SkillContext only into the decision Provider input. The model sees only the Skill Tool
intersection. The same existing ReAct loop, ToolRegistry, ToolExecutor, EvidenceLedger,
grounding validator, budgets, stop rules, and fallback behavior remain authoritative.

The profile also enables the exact v6 companion behavior as one unit:

- action-shaped prior decision messages;
- model-input-only Observation projection while full Evidence remains unchanged;
- tactical presentation rules;
- two composition cards with each card owning its positioning;
- official item Evidence validation;
- fixed two-card completion affordance;
- current-input language guard.

Skill instructions and hashes are not added to the public response or conversation
state. Control telemetry is non-blocking and contains only bounded identity, lifecycle,
Tool, Evidence, and card counts.

## Local verification

Focused tests cover exact-selector activation, version and content-hash binding, frozen
rendered-context parity, Tool-intersection restriction, missing-Tool fail-closed behavior,
legacy behavior for invalid selectors, negative routing for narrow questions, private
guidance injection, action-message conversion, model-only Observation projection, and
absence of Skill content from the public result. The focused Agent/ReAct suites completed
with 158 passed, 0 failed.

A production-shape offline replay used frozen registered-tool observations and a scripted
decision provider. It made no external Provider request and completed the evaluated eight
Tool calls in order:

1. `unit_details`
2. `unit_builds`
3. `item_details_batch`
4. initial `comps_rankings`
5. first-card `comps_rankings` resolution
6. first-card `composition_tactical_details`
7. second-card `comps_rankings` resolution
8. second-card `composition_tactical_details`

The result completed through the model-answer path with two separately bound tactical
Evidence records and card presentation enabled. This validates mechanics only; it does
not replace the pending independent semantic review and does not authorize deployment or
production control.

The canonical local regression also passed:

- main lane: 1,405 tests, 1,398 passed, 7 skipped, 0 failed;
- integration lane: 236 tests, 235 passed, 1 skipped, 0 failed;
- offline Agent evaluation: 50 of 50 cases passed.

These checks used the bundled local Node runtime and did not send a payload to an external
Provider.

## Next gate

Before activation on the running webpage, define the maximum owner-triggered request
count, Provider-request/cost ceiling, observation window, stop conditions, and exact
rollback operator. Production activation requires a new explicit authorization bound to
the implementation commit and those limits.
