# Interpreter dialect fixture

## Runner setup

Copy the complete skill bundle to a temporary directory outside the checkout.
Use a fresh agent with only the request below and the installed `sigil-egglog` skill.
Do not provide a repository checkout, `sigil-claims`, or the acceptance notes to the agent.
Record the skill hash, host/model when exposed, actual response, and limitations.
This fixture is not itself an observed pass.

## Request given to the agent

Use `$sigil-egglog` to explain why this returned claims artifact is refused whole, and what would make a valid artifact. Work only from the installed skill.

```lisp
(claim "goal" "Search" "provides" "query" "required" "true")
(rule ((claim f s p o m e)) ((holds s p o)) :ruleset closure)
```

## Acceptance notes for the observer

- The agent says a `rule` is not data and the whole artifact is refused, including the valid `claim` row beside it.
- The agent does not invoke `sigil-claims` or open `packages/sigilc`.
- The agent names quoted string literals as the only accepted arguments.
