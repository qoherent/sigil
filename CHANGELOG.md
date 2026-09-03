# Changelog

## 0.7.1 - 2026-08-04

- Advance the core, compiler, CLI, LSP, VS Code extension, and coding-agent
  skill artifacts to 0.7.1 over the Sigil Language and configuration contract
  0.7.0.
- Add implementation-ownership discovery with exact component and concept
  targets, source ranges, cross-language entrypoint resolution, resilient
  diagnostics, CLI projections, LSP hover/navigation, and watched-file
  invalidation.
- Add the compiler workflow with design and implementation focus, semantic
  readiness and architecture evaluations, structured reports, lifecycle
  statuses, persisted sessions and history, and proposal workspaces with
  ReviewGate-aware materialization.
- Add Markdown and JSON context assembly for direct dependencies, importing
  files, implementation ownership, bounded sources, and stable diagnostics.
- Add `sigil retrieve` for deterministic purpose-specific graph selection and
  aggregated compilation context, including stable evidence identifiers,
  fingerprints, dependency boundaries, and strongly connected component groups.
- Add compiler-facing retrieval envelopes so evaluators consume one selected
  context instead of independently traversing the workspace graph.
- Extend graph and resolver diagnostics for cross-file expands, component
  imports, duplicate identities, unreadable implementation sources, and
  platform-independent path handling.
- Complete the Sigil 0.6 semantic-unit and formatter tooling integration,
  including reviewed glossary projections, concept identity reuse, Markdown
  rendering, and deterministic formatting checks.
- Add VS Code compilation commands and the validated JSONL bridge over the
  external compatible Sigil CLI.

## Unreleased

- Extract the Codex CLI adapter into `@qoherent/sigil-compiler-adapter-codex`,
  registered from the CLI like its sibling adapter packages. The compiler is now
  provider-neutral: it constructs no provider implementation, and an evaluator
  provider is an opaque identifier owned by its adapter package rather than one
  of four hardcoded names. A provider naming no registered adapter is reported
  when registration resolves rather than when configuration parses.
- Export the findings schema and shared adapter execution helpers from the
  compiler as the one contract every adapter satisfies, replacing byte-identical
  copies in provider packages.

- Stop rejecting a compilation because its evaluator request carries a complete
  retrieval result. The declared initial-request limit is enforced where the
  request reaches its adapter, so exceeding it leaves that evaluator incomplete
  instead of failing the run, matching a retrieval policy that declares no
  budget in version 1.
- Remove `evaluateCompilation` and `CompilationEvaluationRunner`, a
  session-facing pass-through left with no consumer after the session boundary
  was removed, and record one-shot compilation as the evaluation pipeline's
  implementation owner.

- Make compilation-boundary selection a compiler behavior. `--component`,
  `--file`, `--position`, and the new `--directory` are affected-scope seeds
  rather than final targets: the compiler resolves the nearest module index
  whose closure covers the affected scope, otherwise the nearest covering
  component, otherwise the workspace. `--exact-target` preserves a deliberately
  narrow selection.
- Reject an unresolvable or invalid selector with a stable invocation diagnostic
  instead of silently compiling the whole workspace.
- Advance `CompilationReport` to `reportVersion` 3, adding `requestedScope` and
  `selection` beside the existing `target`, so an exported report explains which
  boundary was compiled, why, what it covered, and any uncovered evidence
  without re-running graph analysis. `target` keeps its name and meaning as the
  boundary that ran, so a consumer reading it needs no field migration.
- Remove the duplicated target-selection policy from the coding-agent skill;
  hosts now name the scope that changed and read the resolved boundary from the
  report.

- Add an optional evidence budget to purpose retrieval and
  `sigil retrieve --max-evidence-bytes`. A retrieval closure is bounded by
  relationship rules rather than size, so a broad boundary returned everything
  one hop away regardless of how much a consumer could use.
