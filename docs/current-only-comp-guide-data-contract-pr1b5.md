# PR1B.5 Current-only Comp Guide Data Contract

Status: **APPROVED for the developer-only probe contract; not approved for production ingestion or Skill use**

This contract corrects the normalized schema after PR1B proved that MetaTFT statistics and guide facets do not share one patch-binding model. It supersedes the illustrative `comp-guide.v1` shape in the PR0 roadmap for this probe. The raw PR1B fixtures remain immutable.

## 1. Scope

PR1B.5 may change only the developer probe schema, normalizer, normalized fixtures, replay tests, and their documentation. It does not add a database, scheduler, daily snapshot change, production ingestion path, Tool, endpoint, Effective View, Manual Overlay, Skill data input, Prompt/ReAct change, control experiment, or historical guide backfill.

The schema is `comp-guide-snapshot.v1`.

## 2. Time and binding model

One normalized snapshot contains two independently bound sections:

- `statistics.binding = "patch"`: statistics are evidence for the explicit `statistics.patch`.
- `guide.binding = "current_unversioned"`: guide facets were observed from a current-pointer endpoint while `statistics.patch` was the runtime current patch. `observedDuringPatch` is capture context, not a claim that the provider exposes patch-bound guide data.
- `guide.binding = "unavailable_for_requested_patch"`: the requested historical patch has statistics, but the audited endpoints cannot safely supply guide facets for that patch.

A top-level `patch` or legacy `scope.patch` is forbidden. Consumers must not infer that all fields in a snapshot have the same temporal binding.

The PR1B conclusion is deliberately narrow: the audited `comp_details` and `comp_augment_tiers` endpoints did not demonstrate patch binding, so those endpoints alone cannot safely reconstruct guide state for a requested historical patch. This is not a claim that MetaTFT has no historical guide data anywhere.

## 3. Identity contract

Normalized identity uses `metatft-comp-signature.v1` and is independent of the cluster-scoped provider ids.

The canonical hash input is stable JSON over:

```json
{
  "identityVersion": "metatft-comp-signature.v1",
  "set": "TFTSet17",
  "traits": ["sorted unique exact trait API names"],
  "units": ["sorted unique exact unit API names"]
}
```

The normalization rule is `sort_unique_exact_api_names_utf8_json_v1`; the local id is `metatft:` plus the SHA-256 digest. Set is part of the hash scope. Queue and provider aliases remain metadata and do not alter semantic lineup identity. `sourceAliases.clusterId` and `sourceAliases.sourceCompId` are never durable primary keys.

For the captured probe, the normalized id is `metatft:8f70cb1746c944432780fafdd55622fc9f649ed01c33c917ac0d6193f59b8a1e`.

## 4. Guide facet contract

All six facets carry both `binding` and `status`:

- `earlyBoards`
- `leveling`
- `reroll`
- `firstCarouselComponents`
- `recommendedAugments`
- `positioning`

Allowed statuses are `observed`, `not_available`, `not_applicable`, `parse_failed`, and `mapping_failed`. A non-observed facet must have an empty `data` array and a reason. The facet binding must equal the enclosing guide binding.

`firstCarouselComponents` replaces `componentPriority`. It has `semantics = "observed_frequency"`; each row may retain source count and placement observations, but the data layer makes no causal or prescriptive priority claim.

`recommendedAugments` has `semantics = "source_recommendation"`. Its tier is a provider recommendation, not a measured causal effect or a deterministic augment choice.

## 5. Entity reference contract

Every emitted unit, item, or augment reference is classified exactly once. A mapping record retains:

```json
{
  "entityType": "augment",
  "providerRef": {
    "provider": "MetaTFT",
    "apiName": "TFT..."
  },
  "canonicalId": null,
  "status": "explicitly_unmapped",
  "guessed": false
}
```

Resolved records have a non-empty `canonicalId`. Explicitly unmapped records retain their exact `providerRef` and a null `canonicalId`, so a future approved catalog can re-resolve them deterministically. Guessed mappings, string-fuzzy fallback, duplicate classifications, and silent drops are forbidden.

## 6. Current and historical examples

Current capture:

```json
{
  "statistics": {
    "binding": "patch",
    "patch": "17.9",
    "status": "observed"
  },
  "guide": {
    "binding": "current_unversioned",
    "observedDuringPatch": "17.9"
  }
}
```

Historical request:

```json
{
  "statistics": {
    "binding": "patch",
    "patch": "17.8",
    "status": "observed"
  },
  "guide": {
    "binding": "unavailable_for_requested_patch",
    "observedDuringPatch": null,
    "facets": {
      "earlyBoards": {
        "binding": "unavailable_for_requested_patch",
        "status": "not_available",
        "data": [],
        "reason": "source_endpoint_not_patch_bound"
      }
    }
  }
}
```

## 7. Validation and promotion gates

PR1B.5 is complete only when:

| Gate | Required |
| --- | ---: |
| Top-level patch implying all facets are patch-bound | 0 |
| Guide facets with explicit binding and status | 6/6 per fixture |
| Historical guide facets marked observed | 0 |
| Current guide marked provider patch-bound | 0 |
| Entity references classified | 100% |
| Guessed mappings | 0 |
| Silent drops | 0 |
| Versioned identity with explicit Set scope | 100% |
| Raw fixture byte changes | 0/2 |
| Normalized fixtures schema-valid | 2/2 |
| Deterministic offline replay | 100% |
| Focused test failures | 0 |
| New main/integration failures | 0 |
| Production behavior delta | 0 |

This contract does not approve PR2. A future proposal must separately choose between a Current Comp Guide Snapshot Data Product and the `unit_play_guidance` control experiment, then receive product and safety review.
