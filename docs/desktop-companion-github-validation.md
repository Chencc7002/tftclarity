# Desktop companion source upload validation

Date: 2026-10-30. Base: 3993249. Branch: codex/desktop-companion.

Scope: desktop shell, rendering adapter, narration, companion persona registry,
existing conversation binding, explicit UI selection and developer checks.
No deployment, main-branch merge, GitHub Release or character asset distribution.

Public source excludes GLB/GLTF, sprite artwork, portable executables, profile
caches, test outputs and environment secrets. The existing website icon is kept
as the desktop tray icon. DSH and Three code retain their upstream licenses.
Missing model inputs are documented; packaging fails before copying runtime
files if a configured model is absent.

The source worktree deliberately excludes unrelated edits in the original dirty
workspace. Companion additions were transplanted onto repository HEAD and
focused tests passed: 10/10 (registry, UI metadata, provider layouts, immutable
scoped binding, narration, window policy and interaction cooldowns).

Agent evaluation: 50/50 passed, zero skipped.
Canonical integration lane: 232 cases, one failure, one skip. The failing
conclusion-http case reaches the existing Agent's ten-second deadline. A focused
retry also timed out. This is not claimed to be a clean regression pass and is
not fixed as part of the companion source upload.

Initial main lane: 1163 cases, one raw-fixture integrity failure, seven skips.
The new Windows checkout converted raw JSON bytes to CRLF. Restoring the Git
blob bytes (no semantic fixture change) made all 16 tests in that fixture suite
pass. The main lane is repeated after restoring the bytes; see final result below.

Real-model and actual Electron visual/interaction checks from the original
workspace are documented in desktop-companion-persona-architecture.md. They
are development evidence, not a claim that this public checkout contains
licensed character assets or is enabled in production.

Final main-lane rerun: {'total': 1163, 'failures': 0, 'skipped': 7}.
