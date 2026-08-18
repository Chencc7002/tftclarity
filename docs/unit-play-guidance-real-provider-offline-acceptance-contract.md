# Unit Play Guidance Real-provider Offline Acceptance Contract — PR1D-Contract

Status: **docs-only architecture contract; implementation and paid/provider calls are not authorized**.

PR1C established deterministic, isolated guidance value in a frozen ReAct/Tool/Evidence replay. It did not establish real-model instruction compliance, output stability, actual token cost, or actual end-to-end latency. PR1D is a separately reviewed offline acceptance phase for those claims only. Passing PR1D would authorize only another architecture/product review; it would not authorize production control, canary, rollout, or PR2.

## 1. Acceptance question and non-claims

PR1D may answer one question:

> With the frozen PR1C population and Tool observations, does the version-pinned `unit_play_guidance` candidate preserve architecture safety and deliver repeatable facet value through the production-like real React decision provider at acceptable measured cost?

PR1D must not claim live-data quality, production traffic suitability, provider model immutability, general Skill routing value, or value for any Skill other than `unit_play_guidance`. It must not use real user conversations or live Tool retrieval.

## 2. Frozen experiment identity

The canonical run is bound to the following PR1C inputs. A mismatch is a preflight failure; the corpus, fixtures, rubric, baseline guidance, or candidate content must not be redesigned after real-provider results are visible.

| Field | Frozen value |
| --- | --- |
| Experiment ID | `unit-play-guidance-real-provider-offline.2026-08-18.v1` |
| PR1C implementation commit | `03570d36740786b976c2b969c9762da84e126043` |
| PR1C closure/report commit | `f6903d7` |
| Corpus | `unit-play-guidance-control-corpus.2026-08-18.v1` |
| Corpus normalized SHA-256 | `49f74b710b3bb1bbad04c2aa9656752738b55ba80c22e0aa4f5bd3d68929ee7a` |
| Frozen observations | `unit-play-guidance-frozen-observations.2026-08-18.v1` |
| Observation normalized SHA-256 | `7c4ef33836284b0970fa241f1ba9151512e4b78a45f535a3f8464c99f5a1f338` |
| A guidance | `react-semantic-guidance.unit-play.v1` |
| A guidance SHA-256 | `7a20b6a579e279cfbf5cbdd778de21ee757c1d4bb2c9d13b54df8d3ae0734123` |
| B candidate | `unit_play_guidance.experiment.v1` |
| B candidate content SHA-256 | `8a28b75dcb32909970aaf7b63681b6acf4ccf7d1ee440e300412363a01e5ccfc` |
| B rendered context SHA-256 | `c0f5395e9266b65ecb50eccde93112eb964cd1cf3e1df9993d21b960eb2637f9` |

The implementation commit above identifies the frozen experiment content, not a permission to execute PR1D from a dirty or old checkout. A canonical report must additionally record its actual clean worktree commit and content hashes.

## 3. Provider and request configuration

The canonical provider identity is frozen before any real call:

| Field | Required value |
| --- | --- |
| Runtime provider config | `chat` |
| Provider protocol | `openai-compatible-chat` |
| Endpoint class | `chat_completions` |
| Endpoint | `https://api.deepseek.com/chat/completions` |
| Configured model ID | `deepseek-v4-flash` |
| Provider implementation | repository `createReactDecisionProvider` |
| Provider kind | `react_decision_llm` |
| Decision prompt | `react-decision-contract.v5` |
| Message layout | `append_only` |
| Stable/run/transcript schemas | `react-stable-context.v1`, `react-run-context.v1`, `react-transcript-event.v1` |
| Temperature | `0` |
| `top_p` | omitted; provider default |
| Normal max output tokens | `1800` |
| JSON-repair max output tokens | `700` |
| Response format | `{ "type": "json_object" }` |
| Thinking mode | runtime value `disabled`; request includes `"thinking": { "type": "disabled" }` |
| Per-decision timeout | `25000 ms` |
| Provider action attempts | at most `2`: initial response plus one JSON/action repair attempt |
| Transport retry | none inside the decision provider |
| Agent deadline | `30000 ms` per complete Agent run |
| Agent decision budget | `24` |
| Tool retry budget | `1` per Tool |
| Grounding | `strict` |
| Explicit cache namespace | `null` for both arms |
| Client response cache | disabled; no response or action is reused between runs |

