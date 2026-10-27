# .sigil/config.json

`.sigil/config.json` is mandatory strict UTF-8 JSON at the Sigil workspace root. Its
directory defines the root used for imports and file discovery.

```json
{
  "sigilVersion": "0.9.0",
  "workspace": {
    "name": "example",
    "members": ["packages/example-cli"]
  },
  "files": {
    "include": ["**/*.sigil"],
    "exclude": [
      ".git/**",
      ".deno/**",
      "node_modules/**",
      "build/**",
      "coverage/**"
    ]
  },
  "tools": {}
}
```

Required fields are `sigilVersion`, `workspace.name`, and a
non-empty `files.include`. `workspace.members`, `files.exclude`, and `tools` are
optional and receive the defaults shown above.

`workspace.name` is only a stable Sigil workspace identifier. Package versions,
descriptions, authors, repository details, licenses, and publishing metadata do
not belong here. Unknown configuration, workspace, and file keys are rejected.
Each `tools` value must be a namespaced JSON object; core preserves but does not
interpret it.

`sigil init` writes an empty tools object. The removed compiler's provider,
evaluator, profile and migration configuration has no consumer or compatibility
schema. Native sigilc accepts explicit inputs and limits on its own command line;
model configuration and orchestration remain external.

`sigilc` reads and validates its own settings under `tools.sigilc`; its
implementation selection is documented in `packages/sigilc/README.md`.
`.sigil/local.json` is an optional local override. It carries only `tools`;
its objects merge recursively into the workspace tool settings, while arrays
and scalars replace the workspace values. Core validates only that each tool's
value is an object.

`workspace.members` is the sole authority for additional project roots in the
workspace. Each entry is a unique, non-root, non-overlapping,
workspace-relative directory. Package manifests and repository workspace
declarations may inform an initialization proposal, but they do not create
Sigil workspace members.

The workspace root and each declared member are configured project-summary
boundaries for Brownfield workflow. `files.include` and `files.exclude`
control source discovery.

Patterns use normalized workspace-relative POSIX paths. `**/*.sigil` includes
root and nested files. Exclusion wins over inclusion.

Without `--root`, tools select the nearest ancestor config. When higher
configured workspaces exist, each must exclude the nearer workspace subtree.
With `--root`, the supplied directory must contain the config directly.
Missing configs and configs nested inside included paths are errors. Configs
inside excluded subtrees define independent workspaces and are skipped when the
parent is checked. An independent workspace is not a member of its parent, and
a declared workspace member cannot contain its own `.sigil/config.json`.

The machine-readable schema is
[sigil-config.schema.json](sigil-config.schema.json).
