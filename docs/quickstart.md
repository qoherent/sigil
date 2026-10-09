# Quickstart

Sigil keeps authored contracts and independently reconstructed implementation
worlds separate. `sigil` parses the language; `sigilc` reads the workspace and derives native
semantic states from externally supplied assertions. It does not start a model
or own your coding loop.

## 1. Install both tools

Standalone releases ship `sigil`, `sigilc` and the skill catalog together. See
[installation](../README.md). They require no Deno, Node, Rust or source checkout
at runtime. For repository development, build the two executables:

```sh
deno task build:sigilc
deno task build:cli
build/sigil --version
packages/sigilc/target/debug/sigilc --version
```

Use the appropriate executable paths, or put their directories on PATH. Their
versions are independent; an archive version is not the native compiler version.

## 2. Initialize a workspace

From the intended repository root:

```sh
sigil init . --name your-repo
sigil skill install --project
```

Review `.sigil/config.json` and its authored-source include/exclude patterns.
Keep `.sigil/worlds/` ignored: it is disposable generated native state. Native
Implementation selection is separate from language configuration; exclude vendor,
build and operational files from that comparison as appropriate.

## 3. Author and inspect a boundary

Write `notifier.sigil` beside its owner:

```sigil
component Notifier {
  goal {
    Deliver notifications to recipients over email.
  }
  interface {
    Send {
      Deliver one message and report delivery failure to the caller.
    }
  }
}
```

```sh
sigil check . --format json
sigil context . --component Notifier --format markdown
```

Language checks validate syntax, imports and configuration. They do not establish
semantic coherence or implementation delivery.

## 4. Use the native flow

Compile the workspace directly. `sigilc` reads the `.sigil` files itself:

```sh
sigilc compile design --root .
```

Without independent source reconstructions, this can report Loose with missing
projection warnings. That is not evidence that implementation is complete.
Follow the skill's [native compilation protocol](../integrations/skills/sigil/references/compilation-execution.md)
for scope, freshness, preparation, external interpreter inputs, ingestion,
catalog export and comparison.

Design gates return Coherent or Loose with exit 0 and Disjoint with exit 1.
Implementation gates return Closed or Converged with exit 0 and Drift with exit 1.
Loose and Converged are yellow with warnings. Usage is exit 2; runtime or
unavailable comparison is exit 3. Inspection exits have their own meanings.

Each independent Implementation interpreter receives only captured source bytes,
fixed ontology and frozen identity catalog. Keep Design prose, neighboring code,
binding files and repair feedback out of its inputs. The external host owns
model calls, isolation, coding and iteration. Actual checks and removal evidence
remain necessary alongside semantic comparison.
