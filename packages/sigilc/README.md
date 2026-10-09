# sigilc

`sigilc` is the deterministic Rust compiler and semantic projection publisher.
It validates structural input, accepts externally produced Turtle, computes
Design and Implementation worlds, and reports scoped comparisons. It never
launches models, workers, or task workflows.

Build it with Rust 1.91.1 or newer:

```sh
cargo build --locked --manifest-path packages/sigilc/Cargo.toml
```

Every command reads the workspace itself. `--root DIR` (default `.`) names the
workspace root; `sigilc` reads its `.sigil` configuration, glossary, and
`.sigil` sources directly, so there is nothing to export or refresh by hand.
`--store DIR` (default `<root>/.sigil`) holds the disposable projections and the
tree cache; point it elsewhere to keep a run isolated from the workspace.
Reports use version 2. Source locations carry explicit coordinate conventions
and captured SHA-256 digests. Old stored projections are retained but cannot be
used as current evidence.

```sh
sigilc ontology --format json
sigilc scope --root . --scope scope.json
sigilc prepare design --root . --source architecture/a.sigil --out design-a
# An external caller interprets design-a/design.json and design-a/ontology.json.
sigilc ingest design --root . --source architecture/a.sigil --binding design-a/binding.json --turtle design-a/result.ttl
sigilc stale design --root . --scope scope.json
sigilc compile design --root . --scope scope.json
sigilc entities --root . --scope scope.json
```

## Trees, content ids, and dependencies

`sigilc` turns each `.sigil` file into a content-addressed tree: components,
sections, and Facets, each with an id made from its content. A Facet id is
`facet:<hash>`; it does not change when the file is reformatted or when
unrelated text moves, and it changes when the Facet's meaning changes. Callers
that need a unit or entity id read it from `sigilc tree`.

```sh
sigilc tree --root . [--source PATH] [--diff]
```

`tree` prints the resolved trees as deterministic JSON: per source, its
components, interface Tags, resolved Tags with their IRIs, and Facets with
ranges, prose, and links. `--diff` lists the Facets added, removed, and changed
since the previous tree recorded for each source.

A dependency is presented to its importers by its interface only. A component
sees what a provider declares in its `interface` section and nothing from the
provider's private sections or logic. A flow that crosses components must
therefore be stated in the dependency's interface; editing a dependency's
private sections does not change its importers.

After upgrading from a version that read a pre-exported structural file, run
`sigilc clean --root DIR` once. It drops the old generated projections.
Readings stored under the old unit ids are not reused, so the first `prepare` asks for every unit once, and
later runs ask only for what changed.

`prepare` copies the semantic inputs and writes an immutable `binding.json`.
The external caller keeps that directory, produces Turtle independently, and
passes the matching binding to `ingest`. Ingest validates the source binding,
restricted data, current source inputs, and expected projection generation
before atomically publishing the accepted projection. If any bound input
changes, prepare a new directory and binding. `sigilc` does not record the
external interpretation, its attempts, or its outcome.

The generated `worlds/` cache in the store (`.sigil/worlds/` by default) is
disposable and ignored. Its index keeps
semantic bindings, checksums, generations, accepted projections, and available
history. It does not contain tasks, requests, worker records, or completion
evidence. The index schema is versioned; after upgrading from an older compiler,
run `sigilc clean --root DIR` once before rebuilding worlds. The command removes
generated worlds while preserving authored files and caller-owned preparation
directories.

New Design domain entities use the IRI
`urn:sigil:entity:<encodeURIComponent(source path)>:<encodeURIComponent(local name)>`.
Declare one ontology type and one nonempty label in the owning file. Reference
foreign identities without redeclaring them. Identity matching alone does not
prove that an external interpretation faithfully described the source.

Implementation preparation requires a current provisional or authoritative
Design catalog. It writes exactly `source` (captured unchanged bytes),
`ontology.json`, `catalog.json`, and `binding.json` for the caller.

```sh
sigilc prepare implementation --root . --source src/main.rs --out implementation-main
# An external caller interprets the three copied inputs.
sigilc ingest implementation --root . --source src/main.rs --binding implementation-main/binding.json --turtle implementation-main/result.ttl
sigilc stale implementation --root . --selection selection.json
sigilc compile implementation --root . --selection selection.json
sigilc compare --root . --selection selection.json
```

Implementation inspection and comparison require an explicit selection JSON,
unless a paired `--scope` supplies one. For example:

```json
{"dirs":["src"],"exclude":["**/generated/**"],"vendorDirs":["vendor"]}
```

Optional fields are `paths`, `dirs`, `include`, `exclude`, `vendorDirs` (arrays
of strings), and `allowEmpty` (default false). Paths are workspace-relative;
includes and excludes use `*`, `**`, and `?` globs. Internal cache and build
trees are always excluded.

Reports are JSON. `compile design` returns exit 0 for Coherent or Loose and 1
for Disjoint. `compile implementation` and `compare` return exit 0 for Closed
or Converged and 1 for Drift. `stale` returns 1 when freshness work remains.
Invalid options return 2. Input, I/O, runtime, or unavailable-comparison
failures return 3. These exits describe semantic state or compiler operation;
they do not describe delivery, tests, or external interpretation fidelity.

