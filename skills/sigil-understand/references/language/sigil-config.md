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

`sigilc align` reads its code selection from `tools.sigilc.implementation`:

```json
{
  "tools": {
    "sigilc": {
      "implementation": {
        "dirs": ["src"],
        "include": ["**/*.rs"],
        "exclude": ["**/generated/**"],
        "vendorDirs": ["vendor"],
        "allowEmpty": false,
        "design": ["booking.sigil"]
      }
    }
  }
}
```

This fragment belongs in the workspace config above, or in `.sigil/local.json`.
Local configuration contains only `tools`; its objects merge recursively into
workspace tool settings, while arrays and scalars replace the workspace values.
All paths remain relative to the workspace root.

The implementation namespace is required for alignment. `sigilc` rejects unknown
keys in its namespace, including unknown implementation fields. Core continues
to validate only the tools' object shape. The selection fields are optional:

- `paths`: explicit file paths; defaults to `[]`.
- `dirs`: directory trees; defaults to `[]`. With no paths or directories,
  discovery starts at the workspace root.
- `include`, `exclude`: file globs; default to `[]`. An empty include list accepts
  every file. Exclude patterns remove files in configuration order; a later
  overlapping pattern counts only files earlier patterns have not removed.
- `vendorDirs`: directory trees excluded from discovery; defaults to `[]`.
- `allowEmpty`: permits a selection with no code units; defaults to `false`.
- `design`: non-empty list of unique design source roots. Roots expand through
  required imports and owners using the design scope closure. Omit it to judge
  the whole workspace design. Components outside the closure are listed in the
  report and their promises are outside the implementation check.

Path and glob fields are arrays of non-empty strings. Discovery always excludes
the internal `.sigil`, `.git`, `.deno`, `node_modules`, `build`, `target`, and
`coverage` trees. Workspace design sources encountered inside the selection are
auto-excluded and listed separately from user exclude patterns. Symlinks are
skipped and listed, including linked directories whose contents cannot safely be
checked against include globs. Design auto-exclusions happen before user exclude
counts. Zero-byte files are listed but are not units. Non-UTF-8 files
and files over the presentation byte limit are listed as unpresentable and keep
the implementation check Incomplete until the user excludes them.

`workspace.members` is the sole authority for additional project roots in the
workspace. Each entry is a unique, non-root, non-overlapping,
workspace-relative directory. Package manifests and repository workspace
declarations may inform an initialization proposal, but they do not create
Sigil workspace members.

The workspace root and each declared member are configured project-summary
boundaries for Brownfield workflow. `_module.sigil` may appear in any included
directory regardless of membership. `files.include` and `files.exclude`
control source discovery; they do not declare module-index locations.

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
