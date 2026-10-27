# sigil-core

The shared Sigil 0.9 reader, a Rust library (`packages/core/src`). The crate
version, 0.1.0, is declared in `Cargo.toml` and is not published; the `sigil`
command line, the language server and `sigilc` depend on it by path. Its behavior
is specified by the contract [core.sigil](core.sigil) and the
[language reference](../../docs/spec/sigil-reference.md).

Raw parsing requires an explicit `sigilVersion`. Workspace loading discovers and
validates `.sigil/config.json` before reading sources. Disk reads supply original
bytes; editor overlays supply scalar text. Source ranges are half-open UTF-8 byte
ranges, with scalar and UTF-16 positions derived from the same captured source.

Core owns deterministic language behavior used by the CLI, the language server
and native export:

- All seven contract sections belong to a component, in canonical order:
  Goal, State, Logic, Constraints, Cases, Interface, Decisions. Preserve Facets, embedded
  payloads, Inline Links, grouping occurrences and inline Tag introductions.
- Resolve exact component-owned Tags and explicit file/provider selections.
  Imported Tags remain provider-owned; using Facets remain consumer-owned. Cycles
  are valid. Only Tags evidenced by a provider Interface are importable.
- Preserve independent valid results and staged diagnostics when other input is
  invalid. Reject unsupported configured versions and removed language forms.
- Format against resolved spans and provider vocabulary, preserving exact Tag
  recognition, Facet boundaries, payloads and link targets. Repair width errors
  only when reparsing and resolution preserve meaning.
- Read the workspace glossary and find its term occurrences.
- Read the workspace's optional check rules from `.sigil/conventions/check.json`
  and warn about each named group that lacks a required label.
- Retain explicit missing evidence and ambiguity metadata.

Core does not own CLI arguments, editor APIs, LSP transport, model prompts or
semantic interpretation. Native `sigilc` consumes the structural export
separately.

Run the tests from the repository root with `deno task test:core`, or
`cargo test --manifest-path packages/core/Cargo.toml`. The `*_parity` tests, the
formatter corpus and the glossary tests replay `tests/fixtures/`, output recorded
from the earlier TypeScript core; see the README there.
