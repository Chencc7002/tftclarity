# Phase 6.6.1 Real LLM T3 Acceptance

- Result: PASS
- Evaluation: `live-llm-t3-evaluation.v2`
- Dataset: `live-llm-t3-independent.v2`
- Provider/model: `chat` / `deepseek-v4-flash`
- Executed at: `2026-07-26T01:53:08.724Z`
- Cases/repetitions/requests: 120 / 3 / 360
- Request success: 100% (360/360)
- Provider fallback: 0%
- Pass@3 / Pass^3: 100% / 100%
- Domain/action/status: 100% / 100% / 100%
- Entity mention/Top-1: 100% / 100%
- Tool selection: 100%
- Complete argument semantics: 100%
- Plan shape: 100%
- Clarification: 100%
- Unsupported honest downgrade: 100%
- Context Pass^3: 100%
- Token/latency budget pass: 100% / 100%
- Total tokens: 488,707
- Average/P95 request latency: 1,529.37 ms / 1,901.20 ms
- Wall time: 138,549.32 ms

All six category slices—slang, typo, context, comparison, unknown entity and unsupported—had 60/60 passing runs. The full per-run JSON and Markdown artifacts are generated at `.cache/eval/phase-6-6-1-live-llm-t3.json` and `.cache/eval/phase-6-6-1-live-llm-t3.md`.
