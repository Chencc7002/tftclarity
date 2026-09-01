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

The immutable `metatft-409000-17.9.raw.json` fixture was copied byte-for-byte from the original working tree after Git worktree checkout changed its line endings. Its expected SHA-256 remains `836c609c0c519d6b647be2249a98ecd49d13aaea7f451b0cc6468b6767ebef5b`.

## Next gate

Before any paid run, verify the final snapshot commit is clean, rerun the zero-call preflight and scripted canonical exercise at that commit, then create the separate uncommitted authorization artifact only after explicit user authorization. No call-enabled config or product commit is needed. Formal results still require two independent reviewers and adjudication of disagreements before any production decision.
