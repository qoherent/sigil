# Integrations

This directory contains host-specific adapters for Sigil.

Integrations adapt the Sigil language, workflow, or platform to a host
environment without becoming the shared parser or CLI implementation.

Current integrations:

- `skills/sigil-understand`: source-based Sigil 0.9 interpretation and the shared,
  reproducible offline language pack.
- `skills/sigil-evaluate`: advisory read-only design assessment with exact input
  identities and evidence-backed diagnostics.
- `skills/sigil-write`: compact authoring with independent evaluator delegation,
  supported autonomous corrections, and explicit unresolved decisions.
- `skills/sigil-align`: implementation review and repair for a selected accepted
  Sigil 0.9 Component, with code and test evidence. Contract changes route through
  `sigil-write`; design-only review stays on `sigil-evaluate`.
- `skills/sigil-egglog`: egglog/datalog language instruction for claims interpreters
  and law authors; no design-skill dependency.
- `skills/sigil-compute-design`: computed claims evaluation on an existing 0.9 design:
  routes only explicit claims or computed-check requests, runs the `sigilc`
  loop, and hands back the ingest state (Coherent, Loose, Disjoint, or Incomplete) plus the
  findings; generic review stays on `sigil-evaluate`. Needs the `sigilc`
  binary and a host that can delegate a fresh child.
- `skills/sigil-compute-align`: design-first computed implementation alignment:
  reads whole files through fresh children and returns Closed, Converged, Drift,
  or Incomplete with bound findings and proposed excludes. Requires
  `sigil-compute-design`, `sigil-understand`, `sigil-egglog`, `sigilc`, and
  configured implementation selection; plain review stays on `sigil-align`.
- `skills/sigil`: preserved legacy Sigil 0.7 native workflow (artifact 0.10.0).
  Its existing native compiler prerequisites apply to this entry point.

All eight valid skills ship with CLI releases. `sigil skill install` installs the
complete catalog globally; `--project` installs locally. The four 0.9 design
skills and `sigil-align` start at 0.1.0 and require their declared siblings to
remain together. Design reading needs no compiler. `sigil-align` uses contract,
code, and test evidence without a `sigilc` dependency.
`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary for
their computed loops. `sigil-compute-align` starts at artifact 0.1.0.
`sigil-egglog` is a language skill, not a design sibling. If a host cannot
delegate review, the writer returns an independently unreviewed draft and a
portable review handoff.

Other integrations:

- `editor/vscode`: implemented pre-production VS Code extension and
  editor-native human UI with syntax highlighting, bundled LSP features, and
  component previews.

Rejected historical design material:

- `skills/sigil-anchor-indexer`: a rejected proposal for bounded model-assisted
  anchor proposals over deterministic indexer candidates. Its Markdown is
  retained for design history but it has no active Sigil contract.
