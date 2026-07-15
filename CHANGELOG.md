# Changelog

## Unreleased

- Implement the Sigil VS Code extension 1.0.0 in the v1 release line as the
  first concrete human authoring and review surface.
- Define its initial scope as TextMate highlighting, bundled LSP integration,
  editor-native language features, and hover-backed component previews.
- Implement `@sigil/lsp` 1.0.0 in the v1 release line without changing the
  original v1.0.0 release history.
- Define the initial LSP 3.18 package contract for stdio lifecycle, full
  document synchronization, diagnostics, document symbols, definition
  navigation, and hover.
- Require user collaboration to define and approve clear Sigil coverage before
  adding or modifying affected implementation.
- Define `RootSigil` as the root-project or declared workspace-member contract
  for `#module.sigil` and reserve descriptive filenames for internal Sigil files.
- Clarify that logic owns behavior and execution flow while constraints own
  rules, policies, invariants, architecture decisions, and technology choices.
- Rename internal `#module.sigil` contracts and update their imports.
- Define `workspace.members` as the sole authority for additional RootSigil
  locations; package manifests may inform proposals but not runtime discovery.
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
- Run `sigil init` before Brownfield discovery, establish and review RootSigil
  through evidence plus conversation, and only then focus on the requested task.

## 1.0.0 - 2026-07-13

- Publish Sigil Language 1.0.0.
- Add mandatory strict `sigil.config` schema 1.0.0 and config-based discovery.
- Allow independent nested workspaces only when their subtrees are excluded by configured parents.
- Configure Promise and Slotted as independent example projects.
- Release `@sigil/core` and `@sigil/cli` 1.0.0.
- Add CLI `init` and `version` commands and complete workspace metadata output.
- Version the standalone Codex skill with compatibility checks and fixture
  evaluation.
- Add migration, API, compatibility, release, and configuration documentation.
