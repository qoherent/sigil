---
name: sigil
description: Work with Sigil, a lightweight rationale-oriented modeling language for software systems, and its CLI for AI-assisted development. Use when the user asks to read, write, improve, reconcile, validate, query, render, or use `.sigil` files; create or update component/expand specs; describe product modules, programming abstractions, APIs, state machines, or architecture decisions; align code with Sigil; resolve ambiguity before code generation; or build from a Sigil-driven workflow. Prefer `sigil-cli` when available for parsing, checking, graph, context, and render operations. This skill must stop for human review after creating or changing Sigil and must not write implementation code until the user explicitly approves the agreed Sigil.
---

# Sigil

Sigil is a lightweight, rationale-oriented modeling language for software
systems. It records what a system is, why it exists, how it behaves, and how its
implementation should be understood and changed over time.

Sigil is designed for humans and coding agents working together. Its purpose is
to keep system knowledge coherent by breaking a system into components and
preserving both the public contract and the reasoning behind implementation
decisions.

A Sigil component can be a product module, service boundary, domain concept,
library abstraction, API object, state machine, or other coherent unit. Do not
assume the domain is only business/product software.

Read `references/sigil-format.md` when you need syntax, section meanings, or
examples.

## Tooling

Prefer a `sigil` CLI command when it is available on `PATH`.

Use the CLI to parse, check, resolve graph data, collect context, or render
review Markdown instead of manually reimplementing those operations in the
agent.

An installed Codex skill does not include this repository's `packages/`
directory. Treat `packages/sigil-cli/src/main.ts` as available only when the
current workspace is the Sigil platform repository or another checkout that
contains that path.

CLI discovery order:

1. If `sigil` is available on `PATH`, use `sigil`.
2. Else, if the current workspace contains `packages/sigil-cli/src/main.ts`,
   invoke it with Deno from the workspace root.
3. Else, fall back to direct file reading and `references/sigil-format.md`.

Installed or global CLI command shape:

```bash
sigil check . --format json --pretty
```

Repository-local CLI command shape:

```bash
deno run --allow-read packages/sigil-cli/src/main.ts check . --format json --pretty
```

Common invocations:

```bash
sigil parse path/to/file.sigil --format json --pretty
sigil check path-or-workspace --format json --pretty
sigil graph path-or-workspace --format json --pretty
sigil context path-or-workspace --component Name --format json --pretty
sigil context path-or-workspace --file path/to/file.sigil --format json --pretty
sigil render path-or-workspace
```

Interpret CLI exit codes as:

- `0`: command completed with no error diagnostics;
- `1`: command completed with error diagnostics; inspect JSON diagnostics and
  continue with partial models when useful;
- `2`: usage error; fix the command arguments;
- `3`: host/runtime failure; fall back only if the CLI cannot read the requested
  input.

If no CLI is available, Deno is unavailable for a repo-local CLI, or the command
fails for host reasons, fall back to direct file reading and the format
reference.

Do not use CLI output as approval to implement code. The review gate still
applies after creating or changing Sigil files.

## Core Workflow

1. Discover relevant context.
   - When a `sigil` command or repo-local CLI is available, start with `check`
     on the target workspace or file to discover diagnostics.
   - Use `context --component Name` or `context --file path/to/file.sigil` when
     the user asks about a specific component or file.
   - Use `graph` when import relationships or expansion relationships matter.
   - Read relevant `.sigil` files after the CLI identifies them, especially
     before editing.
   - Follow `@path import { Name }` clauses manually when the CLI is unavailable
     or when source-level review needs exact wording.
   - Also read nearby code, docs, tests, package metadata, or architecture notes
     when the user asks to align Sigil with an existing repo.
   - Treat the topmost ancestor `#module.sigil` as the Sigil workspace root
     until project configuration exists.

