# Evaluate the computed alignment skill

This bundle supplies instructional scenarios, not observed agent evidence.
Static catalog checks validate packaging; they do not prove live delegation or
an implementation verdict. Live benchmark evidence belongs to the separate
Slotted design and implementation batches (U14/U15).

Run package checks from the checkout:

```sh
deno task test:skill
deno test --allow-read --allow-write scripts/skill-foundation_test.ts
cargo test --locked --manifest-path packages/sigilc/Cargo.toml --test claims_egglog_skill
```

The first two run offline without a compiler or model; tests mutate relocated
disposable catalogs to check dependencies, schema, adapters and links. The Rust
test checks the separate design/code dialects against compiled guidance.

For [the scenarios](computed-alignment-fixture.md), copy the complete installed
catalog to a temporary directory and materialize each variant's inputs in a
fresh workspace outside the checkout. Give a fresh host only its request, the
installed skill entrypoint, workspace path and actual binary availability.
Keep observer expectations hidden from host and interpreter children. Children
must receive only their own prepared handoff, never host conversation or
observer notes. Use the actual binary and preserve actual generated names and
bindings; canned artifacts must use that request's names.

Record model and effort, exposed host/child identities, skill/reference/binary
hashes, workspace hashes, all requests and responses, commands/payloads/exits,
immutable seed, private store, preparations and exact child artifacts. Compare
workspace config/code/design hashes and both reading-store trees before/after.
Check child counts and command order from the trace, not from a final answer.
Preserve failed attempts. Label injected payloads or canned answers controlled
replay; an interruption by instruction is instructional fault injection, never
an observed unavailable tool. A missing prerequisite supplies a limitation,
not a state. Do not claim any scenario passed until an observed record exists.
