# AGENTS.md

This repository implements Qode, a Deno/TypeScript CLI and Language Server Protocol milestone for `.qode` concept files.

## Start Here

Read these files before implementing a goal:

- [PRD.md](./PRD.md): current milestone goals, scope, testable iterations, and exit criteria.
- [IMPL.md](./IMPL.md): implementation tracking. Mark the active goal before coding and mark completed goals with `[DONE]`.
- [ARCHITECTURE.md](./ARCHITECTURE.md): durable module and service design.
- [README.md](./README.md): product-facing behavior and documentation promises.
- [deno.json](./deno.json): tasks, compiler settings, formatting, and import map.
- [src/main.ts](./src/main.ts): current binary entrypoint.
- [tests/](./tests): current test surface and conventions.

## Environment State and First-Start Sanity Check

Before running the full sanity suite, read [IMPL.md](./IMPL.md) for the latest recorded environment state.

- If [IMPL.md](./IMPL.md) already records a passing baseline for this machine and the required tools have not changed, do not rerun the full first-start suite.
- Run only the checks needed for new or changed requirements, such as a newly required tool, changed dependency, changed Deno task, or suspicious local state.
- If no usable baseline is recorded for this machine, validate the full toolchain before editing code.
- Record the date, machine/user context when available, commands run, pass/fail state, and any missing or failing item in [IMPL.md](./IMPL.md) before proceeding.
- If dependency probes update `deno.lock`, keep the change only when the implementation will use those dependencies. Otherwise revert probe-only lockfile noise and note that in [IMPL.md](./IMPL.md).

Run:

```sh
pwd
git status --short
deno --version
git --version
node --version
npm --version
which deno
which git
which node
which npm
which rg
deno task
deno eval "import ts from 'npm:typescript'; console.log(ts.version); console.log(typeof ts.createSourceFile)"
deno eval "import * as lsp from 'npm:vscode-languageserver-protocol'; console.log(typeof lsp.RequestType); console.log(lsp.InitializeRequest.method)"
deno eval "import * as server from 'npm:vscode-languageserver/node'; console.log(typeof server.createConnection); console.log(typeof server.TextDocuments)"
deno eval "const f = await Deno.makeTempFile({ suffix: '.qode' }); await Deno.writeTextFile(f, 'concept X { goal: test }'); console.log((await Deno.readTextFile(f)).includes('concept X')); await Deno.remove(f)"
deno fmt --check
deno check src/main.ts tests/**/*.ts
deno test --allow-net tests/
deno task build
```

Expected baseline:

- Deno, Git, Node, npm, and `rg` are available.
- `npm:typescript`, `npm:vscode-languageserver-protocol`, and `npm:vscode-languageserver/node` resolve under Deno.
- Deno file IO works for `.qode` fixture-style tests.
- Formatting, type checking, tests, and build pass before milestone work begins.

## Goal Workflow

At the start of every work session:

1. Read [PRD.md](./PRD.md) and list all current `## Goal...` headings.
2. Read [IMPL.md](./IMPL.md).
3. Mark the active goal in [IMPL.md](./IMPL.md) at the very beginning of work.
4. Work only on the instructed goal unless a prerequisite bug must be fixed to satisfy that goal.

Each PRD goal is a testable iteration. Loop until the goal's exit criteria pass.

For each goal:

1. Write or update focused tests first, or document why the existing failing test already covers the goal.
2. Implement the smallest coherent slice.
3. Run the required checks.
4. If any required check fails, inspect the failure, patch the implementation, and rerun.
5. Do not move to the next goal until all exit criteria for the current goal pass.
6. When the goal is complete, mark it with `[DONE]` in [IMPL.md](./IMPL.md).

Minimum checks for every goal:

```sh
deno fmt --check
deno check src/main.ts tests/**/*.ts
deno test --allow-net tests/
```

Goals that touch the compiled binary must also run:

```sh
deno task build
```

## Committing

Create semantically related commits that are small enough for a human to review comfortably.

- Commit each coherent slice as soon as its files are written and the relevant focused check passes.
- Do not wait until the end of a whole goal to make the first commit.
- Prefer more commits over fewer commits.
- Keep each commit to one coherent idea.
- Aim for changes in the hundreds of lines at most, never thousands.
- Commit tests with the implementation they validate unless a failing test commit is intentionally useful for review.
- Commit [IMPL.md](./IMPL.md) updates with the slice they describe, or as their own small bookkeeping commit immediately after the described state changes.
- Do not include generated or probe-only changes unless they are intentionally part of the implementation.
