# sigil.config 1.0.0

`sigil.config` is mandatory strict UTF-8 JSON at the Sigil workspace root. Its
directory defines the root used for imports and file discovery.

```json
{
  "configVersion": "1.0.0",
  "languageVersion": "1.0.0",
  "project": { "name": "example" },
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

Required fields are `configVersion`, `languageVersion`, `project.name`, and a
non-empty `files.include`. `files.exclude` and `tools` are optional and receive
the defaults shown above.

`project.name` is only a stable Sigil workspace identifier. Package versions,
descriptions, authors, repository details, licenses, and publishing metadata do
not belong here. Unknown configuration, project, and file keys are rejected.
Each `tools` value must be a namespaced JSON object; core preserves but does not
interpret it.

Patterns use normalized workspace-relative POSIX paths. `**/*.sigil` includes
root and nested files. Exclusion wins over inclusion.

Without `--root`, tools select the nearest ancestor config. When higher
configured workspaces exist, each must exclude the nearer workspace subtree.
With `--root`, the supplied directory must contain the config directly.
Missing configs and configs nested inside included paths are errors. Configs
inside excluded subtrees define independent workspaces and are skipped when the
parent is checked.

The machine-readable schema is
[sigil-config.schema.json](sigil-config.schema.json).
