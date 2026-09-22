# Law-author fixture

## Runner setup

Copy the complete skill bundle to a temporary directory outside the checkout.
Use a fresh agent with only the request below, the installed `sigil-egglog` skill, and the in-fixture program below.
Do not provide a repository checkout, `sigil-claims`, or the acceptance notes to the agent.
Record the skill/input hashes, host/model when exposed, actual response, and limitations.
This fixture is not itself an observed pass.

## Request given to the agent

Use `$sigil-egglog` to extend this tiny law so a `known` fact is derived from each `edge` during `closure`, using only the installed language reference.

## Input: `tiny.egg`

```lisp
(relation edge (String String String String))
(relation known (String String String))
(relation because (String String String String String))
(ruleset closure)
(ruleset diagnostics)
```

## Acceptance notes for the observer

- The agent adds a `(rule ... :ruleset closure)` that writes `known` from `edge`, matching the in-bundle kernel pattern rather than a birewrite or Turtle loader.
- The agent does not invoke `sigil-claims` or open `packages/sigilc`.
- Absence of a row is not treated as negation.
