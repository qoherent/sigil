
# <img src="docs/sigil.png" height="30" /> Sigil

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

## Install The CLI

Sigil publishes standalone, unsigned prerelease executables through GitHub
Releases. Deno and Node.js are not required on the destination machine.

macOS or Linux:

```bash
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

Set `SIGIL_VERSION` to install a specific release. To inspect an installer
before running it, download the script first instead of piping it directly to a
shell. Every archive is verified against the release's SHA-256 manifest before
installation.

Install the bundled Sigil skill globally for Codex, Claude Code, OpenCode, and
Pi:

```bash
sigil skill install
```

Use `sigil skill install --project` for repository-local installation, or
`--agent codex|claude|opencode|pi` to target one agent.

VS Code extension releases are currently available as manually installable
`.vsix` files on the [GitHub Releases page](https://github.com/qoherent/sigil/releases).
Marketplace publishing remains deferred.

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

The proposed architecture for semantic readiness, generated Receipts, evidence,
anchors, and human review is recorded in
[ADR-011](spec/decisions/adr-011-generated-rationale-evidence-and-review-records.md).

## Language Shape

Sigil source files use the `.sigil` extension.
They should live as near as practical to the code they describe.
When a public component contract must live elsewhere, a nearby `expand` can still hold the local implementation rationale.

Screens, views, and reusable user-interface surfaces can be components too.
Their `interface` may describe visible regions, user actions, navigation, feedback, and other observable behavior in natural language.
Because section bodies are free-form, the interface may also contain ASCII wireframes, Markdown image references to repository assets, or links to designs such as Figma files.
Authors can explain a visual reference's intended role in their own words when ambiguity would affect implementation.

The language currently has three top-level forms:

```ts
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
    behavior, flows, algorithms, transformations, decision paths, and lifecycle transitions
  }

  constraints {
    rules, policies, invariants, and decisions the implementation must obey
  }

  cases {
    externally observable examples, acceptance criteria, and edge cases
  }
}
```

The canonical language definition lives in [spec/sigil-language.md](spec/sigil-language.md).

Project-specific terms, statuses, reserved names, and abbreviations are defined
in the [Sigil glossary](spec/glossary.md).

Open design questions are tracked in [spec/open-questions.md](spec/open-questions.md).

## Repository Layout

The root [.sigil/config.json](./.sigil/config.json) defines this repository as a Sigil 0.2.0 workspace and excludes the independent example projects.
The root [#module.sigil](./%23module.sigil) is its directory-import index and
contains the ordinary high-level project summary for this configured boundary.

- `spec/` contains language, workflow, platform architecture, and open-question documents.
- `examples/` contains independently configured Sigil projects used as design-pressure fixtures.
- `packages/` contains the implemented `sigil-core`, `sigil-cli`, and initial `sigil-lsp`, plus the proposed future `sigil-indexer`.
- `integrations/` contains host-specific adapters such as the Codex skills, the initial VS Code extension, and future editor integrations.

## Examples

`Promise` in [examples/promise/promise.sigil](examples/promise/promise.sigil) shows how Sigil can describe a programming abstraction with an API, lifecycle states, and transition logic.

Its [.sigil/config.json](examples/promise/.sigil/config.json) makes it an independent workspace named `promise`.

`Slotted` in [examples/slotted/#module.sigil](examples/slotted/%23module.sigil) is an example room booking product used to test Sigil against product and module modeling.

Its [.sigil/config.json](examples/slotted/.sigil/config.json) makes it an independent workspace named `slotted`; imports beginning with `@` resolve from that directory.

`Auth` and `User` in [examples/slotted/auth.sigil](examples/slotted/auth.sigil) show a smaller module-level specification inside the Slotted example.

`UserProfile` in [examples/slotted/user-profile.sigil](examples/slotted/user-profile.sigil) shows an imported component with a TypeScript-shaped public interface.

`BookingCalendarView` in [examples/slotted/booking-calendar-view.sigil](examples/slotted/booking-calendar-view.sigil) shows a UI component whose interface combines natural language, an ASCII wireframe, and a repository image reference.

`Slotted` is only an example project used to test the language.
It is not the purpose of this repository.

## Codex Skill

The Codex skill lives in [integrations/skills/sigil/SKILL.md](integrations/skills/sigil/SKILL.md).

The skill teaches Codex to:

- read relevant `.sigil` files first;
- follow Sigil imports;
- identify public component contracts and matching expands;
- detect missing, conflicting, or vague information;
- assess semantic readiness, modularity, applicable standards, and common implementation pitfalls;
- introduce Sigil incrementally into brownfield codebases through a change-frontier pilot;
- derive provisional boundary pictures from documentation, dependency definitions, executable configuration, and entrypoints, then confirm goals and interfaces before proposing ordinary summaries at the workspace root and declared members;
- preserve material boundary-wide runtime modes, flows, binding architecture decisions, and observable outcomes in minimal expands while excluding incidental and task-specific details;
- propose brownfield and externally informed semantic lines before editing;
- stop at the review gate after semantic changes;
- colocate approved Sigil with the implementation it explains;
- use approved Sigil as implementation context.

The skill reference file at [integrations/skills/sigil/references/sigil-format.md](integrations/skills/sigil/references/sigil-format.md) is a concise agent-facing guide.
The [standards review](integrations/skills/sigil/references/standards-review.md) and [brownfield adoption](integrations/skills/sigil/references/brownfield-adoption.md) references define the corresponding host-side workflows.
The canonical language specification remains [spec/sigil-language.md](spec/sigil-language.md).

## Current Status

All published Sigil artifacts are pre-production and versioned at 0.2.0.
See [PRE_RELEASE.md](PRE_RELEASE.md), [configuration](spec/sigil-config.md), and the [migration guide](spec/migrating-to-0.2.md).

This repository contains the Sigil language and workflow specifications, platform architecture, examples, a shared Deno TypeScript core, a working CLI, and the Codex skill integration.

`sigil-core` implements explicit language-version parsing, strict config
validation, config-based discovery, declared workspace-member metadata, glob
filtering, source ranges and semantic lines, explicit file and directory-index
import resolution, collective expansion, graphs, projections, and stable diagnostics.
`sigil-cli` implements `init`, `version`, `parse`, `check`, `graph`, `context`, and Markdown `render` commands with machine-readable output and stable exit behavior.

`sigil-lsp` is an implemented pre-production deliverable. Its initial contract
covers LSP 3.18 lifecycle, full document synchronization, diagnostics, document
symbols, definition navigation, hover, and resolver-backed semantic highlighting
over a stdio transport.

The Sigil VS Code extension is an implemented pre-production deliverable. Its
initial contract covers TextMate syntax highlighting, bundled LSP startup,
resolver-backed component highlighting through LSP semantic tokens,
editor-native language features, and a read-only component preview derived from
standard hover responses.

Semantic readiness, standards research, brownfield reconciliation, proposal gates, and implementation colocation currently live in the Codex skill rather than `sigil-core`.
The skill also discovers coherent implementation and UI components, distinguishes component contracts from implementation-specific expands and trivial mechanics, and requires an implementation coverage map before coding.
The proposed boundary keeps deterministic facts in shared packages and
model-assisted interpretation in attributed host contributions, as described in
ADR-011.

Editor integrations other than VS Code, stricter body semantics, project
configuration, and code-generation integrations remain deferred.

Receipts and anchors are proposed future capabilities: Receipts explain how
semantic lines were interpreted and checked, while anchors provide reviewed
trace links to implementation evidence.
[ADR-011](spec/decisions/adr-011-generated-rationale-evidence-and-review-records.md)
proposes deterministic shared packages, attributed host-assisted interpretation,
a future `sigil-indexer`, and generated review records without adding inline
Sigil syntax. The proposal is not implemented until ADR-011 and its colocated
Sigil contracts are approved.
