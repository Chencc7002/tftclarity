# Unit-play guidance completion v5 independent review

The formal v5 run passed its candidate reliability gate. It has not yet passed answer-quality review and does not authorize production.

Review the 90 randomized entries in `review-packet.v5.json`. Two reviewers independently fill `reviewer-1.v5.json` and `reviewer-2.v5.json`. Each rating must be one of `pass`, `partial`, `fail`, or `not_applicable`; `reasonCodes` and `note` may record the supporting reason. Reviewers must not open `review-key.v5.json`, compare their labels, or begin adjudication until both independent files are complete.

Apply the six frozen facets from `eval/skills/unit-play-guidance-forward/review-schema.v2.json`. In particular, composition and positioning are evaluated as two cards that each own their formation. The answer prose should interpret the unit, equipment, and when-to-play conditions without restating positioning. Keyword presence is not semantic evidence.

The offline helper reads no credentials, makes no Provider calls, and does not inspect the blind key:

```powershell
$run = '.cache/eval/unit-play-guidance-completion-v5/formal-c80d299-attempt-01'
node scripts/review-unit-play-guidance-completion-v5.mjs --run=$run
```

After both reviewers finish, generate the disagreement-only file. The command refuses to overwrite an existing file:

```powershell
node scripts/review-unit-play-guidance-completion-v5.mjs --run=$run --prepare-adjudication
```

An adjudicator fills `adjudicatorId` and every `rating`, `reasonCodes`, and non-empty `note` in `adjudication.v5.json`. Then create the immutable summary:

```powershell
node scripts/review-unit-play-guidance-completion-v5.mjs --run=$run --finalize
```

The result is `independent-review-result.v5.json`. It preserves hashes of the packet, both original reviewer files, and adjudication; reports agreement and per-facet rating counts; and deliberately makes no automatic pass/fail or production decision. Product extraction remains a separate reviewed change after answer-quality results are available.
