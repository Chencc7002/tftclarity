# Unit-play guidance completion v6 formal report

## Scope and authorization

The formal adaptive candidate reliability run was bound to implementation commit
`5ce0bef26165873ed82170958a12895014a3368e` and normalized config hash
`b341ce23896030c9ae51af455f651af5b012f1d7875cfbb54f85cfc9f72b119f`.
The user authorized one frozen v6 run with 90 Agent runs, at most 1,000 Provider HTTP
requests, no total-token cap, and no production control.

The authorization was consumed under id `30a11477-1887-481e-a8c6-324897495ca8`.
The run used only `api.deepseek.com` and did not enable the checked-in Provider or
production locks.

## Formal result

- 90/90 Agent runs completed with native model answers.
- 90/90 runs followed the exact frozen eight-tool sequence.
- 30/30 cases had three valid native completions.
- 840 Provider HTTP requests were observed, below the 1,000-request hard cap.
- 12,487,457 tokens were observed; the authorized total-token cap was null.
- Provider identity remained `deepseek-v4-flash` with system fingerprint
  `a26a7955944dc5c60445bff77fac9c8e` across 840 observations.
- The result status is `awaiting_independent_review`.

The nominal path requires nine Provider requests per run: eight tool decisions and one
finish decision. All 30 English cases initially attempted a Chinese finish. The frozen
input-language guard rejected each attempt and obtained an English rewrite, accounting
for the 30 extra requests. The final 30 English and 60 Chinese answers all matched the
input language and target length.

## Structural and preliminary answer review

The operator review found:

- both accepted when-to-play alternatives in 90/90 answers;
- low-sample Shen wording correctly qualified in 9/9 relevant outputs;
- two distinct composition cards in 90/90 answers;
- 180/180 cards with complete formation-to-member binding;
- no prose restatement of tactical coordinates or formations;
- preliminary facet totals of 605 pass, 16 partial, and 9 fail out of 630.

The partial and failing preliminary findings cluster around compressed semantic wording:
Gnar item behavior, Amumu and Kennen burn relationships, one Hand of Justice summary,
one Spirit Visage summary, and optional Ionic Spark secondary damage. They do not affect
retrieval order, source card identity, formation binding, completion, or final answer
language.

On 2026-09-03 the user accepted these findings as tolerable and requested no further
candidate revision. This is recorded as a product disposition only. It does not replace
the two frozen independent reviews, does not change the formal result status, and does
not authorize production activation.

## Claim boundary and next gate

The v6 evidence supports candidate runtime reliability, source-card binding, and guarded
language completion. It does not establish paired efficacy because v6 is an adaptive
candidate-only run. Production continues to use Skill 1.3.0; candidate 1.5.11 remains
inactive.

The next protocol gate is completion of the two independent review label files and any
required adjudication. A later shadow extraction or production decision requires a
separate explicit decision and must keep the existing runtime and legacy path intact.
