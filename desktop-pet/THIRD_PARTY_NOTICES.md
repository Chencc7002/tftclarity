# Third-party code and assets

## Local-only Gwen model

`assets/prestige-gwen/model.glb` is NOT included in this public repository.
The local prototype used the original Riot Games asset for
Prestige Chibi Cafe Cuties Gwen, modelviewer.lol TFT ID 68003, retrieved
2026-10-30. Page, resolved download location, SHA-256 and provenance are in
`assets/prestige-gwen/source-manifest.json`. It is ignored by Git and included
only in the user's local personal build. It is not licensed by the MIT or
Apache notices for application code. No public redistribution is authorized.
The live renderer respects hidden-material metadata and omits Smears, while
the Face layer is drawn before Hair and both write depth to preserve bangs
and prevent rear hair from covering the face. The camera elevation is 38 degrees,
retaining source geometry, textures and animation tracks. Scissors are hidden
during Celebrate because the source puts them below ground, where the elevated
camera would expose a detached fragment. No ImageGen or MP4
pixels are used; this is not a Codex sprite atlas or a Codex pet installation.

Three.js 0.187.0 is MIT licensed; `vendor/three/LICENSE` is included. Vendor JS
imports of `three` are rewritten to relative local paths, otherwise unchanged.

## DSH modules

This personal prototype reuses selected components from
[zhu1090093659/dsh-pet](https://github.com/zhu1090093659/dsh-pet),
commit `9ccb048c82b4ac4f6cc52fbb3ca92323b42c799b` (0.4.12).

- `vendor/dsh-pet/{state,affinity,remarks,client/spritesheet}.mjs`:
  Apache-2.0; license reproduced in `vendor/dsh-pet/LICENSE`.
  Changes: TypeScript transformed to JavaScript with Node's type transformer,
  import suffixes changed to `.mjs`, provenance comments added.
- Full upstream notices, including the MIT license text for Pessimist0906,
  are preserved in `vendor/dsh-pet/UPSTREAM_THIRD_PARTY_NOTICES.md`.
  Characters mentioned there are NOT included in this Gwen-only package.
  Earlier sprite references remain in the source workspace for provenance,
  but are not selectable or copied into the portable build.
- `assets/tray.png` is the existing TFTClarity website icon.
- Electron and Chromium notices are included alongside the portable executable.

The desktop shell, website adapter and packaging are specific to TFTClarity.
They do not include the DSH host, workshop, telemetry, or Live2D runtime.
Feeding in this personal prototype uses the upstream 30-second cooldown and
affinity reward but intentionally has no consumable/currency balance. Original
interaction copy is reused with
the whale-specific name replaced at display time.
