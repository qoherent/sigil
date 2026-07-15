# Sigil Platform Architecture

**Status:** Draft
**Owner:** _TBD_
**Last updated:** 2026-07-10

This document defines the high-level architecture guidelines for the Sigil platform.
Package-specific product details, public commands, editor features, and implementation milestones belong near the package or integration they describe.

## 1. Purpose

Sigil is a language and platform for preserving software rationale in a form that humans and coding agents can both use.

The platform must keep these concerns connected without collapsing them into one tool:

- parse and understand `.sigil` files;
- resolve workspace imports and component relationships;
- preserve semantic lines and source locations;
- expose focused context to agents and automation;
- expose readable and navigable views to humans;
- support host-specific integrations without making any host the center of the architecture.

## 2. Repository Boundaries

This repository is organized as a workspace-style monorepo.

```text
spec/
  language, workflow, platform architecture, and open questions

examples/
  parser fixtures and design-pressure examples

packages/
  buildable or distributable platform units

integrations/
  host-specific adapters
```

Boundary rules:

- `spec/` defines durable language and platform decisions.
- `examples/` demonstrates and tests language behavior.
- `packages/` contains reusable implementation units.
- `integrations/` adapts Sigil to specific hosts such as Codex, editors, MCP, or GitHub.
- Package-specific details belong in that package's README or spec.
- Host-specific behavior belongs under `integrations/`, not in shared packages.

## 3. Package Responsibilities

Platform packages:

- `packages/sigil-core`: implemented shared parser, workspace loader, resolver, graph, diagnostics, source-location model, and projection primitives.
- `packages/sigil-cli`: implemented command-line interface for agents, CI, scripts, debugging, context extraction, and Markdown review rendering.
- `packages/sigil-indexer`: proposed vNext deterministic source AST indexing, anchor candidates, validation, persistence, and reconciliation.
- `packages/sigil-lsp`: implemented v1 language-server interface for shared editor-neutral diagnostics, navigation, symbols, and hover across multiple editors.

Integrations:

- `integrations/codex/sigil-skill`: implemented Codex workflow for structural tool use, host-side semantic and standards review, brownfield adoption, review gates, and implementation colocation.
- `integrations/codex/sigil-anchor-indexer`: proposed Codex workflow for bounded model-assisted anchor proposals and human approval.
- `integrations/editor/vscode`: future VS Code extension, syntax highlighting, editor commands, and visual affordances.

The CLI is an automation interface.
It may help humans during early development, but it is not the primary human product.

The primary human experience should become editor-native through syntax highlighting, inline diagnostics, navigation, previews, and collected-expansion views.

## 4. Shared Core Rules

All projections and integrations must interpret Sigil through the same shared core model.

The core must own:

- parsing top-level Sigil structure;
- preserving source ranges and semantic lines;
- resolving imports from a workspace root;
- collecting all matching `expand Name` blocks for a component;
- building component and file dependency graphs;
- producing diagnostics;
- exposing reusable projection primitives for agents and humans.

The core must not depend on:

- CLI argument parsing;
- Codex-specific prompt behavior;
- VS Code APIs;
- editor UI concerns;
- transport protocols such as LSP or MCP.

`sigil-indexer` may depend on `sigil-core` and source-language parser adapters.
It must remain deterministic and must not call models or depend on host prompts.
Source AST nodes are resolution evidence, not durable anchor identities.
Accepted anchor relationships live in a versioned workspace sidecar rather than
inside Sigil syntax.

## 5. Workspace Rules

The platform must model the Sigil workspace root explicitly.

The workspace root is used to:

- discover `.sigil` files;
- resolve `@path` imports;
- relate Sigil files to nearby code;
- build the component graph;
- create agent context packs;
- power editor and documentation views.

A mandatory strict JSON `sigil.config` defines the workspace root, config schema version, language version, workspace identifier, optional workspace members, and file discovery rules.
Platform packages walk upward and select the nearest ancestor config when every higher configured workspace excludes that nearer root, unless an explicit root containing the config is supplied.
Missing and unexcluded nested configs are errors; configs inside excluded
subtrees define independent workspaces. `#module.sigil` is reserved for the
workspace root and member roots explicitly declared by `workspace.members`;
ordinary internal contracts use descriptive `.sigil` filenames. Package
manifests do not independently authorize RootSigil locations.

All workspace-dependent machine-readable outputs include the resolved root, config path, config version, language version, and workspace name.

## 6. Interface Strategy

Sigil has different user modes, so one interface should not pretend to serve every audience equally.

- Agents and automation use CLI and machine-readable JSON.
- Humans author and review Sigil primarily in editors.
- Markdown rendering is a review and documentation projection.
- LSP is the reusable semantic bridge between the shared core and editor integrations.
- Host integrations should stay thin over shared packages.

The Codex skill currently owns nondeterministic host behavior such as user elicitation, web research, brownfield evidence reconciliation, and semantic readiness review.
Whether core should later expose deterministic readiness primitives or a separate optional agent package remains exploratory in ADR-009.

The proposed anchor workflow follows the same boundary: shared packages produce
and validate deterministic candidate data, while Codex or another host may
interpret natural language and propose relationships. Human review remains
outside shared packages. See ADR-010.

This keeps the platform coherent while allowing each surface to feel natural for its audience.

## 7. Architectural Decision Records

### ADR-001: Treat The Repository As A Workspace-Oriented Monorepo

Decision: Use a monorepo-style structure with docs, examples, packages, and integrations in separate top-level areas.

Rationale: Sigil needs examples, buildable packages, and host integrations to evolve with the language without pretending they are the same concern.

