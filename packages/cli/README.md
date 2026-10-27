# sigil-cli

The `sigil` command line, in Rust. The crate version, 0.9.0, is declared in
`Cargo.toml`. The behavior is specified by the contract [cli.sigil](cli.sigil) and
the recorded cases in `tests/fixtures/`.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and formatting, but editor integrations should become the main human
UI.

Standalone GitHub releases install `sigil` and `sigilc`. Each binary reports its
own manifest version. The Sigil skills install through your coding agent; see the
[install guides](../../docs/install/README.md). On macOS or Linux:

```bash
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

Install on Windows PowerShell:

```powershell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

The Linux binaries need glibc 2.35 or newer (Ubuntu 22.04, Debian 12 and later).

From a clone, with Rust 1.91.1 or newer:

```bash
deno task build:sigil    # or: cargo build --manifest-path packages/cli/Cargo.toml
packages/cli/target/debug/sigil --version
```

Commands:

- `sigil --help` reports top-level help, while `--help` after any recognized
  command reports help scoped to that command;
- `sigil init [path]` creates a config and, when absent, an empty
  glossary; it never overwrites either file;
- `sigil version [path]` reports the CLI, core and configured language versions;
- `sigil parse <path>` returns one source document with a source range for each
  of its parts;
- `sigil check [path]` returns the workspace's diagnostics; add
  `--format text --show-locations` to append each diagnostic's file path, line,
  and column to the text output. When the workspace has
  `.sigil/conventions/check.json`, it also warns about each named group that
  lacks a required label (see `docs/spec/sigil-conventions.md`), without
  changing the exit status;
- `sigil fmt [paths...]` formats selected files or included sources beneath
  selected directories in one workspace, deduplicating overlaps. No paths means
  the current directory, so running at the workspace root selects all included
  workspace sources. Add `--check` to report noncanonical files without writing;
  `--root` anchors configuration discovery, while paths still resolve from cwd;
- `sigil glossary [path]` reports reviewed entries, resolved contexts, and
  source occurrences;
- `sigil lsp` starts the language server on standard input and output.

Exit 0 means no language errors, 1 means language errors remain, 2 means
invalid usage, and 3 means an operational failure. These exits do not describe
semantic gate states. A removed command (`graph`, `context`, `retrieve`,
`render`) is invalid usage. Native `sigilc` reads the workspace root directly.

Language ranges are half-open original UTF-8 byte offsets. Text diagnostic
locations use scalar columns derived from the captured source. Relative display
paths never rewrite authored prose, links or payload contents.

The skill catalog reports each skill's declared compatibility. Use
`sigil-understand`, `sigil-write` and `sigil-evaluate` for 0.9 designs.

Use the native compiler directly:

```sh
sigilc prepare --root . --source architecture/a.sigil --out reading-a
sigilc check --root .
```

See the [native command guide](../sigilc/README.md) for configured selection, external
interpretation, preparation/ingestion, claims and implementation alignment.
The model or operator invokes `sigilc` directly. The language CLI does not
launch semanticizers or forward compiler commands.

Run package tests from the repository root with `deno task test:cli`, or
`cargo test --manifest-path packages/cli/Cargo.toml`. The `parity_*` tests replay
`tests/fixtures/cli-parity.json`, output recorded from the earlier TypeScript
command line.
