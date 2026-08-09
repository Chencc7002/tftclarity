# R1 G5 Real Acceptance Conclusion

- Date: 2026-08-09
- Service: `http://127.0.0.1:17335/`
- Final HTTP artifact: `.artifacts/r1-acceptance/r1-real-g5-matrix-final-pass.json`

## G5-O final product decision

The follow-up G5-O orchestration gate is complete and has received formal product approval.

- Decision: `G5 Autonomous ReAct Orchestration PASS`; `G5 OVERALL PASS`.
- Next gate: `G4-B Evidence-driven Allocation` is formally unlocked.
- Final G5-O artifact: `.artifacts/r1-acceptance/r1-real-g5o-gate-final-candidate.json`.
- Browser verification: the local production-backed frontend displayed `模型最终结论` with the provenance label `基于本轮真实工具证据生成`, plus constraint audit, one stable option, two alternatives, samples, and top-four rates.
- The frontend also preserves rejected model prose separately as `模型原始结论（未通过校验）`; it is explicitly not presented as the final recommendation.

The accepted three-case production matrix used three different dynamically selected compositions, two exclusions, and one positive lock:

- Legal completion: 3 / 3.
- Non-empty constrained results: 3 / 3.
- Constraints applied before ranking: 3 / 3.
- Exclusion/lock semantics correct: 3 / 3.
- First-attempt `unit_builds_batch` schema valid: 3 / 3.
- Actual constrained batch executions: exactly one per case.
- Duplicate warnings / second executions / unknown tool executions / schema-invalid executions / unsupported statistics: all zero.
- Answer origin: model-grounded 2 / 3; transparent system evidence fallback 1 / 3, matching the approved gate.
- Tool sequence in all cases: `comps_rankings -> baseline unit_builds_batch -> constrained unit_builds_batch -> finish`.
- Regression: 124 passed, 1 skipped, 0 failed.

The product decision records that `item_details_batch = 0` is correct for these cases because the deterministic next-action affordance set mechanism lookup to `required=false`. Avoiding an unnecessary lookup is evidence of correct orchestration, not a capability omission.

For G4-B, the approved boundary is evidence-driven counterfactual allocation. The evaluator may return `supported_preference`, `no_clear_preference`, or `insufficient_evidence`; it must not infer allocation priority solely from unverified labels such as primary carry, primary tank, core member, champion cost, or model intuition.

## Verdict

`unit_builds_batch` now has a genuine query-affecting constraint contract and passes the product-defined two-composition production HTTP matrix.

- Valid dynamic compositions: 2 / 2 required.
- Required checks: 17 / 17 in both cases.
- Runtime provenance: real model (`deepseek-v4-flash`), production handlers, live-or-production-cache data, fixture mode false.
- Selection contains no hardcoded composition, champion, or item names.
- Final answers expose `answerOrigin`; validated model text and system evidence fallback are no longer mislabeled as the same source.

This proves the G5 tool capability. It does not prove that the model orchestration is warning-free: both final cases needed schema repair and ended with a transparent evidence fallback after a later invalid/repeated action.

## Contract implemented

`unit_builds_batch` accepts:

```json
{
  "entities": [],
  "compositionId": "...",
  "optionsPerUnit": 3,
  "constraints": {
    "lockedItems": [],
    "excludedItems": []
  }
}
```

The constraint is included in the query/cache fingerprint, applied to raw MetaTFT source rows before ranking, echoed in response provenance, and audited per unit with source-row and eligible-row counts. Unknown items and lock/exclude conflicts are rejected.

The ReAct loop now validates tool arguments against the registered JSON Schema before recording a duplicate-call fingerprint. Invalid shapes receive repairable validation errors and never reach the handler. A constrained call still requires an explicit user instruction, grounded item evidence, and a prior unconstrained baseline for the same unit scope.

## Dynamic selection

The source compositions came from the live composition ranking endpoint. The exclusion item was selected by this deterministic rule:

> Among contested items, choose the lowest participant prevalence where every participant retains at least one retrieved alternative build.

The acceptance runner contains no named entities or item IDs. The selected names below are outputs of the live run, not inputs embedded in code.

## Passing case 1

- Composition: `挑战者 · 卑尔维斯` (`cluster:409019`).
- Dynamically selected exclusion: `血手` (`TFT_Item_SteraksGage`).
- Tool sequence: `comps_rankings -> unit_builds_batch baseline -> unit_builds_batch constrained`.
- Baseline fingerprint: `d0a64dd4f6036eb9d19c92161e7ca8e53f85dc8f7c32ef76c71d03d4652982a8`.
- Constrained fingerprint: `118f0e058536ab2f29165c1b5f40dc6e88c4ec3c3a4bb0ece60fbcefaed851a3`.
- Eligible rows:
  - 金克丝: 179 -> 179
  - 卑尔维斯: 369 -> 309
  - 雷克塞: 259 -> 247
  - 阿卡丽: 340 -> 278
- Returned constrained options: 12; excluded item occurrences: 0.
- Answer origin: `system_evidence_fallback`.

## Passing case 2

- Composition: `神谕者 · 佐伊` (`cluster:409054`).
- Dynamically selected exclusion: `反甲` (`TFT_Item_BrambleVest`).
- Tool sequence: `comps_rankings -> unit_builds_batch baseline -> unit_builds_batch constrained`.
- Baseline fingerprint: `4afe70e8a1c1c236747d302970bad81331dc7b766fd63aa60cc874455fb32608`.
- Constrained fingerprint: `c064219dd56899ac731cee8c4650e7bcbea0a295b0904a6d9d26513c515d33fa`.
- Eligible rows:
  - 佐伊: 348 -> 348
  - 蕾欧娜: 282 -> 235
  - 维克托: 226 -> 226
  - 莫德凯撒: 339 -> 284
- Returned constrained options: 12; excluded item occurrences: 0.
- Answer origin: `system_evidence_fallback`.

## Model boundary and failure frequency

The final formal matrix passed both cases on the first attempt. An immediately preceding stabilized rerun required three attempts for two valid compositions because the first composition-ranking call timed out once. Across these two post-fix reruns: 4 valid composition cases out of 5 attempts; the only failed attempt was a recorded `comps_rankings` timeout.

In the final formal run, the model made these orchestration errors:

- 2 / 2 cases initially added unsupported `seasonContextId` to `unit_builds_batch`; schema-first validation rejected it and the model repaired the action.
- After valid constrained evidence existed, one case repeated `unit_builds_batch`; the other repeatedly selected an invalid `item_details_batch` plan.
- No fabricated tool result or model-generated statistic was accepted. The final text was generated deterministically from accepted evidence and labeled `system_evidence_fallback`.

This is the current model boundary: the tool contract and evidence chain work, while the model still has a high action-shape/sequencing error rate on this multi-step conditional query.

## Automated verification

- Targeted ReAct, schema, cache, and frontend tests: 57 / 57 passed.
- Query contract tests prove baseline and constrained requests use distinct cache keys.
- Source-row tests prove exclusions are applied before ranking and excluded items are absent.
- ReAct tests prove missing baseline/grounding is rejected, invalid shapes are repairable before fingerprinting, and fallback text preserves the constraint audit.

## Product decision requested

Please review two separate decisions:

1. G5 tool capability acceptance: recommend `PASS` based on the two-composition 17-check production matrix.
2. Model orchestration quality: recommend keeping as a visible follow-up gap before G4-B, because both passing cases required schema repair and system evidence fallback even though no unsupported facts escaped.
