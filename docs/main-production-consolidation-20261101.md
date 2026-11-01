# Main production source consolidation — 2026-11-01

## Purpose and provenance

Main remained at 5bad834 (2026-09-21), while production was maintained through
release branches and incremental image builds. This integration merges the
existing production source chain through 2eaa0e2
(codex/static-knowledge-release-20261031) into latest origin/main, retaining
main's locale changes. Both histories are preserved by a merge commit.

The chain includes 18.3–18.5 announcements, page/navigation/result presentation,
video recall/metadata guidance, Jev observability, selected-text quotations,
patch-summary Evidence/JSONB/temporal repairs and audited static knowledge
publication. Existing rollout switches retain their values and authorization
boundaries. This is source consolidation, not deployment.

The latest stored deployment receipt is the 2026-11-01 01:35 Asia/Shanghai
activation of tftclarity-app:yi-equipment-20261031, image
sha256:68cd018831d4a93ca351d3066ae2a10de35da4290fb2a2aebe633bf99e28788d.
Its baseline checkout was detached at 259ccbc with additional tracked changes.
The deployed equipment scope corrections are reconciled into three production
files and their two regression suites from the saved deployment payload.
The provider test addition was reassembled as a complete test because the
saved replacement fragment intentionally omits its surrounding closing braces.
No image binaries, credentials, operational backups or production data are added.

Direct and proxied SSH attempts during this audit timed out at banner exchange.
Thus these are documented deployment receipts, not proof of the current live
container. Main must not be described as a byte-for-byte export of today's
running image. Deployment verification remains required before a release.

## Excluded work

The original workspace remains on codex/chatbot with its unrelated dirty changes
untouched. Desktop companion, optional unmerged experiments and assets are not
included. No branches are deleted, production containers restarted, server
files rewritten, or feature flags enabled by this operation.

## Frozen experiment boundary

The equipment prompt repair changes serialized provider messages. Old PR1D and
forward-experiment preflights correctly reject that drift. Their frozen configs,
observations, hashes, preflight implementation and provider-call authorization
are unchanged. Tests now assert failed status and the exact lone drift gate,
while still requiring zero provider calls, all other gates and isolation checks.
Do not start those old experiments against the changed production prompt; a
new baseline/contract review is required first.

## Validation

- Agent offline evaluation: 50/50, zero skipped.
- Canonical integration lane: 238 total, zero failed, one skipped.
- Equipment/ReAct regression: 131 passed.
- Frozen-preflight boundary regression: 13 passed.
- Initial main lane: 1689 total, two frozen-message expectation failures, seven
  skipped; both are addressed as drift rejection checks described above.
- Final main lane: 1689 total, 1682 passed, zero failed, seven skipped.
- Full standard lanes cover the earlier targeted suites; no runtime changes
  followed the final integration run.
- Frozen raw JSON fixtures are marked -text in .gitattributes so Windows
  checkouts preserve their audited byte hashes; fixture contents are unchanged.

## Source and release policy

Use main as the shared integration baseline. Put new work on a short-lived
codex/* branch and merge after appropriate validation. Name the exact commit
and immutable image ID in every deployment receipt. Deploy from a clean,
committed source snapshot; do not use an unexplained dirty server checkout as
the sole source of production fixes. Existing historical release branches may
remain as references until separately reviewed for deletion.

This merge does not change the current website. Production migration to a
clean image from the new main is a separate operation with current-state
verification and a rollback target.
