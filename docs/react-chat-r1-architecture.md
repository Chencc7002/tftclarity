# Phase R1 — Independent ReAct Chat

## Product boundary

R1 adds an experimental chat path without changing QuickTask behavior:

```text
QuickTask -> /api/recommend/stream -> deterministic query path
Free chat experiment -> /api/react-chat/stream -> bounded ReAct path
```

The ReAct endpoint has no fallback to `recommendForInput`, `TakeoverController`,
`RetrievalPlan`, or `ExecutionPlanExecutor`. It reuses `AgentRuntime`,
`ToolRegistry`, `ToolExecutor`, and the shared single-tool evidence validator.

## Action protocol

The model can emit one `react-action.v1` action per decision:

- `call_tool`
- `ask_user`
- `finish`

There is no intermediate `respond` action. User-visible progress comes from
versioned stream events, not from hidden model reasoning.

R1 uses progress-based safety. Tool-call count is recorded for observability but
has no completion limit. The hard controls are a 30-second wall-clock deadline,
per-tool timeouts, canonical duplicate-call rejection, failure circuit breakers,
and termination on the third consecutive decision without new evidence, a
material WorkingState change, or a deliverable result. A 24-decision
`runaway_loop_fuse` remains only as the last emergency guard; it is not a normal
planning budget.

Acceptance must not fail because `actualToolCalls` exceeds a fixed number.
Instead it records `actualToolCalls`, unique fingerprints, blocked duplicates,
progress decisions, no-progress streaks, failures, wall-clock time, and the
termination reason. A no-progress or failure-circuit stop returns an explicit
user-visible limitation and preserves safe partial evidence when available.

## Evidence rules

Every completed ToolResult is checked for the declared tool name, source,
evidence type, update time, required fields, and prohibition on model-generated
statistics before entering the Evidence Ledger.

- `direct_answer` cannot contain current statistical claims.
- `sufficient_evidence` must cite valid Ledger IDs and its numeric claims must
  be present in cited evidence.
- `insufficient_evidence` must explicitly disclose the limitation and cannot
  guess a result.

## Stream protocol

`POST /api/react-chat/stream` uses the existing NDJSON transport and emits
`react-stream-event.v1` envelopes. Supported event types are:

```text
run_started
decision
decision_rejected
tool_started
tool_completed
tool_failed
evidence_added
ask_user
answer
termination
error
```

Decision events disclose only action type, tool name, purpose code, iteration,
and remaining budget. They never expose free-form chain-of-thought.

## Current checkpoint

The R1 loop, provider, endpoint, shared evidence validation, deterministic
acceptance suite, H1 handler extraction, and Conversation Bridge are
implemented. The request-scoped TFT handler factory centralizes:

- `entity_catalog_query`
- `composition_member_statistics`
- `unit_builds_batch`
- `unit_details`
- `item_details`
- `trait_details`
- `semantic_search`
- `composition_change_evaluation` (`add`, `remove`, `replace`)

`composition_change_evaluation` resolves one explicit member change against a
current composition and official unit evidence. It constructs the before/after
member lists and deterministically recalculates affected trait counts and
breakpoints. The model may explain returned `traitDeltas`, but it must not
calculate them itself or turn `strengthConclusion=not_evaluated` into a strength
or best-lineup claim. The older `composition_replacement_evaluation` remains a
backward-compatible one-for-one replacement contract.

Natural entity names are resolved by exact normalized alias through
`entity_catalog_query.filters.names` before a details call. Details tools accept
official `apiName` values only. `semantic_search` is limited to bounded local
knowledge types and cannot support current rankings or statistics by itself.
The factory reports unavailable tools explicitly and can fail coverage tests
instead of pretending that registration implies runtime availability.

The P0 and H1 live HTTP smokes use the real decision model and assert that the
legacy recommendation chain is never called. H1 additionally verifies the
catalog-to-details two-step protocol and local `video_guide` retrieval without
network video discovery.

## QuickTask / chat Conversation Bridge

QuickTask execution remains owned by `/api/recommend/stream`. After a successful
QuickTask, the server writes two bounded records:

- `quick-tool-turn.v1`: model-context metadata for the completed shortcut.
- `quick-tool-evidence-snapshot.v1`: integrity-protected historical evidence.

SQLite commits the snapshot, turn record, and active-state update atomically.
Each request receives a monotonic `turnOrdinal` at request entrance and a stable
`requestId`; retries are idempotent and an older completion cannot replace a
newer active turn. State is scoped by user scope plus `conversationId`, retains
at most 20 records for seven days, and advances `contextEpoch` for explicit new
tasks or season changes.

`/api/react-chat/stream` resolves the next-turn relation into one of:

```text
none
continue
modify
same_operation_new_subject
return_to_previous
reply_to_clarification
new_task
ambiguous
```

This next-turn resolver is deterministic and authoritative. It is separate from
same-request QuickTask supplemental classification.

When a QuickTask request explicitly includes `supplementalText`, a deterministic
classifier assigns one of:

```text
none
social
explain_result
independent_direct_answer
modify_quick_task
conflicting_task
new_tool_task
ambiguous
```

Only `ambiguous` may invoke an optional model classifier, once, with a maximum
five-second timeout and strict `supplemental-classification.v1` output. The
model sees only the QuickTask id, operation, normalized arguments, bounded
original input, bounded supplemental text, and the allowed enum. It does not
receive evidence claims, statistics payloads, tool definitions, old
ConversationState, ExecutionPlan, or budgets. Invalid JSON, extra fields,
unknown relations, contradictory dependency flags, provider errors, and
timeouts remain `ambiguous` and add `supplemental_classification_failed` without
failing the QuickTask.

Supplemental classification cannot mutate QuickTask arguments, Bridge state,
tools, or budgets. `new_tool_task` is recorded as deferred and never executes a
second independent tool task in the same request. The classification is stored
as bounded metadata on `quick-tool-turn.v1`, not as executable instructions or
snapshot claims.

The model sees at most three completed records and one pending clarification in
a deterministic 900-token view. Historical user text is sanitized, bounded,
JSON-structured, and explicitly marked as untrusted data rather than
instructions. Raw statistics payloads are not injected.

Historical evidence is promoted only after validating the record/snapshot
references, integrity hash, scope, conversation, completion state, season,
expiry, and claim structure. Promoted evidence is labeled
`temporalStatus=historical`. Questions about current statistics or rankings must
re-query current tools. A Bridge read failure allows an independent ordinary
answer with `conversation_bridge_read_failed`, but a history-dependent question
must ask the user for clarification. A Bridge write failure never erases an
already successful QuickTask result and is disclosed as
`conversation_bridge_write_failed`.

Enable the SQLite Bridge with:

```text
TFT_AGENT_CONVERSATION_BRIDGE_MODE=on
TFT_AGENT_CONVERSATION_BRIDGE_PATH=.cache/conversation-bridge.sqlite
```

## Video guide search follow-up (R1.5)

Video discovery is a separate, domain-restricted read-only tool, not general web
browsing. R1 only reserves `videoGuideSearchService` dependency injection.

R1.5 will add one `video_guide_search` tool:

- YouTube: official Data API metadata search plus the existing local guide
  knowledge index.
- Bilibili: manually imported local metadata index only until an appropriate
  public search API is available.
- No arbitrary URL input, search-page scraping, private endpoints, cookies, or
  automatic transcript/video ingestion.
- Search results can support metadata claims. Video-content claims require
  existing knowledge evidence; explicit content ingestion is deferred to R2.
