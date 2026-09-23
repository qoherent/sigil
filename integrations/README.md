# Integrations

This directory contains host-specific adapters for Sigil.

Integrations adapt the Sigil language, workflow, or platform to a host
environment without becoming the shared parser or CLI implementation.

Current integrations:

- `skills/sigil-understand`: source-based Sigil 0.8 interpretation and the shared,
  reproducible offline language pack.
- `skills/sigil-evaluate`: advisory read-only design assessment with exact input
  identities and evidence-backed diagnostics.
- `skills/sigil-write`: compact authoring with independent evaluator delegation,
  supported autonomous corrections, and explicit unresolved decisions.
- `skills/sigil-egglog`: egglog/datalog language instruction for claims interpreters
  and law authors; no design-skill dependency.
- `skills/sigil-compute`: computed claims evaluation on an existing 0.8 design:
  routes only explicit claims or computed-check requests, runs the `sigil-claims`
  loop, and hands back the ingest state (Coherent, Loose, or Disjoint) plus the
  findings; generic review stays on `sigil-evaluate`. Needs the `sigil-claims`
  binary and a host that can delegate a fresh child.
- `skills/sigil`: preserved legacy Sigil 0.7 native workflow (artifact 0.9.0).
  Its existing native compiler prerequisites apply to this entry point.

All six valid skills ship with CLI releases. `sigil skill install` installs the
complete catalog globally; `--project` installs locally. The four 0.8 design skills
start at 0.1.0 and require their declared siblings to remain together. They need
no compiler for design reading; `sigil-compute` needs the `sigil-claims` binary
for its claims loop. `sigil-egglog` is a language skill, not a design sibling. If a host cannot delegate review, the writer returns
an independently unreviewed draft and a portable review handoff.

Other integrations:

- `editor/vscode`: implemented pre-production VS Code extension and
  editor-native human UI with syntax highlighting, bundled LSP features, and
  component previews.

Rejected historical design material:

- `skills/sigil-anchor-indexer`: a rejected proposal for bounded model-assisted
  anchor proposals over deterministic indexer candidates. Its Markdown is
  retained for design history but it has no active Sigil contract.
