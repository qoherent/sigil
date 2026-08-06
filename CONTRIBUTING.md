# Contributing to Sigil

This guide takes you from a fresh clone to a passing validation run, and then
explains where a change belongs and what needs human approval before it is
written.

New to Sigil itself? Read [README.md](README.md) for what Sigil is and
[PROBLEM.md](PROBLEM.md) for why it exists. This guide assumes you have read
neither the language specification nor the skill workflow; it links to both
where they matter.

## Contents

- [Prerequisites](#prerequisites)
- [Set up the repository](#set-up-the-repository)
- [The validation workflow](#the-validation-workflow)
- [Focused tasks](#focused-tasks)
- [Repository boundaries](#repository-boundaries)
- [Where Sigil belongs](#where-sigil-belongs)
- [The review gates](#the-review-gates)
- [Your first contribution](#your-first-contribution)
- [Versions and compatibility](#versions-and-compatibility)
- [Troubleshooting](#troubleshooting)
- [Opening a pull request](#opening-a-pull-request)

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| [Deno](https://docs.deno.com/runtime/getting_started/installation/) | 2.9.2 | Everything. Core, CLI, and LSP are Deno TypeScript. |
| [Node.js](https://nodejs.org/) | 24 | The VS Code extension only, including its share of `deno task check` and `deno task test`. |
| Git | any recent | Cloning and contributing. |
| [VS Code](https://code.visualstudio.com/) | `^1.91.0` | Optional. Only if you work on the extension or run its integration tests. |

The Deno and Node versions above are exactly what
[CI pins](.github/workflows/ci.yml). Matching them locally is the cheapest way
to avoid a green local run and a red pull request — and for Node it is
load-bearing, not just advisable: the extension's unit tests do not run at all
on Node 20.

If you juggle Node versions across projects, a version manager such as
[fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm)
makes this painless:

```sh
fnm install 24 && fnm use 24    # or: nvm install 24 && nvm use 24
node --version                  # expect v24.x
```

You do not need a published `sigil` CLI installed to contribute. The repository
runs its own CLI from source.

## Set up the repository

```sh
git clone git@github.com:qoherent/sigil.git
cd sigil
npm ci --prefix integrations/editor/vscode
```

Deno resolves and caches its own dependencies on first use, against the
committed [`deno.lock`](deno.lock), so there is no separate Deno install step.

The `npm ci` step is not optional. `deno task test` and `deno task check` both
delegate part of their work to the extension's npm scripts, and both fail
without `node_modules` present. Run it once after cloning, and again whenever
`integrations/editor/vscode/package-lock.json` changes.

npm 11, which ships with Node 24, prints `npm warn allow-scripts` lines about
`esbuild` and `keytar` during that install. They are expected and safe to
ignore; both packages get their platform binaries from optional dependencies
rather than from the skipped install scripts.

Confirm the environment before you change anything:

```sh
node --version                  # expect v24.x
deno --version                  # expect 2.9.2
deno task check                 # type-checks all four surfaces
```

To use your working copy as the `sigil` command while developing:

```sh
deno task --cwd packages/cli install
sigil --version
```

That installs a launcher that compiles `packages/cli/src/main.ts` from your
working tree on every run, so your edits take effect immediately with no
reinstall. It also prints a harmless warning about the `workspace` field being
ignored; see [Troubleshooting](#troubleshooting).

## The validation workflow

Run these four in order before you open a pull request. This is the same
sequence, in the same order, that [CI](.github/workflows/ci.yml) runs on
Ubuntu, macOS, and Windows.

```sh
deno task fmt
deno task lint
deno task check
deno task test
```

| Task | What it does |
| --- | --- |
| `fmt` | Checks formatting of every tracked source, config, and schema path. **It does not reformat anything** — see below. |
| `lint` | Runs `deno lint` across the workspace. |
| `check` | Type-checks the three package entrypoints, then type-checks the extension with `tsc --noEmit`. |
| `test` | Runs core, CLI, LSP, extension unit, extension integration, and skill-validation suites in sequence. |

`deno task fmt` is a **check**, not a formatter: it runs `deno fmt --check`, so
it reports unformatted files and fails without touching them. To actually
format, run `deno fmt` on what you changed:

```sh
deno fmt packages/core/src packages/core/tests
```

### Platform differences

**Linux without a display.** `deno task test` includes the VS Code extension
integration suite, which downloads and launches a real VS Code instance. On a
headless Linux machine, wrap it exactly as CI does:

```sh
sudo apt-get install -y xvfb    # once, if you do not have it
xvfb-run -a deno task test
```

On a Linux desktop session, macOS, or Windows, run `deno task test` directly; a
VS Code window appears briefly and closes itself.

**First run downloads VS Code.** The integration suite fetches VS Code stable
on its first run, so that run needs network access and takes noticeably longer.

**Everything else is cross-platform.** All tasks are plain Deno and npm
invocations with no shell-specific syntax, and CI proves them on all three
operating systems on every push.

There is one release-only task, `deno task publish:dry-run`, which CI runs on
Ubuntu only. You rarely need it locally; it verifies that each package would
publish cleanly and that the extension packages.

## Focused tasks

Running the whole suite for a one-line change is wasteful. Each package has its
own task:

| Task | Scope |
| --- | --- |
| `deno task test:core` | `@qoherent/sigil-core` — parser, resolver, graph, projections, diagnostics |
| `deno task test:cli` | `@qoherent/sigil` — commands, argument parsing, output formatting, skill installer |
| `deno task test:lsp` | `@qoherent/sigil-lsp` — lifecycle, diagnostics, symbols, hover, semantic tokens |
| `deno task test:vscode` | Extension type-check and unit tests. No VS Code launch. |
| `deno task test:vscode:extension` | Extension integration tests. Launches VS Code. |
| `deno task test:skill` | Validates the bundled agent skill via [`scripts/validate-skill.ts`](scripts/validate-skill.ts) |
| `deno task check:vscode` | Extension type-check alone |

To narrow further, call `deno test` directly. Note that each package's task
supplies its own permission flags, so reuse them:

```sh
# One file (core needs only read access)
deno test --allow-read packages/core/tests/core_test.ts

# One test by name
deno test --allow-read packages/core/tests/core_test.ts --filter "resolves"

# The CLI suite needs write and run permissions as well
deno test --allow-read --allow-write --allow-run packages/cli/tests/cli_test.ts
```

Watch mode is useful while iterating:

```sh
deno test --allow-read --watch packages/core/tests/core_test.ts
```

## Repository boundaries

The layout follows one rule: **deterministic language facts live in
`packages/`, and model-assisted judgment lives in `integrations/`.** Keeping
that line intact is the single most important architectural constraint in this
repository.

| Directory | Owns | Notes |
| --- | --- | --- |
| `spec/` | The language, configuration, workflow, glossary, and platform-architecture specifications, plus [ADRs](spec/decisions) | The canonical definition is [`spec/sigil-language.md`](spec/sigil-language.md). [`spec/language.sigil`](spec/language.sigil) owns the single language-version literal. |
| `packages/core/` | Parsing, configuration, workspace discovery, resolution, graphs, projections, glossary matching, diagnostics | Pure and deterministic. No semantic judgment, no network, no interactive behavior. |
| `packages/cli/` | The `sigil` command: `init`, `version`, `parse`, `check`, `glossary`, `graph`, `context`, `render`, `skill` | Thin over core. Also owns skill installation, which is the one host-filesystem responsibility. |
| `packages/lsp/` | The editor-neutral language server over core | LSP 3.18 on stdio. |
| `integrations/skills/sigil/` | The host-neutral coding-agent skill: semantic review, design conversation, brownfield adoption, review gates | Markdown and Sigil only. No code dependency on `packages/`. |
| `integrations/editor/vscode/` | The VS Code extension: syntax, bundled LSP startup, semantic tokens, component preview | The only Node.js code in the repository. |
| `examples/` | `promise` and `slotted`, each an independently configured workspace | Design-pressure fixtures, excluded from the root workspace. Not products. |
| `scripts/` | Release build and skill validation | |
| `docs/` | Adoption pilots and images | |

Dependency direction is one-way: `cli` and `lsp` depend on `core`; the
extension depends on `lsp`; nothing depends on the skill, and the skill depends
on no package code. A change that inverts any of those arrows needs discussion
before implementation.

For the fuller picture, read [`spec/sigil-platform-architecture.md`](spec/sigil-platform-architecture.md)
and the repository's own boundary summary in [`#module.sigil`](%23module.sigil).

## Where Sigil belongs

This repository specifies itself in Sigil. Before changing behavior, find the
contract that governs it:

```sh
sigil check .                                              # workspace diagnostics
sigil context . --component SigilCore --format markdown    # one contract, readable
sigil context . --component SigilCli --include-dependents   # and who relies on it
sigil graph .                                              # imports and expansions
```

`check` and `context` do not validate the same things. `check` covers syntax,
configuration, and resolution. `context` additionally scans `@sigil implements`
annotations across the source tree, so it can exit 1 while `check` exits 0 —
useful, and worth reading rather than ignoring. Exit codes are `0` clean, `1`
error diagnostics, `2` bad arguments, `3` host failure.

Placement rules, from [`spec/sigil-language.md`](spec/sigil-language.md) and the
skill's [authoring conventions](integrations/skills/sigil/references/authoring-conventions.md):

- **Boundary summaries** live in the `#module.sigil` of the workspace root and
  of each declared member — [`#module.sigil`](%23module.sigil),
  [`packages/core/#module.sigil`](packages/core/%23module.sigil), and so on.
  Do not move these.
- **Internal contracts** use descriptive filenames beside the code they
  describe, such as [`packages/core/src/parser.sigil`](packages/core/src/parser.sigil)
  next to `parser.ts`.
- **`component`** holds the public half: `goal` and `interface`. Dependents see
  only this.
- **`expand`** holds the private half: `state`, `logic`, `constraints`,
  `decisions`, and `cases`. Put an implementation-specific expand beside the
  code it explains.
- **Trivial, safely reconstructable mechanics get no Sigil at all.** Do not
  create one component per file, class, or function.

When you implement something a contract governs, link the code back to it with
an ownership annotation next to the entrypoint definition:

```ts
// @sigil implements packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
export function parseSigilDocument() {}
```

List only the sections that actually have an occurrence for that concept. An
annotation naming a section the contract does not define is an error, and
`sigil context` is what reports it.

Use the language's single-line comment form, its block form when one entrypoint
carries several annotations, and HTML comments in agent-facing Markdown. Never
annotate `.sigil` files, and leave JSON untouched.

## The review gates

Sigil's own workflow applies to changes made to Sigil. The rule that surprises
people most:

> A clean `sigil check` is **not** semantic approval, and passing tests never
> grant approval retroactively.

Two gates matter, both defined in
[`integrations/skills/sigil/SKILL.md`](integrations/skills/sigil/SKILL.md) and
described end-to-end in [`spec/sigil-workflow.md`](spec/sigil-workflow.md):

**A Sigil proposal is required before writing or semantically changing any
`.sigil` file.** Present the exact components, expands, imports, semantic lines,
and decision rationale, and leave the files unchanged until a human approves
that exact scope. This applies to boundary summaries, internal contracts,
concept-identifier changes, and brownfield reconstruction alike.

**An implementation gate applies before changing behavior.** Inspect the
governing Sigil first, confirm every material concern is covered, and only then
implement. If implementation reveals a decision the Sigil does not record, stop
and go back to a Sigil proposal rather than encoding the decision in code.

In practice:

| Your change | Needs a Sigil proposal? |
| --- | --- |
| Fixing a typo, formatting, or a comment | No |
| Adding a test for existing specified behavior | No |
| Documentation that restates approved facts | No |
| Adding a diagnostic code, CLI flag, or output field | **Yes** — it changes a public contract |
| Changing resolution, parsing, or projection behavior | **Yes** |
| Adding a component, or changing a `goal` or `interface` | **Yes** |
| Recording rationale for a choice already made in code | **Yes** — it is a semantic change to an expand |

Material decisions belong in a `decisions` block with `Decision:` and `Scope:`,
alongside the binding outcome in `constraints`. Missing rationale for a material
choice is treated as a readiness gap even when validation passes.

## Your first contribution

A worked example for a change that needs no Sigil proposal — adding a test case
to core.

```sh
# 1. Branch from main.
git checkout main && git pull
git checkout -b my-change

# 2. Establish a clean baseline before you touch anything.
deno task fmt && deno task lint && deno task check && deno task test:core

# 3. Find the contract that governs the behavior you are testing.
sigil context . --component SigilCore --format markdown
```

Read the contract's `cases` section. If the behavior you want to test is
already described there, your test is mechanical and needs no proposal. If it
is not described, stop — you have found either a coverage gap or undocumented
behavior, and both need a Sigil proposal first.

```sh
# 4. Add the test beside its peers.
#    packages/core/tests/core_test.ts

# 5. Run the focused suite while iterating.
deno test --allow-read packages/core/tests/core_test.ts --filter "my new case"

# 6. Format what you changed, then run the full gate.
deno fmt packages/core/tests
deno task fmt && deno task lint && deno task check && deno task test

# 7. Commit and open a pull request against main.
```

If your change had instead touched behavior — a new diagnostic, say — step 3
would have ended in a Sigil proposal covering the new `interface` and `cases`
lines, human approval, the Sigil edit, and only then the implementation and its
ownership annotation.

## Versions and compatibility

Four version lines move independently, and
[COMPATIBILITY.md](COMPATIBILITY.md) is the authority on how they relate:

- **Sigil language and `.sigil/config.json` schema** — currently 0.5.0, owned
  by the single literal in [`spec/language.sigil`](spec/language.sigil).
- **Package artifacts** — currently 0.7.0, owned by each
  `packages/*/deno.json`.
- **VS Code extension** — owned by its `package.json`.
- **Agent skill** — owned by `integrations/skills/sigil/VERSION` and
  `compatibility.json`.

Do not bump a version as a side effect of another change, and do not duplicate a
version literal into a second file. A tool must reject a `sigilVersion` it does
not explicitly support. Everything here is pre-production; see
[PRE_RELEASE.md](PRE_RELEASE.md). User-visible changes belong in
[CHANGELOG.md](CHANGELOG.md).

## Troubleshooting

**`deno task fmt` fails and changes nothing.** Expected — it is a check. Run
`deno fmt <the paths it named>` to fix, then rerun the task.

**`deno task test` or `deno task check` fails in the extension.** You almost
certainly skipped `npm ci --prefix integrations/editor/vscode`, or
`package-lock.json` changed since you last ran it. A bare `tsc: not found` from
`deno task check` is always this.

**`Could not find '.../tests/unit/**/*.test.ts'` during `test:vscode`.** Your
Node.js is older than 24. The extension's unit tests are selected by a recursive
glob that the shell leaves unexpanded, so resolving it falls to the Node test
runner, and older runners report the pattern itself as missing instead. Run
`node --version`; if it is not 24, install Node 24 and rerun. Nothing is wrong
with your checkout.

**`npm warn allow-scripts` during `npm ci`.** Expected on npm 11. See
[Set up the repository](#set-up-the-repository) — the skipped install scripts
are not needed.

**Extension integration tests fail on Linux with a display or Xvfb error.** Use
`xvfb-run -a deno task test`, as CI does. To skip that suite while iterating on
something unrelated, run the focused tasks instead of `deno task test`.

**The first extension test run hangs or times out.** It is downloading VS Code
stable. Confirm network access and let it finish; later runs reuse the download.

**`Warning "workspace" field in the specified config file will be ignored`**
when running `deno task --cwd packages/cli install`. Harmless. The install task
points Deno at the root config for import resolution, and Deno notes that it is
ignoring the workspace list in that context.

**`sigil` on your PATH behaves unexpectedly after switching branches.** The
development install compiles from your working tree on every run, so it always
reflects the branch you have checked out. Reinstall with
`deno task --cwd packages/cli install` only after changing the task itself.

**`deno.lock` shows unexpected changes.** The repository commits its lockfile
with locking enabled. Let Deno update it as a result of a real dependency
change, review that diff like any other, and do not hand-edit it.

**`SIGIL_MISSING_CONCEPT_IDENTIFIER` warnings from `sigil check`.** Interface
content is not grouped under a concept identifier. This is an authoring gap in
the `.sigil` file, not a tooling failure, and repairing it is a semantic change
that goes through the proposal gate.

**`Ownership annotation references section X without a matching occurrence` from
`sigil context`.** An `@sigil implements` annotation claims a section the
concept does not define. Either drop that section from the annotation, or add
the missing occurrence to the contract — the second option is a semantic change
and goes through the proposal gate. `sigil check` does not catch this, so
`sigil context` can exit 1 on a workspace that checks clean.

**A test needs a real workspace.** Use the fixtures in `examples/` or
`packages/cli/tests/fixtures/` rather than creating one outside the repository.
The extension integration suite opens [`examples/slotted`](examples/slotted) as
its workspace.

## Opening a pull request

Open pull requests against `main`. CI runs formatting, linting, type checking,
and the full test suite on Ubuntu, macOS, and Windows for every push and pull
request, plus a publish dry run on Ubuntu; all of it must pass.

Before you open one:

- the four validation tasks pass locally;
- any `.sigil` change was proposed and approved before it was written;
- new behavior carries an ownership annotation pointing at its governing
  contract;
- version literals are unchanged unless the change is a deliberate release;
- user-visible changes are noted in [CHANGELOG.md](CHANGELOG.md).

Unsure whether something needs a Sigil proposal, or which boundary should own
your change? Ask in the pull request or the issue before implementing. That
conversation is cheaper than an approved implementation in the wrong place, and
[`spec/open-questions.md`](spec/open-questions.md) tracks the design questions
that are still open.
