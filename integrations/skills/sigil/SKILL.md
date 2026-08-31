---
name: sigil
description: Work with Sigil, a rationale-oriented modeling language and CLI for software systems. Use when a coding agent needs to read, write, review, reconcile, validate, query, render, or use `.sigil` files; model or revise a component, API, state machine, UI surface, or architecture boundary; adopt Sigil in an existing codebase; assess design readiness, drift, terminology, ownership, or implementation coverage; or implement code governed by Sigil. Prefer the `sigil` CLI for deterministic workspace operations. Inspect governing Sigil before every implementation mutation.
---

<!--
@sigil implements integrations/skills/sigil/_module.sigil::SigilSkill::SkillWorkflow interface
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationAlignment interface,logic,constraints,cases
-->

# Sigil

Sigil records what a software component is, why it exists, how it behaves, and
how its implementation should be understood and changed.

## Core Workflow

1. Read `references/workspace-bootstrap.md` before interpreting workspace
   semantics. It owns CLI discovery, root selection, compatibility, configured
   and unconfigured states, initialization, and failure handling.
2. Read `references/design-intake.md` and classify the request before any semantic
   authoring or implementation. Only a proven mechanical request bypasses
   DesignConversation; unresolved material decisions and insufficient context stop
   authoring.
3. Select the workflow:
   - Read `references/greenfield-design.md` when implementation does not yet
     constrain the boundary.
   - Read `references/brownfield-adoption.md` when implementation exists but
     coverage is absent, partial, ambiguous, or drifted.
   - Use the established workflow below for credible existing coverage.
4. Write scoped semantic Sigil changes directly to the target files. The files,
   not chat proposals or compiler sessions, are the review artifact.
5. After every semantic edit, follow
   `references/design-compilation-review.md`. It owns the one required
   check-and-design-compile loop, including target selection, waiting for the
   compiler process to exit, reading its fresh Markdown output file, retrying one
   failed or incomplete operational run, and its report-driven correction path.
   A completed design report is a mandatory blocker: do not proceed to
   concept grouping, glossary extraction, user design review, implementation
   approval, or implementation while compilation is unavailable, incomplete,
   failed, cancelled, or still running. Retry according to the shared execution
   rule; there is no skip or override for this gate.
6. Report changed files, decisions, assumptions, unresolved questions,
   validation, and glossary status. Always state whether glossary extraction is
   required, deferred, or inspection-only. Let the user review the written Sigil.
   At this handoff the implementation change set must be empty: do not write,
   modify, delete, or annotate code, tests, configuration, fixtures, generated
   artifacts, or documentation alongside the pending Sigil review.
7. Before changing implementation, read
   `references/implementation-design.md`, add
   `references/frontend-surface-review.md` when the boundary renders a user
   interface, and obtain `ReviewGate(action: implementation)` readiness for the
   validated written Sigil and exact implementation scope. Only after the user
   has reviewed the written Sigil and this gate returns `ready` may a new
   implementation change set begin. If implementation was changed earlier, stop
   and report an implementation-first bypass; do not continue from the mixed
   state.
8. After implementation, follow the verification and completed-implementation
   reconciliation in `references/implementation-design.md`. Discover and run the
   complete applicable focused, dependent, integration, regression, build, static,
   contract, and end-to-end checks; report blocked or unavailable checks explicitly.
   Then run implementation-focused compilation, resolve implementation-only questions with the user, and return
   contract-affecting drift to written-Sigil design work. Do not report completion
   until the alignment loop has no unresolved drift and its required compilation
   process has exited with a readable completed Markdown report. Compilation is
   a hard prerequisite, not an optional verification check.

Do not use compiler sessions for normal authoring or review. Keep them available
only for an explicitly requested exceptional diagnostic investigation.

## Established-Sigil Workflow

1. Discover the boundary with bootstrap results and `sigil retrieve`. Use it as
   the preferred source of purpose-specific Sigil context: `semantic` for
   contract review, `architecture` for boundaries and dependencies, and
   `implementation` before implementation work. Use an exact-case component
   target by default; use a file target when its colocated declarations or
   expands are the boundary. Read retrieval diagnostics first: correct a failed
   retrieval target or unavailable implementation discovery instead of masking
   it with another command. Use `sigil context` or `sigil graph` only to inspect
   a relationship or detail absent from an otherwise successful retrieval.
   Read the relevant Sigil plus sufficient code, tests, docs, metadata, and
   visual evidence to assess drift.
2. Identify public goals and interfaces, expands, imports, state ownership,
   dependents, unresolved contradictions, and module-index boundaries. Reuse
   matching public imported identities; imports are dependencies, not repeated
   interface content.
