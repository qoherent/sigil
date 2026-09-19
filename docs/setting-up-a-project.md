# Setting up a project

Install the paired language and native executables using the [root guide](../README.md),
then inspect `sigil --version` and `sigilc --version` separately. For the first
contract and native commands, see [quickstart](quickstart.md).

## Workspace configuration

Run `sigil init . --name my-project` at the intended root. It creates missing
`.sigil/config.json` and `.sigil/glossary.json` without overwriting existing files.
Configuration declares the language version, workspace and authored source
patterns. That language version is distinct from both executable versions.
No model provider configuration is required.

Review `files.exclude`, especially in large repositories. For example:

```json
{
  "sigilVersion": "0.8.0",
  "workspace": { "name": "my-project", "members": [] },
  "files": {
    "include": ["**/*.sigil"],
    "exclude": [".git/**", "node_modules/**", "build/**", "vendor/**"]
  },
  "tools": {}
}
```

Declared members and configuration determine language workspace membership.
Do not infer members from every directory or package manifest. Preserve existing
configuration and unrelated changes when adopting Sigil into an existing project.
Use `sigil check . --format json` to inspect config and language diagnostics.

## Skill and ownership

`sigil skill install --project` installs repository guidance for the selected
host. Use `sigil skill install --help` for supported host and installation options.
The skill helps author contracts and instructs the model to call `sigilc`
directly. It does not supply verdicts or launch reconstruction workers.

Keep contracts beside cohesive owners. A directory `_module.sigil` is a boundary
summary and intentional import surface, not a place to collect unrelated logic.
Use existing public identities and matching expands. Optional source comments
can connect stable entrypoints to governing section occurrences:

```ts
// @sigil implements notifier.sigil::Notifier::Send interface
```

The `Send` concept must actually occur in the selected section. These comments
support navigation and context; they do not prove semantic correspondence.

## Comparison scope and generated state

Language export captures the current workspace. A native scope pairs ordered
Design roots with language-neutral Implementation selection:

```json
{
  "version": 1,
  "design": { "paths": ["notifier.sigil"] },
  "implementation": {
    "dirs": ["src"],
    "exclude": ["**/generated/**"],
    "vendorDirs": ["vendor"]
  }
}
```

Store the scope and exported frontend JSON outside selected sources. Use
`sigilc scope --frontend FILE --scope FILE` to inspect ordered focus and effective
import/owner closure. Carry the same scope through stale, prepare, ingest,
entities and compile/compare. Empty path/directory lists do not mean empty scope;
intentional emptiness must be explicit. Narrowing focus never proves a whole
project complete.

Keep `.sigil/worlds/` ignored. `sigilc clean --root DIR` discards generated worlds
without changing authored files or external preparations. After cleaning, obtain
required reconstructions again. Do not commit generated worlds as authored truth.

Use the [native protocol reference](../integrations/skills/sigil/references/compilation-execution.md)
for exact per-source inputs and exits. Independent interpreters and the coding loop
remain external. Record current native states and unavailable prerequisites
alongside ordinary tests and actual delivery evidence.
