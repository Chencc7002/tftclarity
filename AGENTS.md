# TFTAgent repository guide

Start with these sources before changing Agent behavior:

- `docs/phase-6-6-architecture-convergence.md` — deterministic TaskFrame/ExecutionPlan path.
- `docs/react-chat-r1-architecture.md` — independent ReAct path and its safety boundary.
- `docs/conversation-state-v2-development-handoff.md` — conversation-state ownership.
- `docs/tftclarity-agent-skills-architecture-development-handoff-v2.md` — Skills roadmap and non-goals.
- `docs/agent-skills-architecture-contract-pr0.md` — audited Skills contracts and PR1 split.
- `docs/unit-play-guidance-control-experiment-contract.md` — docs-only PR1A.5 gates; does not authorize control.
- `eval/README.md` and `eval/` — offline evaluation entry points and datasets.

Key constraints:

- Treat current code as authoritative when a document is stale; record the discrepancy.
- Keep Quick Task deterministic. Do not route a stable parameterized query through a Skill.
- Do not create a second runtime beside TaskFrame/ExecutionPlan or ReAct.
- Only registered tools may retrieve facts. Skills cannot access a database or network directly, add tools, or widen permissions.
- Preserve strict tool schemas, server-scoped arguments, Evidence validation, deterministic `nextActionAffordance`, budgets, and approval policy.
- Historical Conversation Bridge Evidence is not current Evidence.
- Prefer deterministic code for set operations, filtering, ranking, freshness, progress, and completion checks.
- Ship behavior changes shadow-first, observable, reversible, and with the legacy path intact.
- Do not implement `transition_decision`, `game_state_decision`, or timeline-based `match_review` without a new approved data contract.
- Preserve unrelated working-tree changes.

Canonical repository baselines:

```powershell
npm run test:ci:main
npm run test:ci:integration
npm run eval:agent
```

`npm test` may also discover ignored `.cache/bilibili-mcp-js/test*` copies in a dirty local workspace. Do not change unrelated test discovery or cache contents in an Agent/Skills PR; use the explicit CI lanes above as the canonical repository regression.

For focused Agent work, run the relevant `test/task-frame*`, `test/phase5*`, `test/phase66*`, `test/react-*`, and `test/conversation-*` suites before the full regression.
