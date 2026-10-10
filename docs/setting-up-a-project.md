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
  "sigilVersion": "0.9.0",
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

## Implementation selection and stored readings

Commit the selected code and design roots in `.sigil/config.json`:

```json
{ "tools": { "sigilc": { "implementation": {
  "dirs": ["src"],
  "exclude": ["**/generated/**"],
  "vendorDirs": ["vendor"],
  "design": ["notifier.sigil"]
} } } }
```

The implementation block also accepts `paths`, `include` and `allowEmpty`.
`.sigil/local.json` can override it: objects merge, arrays replace. Optional
`design` roots expand through required imports and owners; omission selects
the whole design. `sigilc align prepare --root . --out DIR` reports the resolved
selection, exclusions and out-of-scope components. A full-design check always
gates alignment. Intentional empty selections require `allowEmpty`.

Use [sigil-compute-align](../integrations/skills/sigil-compute-align/SKILL.md)
for the design-first reading loop and
[the native guide](../packages/sigilc/README.md) for exact commands and exits.
Stored claims live in `.sigil/claims/`. `sigilc clean --root .` removes generated
trees and old worlds while keeping readings, authored files and config.
