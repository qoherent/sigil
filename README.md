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

1. The user writes the minimum useful Sigil, or selects a reviewed pilot when adopting Sigil in a brownfield repository.
2. The agent runs structural checks, follows imports, and reads related code, tests, configuration, and documentation.
3. The agent reviews semantic readiness, cross-Sigil coherence, modularity, applicable standards, and code/spec drift.
4. Brownfield reconstruction and externally informed additions are proposed before the agent edits Sigil.
5. The user approves, rejects, or revises the proposed contract and semantic lines.
6. The agent writes only the approved Sigil and stops at a semantic review gate.
7. After approval, the agent colocates Sigil with the implementation and uses the agreed contract to generate or change code.
8. If implementation reveals a missing material decision, the workflow returns to Sigil and human review.

The full workflow is described in [spec/sigil-workflow.md](spec/sigil-workflow.md).

The Sigil platform architecture is drafted in [spec/sigil-platform-architecture.md](spec/sigil-platform-architecture.md).

The current exploration of semantic readiness and model ownership is recorded in [ADR-009](spec/decisions/adr-009-sigil-readiness-and-model-boundary.md).

## Language Shape

Sigil source files use the `.sigil` extension.
They should live as near as practical to the code they describe.
When a public component contract must live elsewhere, a nearby `expand` can still hold the local implementation rationale.

Screens, views, and reusable user-interface surfaces can be components too.
Their `interface` may describe visible regions, user actions, navigation, feedback, and other observable behavior in natural language.
Because section bodies are free-form, the interface may also contain ASCII wireframes, Markdown image references to repository assets, or links to designs such as Figma files.
Authors can explain a visual reference's intended role in their own words when ambiguity would affect implementation.

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

## Repository Layout

The root [#module.sigil](./%23module.sigil) currently defines this repository as a Sigil workspace.

- `spec/` contains language, workflow, platform architecture, and open-question documents.
- `examples/` contains example Sigil files used as design-pressure fixtures.
- `packages/` contains the implemented `sigil-core` and `sigil-cli`, the proposed vNext `sigil-indexer`, and the future `sigil-lsp` package boundary.
- `integrations/` contains host-specific adapters such as the Codex skills and future editor integrations.

## Examples

`Promise` in [examples/promise/promise.sigil](examples/promise/promise.sigil) shows how Sigil can describe a programming abstraction with an API, lifecycle states, and transition logic.

`Slotted` in [examples/slotted/#module.sigil](examples/slotted/%23module.sigil) is an example room booking product used to test Sigil against product and module modeling.

`Auth` and `User` in [examples/slotted/auth.sigil](examples/slotted/auth.sigil) show a smaller module-level specification inside the Slotted example.

`UserProfile` in [examples/slotted/user-profile.sigil](examples/slotted/user-profile.sigil) shows an imported component with a TypeScript-shaped public interface.

`BookingCalendarView` in [examples/slotted/booking-calendar-view.sigil](examples/slotted/booking-calendar-view.sigil) shows a UI component whose interface combines natural language, an ASCII wireframe, and a repository image reference.

`Slotted` is only an example project used to test the language.
It is not the purpose of this repository.

## Codex Skill

The Codex skill lives in [integrations/codex/sigil-skill/SKILL.md](integrations/codex/sigil-skill/SKILL.md).

The skill teaches Codex to:

- read relevant `.sigil` files first;
- follow Sigil imports;
- identify public component contracts and matching expands;
- detect missing, conflicting, or vague information;
- assess semantic readiness, modularity, applicable standards, and common implementation pitfalls;
- introduce Sigil incrementally into brownfield codebases through a change-frontier pilot;
- propose brownfield and externally informed semantic lines before editing;
- stop at the review gate after semantic changes;
- colocate approved Sigil with the implementation it explains;
- use approved Sigil as implementation context.

The skill reference file at [integrations/codex/sigil-skill/references/sigil-format.md](integrations/codex/sigil-skill/references/sigil-format.md) is a concise agent-facing guide.
The [standards review](integrations/codex/sigil-skill/references/standards-review.md) and [brownfield adoption](integrations/codex/sigil-skill/references/brownfield-adoption.md) references define the corresponding host-side workflows.
The canonical language specification remains [spec/sigil-language.md](spec/sigil-language.md).

## Current Status

This repository contains the Sigil language and workflow specifications, platform architecture, examples, a shared Deno TypeScript core, a working CLI, and the Codex skill integration.

`sigil-core` currently implements structurally strict and body-tolerant parsing, source ranges and semantic lines, workspace discovery, import and component resolution, collective expansion, graphs, projections, and stable diagnostics.
`sigil-cli` implements `parse`, `check`, `graph`, `context`, and Markdown `render` commands with machine-readable output and stable exit behavior.

Semantic readiness, standards research, brownfield reconciliation, proposal gates, and implementation colocation currently live in the Codex skill rather than `sigil-core`.
The boundary for future deterministic readiness and optional model orchestration remains exploratory in ADR-009.

LSP/editor support, stricter body semantics, project configuration, and code-generation integrations remain deferred.

Anchors are now a proposed vNext capability: reviewed trace links between Sigil semantic lines and implementation evidence.
[ADR-010](spec/decisions/adr-010-ast-anchors-and-model-assisted-indexing.md) proposes a deterministic `sigil-indexer`, a TypeScript-first AST adapter, a committed `.sigil/anchors.json` sidecar, and host-side model assistance for natural-language matching.
The proposal does not add inline Sigil syntax and is not implemented until its ADR and colocated Sigil contracts are approved.
