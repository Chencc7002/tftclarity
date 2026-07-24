# Agent Upgrade Progress

## Current

- phase: 3
- status: completed
- branch: codex/wechat-mobile-chat
- baseline_commit: d9416b0
- latest_verified_commit: 1f505e7

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

- acceptance audit: phases 0-3
- artifact verification: phase reports are tracked and linked to implementation/verification commits `f551390`, `bfcaa5e`, `3c72699`, `2d16226`, `0d25453`, `fe84785`, `8b676fe`, `4996a7d`
- real LLM: existing one-query `smoke:llm` passed; new T2 `eval:llm:live` passed 20/20 strict requests with `chat` / `deepseek-v4-flash`
- live metrics: structured output 100%; domain/action 95% / 95%; understanding status 85%; entity mention recall 92.31%; token/latency budgets 100%; 0 retries
- final audit tests: `npm test` — 599 total / 579 passed / 0 failed / 20 skipped; phase-0/1/2/3 evaluations and small-window/comps smokes passed
- audit report: `docs/reports/phase-0-3-acceptance-audit.md`, `docs/reports/phase-0-3-acceptance-audit.json`
- audit implementation commit: `1f505e7`

## Current work

- objective: phase 0-3 acceptance audit complete; preserve shadow-only behavior and wait for authorization to begin phase 4 context resolution
- files: `src/understanding/`, live/phase-2/3 evaluation datasets and runners, tests, protocol and phase reports
- assumptions: existing deterministic business rules and IntentEnvelope remain authoritative; live LLM evaluation is opt-in through `TFT_AGENT_LIVE_LLM=1`; the untracked master-plan file remains user-owned and untouched

## Blockers

- blocker: none
- evidence: no master-plan blocking condition has been triggered; the configured real provider completed the final 20-case T2 smoke
- user_input_needed: none

## Next

- next_step: phase 4 — implement context reference resolution and clarification policy only after a new request authorizes continuing beyond phase 3
- required_checks: multi-turn reference accuracy at least 90%, unnecessary clarification below 5%, one-key-question behavior, full regression and updated offline reports
