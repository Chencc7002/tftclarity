# Phase 5 Capability Matching and Controlled Planner

- status: PASS
- baseline: `b960439`
- implementation: `02559f2`
- evaluation dataset: `capability-planning-phase5.v1` (190 cases)

## Delivered

- Machine-readable capabilities on all nine existing registered tools.
- Capability declarations for hero item recommendations and comparisons, composition ranking/trends/recommendations, game-concept semantic retrieval, version explanation and catalog details.
- Deterministic-first `capability-match.v1` using action, goal, entity combinations, constraints, expected outputs and trust metadata rather than tool-name guessing.
- `task-plan.v1` with one to three registered-tool steps, input Schema checks, DAG validation, step/tool/Token budgets and independent policy checks.
- Direct one-step planning without an LLM when one tool is sufficient.
- Composite-only Planner invocation with a sanitized capability catalog that excludes untrusted descriptions.
- Side-effect retry protection requiring an idempotency key or confirmed prior failure.
- Capability match and validated TaskPlan telemetry attached to the semantic shadow trace.

## Evaluation

Final `npm run eval:phase5`:

- tool selection accuracy: 100% (170/170; gate at least 95%)
- meaningless multi-step plans for single-tool requests: 0
- unsupported requests correctly returned `understood_but_unsupported`: 100% (10/10)
- bounded composite plans: 100% (10/10)

Security contracts reject unregistered tools, invalid arguments, dependency cycles, excessive steps, policy-denied tools and side-effect retries without an idempotency key. Tool descriptions are not exposed to the Planner catalog.

## Tests

- targeted capability/planner/tool/shadow tests: 14 passed, 0 failed, 0 skipped
- full `npm test`: 607 total, 587 passed, 0 failed, 20 existing conditional skips
- phase 2 action/domain gates retained at 96.00% / 97.67%
- phase 3 entity gates retained at 100% core Top-1 / 100% alias Top-3
- phase 4 context gates retained at 100% reference accuracy / 0% unnecessary clarification
- `npm run smoke:small-window`: passed; hot cache 4ms, reopened local cache 5ms
- `npm run smoke:comps`: passed

## Behavior difference and rollback

The semantic shadow now records capability and plan decisions, but the legacy deterministic workflow still produces user-visible results. Revert `02559f2` to remove phase 5; no production data rollback is required.

## Known limits

- There are nine tools, so the stable grouped catalog remains appropriate; hierarchical discovery is intentionally not enabled.
- The 190-case evaluation is an offline contract set, not production traffic.
- Composite requests require an injected controlled Planner; when unavailable, the system returns `understood_but_unsupported` instead of inventing a plan.
