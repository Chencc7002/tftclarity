# Phase 6.6 Architecture Convergence

Phase 6.6 is a convergence stage between phases 6 and 7. It does not add a new user-facing capability.

## Target chain

`TaskFrame → Capability Matcher → ExecutionPlan → ExecutionPlanExecutor → Tool Registry / ToolExecutor → Evidence Validator → response`

Single-tool requests use `route: deterministic_fast_path` and do not invoke the model planner. Composite requests use `route: controlled_planner`. Both routes are validated and executed by the same `ExecutionPlanExecutor`.

## Ownership

- `TaskFrame` describes what the user wants.
- `CapabilityMatch` is an intermediate decision, not a plan.
- `ExecutionPlan` is the only active protocol that names tools, complete arguments, dependencies and evidence contracts.
- `IntentEnvelope`, `RetrievalPlan` and `TaskPlan` are compatibility protocols. New execution code must not translate an `ExecutionPlan` back into any of them.
- TFT concept, entity, domain and result-policy values live under `src/domain/tft/`. Generic parser, validator, takeover and recommendation layers must not branch on a named strategy, champion or item.

## Runtime stages

- `resolving`: TaskFrame, entity linking, context and clarification.
- `planning`: capability matching, deterministic compilation or controlled planning, and complete argument finalization.
- `retrieving`: dependency-ordered ExecutionPlan execution through registered tools.
- `validating`: structured evidence and generated-conclusion evidence checks.
- `responding`: response serialization and persistence.

Tool events record `executionSource`, `executionPlanRoute` and `executionStepId`. Stage failures remain attached to the stage that performed the work.

## Status protocol

The versioned `agent-status.v1` record owns six independent dimensions:

```json
{
  "understandingStatus": "understood",
  "capabilityStatus": "supported",
  "planningStatus": "planned",
  "executionStatus": "completed",
  "evidenceStatus": "sufficient",
  "finalOutcome": "answered"
}
```

Legacy TaskFrame status strings remain readable during migration but do not replace capability, planning, execution or evidence status.

## Migration and rollback

1. Validate the executor offline.
2. Compare new and legacy tool names and complete parameters.
3. Cut over deterministic read-only single-tool requests.
4. Expand by action only after gates pass.
5. Keep RetrievalPlan as a visible fallback when the new chain is invalid or outside rollout.
6. Disable the fallback only after result equivalence and safety gates pass.

Every routed request records selected path, fallback reason, tool difference, parameter difference, result-comparison status, step count, latency, token use and failure stage. Rollback sets action rollout to zero; it does not require a data migration.

## Hard gates

- Every supported request has a valid ExecutionPlan.
- Production tool calls for cut-over traffic have `executionSource: execution_plan`.
- Tool-name accuracy is at least 99%; complete parameter semantic accuracy is at least 98%.
- Single-tool tasks average one step; every plan and run uses at most three tool calls.
- Wrong-tool calls are below 1%; core new/legacy public business-result equivalence is at least 99%. Parameter semantic equivalence is reported separately.
- Independent context Pass^3 is at least 95%; unsupported capability downgrade is 100%.
- Arbitrary SQL, arbitrary URL and unregistered tools remain impossible.
- Generic Agent code contains no named champion, item or strategy instance.
- Tests inspect execution source, complete arguments and stage trace, not only final answer text.
- Existing tests pass without fixing failures through complete-sentence regexes or evaluation-set leakage.

## Final verification

- Full regression: `npm test` — 640 total, 620 passed, 0 failed, 20 conditionally skipped.
- Architecture evaluation: `architecture-convergence-phase66.v2` — 120 core cases and 36 independent holdout cases; every gate passed.
- Execution sovereignty, tool-name accuracy, complete parameter semantics, parameter equivalence, public business-result equivalence and unsupported honest downgrade: 100%.
- Real LLM T3 v2: 120 independent cases × 3 repetitions, 360/360 successful requests, 0 provider fallback, Pass@3 100%, Pass^3 100%.
- T3 tool selection, complete arguments, plan shape, context Pass^3 and unsupported honest downgrade: 100%.
- Provider/model: `chat` / `deepseek-v4-flash`; executed at `2026-07-26T01:53:08.724Z`.
- Reports: `docs/reports/phase-6-6-1-live-llm-t3.md` and `docs/reports/phase-6-6-1-live-llm-t3.json`; full per-run artifacts remain under `.cache/eval/`.
