# Skills Core Convergence — 2026-08-30

Status: implemented for shadow/offline use; production control remains absent.

Follow-up: `docs/agent-skills-outcome-shadow-20260830.md` records the second
implementation batch, including real ToolResult adapters and finished-run shadow
telemetry. The implementation and verification sections below describe batch one.

This is the first implementation step following the Skills audit and the user's
instruction to proceed. It is not PR1D acceptance, an attempt-03 authorization,
or approval for production control or MetaTFT guide ingestion.

## Changes and compatibility

- `unit_play_guidance` advances to content version `1.1.0` in the shadow registry.
  Its professional instructions and facet requirements match the PR1C candidate:
  role, equipment logic and composition context are required; positioning must be
  covered when supported, otherwise explicitly qualified; when-to-play is optional.
- `UNIT_PLAY_GUIDANCE_SKILL_V1` preserves the old `1.0.0` definition. The archived
  PR1C/PR1D harness explicitly imports it. Frozen guidance, rendered-context,
  corpus, Tool fixtures, pair order and Provider configuration are not rewritten.
- `SkillDefinition` / `SkillContext` v1 gain an additive
  `required_if_supported` requirement and optional `dataDependenciesAny` per facet.
  Dependencies must be declared by the definition. Legacy definitions remain
  readable, but their coverage must still pass the stricter Evidence checks.
- `projectSkillCompletion` now names the initial coverage-only projection used
  by shadow telemetry and the old small offline dataset. Its `valid` field means
  coverage projection only; it must never authorize a ReAct finish.
- `validateSkillCompletion` is the separate, strict guard. Its call contract now
  requires current context, Ledger-backed claim-use annotations, the actual answer
  and citations, and explicit server policy functions. The production finish path
  does not call this guard yet.

Quick Task, model prompts, model/tool call counts, Tool schemas, budgets,
permissions, Conversation Bridge and existing finish validators are unchanged.
The only application wiring change renames the shadow projection call. No new
control flag, Skill router, runtime, network client, database or Tool was added.

## Availability and progress

`buildSkillContext` accepts optional, request-scoped `dataAvailability`
observations from trusted runtime/data policy code, never from model output.

| Runtime fact | Status / reason | Completion treatment |
| --- | --- | --- |
| Handler exists, data not probed | `unknown / not_probed` | Recoverable missing |
| Valid observation of usable data | `available / observed_data` | Still needs facet Evidence |
| Transient source error | `unknown / source_failed` | Recoverable missing |
| Data fails freshness policy | `stale / freshness_failed` | Recoverable missing |
| Tool not permitted/available | `unavailable / source_unavailable` | Explicit qualification |
| Runtime has exhausted permitted retrieval | `unavailable / source_exhausted` | Explicit qualification |
| Requested field/result demonstrably absent | `unavailable / field_unavailable` or `empty_result` | Explicit qualification |

Observed states require an observation time and the dependency's known source.
An observation cannot restore a tool excluded by the runtime intersection.
Observers must record terminal absence only after the existing runtime policy has
ruled out recovery for this request. An arbitrary caught exception is not enough.

Progress is derived per facet. Unavailable positioning does not make equipment
unsupported. Unknown, transient-failure and stale sources do not disappear from
the work remaining. Optional advice need not be retrieved to finish.

Coverage now requires a referenced, validated Ledger entry, a permitted tool, a
supporting claim-use annotation and an explicit server policy decision that
scope, freshness and substantive support all pass. Historical Bridge Evidence
and explicit stale markers are rejected even if an annotation claims freshness.
Tier letters are categorical and cannot override these decisions. The old
unvalidated `facetEvidence` shortcut can no longer supply coverage.

## Answer completion boundary

The strict guard recomputes progress; a caller-supplied `progress: complete`
cannot conceal newly missing Evidence. Every required facet needs one explicit
answer annotation with an exact text span present in the delivered answer:

```js
{ facetId, status: "supported" | "unavailable", text, evidenceIds }
```

Supported spans must cite Evidence accepted for that facet and also cited by the
answer. An unavailable span must describe an actual limitation; a heading alone
does not count. Unknown or duplicate facets, missing citations, invented support,
missing answer text and omitted required facets reject completion.

Three synchronous, deterministic, server-owned policy hooks keep authority out
of Skill instructions and model self-assessment:

