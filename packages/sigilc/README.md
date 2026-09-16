# sigilc

`sigilc` is the deterministic Rust compiler and semantic projection publisher.
It validates structural input, accepts externally produced Turtle, computes
Design and Implementation worlds, and reports scoped comparisons. It never
launches models, workers, or task workflows.

Build it with Rust 1.91.1 or newer:

```sh
cargo build --locked --manifest-path packages/sigilc/Cargo.toml
```

Design commands require structural schema 2 for language 0.8.0 and emit report
version 2. Source locations carry explicit coordinate conventions and captured
SHA-256 digests. Old captures and stored projections are retained but cannot be
used as current evidence.

Design commands consume the versioned structural JSON produced by
`sigil export design .`. The compiler checks the captured source and workspace
inputs against `--root` (default `.`). Regenerate the bundle after authored,
configuration, or glossary changes.

```sh
sigil export design . > frontend.json
sigilc ontology --format json
sigilc scope --frontend frontend.json --scope scope.json
sigilc prepare design --frontend frontend.json --source architecture/a.sigil --out design-a
# An external caller interprets design-a/design.json and design-a/ontology.json.
sigilc ingest design --frontend frontend.json --source architecture/a.sigil --binding design-a/binding.json --turtle design-a/result.ttl
sigilc stale design --frontend frontend.json --scope scope.json
sigilc compile design --frontend frontend.json --scope scope.json
sigilc entities --frontend frontend.json --scope scope.json
```

`prepare` copies the semantic inputs and writes an immutable `binding.json`.
The external caller keeps that directory, produces Turtle independently, and
passes the matching binding to `ingest`. Ingest validates the source binding,
restricted data, current source inputs, and expected projection generation
before atomically publishing the accepted projection. If any bound input
changes, prepare a new directory and binding. `sigilc` does not record the
external interpretation, its attempts, or its outcome.

The generated `.sigil/worlds/` cache is disposable and ignored. Its index keeps
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
sigilc prepare implementation --frontend frontend.json --source src/main.rs --out implementation-main
# An external caller interprets the three copied inputs.
sigilc ingest implementation --frontend frontend.json --source src/main.rs --binding implementation-main/binding.json --turtle implementation-main/result.ttl
sigilc stale implementation --frontend frontend.json --selection selection.json
sigilc compile implementation --frontend frontend.json --selection selection.json
sigilc compare --frontend frontend.json --selection selection.json
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
