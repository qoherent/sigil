# Changelog

## Unreleased

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

- Add standalone CLI archives for macOS ARM64/x86_64, Linux ARM64/x86_64,
  and Windows x86_64, with versioned GitHub Release automation.
- Add checksum-verifying shell and PowerShell installers that require no Deno
  or Node.js runtime on destination machines.
- Replace `sigil install` with `sigil skill list` and `sigil skill install`,
  using global multi-agent installation by default and `--project` for local
  installation.
- Support Codex, Claude Code, OpenCode, and Pi skill locations, including
  managed upgrades, conflict preflight, and a Windows copy fallback.
- Publish the packaged VS Code VSIX through versioned GitHub Releases while
  Marketplace distribution remains deferred.
- Extend the standalone Codex Sigil skill 0.2.0 with implementation
  component discovery and an implementation coverage gate before coding.
- Treat dependent-facing programming abstractions, internal APIs, state
  machines, screens, views, and reusable UI surfaces as possible components.
- Distinguish component contracts, implementation-specific expands, and
  intentionally omitted trivial mechanics through a reviewable coverage map.
- Implement the pre-production Sigil VS Code extension 0.2.0 as the
  first concrete human authoring and review surface.
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
- Add mandatory strict `.sigil/config.json` schema 0.1.0 and config-based discovery.
- Allow independent nested workspaces only when their subtrees are excluded by configured parents.
- Configure Promise and Slotted as independent example projects.
- Release `@qoherent/sigil-core` and `@qoherent/sigil` 0.1.0.
- Add CLI `init` and `version` commands and complete workspace metadata output.
- Version the standalone Codex skill with compatibility checks and fixture
  evaluation.
- Add migration, API, compatibility, release, and configuration documentation.
