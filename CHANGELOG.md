# Changelog

## Unreleased

- Require brownfield application discovery and user confirmation of the
  application goal and interface before proposing a meaningful root module.
- Reject empty and import-only root modules in the brownfield workflow fixture.

## 1.0.0 - 2026-07-13

- Freeze Sigil Language 1.0.0.
- Add mandatory strict `sigil.config` schema 1.0.0 and config-based discovery.
- Allow independent nested workspaces only when their subtrees are excluded by configured parents.
- Configure Promise and Slotted as independent example projects.
- Release `@sigil/core` and `@sigil/cli` 1.0.0.
- Add CLI `init` and `version` commands and complete workspace metadata output.
- Version the standalone Codex skill with compatibility checks and fixture
  evaluation.
- Add migration, API, compatibility, release, and configuration documentation.
