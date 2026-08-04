# sigil-cli

Current package version: **0.7.1**.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): version 0.7 CLI requirements, command behavior, output
  contracts, and acceptance scenarios.
- [architecture.md](architecture.md): command architecture, module boundaries,
  dependency rules, and implementation guidelines.

Install a standalone GitHub release on macOS or Linux:

```bash
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

Install on Windows PowerShell:

```powershell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

Alternatively, install the published JSR package when Deno is available:

```bash
deno install --global --allow-read --allow-write --allow-env=HOME,USERPROFILE --name sigil jsr:@qoherent/sigil@0.7
```

Local development install:

```bash
deno task install
```

This installs a `sigil` command that can be discovered on `PATH`.

Implemented responsibilities:

- install version-owned agent skills globally or into a target repository;
- expose parser output;
- run workspace checks;
- report missing interface concept identifiers as actionable warnings;
- produce agent-oriented context packs;
- render Markdown for review and documentation workflows;
- keep CLI behavior thin over `sigil-core`.

Commands:

- `sigil --help` reports top-level help, while `--help` after any recognized
  command or subcommand reports help scoped to that command path;
- `sigil skill list` reports bundled directories containing `SKILL.md`;
- `sigil skill install` installs skills globally for Codex, Claude Code,
  OpenCode, and Pi;
- `sigil skill install --project` installs into the current repository;
- `sigil skill install --agent <name>` limits installation to one agent;
- `sigil init [path]` creates a config and, when absent, a glossary seeded only
  with the eight agent-context-excluded, colon-qualified decision-record field
  labels; it never overwrites either file;
- `sigil version [path]` reports tool and configured contract versions;
- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics;
- `sigil glossary [path]` reports reviewed entries, resolved contexts, and
  source occurrences;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON with direct dependencies'
  public contracts and decision rationale plus reviewed terminology recognized
  in the selected and related Sigil files, excluding terms whose `agentContext`
  value is `false`;
- `sigil retrieve [path] (--component name | --file file) --purpose
  semantic|architecture|implementation`
  returns a deterministic selected graph, exact evidence, inclusion reasons,
  exclusion frontier, aggregated context, and a content fingerprint; add
  `--format markdown` for a readable context pack;
- `sigil compile [stage] [path] [--component name | --file file
  [--position line:column]]`
  runs profile-scoped deterministic and direct-read agent evaluation. A stage
  operand such as `semantic-readiness` runs that stage and its dependency
  closure. Prefix a colliding path with `./`. Use `--format jsonl` for the
  versioned event stream;
- `sigil render ...` returns Markdown.

Configure agentic compilation under `tools.compile`:

<!--
@sigil uses packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile interface
@sigil uses packages/compiler/src/adapter.sigil::SigilAgentAdapter::ModelBinding constraints,cases
-->

```json
{
  "tools": {
    "compile": {
      "defaultProfile": "standard",
      "adapter": {
        "provider": "opencode",
        "model": "anthropic/claude-sonnet-4-5"
      },
      "budgets": {
        "elapsedTimeMs": 1800000,
        "maxCommands": 512,
        "maxCommandOutputChars": 3000000,
        "maxInputTokens": 1000000,
        "maxOutputTokens": 1000000
      },
      "limits": {
        "maxCompilationRequestChars": 1000000,
        "maxAgentInputChars": 1000000,
        "sessionTtlMs": 86400000
      }
    }
  }
}
```

The compiler accepts `codex`, `claude`, `opencode`, and `pi` provider
identities. The optional model is passed unchanged to the selected provider and
becomes part of the effective-profile fingerprint. OpenCode uses pure JSON mode
and isolated state; Pi uses JSON mode without sessions or discovered
customization and exposes only `read`, `grep`, `find`, and `ls` inside
adapter-owned process isolation; Codex uses its native read-only sandbox. The
stock mappings run without a host-supplied authorization callback. Unsafe
effects are disabled before launch, while exact operation allowlisting and
`maxCommands` are enforced from emitted operation events. A rejected read-only
operation may already have started before the provider is terminated and its
complete result is discarded. Compilation does not generate code or execute
implementation experiments.

Unless `--no-cache` is set, completed compilation reports are atomically stored
under the operating system's user cache directory and used to derive diagnostic
lifecycle. The cache is never written inside the workspace. JSONL compilation
emits one terminal `completed`, `failed`, or `cancelled` event; profile
configuration failures return exit code `3`.

Empty, unknown, incomplete, and invalid invocations report the problem together
with help for the longest recognized command path.

The deterministic commands return exit code `0` for success or warnings, `1` for
error diagnostics, `2` for usage errors, and `3` for host/runtime failures.
Compilation returns `0` only for green, `1` for red or yellow, and `130` when
cancelled. Use JSON or JSON Lines output for automation; human text and Markdown
are convenience projections. Context output includes resolved concept
namespaces, bounded `agentDependencyContexts`, and a scoped `glossaryContext`;
Markdown render output preserves concept grouping.

Versioned binary distributions place assets at `<version>/integrations/skills`
beside `<version>/bin/sigil`. This keeps each binary paired with the language
semantics and skills shipped for that version.

Run the package tests with:

```bash
deno task test
```
