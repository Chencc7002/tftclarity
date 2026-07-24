# Phase 0-3 Acceptance Audit and Live LLM Smoke

- audit date: 2026-07-23
- result: PASS
- scope: phases 0, 1, 2 and 3
- live evaluation tier: T2 live LLM smoke
- production behavior: unchanged; TaskFrame provider remains opt-in and the deterministic/legacy execution chain remains authoritative

## Artifact and commit audit

| Phase | Code and tests | Evaluation report | Verified commits | Result |
| --- | --- | --- | --- | --- |
| 0 | 300-case dataset, phase-0 runner and dataset contract tests | `phase-0-baseline.md/json` | `f551390` | PASS |
| 1 | agent runtime, budgets, tool registry/executor, 50-case runner and tests | `phase-1-agent-runtime.md/json` | `bfcaa5e`, `3c72699` | PASS |
| 2 | TaskFrame, semantic parser, context policy, shadow comparison and tests | `phase-2-semantic-parser.md/json` | `2d16226`, `0d25453` | PASS |
| 3 | entity mention extraction, entity/concept linking, 177-case runner and tests | `phase-3-entity-linker.md/json` | `fe84785`, `8b676fe`, `4996a7d` | PASS |

All four JSON reports are tracked by Git and their report commits were found in history. The untracked master-plan document was treated as user-owned and was not modified or staged.

## Missing acceptance item found and filled

The repository already had historical real-provider evidence and a one-query `npm run smoke:llm` connectivity check. The audit reran that command successfully against `chat` / `deepseek-v4-flash` at `api.deepseek.com`.

That check did not satisfy the master plan's new T2 requirement for a 20-50 case real-model evaluation of the phase-2 TaskFrame parser. The audit added:

- `npm run eval:llm:live`, guarded by the explicit `TFT_AGENT_LIVE_LLM=1` switch;
- independent `live-llm-smoke.v1` with 20 representative cases;
- strict raw `task-frame.v1` validation before normalization;
- hard request, per-request token, total token, latency and wall-clock budgets;
- provider/model, prompt/schema/tool versions, temperature, cached/uncached/output token counts, total latency, retry count and sanitized errors;
- raw structured outputs in ignored `.cache/eval/phase-0-3-live-llm.json`;
- no API key, authorization header or endpoint path in reports.

## Real LLM result

Final command:

```powershell
$env:TFT_AGENT_LIVE_LLM='1'
npm run eval:llm:live
```

Configuration:

- provider/model: `chat` / `deepseek-v4-flash`
- endpoint host: `api.deepseek.com`
- temperature: `0`
- response format: `json_object`
- thinking: disabled
- TaskFrame/context/prompt/tool versions: `task-frame.v1`, `semantic-parser-context.v1`, `live-semantic-task-contract.v2`, `agent_tool.v1`

Final metrics:

- requests and strict structured outputs: 20/20, 100%
- domain accuracy: 95%
- action accuracy: 95%
- understanding-status accuracy: 85%
- entity-mention recall: 92.31%
- input, output and latency budget pass rates: 100%
- cached/uncached/output tokens: 11,648 / 5,802 / 3,907
- average/P95/total latency: 1,718.77ms / 2,262.33ms / 34,408.41ms
- retries: 0
- first-token latency: unavailable because the checked path uses non-streaming chat completions
- monetary cost: not estimated because provider pricing was not configured; exact token counts were retained

The final smoke gates all passed. Five non-gating disagreements remain visible in the raw and Markdown reports:

- one composition entity omission;
- one composition recommendation classified as `search`;
- standalone 九五 explanation marked supported instead of unsupported;
- the prohibited player-database request classified out of domain instead of TFT/unsupported;
- the homophone champion typo treated as supported instead of ambiguous.

These are below the T2 gate thresholds and are retained as future prompt/evaluation evidence; no deterministic phase-2 behavior was changed to hide them.

## Observed live iterations

1. With a 450-output-token limit, 0/20 strict outputs completed; the model exhausted completion budget before final JSON.
2. With a 1,200-output-token limit and thinking enabled, 15/20 strict outputs completed; five responses still exhausted the limit.
3. With the same hard 1,200-token limit and thinking disabled, 20/20 requests returned valid TaskFrames and all T2 gates passed.

The failed runs remained explicit non-zero exits and were not converted into mock or deterministic successes.

## Final regression and evaluation rerun

- `npm test`: 599 total / 579 passed / 0 failed / 20 conditional skips
- new provider plus semantic parser targeted tests: 7 passed / 0 failed
- `npm run eval:phase0:check`: 300 cases, PASS
- `npm run eval:agent`: 50/50, PASS
- `npm run eval:phase2`: action 96%, domain 97.67%, unsupported understanding 100%, all budgets PASS
- `npm run eval:phase3`: core Top-1 100%, alias Top-3 100%, concepts 100%, nonexistent false-hit 0%
- `npm run smoke:small-window`: PASS
- `npm run smoke:comps`: PASS

## Conclusion

Phases 0-3 remain accepted. The only missing acceptance layer was the phase-specific real-LLM T2 smoke; it is now implemented, repeatable behind an explicit live switch, and passed against the configured real provider. This audit is not a T3 release evaluation and does not claim production Pass@k or Pass^k stability.
