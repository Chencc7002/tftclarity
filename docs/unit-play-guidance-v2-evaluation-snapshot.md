# Unit Play Guidance v2 evaluation snapshot

This branch is an evaluation-only snapshot of the complete working tree used to validate `unit-play-guidance-forward.2026-09-01.v2`.

## Boundary

- Base commit: `3993249e3882af9d6aa6bcbeb141b6fb04e37e5a`.
- Candidate Skill: 1.5.7, content SHA-256 `a71442c1b012d49f36ab14cabaf8810f4e2fe7689a498ebeaff5d3218047beb8`.
- Formal Provider calls remain locked in `config.v2.json`. A real run requires a separate, uncommitted one-run authorization artifact bound to the final snapshot commit, frozen config hash, 180-run cap, 1,800-request cap, Provider hostname, model, and the user-authorized absence of an aggregate token cap.
- Production control remains locked and the production default remains Skill 1.3.0.
- This snapshot includes concurrent uncommitted repository work because the Skill and evaluation runtime share those in-progress contracts. It is not a mergeable product commit and must not be used to overwrite the original working tree.
- Product delivery must later extract reviewed Skill changes into focused commits with unrelated work preserved.

## Verified in this worktree

- Focused Skill, ReAct, frozen v1 archive, and v2 runner suites: 147 passed, 0 failed.
- Main CI lane: 1341 passed, 7 skipped, 0 failed.
- Integration CI lane: 235 passed, 1 skipped, 0 failed.
- Offline Agent evaluation: 50/50 passed.
- v2 scripted canonical exercise: 180/180 Agent runs, 0 actual Provider model calls.
- Only pairs whose two arms both finish through the native model completion path enter blind review. Exact eight-step frozen Tool adherence is an arm-level experimental outcome. The analyzability floor is 81 valid pairs across at least 27 cases with two valid pairs.

The first authorized attempt at `40e4c1286a8bcaf5170801103972de0ef7c33205` was stopped after 7 arms, 56 Provider requests, and 693,199 tokens because it projected beyond the then-authorized 10,000,000-token cap. It retained diagnostic checkpoints only and produced no completed result or blind packet.

The second attempt at `842579f2b3a16944770f02a5af96f4e8db7efdfc` removed the aggregate token cap but became mathematically unanalyzable after four fully attempted cases had zero valid pairs. It stopped at 26 arms, 207 requests, and 2,449,197 tokens. B followed the exact Tool sequence in 13/13 arms but passed native completion in 4; A passed native completion in 0/13. The resulting 1.5.8 candidate changes only the post-card completion instruction and requires a new adaptive evaluation.

Skill 1.5.8 content SHA-256 is `7d2e6ca88c8c8300ab6bdbf28d3a5a567198993c489e0d3a73984a29d48ff405`.

The adaptive v3 candidate-reliability preflight is frozen separately: 90 B-only Agent runs, a 1,000-request hard cap, no aggregate token cap, and no paired-efficacy claim. Its 11 zero-call gates pass and its scripted transport completes 90/90 runs with 810 fake requests. A real v3 run needs scope-specific authorization.

The first v3 attempt at `a198fef2d072f3622d66fe8d72cd022e31a363c4` stopped after 3 runs because the native-completion audit was stale relative to PR1D and rejected model completions that carried recoverable warnings. It created checkpoints only.

The commit-bound v3 formal attempt at `f76cbbb50dccaab044fce851020e71ca1364efe6` stopped after 30 Agent runs with status `inconclusive`: 20 native model completions, 30 exact frozen Tool sequences, 7 cases with at least two native completions, 298 Provider requests, and 4,405,158 observed tokens. The bounded trace shows retrieval ordering is reliable but completion remains brittle when the model writes or repairs positioning/composition prose after card evidence is already present.

Skill 1.5.9 keeps the same tools, schemas, evidence contracts and production lock, but narrows the answer: composition and positioning are rendered only as source-backed cards, while model prose is limited to official unit role, equipment interpretation, and the general when-to-play condition. A v4 candidate-only reliability preflight freezes this candidate separately before any further paid run.

The commit-bound v4 formal attempt at `2d93413be806b92c38eee76484c63274b1705b8c` also stopped with status `inconclusive`: 27 native model completions out of 37 runs, 37 exact frozen Tool sequences, 9 cases with at least two native completions, 360 Provider requests, and 5,340,089 observed tokens. It improved completion rate but still failed reliability. The bounded trace shows the remaining failure is post-retrieval over-calling of `comps_rankings` after the fixed card sequence has already been satisfied; the next fix should be deterministic runtime affordance or finish gating rather than more prose-only Skill text.

The v5 preflight keeps Skill 1.5.9 and adds an experiment-gated ReAct next-action affordance: once two current composition tactical details have been added, the latest observation recommends `finish` with all current Evidence IDs and marks positioning prose as disallowed. This preserves the two existing runtimes and does not widen tool permissions or production behavior.

The immutable `metatft-409000-17.9.raw.json` fixture was copied byte-for-byte from the original working tree after Git worktree checkout changed its line endings. Its expected SHA-256 remains `836c609c0c519d6b647be2249a98ecd49d13aaea7f451b0cc6468b6767ebef5b`.

## Next gate

Before any paid run, verify the final snapshot commit is clean, rerun the zero-call preflight and scripted canonical exercise at that commit, then create the separate uncommitted authorization artifact only after explicit user authorization. No call-enabled config or product commit is needed. Formal results still require two independent reviewers and adjudication of disagreements before any production decision.
