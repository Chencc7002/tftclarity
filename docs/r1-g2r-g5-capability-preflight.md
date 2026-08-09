# R1 G2-R / G5 Capability Preflight

## Scope and provenance

- Goal: determine which composition-role and conditional re-query capabilities are genuinely supported by the current production contracts before implementing the next R1 composition gate.
- Runtime provenance: `deepseek-v4-flash`, production tool handlers, `live_or_production_cache`, `fixtureMode=false`.
- Selection policy: compositions, units, and the excluded item were selected from live production responses. No named composition, unit, or item was preselected in code.
- Machine-readable evidence: `.artifacts/r1-acceptance/r1-g2r-g5-capability-preflight.json`.

## G2-R — Composition role evidence

The dynamic run discovered 34 live composition candidates, attempted 4, and resolved 3. The resolved cases produced 23 composition-member records.

Directly supported evidence:

- `member_of_comp` for all 23 returned members;
- `officialProfile.role` for 22/23 members;
- `officialProfile.cost`;
- `targetStarLevel` for 14/23 members;
- `itemized_core_candidate` for 12/23 members;
- `itemizationEvidence.games`, `averagePlacement`, and `items` for itemized candidates.

Observed official role labels were limited to generic combat archetypes such as physical/magic tank, physical fighter/shooter, and magic caster. They describe the unit's official archetype, not its comp-specific responsibility.

Not supported by current production evidence:

- `primary_carry`;
- `primary_tank`;
- `core_member`;
- `flex_slot`;
- actual `frontline_position` / `backline_position`;
- equipment `allocation_priority`.

Preflight conclusion: `G2 Explicit Role Evidence = PARTIAL`. Safe evidence vocabulary may include `official_combat_archetype`, `itemized_member`, and deterministic itemization-sample ordering. It must not promote those signals to primary carry, primary tank, board position, or allocation priority.

## G5 — Given-constraint re-query

Contract inspection:

- registered single-unit `unit_builds` accepts `lockedItems`, `excludedItems`, and `comparisonItems`;
- registered `unit_builds_batch` accepts none of those query-affecting constraints;
- the current production ReAct runtime reports `unit_builds` as unavailable;
- `unit_builds_batch` is callable, but cannot express the required exclusion/fixed-owner query.

Real legacy production probe:

- the target composition, member, and excluded item were selected from live response data;
- baseline query returned 3 cards;
- the excluded item was present in the baseline first card;
- the constrained query carried the selected item in `query.excludedItems`;
- the constrained query returned 0 cards.

The probe proves that the legacy route receives the exclusion constraint. It does **not** prove the product capability because it did not return a usable alternative build. An empty result cannot be presented as a successful conditional re-query, and the model must not edit old build cards by hand.

Preflight conclusion: `G5 capability_not_proven`. Until a production-callable tool can express the constraint and return fresh non-empty build evidence, treat this as `BLOCKED_BY_TOOL_CONTRACT_GAP`.

## Proposed next gate

1. Add only weak, descriptive G2-R evidence labels whose values are direct or deterministically derived from the fields above.
2. Keep G4-B role-aware allocation blocked; no primary carry/tank or priority inference is authorized.
3. For G5, either expose the existing single-unit constrained query safely to production ReAct or add genuine constraint fields and query handling to `unit_builds_batch`.
4. Require at least two dynamically selected positive production cases for G5-A. Each must return a non-empty constrained result, show that the excluded item reached the upstream query and is absent from all returned cards, retain production provenance/statistics, and render the model's limitation if only partial coverage is available.

## Current R1 status

- G1 Composition Resolution: PASS
- G2 Member Evidence: PASS
- G2 Explicit Role Evidence: PARTIAL
- G3 Given Replacement Evaluation: PASS
- G4-A Item Contention Detection: PASS
- G4-B Role-aware Allocation Priority: BLOCKED by role evidence
- G5 Conditional Allocation Re-query: capability not proven / tool-contract gap
- R1-E2E-COMPOSITE-001: NOT YET PASS