2. Build the component picture.
   - Use CLI JSON diagnostics and context output when available to identify
     import dependencies, unresolved imported names, public contracts, collected
     expands, and related files.
   - Identify public `component` contracts: `goal` and `interface`.
   - Identify matching `expand` blocks for operational detail.
   - Treat `component` as the reusable public contract and all matching
     `expand Name` blocks as the collected operational description.
   - Note unresolved imports, missing components, collected-expand
     contradictions, vague lines, and code/spec drift.

3. Improve Sigil before generating code.
   - If the user is asking for implementation and the Sigil is incomplete,
     repair or propose the Sigil first.
   - Ask concise questions only when the ambiguity changes architecture,
     ownership, behavior, or public contract.
   - If the ambiguity is low-risk, make a conservative assumption and state it.

4. Keep sections disciplined.
   - Put binding decisions in `constraints`, including stack choices and
     architecture rules.
   - Put behavior, flows, transitions, policies, and algorithms in `logic`.
   - Put meaningful runtime/domain configurations in `state`.
   - Put architecture, ownership, dependencies, module boundaries, and binding
     technology decisions in `constraints`.
   - Put examples, acceptance criteria, and edge cases in `cases`.

5. Preserve semantic lines.
   - Keep each non-empty line as one distinct idea.
   - Blank lines are allowed for readability and do not create semantic units.
   - Prefer concise, reviewable lines over paragraphs inside sections.
   - Free-form Markdown, pseudocode, API signatures, bullets, tables, and prose
     are allowed inside sections when they remain coherent.

6. Stop at the Sigil review gate.
   - After creating or changing Sigil files, summarize the changes and ask the
     user to review them.
   - Do not write implementation code in the same pass unless the user has
     already explicitly approved the current Sigil and explicitly asked for
     code.
   - A request like "use Sigil", "improve Sigil", "prepare Sigil", or "check the
     spec before coding" is not approval to code.

7. Implement only after approval.
   - Use the approved Sigil as the durable rationale and source of constraints.
   - Keep generated code aligned with component boundaries and public
     interfaces.
   - If implementation reveals a missing decision, stop and update or propose
     Sigil first, then ask for review again.

## Review Gate

The review gate is mandatory when Sigil is created or changed.

At the gate, respond with:

- changed Sigil files;
- the main decisions or assumptions captured;
- unresolved questions, if any;
- a direct request for the user to review and approve before implementation.

Do not continue from the review gate into implementation just because the
original user request included code generation. The point of Sigil is to make
the human check the durable rationale before code exists.

## Review Heuristics

When reviewing or improving Sigil, check:

- Does every component explain why it exists?
- Does every component expose how callers, users, modules, or other parts
  interact with it?
- Does each `expand Name` have a matching `component Name`?
- Does each imported name resolve to a matching component in the imported Sigil
  source?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in
  `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation details hidden from public component interfaces unless they
  are part of the contract?
- Are roles, states, permissions, and lifecycle transitions explicit enough to
  test?
- For abstractions and APIs, are constructor/functions, return values,
  settlement/lifecycle behavior, and error behavior explicit?
- Are examples in `cases` externally observable?
- If there are multiple expands for the same component, did you collect all
  matching expands and flag any contradictions between them?

## Working With Users

Sigil is collaborative. Do not silently invent major product, architecture, or
domain decisions.

Ask targeted questions when:

- a component boundary is unclear;
- a public interface would change depending on the answer;
- multiple modules could own the same responsibility;
- a lifecycle or state transition has unclear behavior;
- an API-shaped interface has unclear return, error, chaining, or async
  behavior;
- stack, persistence, auth, deployment, or testing choices are binding but
  unstated;
- code generation would lock in a domain rule that is not captured.

Prefer editing the Sigil directly when:

- the issue is wording, typos, section placement, or consistency;
- the decision already appears elsewhere in the repo;
- a line can be made clearer without changing meaning.

## Output Style

When updating Sigil files, summarize:

- which files changed;
- which ambiguities were resolved;
- which open questions remain.
- that implementation is waiting for user approval of the Sigil.

When a user asks only for understanding or review, do not edit files unless they
ask for updates.
