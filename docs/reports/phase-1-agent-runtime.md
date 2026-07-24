# Phase 1 Agent Runtime Report

- status: PASS
- baseline: `f551390`
- implementation commit: `bfcaa5e`
- dataset: `core-agent-cases.v1`

## Delivered

- Versioned `AgentRun`, public run summary and structured events.
- Fixed lifecycle with deadline, step/tool/retry/event budgets, cancellation and terminal-state protection.
- Shared `ToolRegistry`/`ToolExecutor` derived from `STRUCTURED_OPERATION_REGISTRY`.
- Registered structured recommendation, detail catalog and semantic search capabilities.
- `/api/recommend` Runtime integration, safe additive `run` response and query-event `runId`.
- Backward-compatible nullable SQLite `query_events.run_id` migration.
- Reproducible 50-case offline evaluator with JSON/Markdown output and nonzero failure exit.

No deterministic statistics, filters, sorting rules, Evidence Pack, ConclusionSpec, QuestionContract or UI product rules were moved into Runtime or changed.

## Evaluation

Final `npm run eval:agent`:

- 50 total / 50 passed / 0 failed / 0 skipped
- task success: 100%
- intent: 100%
- clarification: 100%
- tool selection: 100%
- tool input validity: 100%
- expected fallback: 4%
- expected timeout: 2%
- average/P95: 0ms with injected deterministic clock

The required suite covers primary recommendation queries, three detail types, multi-turn inheritance/correction, clarification, low-sample/empty/stale/Embedding/LLM degradation, illegal tool/input/source rejection, Runtime timeout/cancel/budget/late result, season isolation and LLM fact-authority rejection.

Failed iterations were retained as real development evidence: 34/40, then 38/40, then 47/50 before the final 50/50 run. They were not counted as passes.

## Tests and smoke

- Targeted Node 18: 70 total / 69 passed / 0 failed / 1 existing obsolete skip.
- Full Node 18.20.8 `npm test`: 580 total / 560 passed / 0 failed / 20 skipped.
- Bundled Node 24.14.0 Runtime/tool/eval/SQLite tests: 22/22, 0 skipped.
- `npm run smoke:small-window`: passed; hot cache 3ms, reopened local cache 4ms.
- `npm run smoke:comps`: passed.
- Bundled Node 24 SQLite file smoke: passed; reopened cache hit and zero unexpected remote calls.

The Node 18 full-suite skips are SQLite/provider/explicit obsolete conditions and are not counted as passed. Node 24 exercised the relevant SQLite paths successfully.

## Compatibility and rollback

Visible behavior changes are additive: each recommendation response now includes `agent_run_public.v1`. Existing response fields and deterministic business results remain compatible. Internal events do not expose raw prompts or Chain-of-Thought.

Rollback by reverting `bfcaa5e`. The nullable SQLite `run_id` column is safe for old code to ignore; no destructive migration is needed.

## Known limits

- Fixed workflow and existing IntentEnvelope remain until phase 2.
- The 50-case suite is a minimum contract set, not a 95% coverage claim.
- Injected-clock evaluation latency is not a production SLA.
- No autonomous Planner, ReAct, MCP, multi-Agent, write tool, paid service or new credential was added.
