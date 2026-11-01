# Desktop source integration — 2026-11-01

Status: source-only integration into main; not a production release.

Integrates the desktop companion branch plus the current locally tested compact
UI, right-click feeding, per-character narration, two-character greeting,
length-based bubble expiry, compact chat docking, project shortcut icon,
auto-hidden controls and inline composer. Models, sprite artwork, portable
binaries, profiles, screenshots and credentials remain excluded.

The desktop package manages Electron, Three and Playwright separately. Root
package and lockfile stay unchanged. The website Dockerfile copies only its
existing source/service directories; .dockerignore additionally excludes
all desktop-pet inputs from its build context.

Companion voice defaults to off; the example explicitly says off. Website
requests include the selection only with an explicit companion URL parameter;
Quick Task excludes the descriptor. The server rejects disabled companion
requests before a model call. Ordinary chat retains its path. Existing main
candidate-decision profiles and equipment/category rules are preserved when
resolving the old desktop branch conflicts.

No production environment, container, website release, auto-start service,
installed desktop profile or desktop shortcut is changed by this merge.
The earlier local desktop installation and personal trial remain local.

## Validation

- Initial persona/ReAct/desktop unit focused set: 49 passed.
- Existing local native UI validation: 17 integration checks and two real-model
  inline conversation turns passed, with preserved context. This evidence comes
  from the personal workspace; public source contains no model needed to rerun it.
- Deployment boundary tests assert exclusion from web Docker inputs/root
  dependencies and rejection of persona requests while default off.
- Canonical main lane: 1696 total, 1689 passed, zero failed, seven skipped.
- Canonical integration lane: 238 total, 237 passed, zero failed, one skipped.
- Agent offline evaluation: 50/50, zero skipped.
- No model, install binary, personal profile, secret or absolute user path found in the staged source audit.

The historical desktop-companion-github-validation.md refers to the original
upload branch; this record supersedes its earlier base/regression counts.
No raw character asset redistribution is authorized by this source merge.
