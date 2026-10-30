# Desktop companion personas — architecture proposal

Date: 2026-10-30. Status: implemented locally, default off; production unchanged.

## Objective

Give desktop companions distinct, consistent voices while retaining the existing
TFTClarity chat, evidence, tools, budgets and conversation ownership. Gwen is the
only selectable character in the first release. Adding a character later must
not require a separate AI runtime or edits to shared reasoning rules.

## Ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| Client character registry | character ID, name, asset manifest, camera, animation mapping, local interaction copy, persona ID | arbitrary system prompts, tool access |
| Server persona registry | allowlisted persona ID, version, identity, tone and expression constraints | tools, sources, model credentials, factual game knowledge |
| Conversation binding | selected persona ID/version for one conversation | user identity or global assistant personality |
| Existing chat runtime | decisions, retrieval, evidence, memory, task completion | character asset rendering |
| Desktop UI | animations and actual-answer excerpt | rewriting factual answers to sound cute |

Character and persona are separate IDs: `prestige-gwen` can reference
`gwen-companion.v1`; a future skin can reuse the voice without duplicating it.
Client animation state names remain shared. Per-character manifests map them
to source clips and declare honest fallbacks. Interaction text must also move
to character data rather than accumulate name replacements in main.cjs.

## Request and session contract

1. Desktop opens the existing website with an explicit companion selection.
   A URL/UI identifier is a selection, not an authenticated privilege.
2. The website creates a companion conversation and submits a small versioned
   descriptor such as `{ schemaVersion: 'companion-context.v1', personaId:
   'gwen-companion.v1' }` with free-chat requests.
3. Server resolves the descriptor against its own allowlist. Never accept prompt
   text or model/tool overrides from the client. Invalid selections fail with a
   clear validation response rather than silently selecting a different voice.
4. Bind the resolved persona/version to that conversation through the existing
   conversation owner. No second memory store or implicit global user setting.
   Requests cannot change an existing conversation's persona in place.
5. Each new companion conversation supplies its descriptor. Hiding/reopening
   preserves the binding; a new conversation starts clean. Ordinary browser chat
   without the descriptor keeps its existing behavior.
6. A future character switch starts a new conversation and preserves the old
   one for explicit return. Never silently copy facts, history or permissions
   between characters. Transfers, if added later, are a separate explicit feature.

No invisible first user message, automatic paid greeting request, fetch-body
interception, or repeated persona instructions in user history. A local greeting
can be immediate; the first real message initializes the server binding.

## Prompt integration and priority

Keep TaskFrame/ExecutionPlan and ReAct separate. This feature is a presentation
configuration, not a Skill and not a router. It does not implement any unit-play
guidance control experiment or alter its approval boundary.

For ReAct, project the resolved server persona into a separate, bounded trusted
prompt block, below existing protocol/safety/evidence constraints. Its scope is
the wording of `finish.answer` and `ask_user.question`. Tool selection, tool
arguments, action JSON, missing fields, evidence IDs, numerical results and
completion policy retain the existing rules. Do not put persona instructions
into user-controlled WorkingState fields and reinterpret them as trusted text.
Integrate consistently with both message layouts in react-decision-provider.js.

No extra model call to rewrite completed answers: this risks changing evidence
claims and adds latency. Existing deterministic summaries, failures and fallback
answers remain valid even when they do not sound like the character.

Quick Task stays deterministic. Its queries, ordering and result cards remain
unchanged. Any later support in an existing generated-conclusion path must be
separately scoped and tested; first-release persona applies to free chat only.

## Gwen profile v1

- Identity: the user's Gwen desktop companion; light fictional roleplay.
- Voice: cute, innocent, curious, warm and encouraging; simple natural Chinese.
- Use occasional light interjections and small references to sewing/scissors;
  no mandatory catchphrase, baby talk, repeated self-introduction or emoji flood.
- For game questions: put actionable content first; preserve exact names,
  conditions, statistics, uncertainty and sources. Innocence is a tone, not
  ignorance or permission to guess.
- When losing: acknowledge frustration and offer a concrete next step without
  blaming the user. Never promise wins or claim to see their game screen.
- Short casual exchanges may be playful. Detailed questions still receive the
  detail needed. Do not imply exclusivity, guilt for leaving, or real sentience.
- Example greeting: “你好呀，我是格温！今天想一起研究什么阵容？”
- Example uncertainty: “这个我还不能确定呢，先查查数据，再一起决定吧。”

## Rollout, rollback and observability

