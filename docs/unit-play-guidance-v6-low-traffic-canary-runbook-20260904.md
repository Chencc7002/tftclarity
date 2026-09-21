# Unit-play guidance v6 low-traffic canary runbook

Status: **proposal only; not authorized, deployed, or activated**

## What this canary means

The webpage has no owner identity boundary for chat requests. While the selector is on,
every understood broad single-champion play-guidance request can use the 1.5.11 candidate.
Narrow equipment questions, ambiguous requests, unsupported requests, and Quick Tasks
remain on their existing paths. This is therefore a short low-traffic site canary, not a
technically owner-only rollout.

Before any operation, record and explicitly authorize the exact release Git SHA. It must
contain the default-off control implementation and bounded structured-log observer. Do
not activate a dirty working tree or a floating branch.

## Proposed first observation window

- Duration: 30 minutes or 10 matching broad play-guidance requests, whichever comes first.
- Decision-Provider ceiling: 120 invocations across those candidate runs, measured by
  summing the structured `decisionCount` values. A decision may make one repair HTTP
  request, so the corresponding hard upper bound is 240 Provider HTTP requests.
- Token ceiling: none, following the user's current preference. Existing site access and
  Provider controls remain authoritative.
- Traffic: normal low site traffic plus the owner's manual questions; no synthetic public
  load and no percentage routing.
- Production Skill export remains 1.3.0. Only the exact candidate selector controls this
  bounded path.

## Activation checklist

1. Confirm the authorized SHA and a clean checkout.
2. Run the canonical main and integration lanes and offline Agent evaluation on that SHA.
3. Keep `AGENT_SKILLS_UNIT_PLAY_CONTROL_V1=off` while building and starting the release.
4. Verify `/api/health`, `/api/ready`, and `/api/runtime`. The runtime response must show
   the selector off and candidate control non-operational.
5. Change only `AGENT_SKILLS_UNIT_PLAY_CONTROL_V1` to
   `unit_play_guidance@1.5.11`, recreate the `app` service, and leave worker and data
   services unchanged.
6. Verify `/api/runtime` reports the exact selector, control enabled, operational true,
   and no diagnostic.
7. Start the 30-minute / 10-request observation counter and collect only structured
   `agent_skill_control` log lines. Do not log questions or Skill instructions.

## Success and stop conditions

Continue only while every completed candidate run has the expected 1.5.11 identity,
accepted Skill and rendered-context hashes, no preparation diagnostic, at most 24
decisions, at most 24 Tool calls, a model or safe fallback answer, and no leakage of Skill
content in the public response.

Disable immediately if any of these occurs:

- runtime identity/hash/profile mismatch or candidate preparation failure;
- server error, repeated deadline, repeated fallback, or grounding rejection;
- missing/widened Tool catalog, more than 24 Tool calls, or either Provider ceiling reached;
- fewer or more than two composition cards in a supposedly completed candidate answer;
- an answer invents equipment, composition, or positioning facts, or exposes Skill
  instructions/hashes to the user;
- the 30-minute or 10-request boundary is reached, even if all results look correct.

## Rollback and evidence record

Set `AGENT_SKILLS_UNIT_PLAY_CONTROL_V1=off`, recreate only the `app` service, then verify
`/api/runtime` reports the selector off and candidate control non-operational. No database
migration or data rollback is required.

Record the release SHA, start/end timestamps, number of candidate runs, Decision-Provider
invocations, calculated HTTP-request upper bound, completion/fallback/failure counts,
Tool-call range, card-count results, stop reason, and the post-rollback runtime status.
Keep raw user questions and Provider payloads out of the canary report.
