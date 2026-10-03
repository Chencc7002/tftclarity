# 18.3 announcement catch-up through 2026-10-04

Production baseline: 9a7f2f26de29ff6e06a4ce58e6ee8462e1e4a88e. Prepared in the existing isolated release worktree on codex/patch-hotfix-20261004, preserving unrelated root development.

Verified official English 18.3 article on October 4: https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-3/

Missing September 24 B-patch and September 28 disable have been appended. The Traditional Chinese article still lacks these sections, so the new updates link to the English source. Revision dates reproduce source heading dates; no precise publication timestamp or China-server rollout time is inferred.

September 24 includes 13 numerical records: Blackthorn AP sacrifice damage amplification, two Kha'Zix damage ratios, and ten explicitly restored 18.2 B adjustments. The restoration is not a second application of those reductions. Brambleback's faster cast, the intentional targeting revert, and four temporary Augment disables are preserved in its summary without invented numbers.

September 28 has no numeric changes. A summary-only revision records Major Polymorph's temporary disable. The official explanatory paragraph calls it Greater Polymorph; both names are retained. A fix planned for 18.4 is not represented as already live. The official schedule lists 18.4 for October 7, after this audit cutoff.

The existing patch_facts schema, numericOnly contract and tool routing are unchanged: numerical records remain in changes, status information is in revision summaries. The evidence overview includes the nonnumeric updates within its first 800 characters so the existing bounded semantic retrieval can expose them. No skill, runtime, permissions or database changes.

History now contains six nodes and 273 numerical records across 18.1–18.3. Patch 18.3 retains its original 74 records and adds 13, for 87. Website and generated mini-program data preserve all prior history. Empty numerical detail accordions are omitted for the status-only node. Mini-program publication is outside this deployment.

Validation before release: 34 focused history/data tests passed; all 13 values are independently asserted against the source; first-800-character status coverage and both locale chains passed. The canonical main lane passed 1,591 tests with 7 skips, the integration lane passed 238 with 1 skip, and Agent evaluation passed 50/50. Browser review confirmed the September 28 status-only node renders without an empty numeric accordion. Candidate real-model acceptance runs before app-only activation. Production results are recorded after deployment.