The full message order remains the current append-only layout: decision-contract system message, stable Tool Catalog system message, frozen run-context user message, then ordered transcript events; a repair user message is appended only after an invalid first response. A and B may differ only at the professional-guidance rendering boundary defined in section 4.

Provider-side prompt caching may occur opaquely. It must not be enabled or disabled differently by arm. Every request records cached and uncached input tokens when the provider reports them. Cache hits do not permit skipping a call, copying an action, or sharing mutable state.

`deepseek-v4-flash` may be a provider-controlled alias rather than an immutable model revision. The report must therefore capture the configured model ID and, when returned, the provider response model ID, version, and system fingerprint for every request. A change in a returned identity or fingerprint during the canonical run aborts the run for review. If the provider returns no immutable revision/fingerprint, the report must state that reproducibility limitation; deterministic pair interleaving reduces but does not eliminate provider drift.

No configuration value may be silently inherited for the canonical run. A redacted preflight manifest must serialize every field above and its source. Secrets are represented only as `configured: true|false`.

## 4. A/B injection boundary and implementation seam

The arms keep the PR1C meaning:

- **A — baseline:** the pinned existing `semanticGuidance()` output for eligible `recommend_unit_play`.
- **B — candidate:** the pinned rendered `unit_play_guidance` Skill content as the sole professional unit-play guidance.

B replaces A guidance. It must not concatenate or otherwise double-inject `semanticGuidance` and Skill guidance. The raw request, messages, resolved TaskFrame, `semanticAdvisory`, Tool Catalog, transcript schema, decision contract, Tool observations, validators, budgets, and runtime are otherwise identical.

The real-provider implementation must reuse `createReactDecisionProvider`; copying its HTTP, message, parse, validation, or repair behavior into an experiment provider is forbidden. The only acceptable future implementation seam is a constructor-injected, pure guidance renderer with these restrictions:

- absence of the option produces byte-identical current production messages;
- the renderer receives only the already-bounded semantic advisory and returns only the professional-guidance value;
- it cannot alter the decision contract, Tool Catalog, Tool arguments, transcript, Evidence, budget, endpoint, or provider parameters;
- only the experiment harness may pass the candidate renderer;
- production request handlers do not import experiment code and never pass the option;
- automated tests prove default-message byte identity and zero candidate-context leakage into A, ineligible, negative, boundary, fallback, or production runs.

This seam is a proposal frozen for implementation review, not current permission to edit ReAct production code. If it cannot be implemented without a broader provider fork or production behavior change, implementation must stop and return for architecture review.

## 5. Canonical population, repetition, and pair order

The frozen population is not resampled:

- 30 positive eligible cases run through the real provider;
- each eligible case runs both A and B for three repetitions;
- total planned complete Agent runs: `30 × 2 × 3 = 180`;
- the frozen 20 negative cases and 10 boundary cases remain deterministic routing/eligibility tests and are not multiplied into paid model runs.

Each `(caseId, repetition)` is a paired unit created from one immutable pre-fork input. Pair order is deterministic:

```text
digest = SHA-256(UTF-8(experimentId + "\0" + caseId + "\0" + repetition))
if (digest byte 0 & 1) == 0: A then B
else: B then A
```

Repetition is the integer `1`, `2`, or `3`. The runner processes pairs in the frozen corpus order and must never execute all A runs before all B runs. A and B get independent WorkingState, EvidenceLedger, DuplicateCallGuard, run ID, telemetry, abort controller, termination state, and temporary objects. They share immutable inputs and byte-identical frozen Tool observations only.