Scope is read-only semantic membership. It preserves caller priority in
`design.focus_order`, expands required imports and owners, and reports the
effective membership and order fingerprints. It is not a queue, scheduler, or
completion mechanism. External callers may use those results to organize work
and may store any workflow records wherever they choose.

Use the same scope through scope inspection, stale checks, preparation,
ingestion, and comparison. `--scope` replaces `--selection` for Implementation
and conflicts with it and `--allow-empty`. Intentional emptiness must be
explicit in the scope. Reordering roots changes focus order without changing
per-source semantic bindings when membership is unchanged.

The compiler keeps publication safety at the boundary: source and catalog
identity are revalidated, projection generations use compare-and-swap
semantics, the world index is locked, and accepted projections become visible
atomically. These guarantees are independent of how an external caller
chooses to schedule interpretation or retain its records.

## `sigil-claims`: computed design validation

The crate ships a second binary beside `sigilc`. It answers a different
question: not whether an external interpretation of a Design is coherent
against the compiler's ontology, but which design findings follow from a
model's reading of authored prose — and which still need judgment.

It never launches a model. Like `sigilc`, it uses a prepare/ingest boundary,
and the interpretation is an input the caller supplies and can supply again.

```sh
sigil-claims prepare --root . --source a.sigil --out claims-a
# An external interpreter reads claims-a and writes Datalog claims.
sigil-claims ingest --root . \
  --binding claims-a/binding.json --claims claims-a/result.egg
sigil-claims check --root .
sigil-claims extract-guidance --out ./guidance
```

`prepare` writes an immutable `binding.json`, a `request.json` carrying each
Facet's exact prose slice with the contract role it belongs to, and the
interpreter guidance. `ingest` recomputes the request from the current workspace
and refuses a binding that does not match it, naming which input moved.

`ingest` judges one source against the interfaces it imports. For the whole
design, interpret and ingest each source, then run `check`: it links every
valid stored reading into one program, applies every law across components, and
writes `workspace.linked.json` and `workspace.linked.context.json` under the
store's `claims` directory. `--source PATH` limits the check to findings that
source authored part of, writing `<source>.linked.json`; its state and exit
code follow those findings, so gate the whole design with the workspace check
and use `--source` to read one author's view. A unit with no stored
reading, or an import no source resolves, makes the state `incomplete`, listing
the `unread` units and `unresolvedImports`; that exits 1, as does `disjoint`.

Claims come back as data-only egglog atoms. An artifact containing a rule,
command, schedule or nested expression is refused whole. A row that is data but
wrong refuses only its own unit, one Facet or one Logic section: the other units
are stored, every refusal is listed in the result, and the refused unit stays
unread, so `prepare` asks for it again. Until every unit is read, ingest and
`check` report `incomplete` and exit 1. Relation and
property names are closed over the compiler's published ontology, read through
`turtle::vocabulary()`. The tool mints every claim identity, fills the contract
role from the source tree, and refuses a name that is not on its Facet's list.
Each Facet in a request carries a short handle (`#3`, accepted wherever an answer
names a Facet) and the list of names it may use: its own component, the
components its source imports from, and the Tags its prose references or
introduces. A flow's steps are numbered within their own Facet, and a flow ends
with an `end` row. An `undeclared` row says the prose relies on something no Tag
declares.

Every claim carries the role it was authored under, which is what the
compiler's RDF-shaped facts could not express. A claim from a `decisions` Facet
is retained, reported and passed to the judge but derives nothing: rationale
does not convert a rejected alternative into a promise. Modality carries the
rest — `required` commitments oblige, `permitted` ones do not, and `assumed`
ones oblige the design to state what it leans on.

Findings cite the claims and the law that produced them. A declared role the
interpretation returned nothing for is named with its component and attributed
to the interpretation, not the design. A claim whose subject and object coincide
is degenerate and does not satisfy its unit. A name the prose relies on that
its Facet's list lacks is a warning about the design, and never fails it.

Alongside the report, `ingest` writes a judgment context covering every unit in
the design — including units nothing was found about — with derived facts, their
provenance, the state of each promise and where it is stated, and
simplification candidates it does not rule on. Deciding those is not this
binary's work.

Guidance is compiled into the binary and covered by a runtime fingerprint
alongside the vocabulary and the laws. Guidance found in the workspace under
validation is never read, so no file on disk can widen what is accepted;
`extract-guidance` writes an editable copy to a path outside that workspace.

`prepare` reads the workspace through the tree cache and asks the interpreter
only about units whose stored reading no longer holds. It prints
`requestedUnits`, `regroundedUnits`, `uninterpretedContext` (dependency
interface Facets shown for context, not to be read), and a `workspaceDigest`,
the hash of every resolved tree id, which a caller can keep as run evidence. A
binding covers the source's tree, the interface hashes of what it imports, the
guidance, and the vocabulary generation, so editing an unrelated file or a
dependency's private section does not reject `ingest`. A mismatch names the
field that moved, and reports identify what they were computed from by
`bindingDigest`.

Reports and readings live under `<store>/claims/`, which this binary owns, with
`--store DIR` (default `<root>/.sigil`). A caller that must never reuse an
earlier reading, such as a benchmark, passes a fresh empty `--store`. The
compiler's `worlds/` cache, its stored projections, and its command surface are
untouched.

Gate exits match the compiler's convention: 0 for coherent or loose, 1 for
disjoint, 2 for usage, 3 for operational failure.
