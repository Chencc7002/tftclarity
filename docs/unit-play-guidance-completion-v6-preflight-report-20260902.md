# Unit-play guidance v6 zero-call preflight

## Decision

The v6 candidate is frozen for a separate candidate-only quality and reliability experiment. The zero-call preflight passed and the scripted transport completed all 90 planned Agent runs with 810 fake transport requests and zero Provider calls. This does not authorize a real Provider run or production control.

## Candidate changes

- Skill 1.5.11 keeps the 1.5.9 retrieval and two-card completion contracts.
- Prose uses source recommendation wording unless the source supports stronger language.
- Unit explanations may omit secondary effects but must preserve the effect source, target, condition and result.
- A candidate-only finish guard rejects predominantly Chinese answers for clearly English current-turn input.
- English answer language is a seventh independent review facet.

## Browser validation

One explicitly authorized BrowserUse run was performed against `api.deepseek.com` at commit `1577039799e91ef0559d74a025af1ab187180223`.

- The exact eight-tool sequence completed.
- The first Chinese finish for an English request was rejected by the new language guard.
- The repaired answer was English and preserved Amumu's condition: the stun lasts longer when the target is already burning.
- Two composition cards were rendered, and each card contained its own bound nine-unit board.
- The run used 18 Provider requests. Eight were avoidable action-shape repairs caused by the Browser diagnostic's `event` message mode. V6 freezes the canonical action-shaped transport used by v5; the Browser diagnostic now defaults to `action`.

## Frozen scope

- 30 existing positive cases, three candidate repetitions each.
- 90 Agent runs, concurrency one.
- At most 1,000 Provider HTTP requests if separately authorized.
- No total token cap in the frozen config.
- No paired efficacy claim and no production authorization.

## Remaining gate

A real v6 Provider run requires a new authorization artifact bound to the final implementation commit and the normalized v6 config hash. The checked-in lock remains false.
