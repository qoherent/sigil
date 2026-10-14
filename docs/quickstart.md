# Quickstart

Sigil keeps authored contracts and independently reconstructed implementation
worlds separate. `sigil` parses the language; `sigilc` reads the workspace and derives native
semantic states from externally supplied assertions. It does not start a model
or own your coding loop.

## 1. Install both tools

Standalone releases ship `sigil` and `sigilc` together. The skills install through
your agent's plugin system and follow the same releases; see
[installation](../README.md) and the [install guides](install/README.md). They require no Deno, Node, Rust or source checkout
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
```

Install the Sigil skills for your coding agent by following its
[install guide](install/README.md). They install through the agent's own plugin
system and need no `sigil` binary.

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

## 4. Run computed checks

`sigilc` reads workspace sources and stored external interpretations:

```sh
sigilc check --root .
sigilc align check --root .
```

A fresh workspace is Incomplete until its readings are supplied. Run
[sigil-compute-design](../skills/sigil-compute-design/SKILL.md)
for design computation or
[sigil-compute-align](../skills/sigil-compute-align/SKILL.md)
for a design-first implementation check. The latter reads selection from
`tools.sigilc.implementation` in workspace config and proposes excludes as output.

Design states are Coherent, Loose, Disjoint and Incomplete. Implementation
states are Closed, Converged, Drift and Incomplete. The first two states on
each side exit 0; the latter two exit 1. Usage exits 2 and operational failures
exit 3. See the [native command guide](../packages/sigilc/README.md).

Model readers supply data-only rows; the native tool admits them and applies
the laws. Ordinary tests and delivery evidence remain necessary.