- `assessEvidenceUse({ entry, use, facet, context })` returns explicit
  `valid`, `scopeValid`, `freshnessValid`, and `supportValid` decisions. It must
  bind the request's unit/season/patch scope and inspect real supporting fields.
- `assessAnswerFacet({ facet, text, status, evidence, claimEvidenceUses, reasonCode })`
  verifies substantive support or the visible limitation for this exact text.
- `finishValidation({ answer, citedEvidenceIds, evidenceLedger })` composes the
  existing action/finish/grounding policies for this exact answer. Skill coverage
  can never override their rejection.

Missing hooks, thrown errors and async decisions fail closed. Serialized
`{ valid: true }` objects cannot replace the hooks. These hooks may inspect
already retrieved data only; they are not retrieval interfaces, LLM judges,
new tools or an alternative runtime.

## Code audit discrepancy and remaining integration

The current `entity_catalog_query` unit projection exposes identity, cost and
traits, not explicit champion role facts. The frozen experiment's role-bearing
catalog fixture is therefore not a general production role contract.
Version 1.1 allows role coverage from explicit mechanism knowledge only; identity,
cost, traits or composition membership must not be promoted to a role claim.
Adding a different role source requires reviewing its existing/new Tool contract.

This change does **not** implement a production semantic facet assessor. The new
tests use explicit frozen facts and exact supported text with real EvidenceLedger
and finish validation. They establish core rejection/coverage mechanics, not
general natural-language interpretation or model value.

Remaining work identified after batch one (see the follow-up for current status):

1. Implement and audit TFT-specific adapters for real ToolResult field paths,
   request scope, freshness, maintained mechanism knowledge and answer spans.
   Do not substitute fixture tags or keyword matching for these adapters.
2. Feed runtime data observations and accepted claim uses into an end-of-run
   shadow observer, without changing the model input, response or conversation
   persistence. Current production shadow remains an initial projection only.
3. Expand replay to representative real ToolResult fixtures and Chinese/English
   substantive/negative answers. Freeze any new candidate/corpus under new
   versions instead of silently modifying the archived PR1D experiment.
4. Review new Provider execution conditions before another real-model experiment.
   Keep production control, other Skills and PR2 data productization gated.

## Provider recovery preparation — zero calls

The final PR1D report remains authoritative: attempt-02 had 17/90 valid paired
repetitions and 6/30 sufficiently covered cases; its 145 `fetch failed` records
and one decision timeout do not establish a specific transport root cause.

A new proposal must first distinguish DNS/connect/TLS/reset/timeout/HTTP failures
using bounded, allowlisted diagnostics. Do not persist raw error bodies, headers,
credentials or environment dumps. Validate the diagnostic recorder with injected
transport failures before any network/paid probe. Pin the runtime, Provider,
timeout/retry policy, concurrency, candidate version and costs; explain materially
changed conditions. Preserve the 81/90 and 27/30 analyzability gates unless a new
review explicitly changes them. Old runs cannot be reused as new acceptance data.

No real Provider request, paid retry, original artifact modification, production
rollout or canary occurred in this change.

## Verification

Baseline before edits: 268 focused Agent/Skills/experiment/probe tests passed.
Final verification used workspace Node 24.19.0; the default shell Node 18 is below
repository requirements.

| Check | Result |
| --- | --- |
| Focused Agent/Skills/experiment/probe suites | 288 passed, 0 failed |
| New core completion/availability safety tests | 20 passed, 0 failed |
| Canonical main CI lane | 1,240 passed, 0 failed, 7 skipped |
| Canonical integration CI lane | 231 passed, 0 failed, 1 skipped |
| Agent offline evaluation | 50/50 passed |
| Small Skill shadow dataset | 2/2 routing, 3/3 negatives, 3/3 coverage projections, 3/3 fixture Bridge invariants |
| Frozen PR1C/PR1D replay and zero-call preflight | Passed in focused and main lanes |

The small shadow runner now explicitly labels completion results
`coverage_projection_only` with `answerValidated: false`. The 20 new tests cover
substantive fixture-backed answer completion separately; no real-model value
claim is derived from either result.

JUnit artifacts: `.cache/eval/skills-convergence-main.xml` and
`.cache/eval/skills-convergence-integration.xml`. Agent reports remain under
`.cache/eval/agent-eval.*`. No archived report or paid-run artifact was rewritten.

The full CI scripts select the same main/integration lanes as
`npm run test:ci:main` and `npm run test:ci:integration`. Existing unrelated dirty
working-tree changes are preserved and included in the regression environment.