No run may be substituted after inspecting its output. A rerun after infrastructure interruption creates a new attempt record; it does not overwrite the original. Only one fully declared canonical attempt can be used for acceptance.

## 6. Failure taxonomy and analysis population

Every planned run receives exactly one terminal classification:

- `normal_provider_completion` — the Agent completes through normal provider execution and all required runtime validators;
- `provider_transport_failure` — HTTP 429, timeout, connection failure, HTTP 5xx, or declared provider unavailable response;
- `provider_parse_failure` — the provider returns no valid `react-action.v1` after the one allowed repair attempt;
- `candidate_skill_failure` — B candidate definition, context, renderer, or candidate-only runtime construction fails;
- `grounding_failure` — finish/answer is rejected by existing Evidence, freshness, temporal, narrative, or grounding validation;
- `budget_failure` — Agent deadline, decision budget, Tool budget, no-progress fuse, or another declared runtime budget terminates the run.

Provider HTTP 4xx other than 429 is a configuration/protocol failure and aborts the canonical attempt; it is not relabeled as random transport noise. Unknown terminal states also abort for review.

Only a pair in which both A and B are `normal_provider_completion` enters the primary paired value and cost analysis. Exclusion never erases the pair: all excluded pairs, attempts, arm, reason, completed telemetry, and partial usage are reported. Safety, stability, failure-rate, and early-abort analysis uses all planned runs; a failed B repetition is not treated as facet coverage.

Minimum valid-sample gates are both required:

- at least `81/90` paired repetitions have normal A and B completion;
- at least `27/30` cases have at least two valid paired repetitions.

Falling below either threshold makes the acceptance result `INCONCLUSIVE` and therefore not passed. It is not permission to weaken the corpus, add repetitions selectively, or change the provider. Provider/failure counts and rates must be shown separately by arm and failure class.

## 7. Immediate-abort safety gate

The first zero-tolerance violation aborts the canonical run, marks PR1D `FAIL`, and preserves every completed artifact. The remaining provider calls must not be issued. Zero tolerance applies to:

- unauthorized, unregistered, unsupported, or arm-expanded Tool access;
- server-scoped argument violations;
- historical Evidence represented as current;
- invented numeric/statistical claims;
- Evidence, freshness, temporal, narrative, or grounding violations;
- duplicate deterministic Tool calls;
- deterministic `nextActionAffordance` priority violations;
- Tool, decision, deadline, approval, or permission budget overrun;
- candidate context in A, an ineligible/negative/boundary run, fallback A, production code path, or persisted conversation state;
- a Skill-routing or Skill-completion model call;
- a second TaskFrame parse;
- a production import of experiment code;
- any conversation-state write.

Preflight deterministic routing, isolation, hash, schema, and fault tests run before the first provider call. A preflight failure issues zero paid calls.

## 8. Three acceptance layers

All three layers must pass. Aggregate value cannot compensate for a safety, stability, or cost failure.

### 8.1 Safety and architecture — zero tolerance

Canonical results require all metrics below to be zero unless explicitly stated otherwise:

- unauthorized/unsupported Tool calls;
- Tool Catalog expansion and server-scope violations;
- historical-as-current, invented-statistic, and grounding violations;
- duplicate deterministic calls and `nextActionAffordance` priority violations;
- budget overruns;
- Skill-routing or Skill-completion model calls;
- second TaskFrame parses;
- normal, unforced fallback;
- production imports of experiment code;
- conversation writes.

The frozen negative false-takeover count and boundary forced-takeover count must remain zero. The separately frozen five PR1C fault classes must fall back to clean pinned A in `5/5` cases, with zero wrong destinations. Fault injection is deterministic and separate from the 180 normal real-provider runs.

### 8.2 Paired value — B-native only

On valid pairs, B-native must satisfy all of:

- required Evidence Facet Coverage `B >= A`;
- required Answer Facet Coverage `B >= A`;
- either total supported-facet Answer Coverage improves by at least `10` percentage points, or missing-required-facet rate decreases by at least `20%` relative to A.

