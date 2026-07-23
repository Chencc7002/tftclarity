# Phase 3 Entity and Game Concept Linking

- status: PASS
- baseline: `0d25453`
- implementation: `fe84785`
- evaluation dataset: `entity-linking-phase3.v1` (177 cases)

## Delivered

- Entity mention extraction separated from semantic action parsing.
- `entity-link-result.v1` with raw text, canonical ID/name, type, version, candidates, source and confidence.
- Fixed resolution order: exact, normalized alias, current-patch catalog, pinyin/fuzzy, semantic retrieval, bounded candidate rerank.
- Current-patch and `supersededBy` filtering.
- Candidate preservation and no forced resolution below confidence/margin thresholds.
- `game-concepts.v1` for 九五、赌狗、运营、连败、前排装 and reusable aliases.
- Candidate rerankers cannot introduce IDs that were not retrieved.

## Evaluation

Final `npm run eval:phase3`:

- current core entity Top-1: 100% (15/15; gate at least 97%)
- player slang and alias Top-3 recall: 100% (50/50; gate at least 98%)
- reusable game concept accuracy: 100% (12/12)
- nonexistent entity false-hit rate: 0% (0/100; gate below 2%)

Phase 2 regression after entity separation:

- action accuracy: 96.00%
- domain accuracy: 97.67%
- unsupported capability understood correctly: 100%
- Token and latency budget pass rates: 100%

## Tests

- targeted entity/evaluation/parser/shadow tests: 14 passed, 0 failed, 0 skipped
- full `npm test`: 597 total, 577 passed, 0 failed, 20 existing conditional skips
- `npm run smoke:small-window`: passed; hot cache 3ms, reopened local cache 4ms
- `npm run smoke:comps`: passed
- final phase-0 dataset check and phase-1 50-case evaluation: passed

## Behavior difference and rollback

Linked entities exist only in the shadow TaskFrame. The old parser and `IntentEnvelope` remain authoritative, so user-visible response behavior is unchanged. Revert `fe84785` to remove phase 3; no production data rollback is required.

## Known limits

- The 177-case deterministic contract set is not a production holdout.
- “炼刀” has no unique verified target in the current catalog and remains unresolved; “巨九” resolves through the reusable equipment alias directory.
- Optional semantic retrieval and candidate reranking are bounded and never allowed to invent IDs.