3. Apply `references/design-intake.md` to the discovered boundary. When it returns
   `conversation-required`, resolve the decision in DesignConversation before
   authoring; when it returns `context-insufficient`, obtain the missing evidence
   before proceeding.
4. Read `references/standards-review.md` and assess external guidance through
   `references/external-guidance-evidence.md`. Treat `sigil check` as
   structural validation, not design approval.
5. Follow `references/design-compilation-review.md` for the written design
   compile loop and compiler-owned readiness and architecture evidence. Name
   the scope that changed with `--component`, `--file`, `--position`, or
   `--directory`; the compiler resolves the covering boundary and reports the
   requested scope, the resolved target, and why. Do not derive the boundary
   yourself, and do not cancel or replace that compile while it is running.
6. Use `references/design-conversation.md` for DesignIntake findings and explicit
   design, review, or improvement work. Ask one primary decision at a time unless
   the user requests a grouped review.
7. Read `references/authoring-conventions.md`, write the scoped components,
   expands, imports, and rationale directly, then rerun validation and design
   compilation. Keep `ModuleIndexFile` as a small boundary summary.
8. Follow `references/glossary-workflow.md` after semantic edits. Always state
   whether glossary extraction is required, deferred, or inspection-only.
9. After implementation, follow the completed-implementation reconciliation in
   `references/implementation-design.md` until implementation alignment reports no
   unresolved drift.

## ReviewGate

Use `ReviewGate(action, scope, changeSet, evidence)` only for:

- `workspace-initialization` before creating a ConfigFile or seeded glossary;
- `glossary-change` for reviewed glossary mutations;
- `implementation` for implementation artifacts, including ownership comments.

Its result is `blocked`, `review-required`, or `ready`. Validation, compiler
evidence, coverage, delegated analysis, and tests are evidence, never approval.
A ready result applies only to its exact action, scope, change set, and material
evidence. Do not implement merely because the user requested an outcome or a
check passed.

The design and implementation phases are separate change sets. A Sigil edit and
its implementation may never be authored together before review. Validation,
compilation, coverage, or a user request does not waive this ordering; only a
`ready` implementation ReviewGate for the exact validated Sigil and scope opens
the implementation phase.

## Required References

- `references/design-compilation-review.md`: after design intent is sufficiently
  resolved and after written semantic changes.
- `references/compilation-execution.md`: for every ordinary design or
  implementation compilation; it owns Markdown output isolation, process-exit
  handling, and one-retry behavior for failed or incomplete operational runs.
- `references/design-intake.md`: before semantic authoring or implementation for
  every requested change.
- `references/authoring-conventions.md`: when creating or semantically editing
  Sigil.
- `references/glossary-workflow.md`: after semantic Sigil edits, when a glossary
  exists, when reviewed vocabulary is requested, or when terminology is material.
- `references/sigil-format.md`: when syntax, workspace structure, or examples
  are needed.
- `references/implementation-design.md`: before every implementation mutation
  or coverage decision.
- `references/frontend-surface-review.md`: whenever the selected boundary
  renders a user interface, including screens, routes, reusable components,
  client state stores, and styling that carries contract meaning. It owns
  surface inventory, client-state ownership, presentation annotation, and
  frontend drift evidence.

## CLI

Prefer the compatible `sigil` CLI; do not recreate its deterministic semantics.

```bash
sigil parse path/to/file.sigil --format json --pretty
sigil check path-or-workspace --format json --pretty
sigil fmt path-or-workspace --check
sigil compile path-or-workspace --agent --focus design --component Name --format markdown --output /tmp/sigil-design-report.md
sigil compile path-or-workspace --agent --focus implementation --component Name --format markdown --output /tmp/sigil-implementation-report.md
sigil retrieve path-or-workspace --component Name --purpose semantic --format markdown
sigil retrieve path-or-workspace --file path/to/file.sigil --purpose architecture --format markdown
sigil retrieve path-or-workspace --component Name --purpose implementation --format markdown
sigil graph path-or-workspace --format json --pretty
sigil context path-or-workspace --component Name --format markdown
sigil context path-or-workspace --file path/to/file.sigil --format  markdown
sigil glossary path-or-workspace --format json --pretty
sigil render path-or-workspace
```

Exit code `0` is green; `1` accompanies a completed yellow or red report; `2` is
a usage error; `3` is a host or runtime failure; and `130` is cancellation. CLI
output never grants implementation approval.

For understanding or review-only requests, do not edit files. For
standards-aware review, use the headings in `references/standards-review.md`.