Value is computed from paired per-run labels, with case/repetition numerators, denominators, and failures retained. B-end-to-end fallback output is safety/user-impact reporting only and cannot rescue B-native value.

### 8.3 Candidate stability

At least `27/30` eligible cases must cover every fixture-available required facet in at least two of their three B-native repetitions. Candidate failures and missing/invalid facets count as uncovered.

The report must show case distributions for `3/3`, `2/3`, `1/3`, and `0/3`, plus the same stability distribution per facet. `positioning` remains required only when supported by the frozen fixture; unsupported positioning requires a visible qualification and cannot be scored as a fabricated recommendation.

## 9. Facet adjudication — substantive, claim-aware, and blinded

Keyword presence is never sufficient for Evidence or Answer Facet Coverage. Primary Answer labels are produced from a frozen, arm-blinded rubric. Reviewers see randomized outputs without arm, repetition, provider usage, or candidate labels. At least two independent labels are required; disagreements are resolved by a predeclared adjudicator and both original labels remain in the artifact.

A facet counts only when all applicable conditions hold:

1. the answer contains substantive user-facing content for that facet, not merely its label;
2. the content's claim kind is identified as current fact/statistic, source recommendation, official mechanism, maintained rule, general heuristic, or model inference;
3. cited Evidence exists and is valid/fresh for claim kinds that require it;
4. advice or inference is visibly qualified and does not impersonate a current fact;
5. the statement obeys the frozen facet-specific use policy.

Examples that do not count:

- writing `主C` or `主坦` merely because a champion is a composition member or itemized candidate;
- naming a recommended item without explaining supported equipment logic;
- listing a composition name without explaining the supported composition context;
- repeating `站位` without an observed formation or a clearly qualified non-factual suggestion;
- turning guide membership into a statistical ranking, causal claim, or negative evidence;
- restating an unsupported facet heading followed only by a limitation.

Composition membership remains evidence of membership only. It cannot become a carry, tank, flex, strength, or priority claim without separate support or an explicit qualitative-inference label.

Evidence Facet Coverage remains deterministic and claim-use-aware: the existing Evidence validators run first, then the frozen facet mapping and evidence-use policy. Reviewer judgment cannot promote invalid, stale, historical, or unrelated Evidence.

## 10. Actual cost and structured-action quality

PR1D replaces the PR1C estimator with provider-reported usage. Usage is summed across every decision request and repair attempt in a complete Agent run:

- cached input tokens;
- uncached input tokens;
- total input tokens;
- output tokens;
- total tokens.

Latency is measured with a monotonic clock at three layers:

- complete Agent-run end-to-end latency;
- cumulative and per-call decision-provider latency;
- cumulative frozen Tool replay latency.

For valid paired runs, B must pass:

- mean actual total tokens `B <= A × 1.20`;
- mean Agent end-to-end latency `B <= A × 1.20`;
- mean Tool calls `B <= A + 0.5`;
- p95 Tool calls `B <= A + 1`;
- mean decision-model calls `B <= A + 0.5`;
- p95 decision-model calls `B <= A + 1`.

The report additionally includes p50/p95 distributions and paired deltas for actual tokens, latency, Tool calls, and decision calls. If the provider omits token usage for any successful request, that run is not silently estimated; missing-usage rate is reported and the cost gate is `INCONCLUSIVE` unless complete paired cost coverage still meets the declared minimum sample gates.

Structured-action quality is reported by arm:

- JSON/action repair rate: decisions needing the one repair attempt divided by decisions;
- decision retry rate: all retry telemetry events divided by decision requests;
- invalid action rate: initial responses failing JSON parse or `react-action.v1` validation divided by initial responses;
- terminal provider-parse failure rate.

There is no absolute repair-rate pass threshold in PR1D. However, a material unexplained B degradation requires architecture review and prevents automatic PASS; for example, A at 1% and B at 15% is not accepted merely because final actions validate.

## 11. Secrets, privacy, and artifact policy