Use an isolated `off | shadow | on` mode. Default off preserves existing requests
and provider messages. Shadow validates/resolves selection and records metadata
without adding a prompt or performing a second model run. A local/private test
can opt into on before any production rollout.

Record requested/resolved persona ID, version, mode, prompt-block version and
binding outcome with the existing run diagnostics. Never log arbitrary persona
text, add new raw conversation logging, or treat personality as authorization.
Rollback removes the projection while preserving conversation data and the
original answer path. The UI reports that companion voice is unavailable.

## Implementation order and acceptance

1. Add a pure server persona registry/resolver and versioned descriptor contract;
   test allowlisting, unknown versions, client prompt rejection and mode behavior.
2. Wire optional conversation binding at handleReactChatRequest and the existing
   conversation owner. Confirm real current ownership before touching storage.
3. Add trusted prompt projection in the current ReAct provider; no tool/runtime
   expansion. Test direct answers, clarification, evidence-backed answers and
   both provider message layouts. Default/shadow must preserve baseline prompts.
4. Add explicit website request metadata and desktop selection. Test ordinary
   web isolation, new chat, reopen, cancellation, stale histories and spoofed IDs.
5. Evaluate Gwen with casual chat, loss/frustration, missing data and concrete
   game-stat queries. Inspect persona consistency and facts separately. Run
   relevant react/conversation suites, then the repository's canonical CI lanes
   and eval:agent. Existing unrelated baseline failures must be recorded.
6. Enable only for the personal companion trial after shadow checks. Production
   rollout is separate from this design and must use the normal release process.

Implemented entry points: desktop-pet/pets.json and assets manifests;
src/app/small-window-ui/app.js requestBody/conversationId;
src/app/small-window-server.js handleReactChatRequest;
src/react/react-decision-provider.js. At inspection, no existing dedicated
persona registry existed before this change. The new registry is
src/conversation/companion-personas.js. Desktop passes an explicit selection in
the URL; website builds the descriptor. The preload remains a read-only observer.

## Local implementation and validation

Set `TFT_AGENT_COMPANION_PERSONA_MODE=shadow` for resolution-only checks, then
`on` for the personal trial. The existing conversation bridge store must be
enabled. Selection URL: `/?companion=gwen-companion.v1`. Descriptor validation
rejects arbitrary prompts and unknown profiles. Mode off returns a clear
unavailable response to companion requests. Ordinary requests keep their path.

An additive table in the existing SQLite conversation database binds persona
ID/version by visitor scope and conversation ID. In on mode the first free-chat
turn binds either the selected persona or ordinary chat. Subsequent attempts
to change or omit that binding fail with 409. Persona version changes require
a new conversation. Shadow does not persist bindings or project prompts.
Quick Task itself does not bind or style its deterministic result.

Both ReAct provider layouts accept the resolved persona through trusted provider
context, not WorkingState/history. The provider looks up profile text again in
its own registry. Responses include ID/version/mode/prompt version as a receipt;
runtime status exposes the configured mode. No automatic greeting model call.

Local evidence: 38 focused tests; 12 desktop integration checks; Agent eval 50/50.
Canonical main lane: 2343 cases, 7 failures and 7 skips. Failures are in
miniprogram-contract, patch-note-history, r1-readiness-docs, season-context and
welcome-recommendations assertions: current patch 18.3 versus expected 18.2,
changed history entries, and a README readiness link. These files/data were not
modified for this feature. Canonical integration lane: 238 cases, zero failures,
one skip. The first sandboxed full run additionally failed local HTTP and temp
file operations; the numbers above are from the normal-permission rerun.
Reports: .cache/companion-main-unsandboxed.xml,
.cache/companion-integration-unsandboxed.xml and
.cache/companion-regression-summary.json. These are development-workspace
results; they do not establish a clean baseline for unrelated uncommitted work.
Real-model smoke used deepseek-v4-flash for introduction, emotional support and
screen-visibility limitations, with persona receipts on every response. Report:
desktop-pet/test-output/persona-live.json. This is three development cases,
not a broad personality or game-answer quality benchmark.

The current installed desktop shortcut still points to the earlier production
client. Do not copy this persona-enabled desktop source into that installation
before the website/server feature is released. No production deployment or
environment changes were performed by this implementation.

## Public source branch

This branch isolates companion changes on top of the repository HEAD, without
unrelated uncommitted runtime changes. No character models, sprite artwork,
portable binaries, test screenshots, personal profiles, or secrets are included.
Existing local-build validation above describes the original workspace; branch
validation is recorded separately in desktop-companion-github-validation.md.
There is no release artifact or production rollout in this source upload.