Tradeoff: The repository becomes broader, so naming and boundaries need discipline.

### ADR-002: Introduce A First-Class Sigil Workspace Model

Decision: Model the workspace root explicitly in the platform core.

Rationale: Import resolution, file discovery, agent context, and future code relation all need a stable root.

Tradeoff: a declared workspace member may have a `RootSigil` without defining
an independent Sigil workspace; `sigil.config` remains the sole workspace and
membership authority.

### ADR-003: Use One Shared Core For Agent And Human Outputs

Decision: Agent context, human rendering, CLI output, and editor semantics must consume the same parser, resolver, diagnostics, and graph model.

Rationale: Separate interpretations would drift and make trust worse.

Tradeoff: The shared core needs careful boundaries before host integrations grow.

### ADR-004: Preserve Semantic Lines As First-Class Data

Decision: Every non-empty section line becomes a semantic line with source location.

Rationale: This supports review, diagnostics, future anchors, and code/spec drift detection.

Tradeoff: The parser model is more detailed than a simple document tree.

### ADR-005: Keep The Parser Structurally Strict And Body-Tolerant

Decision: Parse Sigil structure strictly but keep section body content mostly free-form.

Rationale: Sigil is meant to be useful while humans are thinking, not only after formalization.

Tradeoff: Some semantic mistakes will be diagnostics or review issues rather than parse errors.

### ADR-006: Start Agent Context With Deterministic Signals

Decision: Agent context should initially use graph and text heuristics, not embeddings or opaque ranking.

Rationale: Deterministic context is easier to debug and trust.

Tradeoff: Early search may feel less magical for broad natural-language queries.

### ADR-007: Treat The CLI As Automation, Not The Primary Human UI

Decision: CLI commands are for agents, CI, scripts, and debugging; editor integrations are the primary human interface.

Rationale: Humans author Sigil beside code and need inline feedback, navigation, and previews.

Tradeoff: The platform needs an LSP/editor path instead of stopping at terminal output.

### ADR-008: Separate Buildable Packages From Host Integrations

Decision: Shared implementation packages live under `packages/`; host-specific adapters live under `integrations/`.

Rationale: The same Sigil core should support multiple hosts without making Codex, VS Code, or any one environment the center of the architecture.

Tradeoff: Documentation and installation references must point to longer integration paths.

### ADR-009: Explore Sigil Readiness And The Model Boundary

Status: Exploratory; no option has been selected.

Question: When does Sigil contain enough information for implementation, and which layer should gather missing information from users, repositories, models, and research?

Discussion: See [ADR-009: Sigil Readiness And Model Boundary](decisions/adr-009-sigil-readiness-and-model-boundary.md).

### ADR-010: Use AST Evidence With Model-Assisted Anchor Proposals

Status: Proposed; implementation is blocked on semantic review.

Decision proposal: Keep anchors outside `.sigil` syntax, use deterministic
source-language adapters and a committed anchor sidecar, and allow hosts to use
models only to propose natural-language relationships for human approval.

Discussion: See [ADR-010: AST Anchors And Model-Assisted Indexing](decisions/adr-010-ast-anchors-and-model-assisted-indexing.md).

## 8. Risks And Guardrails

### Over-Formalizing The Language

If the parser becomes too strict too early, authors may stop using Sigil during ambiguous design work.

Guardrail: keep section bodies free-form and provide diagnostics instead of hard failures where possible.

### Splitting Interpretations

If CLI, agent, renderer, and editor integrations interpret Sigil separately, they will disagree.

Guardrail: all surfaces use `sigil-core`.

### Losing Source Fidelity

If source locations and semantic lines are not preserved from the beginning, anchors and drift detection become expensive later.

Guardrail: source ranges are core parser output, not metadata added later.

### Treating AST Nodes As Permanent Identity

AST nodes are recreated on every parse and may disappear during behavior-preserving refactors.

Guardrail: persist relationship IDs and locator fingerprints, use AST nodes as
resolution evidence, and return ambiguous remapping to review.

### Letting Models Mutate Accepted Anchors

Natural-language matching is useful but nondeterministic and may silently choose
the wrong target after a refactor.

Guardrail: models only propose; deterministic validation and explicit human
approval precede persistence.

### Making Agent Context Too Large

Agents can lose focus if context packs include every related file and full code body.

Guardrail: start with compact Sigil context plus suggested code paths.

### Treating Markdown As The Human Product

Markdown rendering helps review, but it cannot provide the authoring experience humans need.

Guardrail: plan editor-native syntax, diagnostics, navigation, and previews as the main human UI.

### Workspace Root Ambiguity

Import behavior becomes confusing if the root changes depending on where commands are run.

Guardrail: expose the resolved workspace root in machine-readable output and support explicit root selection.

## 9. Where Product Detail Lives

Detailed package and integration specs should live close to the implementation surface:

- `packages/sigil-core/README.md`: parser, resolver, graph, diagnostics, projections.
- `packages/sigil-cli/README.md`: command behavior for agents, CI, scripts, and debugging.
- `packages/sigil-indexer/README.md`: deterministic anchor index, source adapters, reconciliation, and persistence.
- `packages/sigil-lsp/README.md`: future editor semantic protocol.
- `integrations/editor/vscode/README.md`: future concrete editor UX.
- `integrations/codex/sigil-skill/`: Codex prompt and reference behavior.
- `integrations/codex/sigil-anchor-indexer/`: model-assisted anchor proposal workflow.

Root-level docs should stay stable and architectural.
Package docs can change as the implementation and product surface become more concrete.
