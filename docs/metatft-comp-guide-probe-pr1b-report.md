# PR1B MetaTFT Comp Guide Probe Report

Status: **PR1B POC closed; PR1B.5 APPROVED by product review**

Captured: `2026-08-18T04:07:32.041Z`

## 1. Scope and non-goals

This PR1B probe evaluates whether one MetaTFT comp guide can be captured, normalized, entity-classified, replayed offline, and isolated across the current and previous patches.

It does not add a Skill, production Tool, endpoint, database table, scheduler, prompt, ReAct input, answer path, or control treatment. It does not modify the daily MetaTFT snapshot job.

## 2. Real probe target

| Field | Value |
| --- | --- |
| Page | `https://www.metatft.com/comps` |
| Queue | `1100` |
| Set | `TFTSet17` |
| Current patch | `17.9` |
| Previous patch | `17.8` |
| MetaTFT cluster | `409` |
| MetaTFT comp id | `409000` |
| Comp family | Timebreaker / Jax-Milio reroll family |
| Raw probe lineup id | `metatft:9b8eee6b1c201debbb210c3ea668795cf52db5de2938d33ad19c2c354a369995` |
| Normalized comp id | `metatft:8f70cb1746c944432780fafdd55622fc9f649ed01c33c917ac0d6193f59b8a1e` |

The PR1B.5 normalized id uses versioned `metatft-comp-signature.v1`: SHA-256 over Set plus sorted unique core unit and trait API names. Set is in the hash scope. The original raw probe id remains immutable capture evidence. MetaTFT's `409000` id is cluster-scoped and must not be treated as durable across a future cluster rotation.

## 3. Source and patch-switch audit

The page consumes structured JSON APIs; the probe does not scrape rendered HTML and does not depend on hydration data.

The audited page bundle implements patch switching as follows:

- current stats: `/tft-comps-api/comps_stats?queue=1100`;
- previous stats: `/tft-comps-api/comps_stats?queue=1100&patch=17.8&b_patch=`;
- comp definitions: `/tft-comps-api/comps_data?queue=1100`, without a same-Set patch parameter;
- comp details: `/tft-comps-api/comp_details?comp=409000&cluster_id=409`, without a patch parameter;
- comp augment tiers: `/tft-comps-api/comp_augment_tiers?cluster_id=409`, without a patch parameter.

Adding `patch=17.8&b_patch=` to `comp_details` and `comp_augment_tiers` produced the same canonical response as the current request after removing only the volatile `updated` field. Therefore the detail and augment endpoints are classified as **unbound**, not as previous-patch evidence.

The stats responses were distinct and contained the same comp id:

| Patch | Comp games | Average placement | Stats response SHA-256 |
| --- | ---: | ---: | --- |
| 17.9 | 52,886 | 4.2197 | `26fdd913cf58ce33be73641eada6d2d1d29fb98e00e4a41d214fa5d44b93342e` |
| 17.8 | 8,549 | 4.3837 | `27cd1b51fcd391f180782ef128940cb292380d428f18e69ba0a109b2c82e76c1` |

This verifies the stats switch, but it also proves that a two-patch guide comparison cannot be safely produced from these endpoints today.

## 4. Normalized binding and facet result

PR1B.5 replaces `comp-guide.v1` with `comp-guide-snapshot.v1`. Statistics and guide data have separate temporal bindings: statistics are `patch` bound, current guide data is `current_unversioned`, and the requested historical guide is `unavailable_for_requested_patch`. The normalized schema forbids a top-level `patch` and legacy `scope.patch`.

Every target facet has one of the contract statuses: `observed`, `not_available`, `not_applicable`, `parse_failed`, or `mapping_failed`.

| Facet | 17.9 | Rows | 17.8 | Reason / semantics |
| --- | --- | ---: | --- | --- |
| Early boards | `observed` | 8 | `not_available` | Top two observed boards for each of levels 4-7; previous detail is unbound |
| Leveling | `observed` | 7 | `not_available` | Observed level reach timing; previous detail is unbound |
| Reroll | `observed` | 9 | `not_available` | Observed reroll distribution by level; source key `-1` is explicitly excluded |
| First-carousel components | `observed` | 8 | `not_available` | `observed_frequency` only; not a causal or prescriptive priority claim |
| Recommended augments | `observed` | 43 | `not_available` | MetaTFT comp compatibility tiers; previous augment response is unbound |
| Positioning | `observed` | 7 | `not_available` | Only source-observed cells for the seven-unit core roster |

Missing previous-patch guide data is not copied from current and is not invented.

## 5. Entity mapping

Every entity reference emitted by an observed facet is classified exactly once:

- `17` exact unit/item API names resolved through `src/data/generated/asset-manifest.json`;
- `44` references explicitly unmapped: `43` augments absent from that local manifest and `TFT_TrainingDummy`;
- guessed mappings: `0`;
- silent drops: `0`.

The POC intentionally keeps unmapped augment API names as `providerRef` with `canonicalId: null` instead of guessing localized labels. A future production proposal would need a separately reviewed augment lookup contract.

## 6. Fixtures and replay

Immutable parsed raw bodies:

- `test/fixtures/metatft-comp-guide/raw/metatft-409000-17.9.raw.json` — 1,713,023 bytes;
- `test/fixtures/metatft-comp-guide/raw/metatft-409000-17.8.raw.json` — 1,712,691 bytes.

Normalized fixtures:

