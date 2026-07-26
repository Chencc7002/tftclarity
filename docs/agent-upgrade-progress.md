# Agent Upgrade Progress

## Current

- phase: 6.6.1
- status: completed
- branch: codex/phase-6-6-execution-plan-cutover
- baseline_commit: 8690451
- latest_verified_commit: 03290a7
- latest_verified_worktree: 2026-07-26

## Completed gates

- phase: 0
- tests: baseline `npm test` — 561 total / 541 passed / 0 failed / 20 skipped; final `npm test` — 564 total / 544 passed / 0 failed / 20 skipped; dataset tests — 3 passed / 0 failed
- metrics: 300 total and unique inputs; 0 privacy violations; 90% non-standard style; every required failure label and phenomenon covered
- report: `docs/reports/phase-0-baseline.md`, `docs/reports/phase-0-baseline.json`

- phase: 1
- tests: final Node 18 `npm test` — 580 total / 560 passed / 0 failed / 20 skipped; targeted — 70 total / 69 passed / 0 failed / 1 skipped; bundled Node 24 targeted — 22 passed / 0 failed / 0 skipped; small-window/comps/SQLite smokes passed
- metrics: `core-agent-cases.v1` — 50 passed / 0 failed / 0 skipped; task, intent, clarification, tool selection and tool input validity 100%; expected fallback 4%; expected timeout 2%
- report: `docs/reports/phase-1-agent-runtime.md`, `docs/reports/phase-1-agent-runtime.json`

- phase: 2
- tests: final `npm test` — 589 total / 569 passed / 0 failed / 20 skipped; targeted TaskFrame/parser/context/shadow — 10 passed / 0 failed / 0 skipped
- metrics: `natural-language-agent-phase0.v1` — action 96.00%; domain 97.67%; unsupported understanding 100%; input/output/latency budgets 100%
- report: `docs/reports/phase-2-semantic-parser.md`, `docs/reports/phase-2-semantic-parser.json`

- phase: 3
- tests: final `npm test` — 597 total / 577 passed / 0 failed / 20 skipped; targeted entity/evaluation/parser/shadow — 14 passed / 0 failed / 0 skipped; small-window/comps smokes passed; final phase-0/1 evaluation rechecks passed
- metrics: `entity-linking-phase3.v1` — core Top-1 100%; slang/alias Top-3 100%; concepts 100%; nonexistent false-hit 0%; phase-2 action/domain gates retained
- report: `docs/reports/phase-3-entity-linker.md`, `docs/reports/phase-3-entity-linker.json`

- phase: 4
- tests: final `npm test` — 602 total / 582 passed / 0 failed / 20 skipped; targeted context/parser/shadow — 10 passed / 0 failed / 0 skipped; phase-0/2/3 evaluations and small-window/comps smokes passed
- metrics: `context-resolution-phase4.v1` — multi-turn reference accuracy 100%; unnecessary clarification 0%; one-key-question compliance 100%; explicit/conversation/default condition source accuracy 100%
- report: `docs/reports/phase-4-context-clarification.md`, `docs/reports/phase-4-context-clarification.json`

- phase: 5
- tests: final `npm test` — 607 total / 587 passed / 0 failed / 20 skipped; targeted capability/planner/tool/shadow — 14 passed / 0 failed / 0 skipped; phase-2/3/4 evaluations and small-window/comps smokes passed
- metrics: `capability-planning-phase5.v1` — tool selection 100%; meaningless single-tool multi-step plans 0; unsupported honest downgrade 100%; bounded composite plans 100%
- report: `docs/reports/phase-5-capability-planner.md`, `docs/reports/phase-5-capability-planner.json`

- phase: 6
- tests: final `npm test` — 611 total / 591 passed / 0 failed / 20 skipped; targeted takeover/shadow — 7 passed / 0 failed / 0 skipped; 50-case Agent evaluation and phase-0 through phase-6 evaluations passed; small-window/comps smokes passed; SQLite conditionally skipped under Node 18
- metrics: `semantic-takeover-phase6.v1` — 120 cases × 5 runs; effective answers 100%; wrong tools 0%; shadow differences 0%; Pass@5 100%; Pass^5 100%; all action/entity/style/version/tool slices 100%
- live LLM: T2 20/20 requests; structured output 100%; domain/action 95% / 95%; entity recall 92.31%; Token/latency budgets 100%; 0 retries
- report: `docs/reports/phase-6-semantic-takeover.md`, `docs/reports/phase-6-semantic-takeover.json`

- phase: 6.5
- tests: final `node --test` — 620 total / 600 passed / 0 failed / 20 skipped; phase-4/5/6/6.5 evaluations passed with 120 / 190 / 600 / 360 runs
- metrics: `semantic-gap-phase65.v1` — 120 cases × 3 runs; classification and routing 100%; arbitrary tool calls 0; Pass@3 and Pass^3 100%
- real LLM T3: `live-llm-t3-independent.v2` — 120 independent cases × 3 runs; exact Few-shot overlap 0; request success 100%; controlled fallback 0.56%; Pass@3 99.17%; Pass^3 95.83%
- T3 quality: domain/action/status 100% / 100% / 98.61%; entity mention/Top-1 100% / 100%; tool selection 98.06%; clarification 99.17%; token and latency budgets 100%
- safety: legacy equivalent and fallback paths retained; `RetrievalPlan` retained; ExecutionPlan allows only registered first-party read-only tools; arbitrary tools and video tools remain disabled; no real canary was started
- report: `docs/reports/phase-6-5-semantic-correction.md`, `docs/reports/phase-6-5-semantic-correction.json`, `docs/reports/phase-6-5-live-llm-t3.md`, `docs/reports/phase-6-5-live-llm-t3.json`