- API keys are supplied only at execution time and never written to fixtures, manifests, logs, reports, snapshots, or commits.
- Authorization headers and complete request headers are never logged.
- Only the frozen evaluation corpus is sent; real user messages, production conversation IDs, cookies, account data, and Conversation Bridge history are forbidden.
- Provider request artifacts contain the frozen messages needed for audit but are redacted of credentials and provider account metadata.
- Provider error text is bounded and reviewed before persistence.
- No hidden reasoning or chain-of-thought is requested or stored.

Future implementation may add only separately approved experiment artifacts such as:

```text
eval/skills/unit-play-guidance-real-provider/config.v1.json
eval/skills/unit-play-guidance-real-provider/run-manifest.v1.json
eval/skills/unit-play-guidance-real-provider/results.v1.jsonl
eval/skills/unit-play-guidance-real-provider/facet-labels.v1.jsonl
docs/unit-play-guidance-real-provider-offline-acceptance-report.md
```

Each record must carry experiment/config/content hashes, case ID, repetition, arm, deterministic pair order, attempt ID, terminal classification, model identity fields when returned, request/repair counts, usage, latency, Tool calls, Evidence IDs, facet labels, violations, and exclusion reason. Raw secrets and mutable environment dumps are forbidden.

## 12. Canonical procedure

1. Start from a clean reviewed commit and verify every frozen hash.
2. Materialize and redact the exact provider/config manifest; no silent environment inheritance.
3. Run deterministic 30/20/10 eligibility, isolation, default-message identity, no-import, no-write, and five-class fallback preflight tests.
4. Freeze reviewer rubric, blind-label schema, runner version, and report schema before real results.
5. Execute the 90 interleaved pairs in frozen corpus order, stopping immediately on a zero-tolerance violation or provider identity drift.
6. Preserve every attempt and classify all 180 planned runs; never overwrite or silently drop failures.
7. Compute primary value/cost only on valid normal-completion pairs; compute stability and safety over their declared full populations.
8. Complete blinded facet adjudication without changing candidate content or rubric.
9. Produce one machine-readable result and one qualified report with PASS, FAIL, or INCONCLUSIVE per gate.
10. Return to product/architecture review. Do not enable control or begin PR2.

## 13. PR1D-Contract Definition of Done

This docs-only contract is complete when it freezes:

- exact provider, endpoint class, configured model, prompt, request, timeout, retry, message, and cache behavior;
- the unchanged PR1C population and `180` complete-Agent-run design;
- deterministic paired interleaving and arm-local state;
- failure taxonomy, complete reporting, and minimum valid sample gates;
- immediate-abort zero-tolerance safety rules;
- B-native value, candidate stability, actual cost, and structured-action quality gates;
- a substantive, claim-aware, blinded facet rubric that cannot keyword-score;
- secrets, privacy, artifacts, reproducibility limitations, and stop conditions;
- the narrow future guidance-renderer seam requiring separate implementation approval.

Production code changes, real-provider calls, feature flags, database work, and runtime behavior changes must remain zero in PR1D-Contract.

## 14. Explicit non-authorization

PR1D-Contract does not authorize:

- a real-provider harness or any real model call;
- a production handler, Prompt, SkillContext, ReAct, Tool Catalog, permission, approval, budget, or conversation-state behavior change;
- `AGENT_SKILLS_CONTROL_V1` or an equivalent production/offline-control feature flag;
- production A/B assignment, canary, rollout, or deletion/replacement of production `semanticGuidance`;
- PR2, database or migration work, scheduler/daily snapshot work, production MetaTFT ingestion, Manual Overlay, or Effective View;
- a new Tool, LLM Skill Router, LLM completion evaluator, or another Skill;
- `transition_decision`, `game_state_decision`, or timeline-based `match_review`.

After architecture approval, a separately authorized implementation proposal may implement only the bounded offline harness and the minimal reviewed guidance-renderer seam. It must still return for review before issuing real calls if provider cost/credential authorization has not also been granted.
