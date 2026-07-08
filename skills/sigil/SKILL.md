---
name: sigil
description: Work with Sigil `.sigil` component specifications for AI-assisted development. Use when the user asks to read, write, improve, reconcile, or use Sigil files; create or update component/expand specs; align code with Sigil; resolve ambiguity before code generation; or build from a Sigil-driven workflow.
---

# Sigil

Sigil is a shared, free-form specification language for humans and coding agents. Use it to preserve system rationale before implementation: what each component is for, how it interacts with the rest of the system, what internal details matter, and which constraints the code must obey.

Read `references/sigil-format.md` when you need syntax, section meanings, or examples.

## Core Workflow

1. Discover relevant context.
   - Read all relevant `.sigil` files first.
   - Also read nearby code, docs, tests, package metadata, or architecture notes when the user asks to align Sigil with an existing repo.
   - Treat `#module.sigil` as the current tolerated root module filename.

2. Build the component picture.
   - Identify public `component` contracts: `goal` and `interface`.
   - Identify matching `expand` blocks for internal detail.
   - Note missing components, duplicate expands, vague lines, contradictions, and code/spec drift.

3. Improve Sigil before generating code.
   - If the user is asking for implementation and the Sigil is incomplete, repair or propose the Sigil first.
   - Ask concise questions only when the ambiguity changes architecture, ownership, behavior, or public contract.
   - If the ambiguity is low-risk, make a conservative assumption and state it.

4. Keep sections disciplined.
   - Put binding decisions in `constraints`, including stack choices and architecture rules.
   - Put owned internals, modules, libraries, dependencies, and resources in `internal`.
   - Put behavior and flows in `logic`.
   - Put meaningful runtime/domain configurations in `state`.
   - Put examples, acceptance criteria, and edge cases in `cases`.

5. Preserve semantic lines.
   - Keep each non-empty line as one distinct idea.
   - Prefer concise, reviewable lines over paragraphs inside sections.
   - Free-form Markdown, pseudocode, bullets, tables, and prose are allowed inside sections when they remain coherent.

6. Then implement, if requested.
   - Use the agreed Sigil as the durable rationale and source of constraints.
   - Keep generated code aligned with component boundaries and public interfaces.
   - Update Sigil when implementation reveals a real decision that was not captured.

## Review Heuristics

When reviewing or improving Sigil, check:

- Does every component explain why it exists?
- Does every component expose how other parts interact with it?
- Does each `expand Name` have a matching `component Name`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation details hidden from public component interfaces unless they are part of the contract?
- Are roles, states, permissions, and lifecycle transitions explicit enough to test?
- Are examples in `cases` externally observable?
- Are there multiple expands for the same component? If yes, flag selection or merge behavior as an open design question unless the repo already defines a rule.

## Working With Users

Sigil is collaborative. Do not silently invent major product, architecture, or domain decisions.

Ask targeted questions when:

- a component boundary is unclear;
- a public interface would change depending on the answer;
- multiple modules could own the same responsibility;
- stack, persistence, auth, deployment, or testing choices are binding but unstated;
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

When a user asks only for understanding or review, do not edit files unless they ask for updates.