- `test/fixtures/metatft-comp-guide/normalized/metatft-409000-17.9.normalized.json`;
- `test/fixtures/metatft-comp-guide/normalized/metatft-409000-17.8.normalized.json`.

The previous raw fixture retains the attempted patch-parameter responses as binding-probe evidence, but the active `compDetails` and `compAugmentTiers` evidence fields are `null`. The normalizer cannot promote those unbound bodies.

The capture command refuses to overwrite fixtures unless `--overwrite` is explicitly supplied:

```powershell
.\.cache\runtime\node-v24.18.0-win-x64\node.exe scripts\probe-metatft-comp-guide.mjs
```

Offline replay and mutation tests:

```powershell
.\.cache\runtime\node-v24.18.0-win-x64\node.exe --test test\metatft-comp-guide-probe.test.js
```

## 7. Fail-closed mutations

The focused suite covers:

- missing comp identity;
- stats `places` type change after refreshing the document hash;
- patch label / request URL mismatch;
- missing current detail facet, producing `parse_failed` with no invented data;
- previous detail activation, rejected as cross-patch contamination;
- removed entity mapping;
- guessed entity mapping.

All fixture replay tests are network-free.

## 8. DoD result

| Requirement | Result |
| --- | --- |
| Live fetch, current + previous stats | 2/2 |
| Correct patch identity | 2/2 |
| Cross-patch detail contamination | 0 |
| Raw fixtures with timestamp, patch and stable comp id | 2/2 |
| Raw to normalized | 2/2 |
| Normalized contract validation | 100% |
| Deterministic fixture replay | 100% |
| Network-free unit tests | 100% |
| Entity references classified | 100% |
| Guessed mappings | 0 |
| Silent entity drops | 0 |
| Target facets classified | 12/12 |
| Mutation tests | fail-closed |
| Top-level patch binding all fields | 0 |
| Guide facets with explicit binding/status | 12/12 |
| Historical guide facets marked observed | 0 |
| Current guide marked provider patch-bound | 0 |
| Versioned identity with Set in hash scope | 2/2 |
| Raw fixture byte changes in PR1B.5 | 0/2 |
| Unmapped references retaining `providerRef` | 100% |

Regression on 2026-08-18:

- focused PR1B/PR1B.5 suite: 16/16 passed;
- main CI lane: 1,117 total, 1,110 passed, 0 failed, 7 skipped;
- integration CI lane: 232 total, 231 passed, 0 failed, 1 skipped;
- Agent offline eval: 50/50 passed.

## 9. Productization assessment

Potentially productizable after a separate approval:

- current-pointer early-board, leveling, reroll, positioning, and augment-tier observations;
- versioned, Set-scoped local lineup identity derived from units and traits;
- deterministic parsing, source hashes, and explicit availability statuses.

Brittle or not productizable under the observed contract:

- previous-patch guide facets, because detail and augment endpoints are not patch-bound;
- MetaTFT cluster/comp ids as durable identities;
- first-carousel frequency as a prescriptive component priority;
- localized augment names without an approved patch-scoped lookup;
- any direct answer or Skill behavior based on this POC.

## 10. Future data boundary (not implemented)

Any later PR2 proposal must preserve this one-way boundary:

```text
Raw capture
  -> Normalized comp-guide-snapshot.v1
  -> Manual Overlay
  -> Effective View
```

- **Raw capture** is immutable provider evidence plus request, timestamp, hash, source patch and binding verdict.
- **Normalized** contains observed fields only, with deterministic parsing, entity classifications and availability statuses.
- **Manual Overlay** would be separately authored corrections or annotations. It must never rewrite raw evidence or turn an unavailable provider field into an observed one.
- **Effective View** would deterministically merge normalized data and approved overlay records while retaining provenance for every field.

PR1B and PR1B.5 implement only Raw and Normalized fixtures plus the corrected contract. They create no overlay store, effective-view resolver, database schema, scheduler, Tool, or endpoint.

## 11. Legal and operational risks

- MetaTFT is an unofficial third-party source; endpoint availability, response shape, rate policy and permitted reuse can change independently of TFTAgent.
- The public page exposes the JSON calls used here, but this POC is not a legal determination for production redistribution or persistent commercial storage.
- Raw responses are large (about 1.71 MB per patch fixture) and would need retention, refresh, rate-limit and incident policies before production use.
- Cluster rotation can invalidate source ids even when the lineup is semantically similar.
- Detail freshness is current-pointer only and is not synchronized transactionally with patch-specific stats.
- A provider schema or patch-binding change must stop ingestion for review, not silently fall back.

Evidence required before PR2 includes a reviewed provider-use policy, a stable patch-bound detail contract, refresh/rate-limit expectations, retention requirements, and an approved ownership model for manual overlays.

## 12. Product review and recommendation

Product review returned `APPROVED WITH CONDITIONS` for PR1B, then `APPROVED` for the completed PR1B.5 Current-only Comp Guide Data Contract / Schema Correction. The approved correction is implemented in [`current-only-comp-guide-data-contract-pr1b5.md`](./current-only-comp-guide-data-contract-pr1b5.md). The MetaTFT Guide data line ends its POC phase here.

Keep the probe isolated. Product selected the independently defined `unit_play_guidance` isolated/offline Control Experiment as the next priority, starting with a docs-only PR1C-Contract. This does not approve experiment code, PR2, a production canary, a two-patch guide feature, production ingestion, DB/scheduler work, or production Skill/ReAct/Prompt integration.