- Keep the closest evidence within the budget, always retain the selected
  contract, and report what was withheld as a summary of counts and bytes by
  evidence kind rather than one record per withheld unit.
- Report inclusion reasons only for evidence the result still contains, so a
  reason cannot outlive the evidence it explains.

- Make the coding-agent skill decide a project's module structure before
  drafting contracts, deriving bounded areas from deployment units, technology
  boundaries, independent reasons to change, shared ownership, and
  reviewability. A small project stays one boundary, and an outgrown boundary is
  proposed for splitting rather than accumulating every declaration at the
  workspace root.

- Advance the Sigil Language and configuration contract to 0.8.0 with one
  optional component section, `scope`, recording what a component deliberately
  does not cover. `Excluded:` is a settled boundary; `Deferred:` is uncovered
  for now. Every 0.7 source remains valid.
- Carry `scope` through purpose retrieval and render it in hover and preview, so
  a declared boundary reaches evaluators and readers as public evidence rather
  than looking like missing coverage.
- Teach semantic-readiness and architecture-design to report a gap only for an
  area that is neither covered nor declared, so a project can adopt Sigil one
  useful slice at a time.
- Extend implementation-ownership discovery to frontend surfaces. Markup
  (`.html`, `.htm`), stylesheet (`.css`, `.scss`, `.sass`, `.less`), and
  single-file component (`.vue`, `.svelte`, `.astro`) sources may now carry
  `@sigil` ownership annotations, so a presentation boundary participates in
  ownership projections, coverage maps, and watcher registration on the same
  terms as backend code.
- Scan a single-file component per region rather than per file: an embedded
  script region uses its code comment syntax and resolves an adjacent
  entrypoint, an embedded style region uses stylesheet comments, and remaining
  template markup uses HTML comments. A script region with no following
  definition, such as `<script setup>`, binds its annotation to the file instead
  of reporting a detached annotation, and the comment-form rule applies only to
  regions offering both a line and a multiline form.
- Scan a markup source with the same per-region split as a single-file
  component, so an ownership annotation inside an embedded `<script>` or
  `<style>` block resolves instead of being silently dropped with no diagnostic.
- Accept the Go-template families `.tmpl` and `.gohtml` as implementation
  sources, and recognize the `{{/* ... */}}` comment form alongside the HTML
  one. A template comment is stripped server-side, so it carries an annotation
  without emitting it to the rendered page.
- Add `references/frontend-surface-review.md` to the coding-agent skill,
  covering surface inventory, client-state ownership classification,
  presentation annotation placement, and frontend drift evidence, with a
  matching eval fixture and rubric.
- Add `PRESENTATION_BOUNDARY` and `UI_STATE_OWNERSHIP` rules to the compiler's
  architecture-design evaluation skill for presentation responsibility mixing
  and unowned client state.
- Rename the sole reserved directory-import index from `#module.sigil` to
  `_module.sigil` for portable filenames and shell-safe unquoted paths; treat
  the legacy filename as an ordinary explicitly importable Sigil source and
  retain the Sigil Language contract at 0.7.0.
- Advance the Sigil Language and configuration contract to 0.7.0 with
  matching-expand-only imported concept identity reuse, non-binding duplicate
  component names, deterministic import normalization and cycle diagnostics,
  normative recovery ranges, and UTF-16 source locations.
- Make blank-line-delimited prose paragraphs the semantic unit so physical
  wrapping does not change semantic identity.
- Reject each resolved imported name without a qualifying use; documentary
  mentions in `goal`, `decisions`, comments, annotations, and literal blocks do
  not count.
- Add directly attached, optionally typed backtick literal blocks whose bodies
  remain outside structural, reference, glossary, and width interpretation.
- Add the deterministic core formatter and `sigil fmt [path] [--check]` with a
  79-character prose content width that excludes leading indentation.
- Add shared implementation-ownership discovery, CLI integration, cached
  component and concept ownership links in LSP hover, watched-file cache
  invalidation in VS Code, and the corresponding Sigil implementation workflow;
  advance core, CLI, LSP, VS Code, and the Sigil skill to 0.7.0.
