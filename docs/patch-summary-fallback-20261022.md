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

## Production deployment

The fix was deployed to `tftclarity.cn` on 2026-10-22 from commit `1fe28e42a641097156167238482dfb3bdd63b787`, based on the previously deployed 18.5 announcement commit `a28a3046`. Only the `app` service was rebuilt and recreated; PostgreSQL, Redis, and the remaining services were left running.

- previous app image: `sha256:1f4117cd...` (tagged `tftclarity-app:pre-patch-summary-fix-20261022`);
- deployed app image: `sha256:458e944b7b64e1adc4865ad7b0da45ebfc3394b236ac9caa410b856e21d7dffd`;
- backup directory: `/root/tftclarity/backups/patch-summary-fix-20261022`;
- PostgreSQL custom dump: 3,264,159 bytes, validated with `pg_restore --list`;
- dump SHA-256: `41ba719fe1004cb2c232f687a9c96e2f355f7f0fdc726ea13ae6cbabdf227840`.

After deployment, `/api/health` and `/api/ready` both returned HTTP 200, with PostgreSQL and Redis ready. A public streaming request using the exact text `简述版本更新` returned HTTP 200 and a grounded 18.5 summary. The fallback path reported 71 adjustments, 33 buffs, and 38 nerfs with `status=completed_with_warning`, `terminationReason=finish_validation_fallback`, `answerOrigin=system_patch_summary_fallback`, and current `patch_facts` Evidence. A separate end-to-end browser check submitted the same text through the production chat UI and rendered the 18.5 answer with its Evidence and feedback controls without a frontend error.

Existing untracked production files (`-b` and `backups/`) were preserved.
