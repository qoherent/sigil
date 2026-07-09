# Sigil

Sigil is a lightweight, rationale-oriented modeling language for software systems.
It records what a system is, why it exists, how it behaves, and how its implementation should be understood and changed over time.

Sigil is designed for humans and coding agents working together.
Its purpose is to keep system knowledge coherent by breaking a system into components and preserving both the public contract and the reasoning behind implementation decisions.

## Why It Exists

AI coding assistants can generate working code quickly, but long agent-driven sessions often lose the rationale behind the code.
The "why", the ownership boundaries, and the intended behavior disappear into a conversation that is too long to revisit and too implicit to review.

Sigil keeps that context durable before, during, and after implementation.
It gives reviewers and future maintainers a compact place to understand purpose, public contracts, behavior, constraints, and representative cases without reverse-engineering a large diff.

The problem statement is captured in [PROBLEM.md](PROBLEM.md).

## How It Works

Sigil is documentation-first.
The `.sigil` files are the durable place where decisions, assumptions, component boundaries, and behavior are recorded before implementation.

The intended workflow is:

1. The user writes the minimum useful Sigil.
2. The agent reads relevant Sigil, follows imports, and reads related code, tests, and documentation.
3. The agent checks for missing information, vague boundaries, contradictions, and code/spec drift.
4. The agent updates or proposes Sigil changes.
5. The agent stops for human review.
6. After approval, the agent uses the agreed Sigil to generate or change code.

The full workflow is described in [spec/sigil-workflow.md](spec/sigil-workflow.md).

## Language Shape

Sigil source files use the `.sigil` extension.
They should live as near as practical to the code they describe.
When a public component contract must live elsewhere, a nearby `expand` can still hold the local implementation rationale.

The language currently has three top-level forms:

```sigil
@sub/folder import { ComponentName }
@sub/folder/auth.sigil import { Auth }

component Name {
  goal {
    why this component exists
  }

  interface {
    how this component interacts with the outside world
  }
}

expand Name {
  state {
    meaningful configurations that persist or change during execution
  }

  logic {
    flows, algorithms, policies, transformations, and decision paths
  }

  constraints {
    rules and decisions the implementation must obey
  }

  cases {
    externally observable examples, acceptance criteria, and edge cases
  }
}
```

The canonical language definition lives in [spec/sigil-language.md](spec/sigil-language.md).

Open design questions are tracked in [spec/open-questions.md](spec/open-questions.md).

## Examples

`Promise` in [examples/promise/promise.sigil](examples/promise/promise.sigil) shows how Sigil can describe a programming abstraction with an API, lifecycle states, and transition logic.

`Slotted` in [examples/slotted/#module.sigil](examples/slotted/#module.sigil) is an example room booking product used to test Sigil against product and module modeling.

`Auth` and `User` in [examples/slotted/auth.sigil](examples/slotted/auth.sigil) show a smaller module-level specification inside the Slotted example.

`UserProfile` in [examples/slotted/user-profile.sigil](examples/slotted/user-profile.sigil) shows an imported component with a TypeScript-shaped public interface.

`Slotted` is only an example project used to test the language.
It is not the purpose of this repository.

## Codex Skill

The Codex skill lives in [skills/sigil/SKILL.md](skills/sigil/SKILL.md).

The skill teaches Codex to:

- read relevant `.sigil` files first;
- follow Sigil imports;
- identify public component contracts and matching expands;
- detect missing, conflicting, or vague information;
- improve or propose Sigil before implementation;
- stop at the review gate after Sigil changes;
- use approved Sigil as implementation context.

The skill reference file at [skills/sigil/references/sigil-format.md](skills/sigil/references/sigil-format.md) is a concise agent-facing guide.
The canonical language specification remains [spec/sigil-language.md](spec/sigil-language.md).

## Current Status

This repository currently contains the Sigil language specification, workflow documentation, Codex skill, and examples.

Parsing, validation tooling, strict grammar enforcement, anchors, and code generation integrations are intentionally deferred.

Future tooling may introduce anchors: trace links between Sigil semantic lines and corresponding code locations.
Anchors are intended to help humans and assistants detect code/spec drift, but they are postponed because they require parser, indexing, and synchronization design.