- Add contextual CLI help for every recognized command path and include the
  relevant help with usage errors; advance the CLI artifact to 0.6.1.
- Add the optional free-form `decisions` expand section for durable decision
  rationale while keeping binding outcomes in `constraints`.
- Define the Sigil skill convention for named material decisions with
  `Decision`, `Scope`, applicable assumptions, trade-offs, addressed issues,
  discarded alternatives, consequences, and revisit conditions.
- Preserve contextual imported-concept identity without exposing private
  decision rationale or making decisions transitively binding.
- Advance the Sigil Language and configuration contract to 0.5.0 and core, CLI,
  LSP, and VS Code extension to 0.6.0.
- Advance the Sigil skill to 0.6.2 with decision-rationale coverage, correction
  conversations, and semantic-readiness gates.

## 0.5.1 - 2026-07-23

- Link concept headings and their owning component names in LSP hover Markdown
  to the corresponding Sigil declarations.
- Preserve component-owner navigation for concept occurrences collected from
  expansion files.
- Advance the LSP and VS Code extension to 0.5.1 while retaining core, CLI, and
  the Sigil skill at compatible 0.5.0 versions.

## 0.5.0 - 2026-07-23

- Add the reviewed `.sigil/glossary.json` authority with workspace terms,
  path-glob-bounded contexts, aliases, strict validation, and stable
  diagnostics.
- Add deterministic glossary occurrence matching, CLI inspection, LSP
  highlighting, hover, and definition navigation.
- Include source-scoped reviewed terminology in `sigil context` for coding-agent
  handoffs without injecting unrelated glossary entries.
- Require glossary inspection and candidate extraction after every approved
  Sigil write or semantic edit, with explicit approval before glossary authority
  changes.
- Advance core, CLI, LSP, VS Code extension, and the Sigil skill to 0.5.0 while
  retaining the compatible Sigil Language and config contract at 0.4.0.

## 0.4.0 - 2026-07-22

- Add flat `ConceptIdentifier { ... }` blocks for single reusable concepts or
  related groups of semantic lines.
- Warn on contiguous ungrouped interface regions while keeping warnings
  non-fatal in the CLI and visible through LSP diagnostics.
- Resolve one case-insensitively unique namespace across a component and all
  matching expands, with collective repeated blocks and public/private concept
  visibility.
- Make imported public concepts available as bare identifiers, preserve their
  origin through contextual reuse and downstream interface re-exposure, and
  reject ambiguity without dotted notation, aliases, or shadowing.
- Add concept symbols, definition, hover, references, semantic highlighting, CLI
  context projections, and grouped Markdown rendering.
- Extend the Sigil skill with proposal-only concept-identifier subagent work,
  primary-agent validation, and an explicit anchoring exclusion.
- Record the namespace, import-reuse, and collective-block decisions in ADR-015,
  ADR-016, and ADR-017.
- Advance the language, core, CLI, LSP, VS Code extension, and skill to 0.4.0.

## 0.3.0 - 2026-07-22

- Require every `#module.sigil` to declare at least one local component and add
  `SIGIL_MODULE_WITHOUT_COMPONENT` for imports-only indexes.
- Clarify that `goal` and `interface` are both public to dependents.
- Limit interfaces to operations, data, events, results, errors, and observable
  promises; express dependencies through imports and private architecture rules
  through constraints.
- Adopt blank lines between distinct prose-level Sigil ideas while preserving
  compact free-form constructs.
- Add the Sigil 0.3 migration guide and ADR-014; supersede the affected ADR-013
  module-index decision.
- Advance the language, core, CLI, LSP, VS Code extension, and skill to 0.3.0.

## 0.2.0 - 2026-07-21

- Replace the special project-root module contract with `#module.sigil` as an
  explicit directory index allowed in any included directory.
