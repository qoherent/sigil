# Sigil Workflow

Sigil is documentation-first.
The `.sigil` files are the durable place where decisions, assumptions, component boundaries, and behavior are recorded before implementation.

## Intended Flow

1. The user writes the minimum useful Sigil.
2. The agent reads relevant `.sigil` files, code, tests, package metadata, and documentation.
3. The agent checks for missing information, vague boundaries, contradictions, and code/spec drift.
4. The agent asks targeted questions only when the answer changes architecture, ownership, behavior, or public contract.
5. The agent updates or proposes Sigil changes.
6. The agent stops at a review gate and asks the user to review the Sigil.
7. The user approves or corrects the Sigil.
8. Only after approval, the agent uses the agreed Sigil to generate or change code.

If implementation reveals a missing decision, the agent should stop and reflect that decision back into Sigil before continuing.
This keeps documentation ahead of the code instead of turning it into an after-the-fact summary.

## Review Gate

The review gate is mandatory after creating or changing Sigil files.

At the review gate, the agent should report:

- changed Sigil files;
- main decisions or assumptions captured;
- unresolved questions;
- a direct request for user review and approval before implementation.

Requests like "use Sigil", "improve Sigil", "prepare Sigil", or "check the spec before coding" are not approval to write implementation code.
They mean the agent should work on the documentation/specification layer and wait for review.

## Agent Review Heuristics

When reviewing or improving Sigil, check:

- Does every component explain why it exists?
- Does every component expose how callers, users, modules, or other parts interact with it?
- Does each `expand Name` have a matching `component Name`?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation details hidden from public component interfaces unless they are part of the contract?
- Are roles, states, permissions, and lifecycle transitions explicit enough to test?
- For abstractions and APIs, are constructor/functions, return values, settlement/lifecycle behavior, and error behavior explicit?
- Are examples in `cases` externally observable?
- Are there multiple expands for the same component?

When multiple expands exist, ask whether they should be merged, scoped, or selected by context unless the project already defines a rule.