- phase: 6.6.1
- tests: final `npm test` — 644 total / 624 passed / 0 failed / 20 skipped; phase-6.6 architecture, parameter-integrity, status, domain-isolation and HTTP sovereignty tests passed; phase-2/6/6.6 evaluations passed
- metrics: `architecture-convergence-phase66.v2` — 120 core cases plus 36 independent natural-language holdout cases; valid plans, tool names, complete arguments, ExecutionPlan source, parameter equivalence, deterministic public-projection equivalence and unsupported honest downgrade all 100%; average/max steps 1/1; wrong tools 0%; 3/3 arbitrary tool, URL and SQL attempts rejected
- result sovereignty: `ResultPolicyExecutor` now applies filtering, ordering and trimming from ExecutionPlan; registered TFT policies reuse the deterministic domain algorithm without returning to RetrievalPlan
- evidence: step and final contracts enforce evidence type, source, declared fields, timestamps and the prohibition on model-generated statistics
- parameter integrity: TaskFrame removes cross-role duplicate resolved entities; ExecutionPlan and TFT query adapters preserve stable unique arrays; T3 rejects duplicate, missing and extra entity arguments
- result comparison: production composition requests record actual post-policy ExecutionPlan and legacy public-result comparisons; offline deterministic projection evidence is labeled separately
- real LLM T3: `live-llm-t3-evaluation.v2` / `live-llm-t3-independent.v2` — 120 independent cases × 3 runs; 360/360 requests; 0 provider fallback; Pass@3 and Pass^3 100%; executed at `2026-07-26T02:45:31.188Z`
- T3 quality: domain/action/status, exact entity mention/Top-1, tool selection, duplicate-free complete argument semantics, plan shape, clarification, unsupported honest downgrade, context Pass^3, token and latency budgets all 100%
- safety: production cut-over traffic executes directly from ExecutionPlan; default run budget permits at most three tool calls; RetrievalPlan remains observable fallback and is not a prerequisite for a valid sovereign ExecutionPlan; legacy semantic augmentation is disabled whenever the result source is ExecutionPlan
- report: `docs/phase-6-6-architecture-convergence.md`, `docs/reports/phase-6-6-1-live-llm-t3.md`, `docs/reports/phase-6-6-1-live-llm-t3.json`

- phase: 8A
- tests: `npm test` — 625 total / 605 passed / 0 failed / 20 skipped; targeted phase-8A failure-loop tests — 5 passed / 0 failed; `npm run eval:phase8a` — PASS
- metrics: 6 query events → 5 candidates; 1 duplicate; 5 clusters; 0 privacy violations; 2 human-verified exports; ignored/rejected states exercised; injection cases excluded; production apply hooks 0; `find_video` is understood by Parser and downgraded by Capability Matcher
- report: `docs/reports/phase-8a-controlled-failure-loop.md`, `docs/reports/phase-8a-controlled-failure-loop.json`

- acceptance audit: phases 0-3
- artifact verification: phase reports are tracked and linked to implementation/verification commits `f551390`, `bfcaa5e`, `3c72699`, `2d16226`, `0d25453`, `fe84785`, `8b676fe`, `4996a7d`
- real LLM: existing one-query `smoke:llm` passed; new T2 `eval:llm:live` passed 20/20 strict requests with `chat` / `deepseek-v4-flash`
- live metrics: structured output 100%; domain/action 95% / 95%; understanding status 85%; entity mention recall 92.31%; token/latency budgets 100%; 0 retries
- final audit tests: `npm test` — 599 total / 579 passed / 0 failed / 20 skipped; phase-0/1/2/3 evaluations and small-window/comps smokes passed
- audit report: `docs/reports/phase-0-3-acceptance-audit.md`, `docs/reports/phase-0-3-acceptance-audit.json`
- audit implementation commit: `1f505e7`

## Current work

- objective: phase 6.6.1 architecture convergence and post-audit parameter-integrity hardening completed; stop before phase 7 capability work
- files: ExecutionPlan compiler/executor, ResultPolicyExecutor, strict evidence validation, runtime stage orchestration, split status protocol, TFT concept and result-policy registries, public-result shadow comparison, independent holdout, T3 v2 checks, phase-6.6 tests and governance docs
- assumptions: legacy IntentEnvelope/RetrievalPlan and TaskPlan remain only behind compatibility surfaces during rollout; no new product capability, video tool, arbitrary SQL, arbitrary URL or unregistered tool is introduced

## Blockers

- blocker: none
- evidence: full regression, Phase 2/6/6.6 offline evaluations and real-LLM T3 v2 all passed
- user_input_needed: none

## Next

- next_step: review the committed post-audit 6.6 hardening before authorizing any phase 7 capability work
- required_checks: preserve ExecutionPlan and result-policy sovereignty, strict evidence, split status ownership, three-step/tool-call ceiling, safety boundaries and legacy fallback observability