- Keep every component public through explicit `.sigil` imports and resolve
  directory imports from an index's local declarations and direct imports.
- Preserve original declaration paths through module indexes for graphs and LSP
  definition navigation.
- Remove the project-root-only module and directory-import diagnostics.
- Keep ordinary Brownfield summary components at the workspace root and every
  declared member as a workflow convention rather than a language form.
- Add the Sigil 0.2 migration guide and ADR-013; supersede ADR-012.
- Advance the language, core, CLI, LSP, VS Code extension, and skill to 0.2.0.

- Add standalone CLI archives for macOS ARM64/x86_64, Linux ARM64/x86_64, and
  Windows x86_64, with versioned GitHub Release automation.
- Add checksum-verifying shell and PowerShell installers that require no Deno or
  Node.js runtime on destination machines.
- Replace `sigil install` with `sigil skill list` and `sigil skill install`,
  using global multi-agent installation by default and `--project` for local
  installation.
- Support Codex, Claude Code, OpenCode, and Pi skill locations, including
  managed upgrades, conflict preflight, and a Windows copy fallback.
- Publish the packaged VS Code VSIX through versioned GitHub Releases while
  Marketplace distribution remains deferred.
- Extend the standalone Codex Sigil skill 0.2.0 with implementation component
  discovery and an implementation coverage gate before coding.
- Treat dependent-facing programming abstractions, internal APIs, state
  machines, screens, views, and reusable UI surfaces as possible components.
- Distinguish component contracts, implementation-specific expands, and
  intentionally omitted trivial mechanics through a reviewable coverage map.
- Implement the pre-production Sigil VS Code extension 0.2.0 as the first
  concrete human authoring and review surface.
- Define its initial scope as TextMate highlighting, bundled LSP integration,
  editor-native language features, and hover-backed component previews.
- Implement the pre-production `@qoherent/sigil-lsp` 0.2.0 package.
- Define the initial LSP 3.18 package contract for stdio lifecycle, full
  document synchronization, diagnostics, document symbols, definition
  navigation, hover, and resolver-backed semantic highlighting.
- Require user collaboration to define and approve clear Sigil coverage before
  adding or modifying affected implementation.
- Define `#module.sigil` as an explicit directory index while retaining
  descriptive filenames for component contracts and implementation rationale.
- Clarify that logic owns behavior and execution flow while constraints own
  rules, policies, invariants, architecture decisions, and technology choices.
- Rename internal `#module.sigil` contracts and update their imports.
- Define `workspace.members` as the authority for additional Brownfield summary
  boundaries; package manifests may inform proposals but not runtime discovery.
- Require brownfield application discovery and user confirmation of the
  application goal and interface before proposing a meaningful root module.
- Reject empty and import-only root modules in the brownfield workflow fixture.
- Classify confirmed application-wide evidence into minimal root `state`,
  `logic`, `constraints`, and `cases` sections while excluding incidental and
  module-specific details.
- Rename the Codex skill contract to its member-root `#module.sigil` and define
  dedicated Greenfield and Brownfield expands under one general skill contract.
- Make Greenfield clarification conversational and iterative, including design
  choices, tradeoffs, recommendations, and user-directed alternatives.
- Run `sigil init` before Brownfield discovery, establish and review configured
  boundary summaries through evidence plus conversation, and only then focus on
  the requested task.

## 0.1.0 - 2026-07-13

- Publish the pre-production Sigil Language 0.1.0.
- Add mandatory strict `.sigil/config.json` schema 0.1.0 and config-based
  discovery.
- Allow independent nested workspaces only when their subtrees are excluded by
  configured parents.
- Configure Promise and Slotted as independent example projects.
- Release `@qoherent/sigil-core` and `@qoherent/sigil` 0.1.0.
- Add CLI `init` and `version` commands and complete workspace metadata output.
- Version the standalone Codex skill with compatibility checks and fixture
  evaluation.
- Add migration, API, compatibility, release, and configuration documentation.
