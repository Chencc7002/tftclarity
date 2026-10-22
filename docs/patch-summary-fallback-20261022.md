# Patch summary validation fallback

## Problem

The public request `简述版本更新` correctly called the registered `patch_facts` tool for patch 18.5 and added validated official Evidence. The model then compressed several independent before/after records into combined numeric series. Strict patch-series grounding rejected those merged series, and the run terminated as `missing_required_evidence`; the frontend therefore had no answer to render and showed an error.

## Change

When all of the following are true, ReAct now discards the rejected model prose and renders a deterministic summary from the cited `patch_facts` entry:

- the current turn asks for a summary or recap of a patch/update;
- the finish cites a current, validated `patch_facts` Evidence entry;
- the only finish errors are unsupported numeric tokens or patch numeric-series grouping errors.

The fallback reports the official patch title, change/buff/nerf counts, revision date, affected groups, reviewed revision summary, source link, and a prompt to request entity-level details. It returns `completed_with_warning` with `answerOrigin=system_patch_summary_fallback` and keeps the rejected model conclusion plus validation errors in the audit record.

Strict numeric grounding remains enabled. Unknown Evidence, unrelated finish errors, non-summary requests, historical Evidence, and missing patch facts do not use this fallback. No Tool, permission, runtime family, route, database migration, dependency, or frontend contract was added.

## Validation

- focused patch/ReAct suites: 156 passed, 0 failed;
- canonical main CI on Node 24 with normal local permissions: 1665 passed, 0 failed, 7 conditionally skipped;
- canonical integration CI: 238 passed, 0 failed, 1 conditionally skipped;
- offline Agent evaluation: 50/50 passed.

The first main-CI attempt ran in the restricted Windows sandbox and produced six environment failures involving loopback sockets, temporary-file atomic rename, and test resource resolution. The unchanged lane passed when rerun with normal local permissions.
