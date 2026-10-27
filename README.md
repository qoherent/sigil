# <img src="docs/sigil.png" height="30" /> Sigil

Sigil is an inferential modeling language (IML).
It's text-only, with a cool 7-word syntax.
AI writes it for you, don't worry (^_~). Unlike descriptive modeling languages,
Sigil design files (*.sigil) compile into **world models (Semantic Worlds)** that compute what
follows from what you specify, and whether an implementation realizes it.
It records what a system is, why it exists, how it behaves, and how its
implementation should be understood and changed over time.

This puts some new superpowers on the table. A Sigil design can **infer facts
nobody explicitly wrote**, turn intent into **computable obligations**, and
independently reconstruct the implementation into a second world to ask whether
the two actually realize each other. Ambiguity stays ambiguity; contradictions become errors; missing realization
becomes a warning. The model is no longer documentation sitting next to the
software. **It computes.**

## Start vibing:

macOS or Linux:

```bash
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

Set `SIGIL_VERSION` to install a specific release. To inspect an installer
before running it, download the script first instead of piping it directly to a
shell. Every archive is verified against the release's SHA-256 manifest before
installation.

The installer puts two commands on your `PATH`: `sigil`, the language CLI, and
`sigilc`, the native compiler that runs computed design checks and
implementation alignment.

The Sigil skills install separately, through your coding agent's own plugin
system, with no `sigil` binary needed. `sigil-compute-design` and
`sigil-compute-align` need `sigilc`; the other skills work without it. Claude
Code, Codex, OpenCode, Pi, Cursor, and Gemini CLI or Antigravity each have an
[install guide](docs/install/README.md).
For example, in Claude Code:

```text
/plugin marketplace add qoherent/sigil#release
/plugin install sigil@sigil
```

VS Code extension releases are currently available as manually installable
`.vsix` files on the
[GitHub Releases page](https://github.com/qoherent/sigil/releases). Marketplace
publishing remains deferred.


The [language guide](docs/spec/sigil-language.md) teaches the 0.9.0 language;
the [normative reference](docs/spec/sigil-reference.md) and [EBNF grammar](docs/spec/sigil.ebnf)
define its rules. A component declares all its contracts in one place. Tags are
defined inline with `*asterisks*`, Concept Tag headings group related Facets,
and imports select Tags from the component that owns them, such as
`@search/service.sigil from SearchService import { query, search results }`.
A consumer can import only Tags that appear in the provider's Interface, and
imports never re-export. This checkout implements 0.9.0; released artifacts
have independent versions and must be checked before installation. Upgrading
from 0.8? See the [migration guide](docs/spec/migrating-to-0.9.md).

## Seven Words

Sigil's authored language revolves around seven contract kinds:

```text
goal
state
logic
constraints
cases
interface
decisions
```

They answer different questions:

```text
goal
    Why should this exist?

interface
    What does the outside world get?

state
    What meaningful configurations persist or change?

logic
    What transformations and flows happen?

constraints
    What must remain true?

decisions
    Which important choices were made, and why?

cases
    What should we actually observe?
```

They are intentionally broad enough for humans to write naturally and narrow enough for an AI semanticizer to project into a fixed vocabulary.

The prose is not the final computational representation.

It is the human-authored surface from which the Semantic World is compiled.

---

```sigil
component SearchPublication {
  goal {
    Keep the published results aligned with the active request.
  }

  state {
    At most one request is the *active request*.

    A *request cancellation* withdraws the active request.

    The *published results* are the results currently on display.
  }

  logic {
    An *eligible response* answers the active request and arrives before any
    request cancellation.

    A response publication with an eligible response replaces the published
    results and returns replaced.

    A response publication with any other response leaves the published results
    unchanged and returns ignored.
  }

  constraints {
    A response publication never changes the active request.

    Only an eligible response may replace the published results.
  }

  cases {
    A response publication for an older request returns ignored.

    A response publication for the active request after a request cancellation
    returns ignored.

    A response publication with an eligible response returns replaced, and its
    results become the published results.
  }

  interface {
    A *response publication* takes a response with its results and returns
    *replaced* or *ignored*.

    The outcome replaced means the response's results are now the published
    results.

    The outcome ignored means the published results did not change.
  }

  decisions {
    Keep the active request authoritative because responses can arrive out of
    submission order.
  }
}
```

Each blank-line-separated paragraph is a **Facet**. Asterisks define a **Tag**
once, such as `*active request*`; after that, its bare name refers to it in any
contract of the component.

Read [more about the syntax here.](docs/spec/sigil-language.md)

## What Just Changed

Software models used to be pictures humans looked at.

Sigil models are inputs to a compiler.

A Design becomes a Semantic World `D`. The implementation is independently reconstructed into another Semantic World `I`. Compiler-owned laws expand both worlds until no more consequences can be derived:

```text
D* = saturate(D)
I* = saturate(I)

O = obligations(D*)

compare(O, I*)
```

That small change unlocks a very different kind of modeling.

In `sigilc` 0.3.0 each step is a command. `sigilc` never runs a model:
`prepare` writes a request, an external reader (a coding agent running the
compute skills) answers it with data-only egglog rows in `answer.egg`, and
`ingest` admits or refuses those rows.

```sh
# Design world
sigilc prepare --root . --source architecture/a.sigil --out reading-a
sigilc ingest --root . --binding reading-a/binding.json --claims answer.egg
sigilc check --root .

# Implementation world
sigilc align prepare --root . --out code-readings
sigilc align ingest --root . --binding code-readings/FILE/binding.json --claims answer.egg
sigilc align check --root .
```

The [sigilc README](packages/sigilc/README.md) covers options, configuration,
report locations, and exit codes.

### Models can infer things nobody wrote

If:

```text
A depends on B
B depends on C
```

Sigil can derive:

```text
A reaches C
```

If:

```text
A requires X
```

the model can derive an obligation that X must somehow become available to A.

If two individually reasonable statements cannot both be true, the contradiction appears when the world is compiled.

The author supplies the generators. The kernel computes closure under composition.

### A design can ask whether reality realizes it

Sigil does not ask the coding agent whether it implemented the spec correctly.

The Design and Implementation worlds are built independently.

```text
Design                         Implementation

what should be true            what the code appears to make true
       │                                  │
       ▼                                  ▼
      D*                                 I*
       │                                  │
       └──── obligations ──── realization ┘
```

That produces four implementation states:

```text
⚪ Incomplete
   A code file is unread or cannot be presented, or the Design
   check itself is Disjoint or Incomplete.

🔴 Drift
   Implementation breaches Design, does work no Design claim
   accounts for, or leaves a Design promise unanswered.

🟡 Converged
   No disagreement found, but the Design is Loose, so some
   realization is still unresolved.

🟢 Closed
   Every finite Design obligation is realized by the current
   Implementation world.
```

Design itself has the matching progression:

```text
⚪ Incomplete  some Facets have no admitted reading yet
🔴 Disjoint    contradictory
🟡 Loose       coherent enough to work with, but incomplete
🟢 Coherent    closed under the current Design laws
```

`sigilc check` exits 0 for Coherent or Loose and 1 for Disjoint or Incomplete.
`sigilc align check` exits 0 for Closed or Converged and 1 for Drift or
Incomplete.

Yellow is useful. Unknown stays unknown instead of being converted into confidence theater.

### Meaning survives different spellings and different languages

The same thing rarely keeps the same name all the way down:

```text
Age
 ↓
age
 ↓
age_years
```

Sigil keeps each name local to its source and connects them with explicit mappings.

The compiler does not lowercase them, fuzzy-match them, or pretend they are one global identifier.

The LLM reading each source understands its local language and proposes the mapping. For code, the mapping is a `realizes` row from a name in the file to a Design name:

```text
(element "age_years" "state")
(realizes "age_years" "Person::age")
```

`sigilc` qualifies `age_years` with its file path and keeps the mapping as data, so the path by which meaning crossed Sigil, Rust, Python, TypeScript, or anything else remains inspectable. Annotations such as `@sigil implements` are not mapping evidence.

`sigilc` 0.3.0 does not yet map origin documents such as Markdown into the Design, or derive correspondence chains such as `denotes(A, B), denotes(B, C) → correspondsTo(A, C)`.

### Refactors acquire a semantic blast radius

When code changes, its old semantic facts immediately stop being current truth.

But the last known correspondence is still useful for a different question:

> What might this change affect?

```text
changed source
    ↓
last-known local anchors
    ↓
correspondence closure
    ↓
Tags + Facets
    ↓
Sigil contracts
    ↓
origin material
```

So a changed Rust file can point back toward the Design decisions, interface Facets, constraints, or origin sections it previously realized.

Stale knowledge may explain impact.

It can never make the current implementation green.

`sigilc` 0.3.0 does not compute this impact path yet. Two inputs to it exist
today: `sigilc tree --diff` lists the Facets added, removed, and changed since
the last recorded tree, and `prepare` asks again only for readings that are
stale or unread.

### Numbers can participate too

Semantic facts do not have to carry only true/false information. A claim can
carry a measure, and the laws compare measures:

```text
latency
    Design states a budget (latencyBudgetMs)
    code reports an observed latencyMs
    over budget      → numeric-budget breach (Drift)
    never observed   → unanswered promise (Drift)

day counts
    maxDurationDays, maxLeadDays, maxSpanDays
    checked the same way against durationDays, leadDays, spanDays

conflicting Design numbers
    two readings give one property different values
    → conflicting-measure
```

Path costs that compose with `+` and merge with `min`, or risk that propagates
through reachability, are not in `sigilc` 0.3.0.

This is why Semantic Worlds are more than graphs with labels.

Their edges participate in computation.

---

## The Core Idea

Sigil deliberately splits fuzzy interpretation from deterministic reasoning.

```text
                 LLM territory
                      │
                      ▼
source ───────→ data-only claims readers
                      │
                      ▼
                admitted claims
                      │
                 compiler territory
                      ▼
                    link
                      ▼
                   world
                      ▼
                  saturate
                      ▼
                richer world
```

The LLM is good at understanding language, code, aliases, intent, and local meaning.

The kernel is good at composition, closure, contradictions, obligations, correspondence, arithmetic, and comparison.

Neither is asked to impersonate the other.

The rule is:

> **LLMs emit generators. The kernel owns composition.**

---

## Two Worlds, Kept Apart

The most important correctness rule in Sigil is almost boringly simple:

```text
Never saturate(D ∪ I).
```

Design and Implementation are separate universes.

```text
.sigil files
    ↓
semanticize
    ↓
Design admitted claims
    ↓
D
    ↓
D*


source code
    ↓
independent semanticize
    ↓
Implementation admitted claims
    ↓
I
    ↓
I*
```

Only after both have independently reached closure does comparison begin.

This prevents:

```text
"Design says A provides X"
```

from somehow becoming evidence that:

```text
"the implementation provides X"
```

Design determines the obligations.

Implementation has to realize them on its own.

`sigilc` enforces this in its laws: only admitted code observations establish
actual behavior, and Design claims produce only obligations and prohibitions.
`sigilc align check` also checks the whole linked Design first; a Disjoint or
Incomplete Design makes the alignment result Incomplete.

---

## Local Facts, Global Meaning

Semanticization is incremental.

Each unit gets its own stored reading. A Design reading covers one Facet; a code
reading covers one whole file. The reader answers in egglog rows, and `ingest`
stores the admitted reading in the store (`.sigil` by default):

```text
one Facet      → claims/interpretations/<key>.json
auth.ts        → claims/implementation/<key>.json
storage.py     → claims/implementation/<key>.json
```

Each reading contains only direct facts attributable to that source.

It does not attempt fuzzy whole-program analysis.

```text
a.ts.egg:
A dependsOn B

b.ts.egg:
B dependsOn C
```

`sigilc check` links the readings into one world and egglog derives:

```text
A reaches C
```

So changing `b.ts` requires a new reading of `b.ts`, not `a.ts`.

Then the cheap deterministic world closure runs again.

> **Local facts in files. Global meaning in closure.**

The expensive part, LLM semanticization, is incremental. The deterministic circuitry can simply recompute.

---

## Tags and Facets

A **Tag** gives a design concept a reusable identity owned by its component.

A **Facet** is one blank-line-separated paragraph in a contract: one authored
contribution that can be reviewed on its own. A Facet connects to a Tag by
defining or naming it, and a Concept Tag heading groups Facets from different
contracts under one Tag.

For example, the `login` Concept Tag in an `Authentication` component:

```text
Authentication › login

├── Interface Facet
│   login interaction
│
├── Logic Facet
│   credential validation
│
├── State Facet
│   authenticated lifecycle
│
├── Constraint Facet
│   credentials never leak
│
└── Case Facet
    invalid password is rejected
```

This distinction matters during implementation.

A code element may belong to a component:

```text
(realizes "login_handler" "Authentication")
```

while delivering one specific Tag:

```text
(realizes "login_handler" "Authentication::login")
```

Delivering a Tag does not make an element a member of the component; the
reader states membership separately. Membership also needs at least one Design
claim that accounts for the element's actual work. Being in the component's
file is not enough.

Correspondence alone also proves no behavior.

A concrete local fact must participate in a compiler-owned composition law before an Implementation realization can satisfy a Design obligation.

That keeps semantic traceability rich without turning “these things seem related” into “therefore the code is correct.”

---

## Why AI Changes The Modeling Problem

Before AI coding, the implementation itself was expensive enough that engineers naturally carried much of its context in their heads.

Now code can appear faster than a team can build a shared mental model of it.

The scarce resource moves upward:

```text
not:
    typing code

but:
    preserving intent
    making boundaries explicit
    noticing contradictions
    understanding consequences
    knowing what a change touches
    checking whether generated code still realizes the design
```

That is the problem Sigil is built around.
A model that participates in the software system itself.
The problem statement that lead us to Sigil is captured in [PROBLEM.md](PROBLEM.md).


## Where To Start

| Your situation                   | Read                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Trying Sigil for the first time  | [Quickstart](docs/quickstart.md)                                                        |
| Setting up a repository properly | [Setting Up A Project](docs/setting-up-a-project.md)                                    |
| Code exists, contracts do not    | [Setting Up A Project](docs/setting-up-a-project.md#adopting-into-an-existing-codebase) |
| Designing something new          | [sigil-write](skills/sigil-write/SKILL.md)                                 |
| Writing Sigil, need the syntax   | [Language Guide](docs/spec/sigil-language.md)                                        |
| Tuning `.sigil/config.json`      | [Config Reference](docs/spec/sigil-config.md)                                                |
| Upgrading an existing workspace  | [Compatibility](COMPATIBILITY.md), then the [migration guide](docs/spec/migrating-to-0.9.md) |
| Changing Sigil itself            | [CONTRIBUTING.md](CONTRIBUTING.md)                                                      |
| Changing the skills or cutting a release | [Contributor guide](docs/contributing/README.md)                                |

Greenfield design is the job of the `sigil-write` skill. The brownfield
procedure is written for a coding agent running the Sigil skills; it is readable
on its own in Setting Up A Project.

## Setup for development

For Contributors using the codebase directly, use the following. Working on the
skills? The [contributor guide](docs/contributing/README.md) also covers loading
the checkout into your agent.

1. Clone the repo:

```sh
git clone https://github.com/qoherent/sigil.git
cd sigil
```

Use `git@github.com:qoherent/sigil.git` instead if you have SSH keys set up for
GitHub.

2. Install [Rust](https://www.rust-lang.org/tools/install) 1.91.1 or newer. The
   `sigil` command line, the language server and the native compiler `sigilc` are
   Rust. Install [Deno](https://docs.deno.com/runtime/getting_started/installation/)
   too if you will run the repository's scripts and checks (it is not needed to
   build or use the tools).

3. Build the tools from the clone:

```sh
deno task build:sigil     # packages/cli/target/debug/sigil
deno task build:sigilc    # packages/sigilc/target/debug/sigilc
```

Without Deno, run `cargo build --manifest-path packages/cli/Cargo.toml` and
`cargo build --manifest-path packages/sigilc/Cargo.toml`. Put both folders on your
`PATH`, then check:

```sh
sigil --version
sigilc --version
```

The binaries are whatever you last built, so rebuild after you pull or switch
branches. To keep one build while you work on another, build it in a detached
worktree and put that worktree's `target/debug` on your `PATH` instead:

```sh
git worktree add --detach ../sigil-pinned <branch-or-commit>
cargo build --manifest-path ../sigil-pinned/packages/cli/Cargo.toml
```

Run the tests with `deno task test:core`, `test:cli`, `test:lsp` and
`test:sigilc`, or the whole set with `deno task test`.

## Usage

The `.sigil` files are the durable place where
decisions, assumptions, component boundaries, and behavior are recorded before
implementation.

The intended workflow is:

1. The user writes the minimum useful Sigil.
2. The agent runs structural checks, follows imports, and reads related code,
   tests, configuration, and documentation.
3. The agent reviews semantic readiness, cross-Sigil coherence, modularity,
   applicable standards, and code/spec drift.
4. Brownfield reconstruction and externally informed additions are proposed
   before the agent edits Sigil.
5. The user approves, rejects, or revises the proposed contract and semantic
   lines.
6. The agent writes only the approved Sigil and stops at a semantic review gate.
7. After approval, the agent colocates Sigil with the implementation and uses
   the agreed contract to generate or change code.
8. If implementation reveals a missing material decision, the workflow returns
   to Sigil and human review.

## Repository Layout

The root [.sigil/config.json](./.sigil/config.json) defines this repository as a
Sigil 0.9.0 workspace and excludes the independent example projects.

- `docs/spec/` contains the language reference, grammar, authoring guide,
  configuration, glossary and conventions specifications, their JSON schemas,
  and the Sigil contracts that describe them.
- `examples/` contains independently configured Sigil projects used as
  design-pressure fixtures.
- `packages/` contains `sigil-core`, the `sigil` command line, the language server, and the native `sigilc`, all Rust.
- `integrations/` contains host adapters such as coding-agent skills, the
  initial VS Code extension, and future editor integrations.

## Examples

`Promise` in [examples/promise/promise.sigil](examples/promise/promise.sigil)
shows how Sigil can describe a programming abstraction with an API, lifecycle
states, and transition logic.

Its [.sigil/config.json](examples/promise/.sigil/config.json) makes it an
independent workspace named `promise`.

`Slotted` in [examples/slotted/slotted.sigil](examples/slotted/slotted.sigil) is
a room-booking design that spans several modules. It is a clean design: it
contains no deliberate mistakes, so use it when you need a valid example of a
multi-module Sigil workspace. It was written with `sigil-write` from the
maintainer's Slotted plan, then reviewed and edited by the maintainer.

Its [.sigil/config.json](examples/slotted/.sigil/config.json) makes it an
independent workspace named `slotted`; imports beginning with `@` resolve from
that directory.

Slotted has six components, each in its own file, plus a shared kernel:

- [Identity](examples/slotted/identity.sigil) owns users, sessions, and the
  signed-in user.
- [Rooms](examples/slotted/rooms.sigil) owns rooms, room owners, the room
  timezone, archiving, and the room lock.
- [Availability](examples/slotted/availability.sigil) owns weekly windows,
  blackouts, and open time.
- [Booking](examples/slotted/booking.sigil) owns booking requests, their
  lifecycle, and the no-overlap rule.
- [Calendar](examples/slotted/calendar.sigil) owns the room calendar and what
  each viewer may see.
- [SharedKernel](examples/slotted/shared.sigil) owns the clock, the 30-minute
  grid, time conversion, and domain errors. Any module may use it.

Each component reuses the other components' Tags through imports instead of
defining them again.

A copy of Slotted with four deliberate design mistakes lives in
[scripts/slotted-benchmark/fixtures/slotted-planted](scripts/slotted-benchmark/fixtures/slotted-planted):
a contradiction and an ownership conflict in Booking, and an unmet obligation
and a dead-end flow step in Calendar. The
[Slotted interpretation benchmark](scripts/slotted-benchmark/README.md) runs
agents against that copy and reports what they find. The mistakes are there on
purpose, so please do not fix them.

Slotted is an example project for testing the language, not the purpose of this
repository.

## Coding-Agent Skills

The skills provide four Sigil 0.9 design entry points, an implementation
alignment skill, its computed partner, and one egglog language skill:

| Skill | Use it to |
| --- | --- |
| [sigil-understand](skills/sigil-understand/SKILL.md) | Explain intent, contract roles, Tag ownership, and relevant context. |
| [sigil-evaluate](skills/sigil-evaluate/SKILL.md) | Review design read-only from its computed claims for consequential problems and useful simplification. |
| [sigil-compute-design](skills/sigil-compute-design/SKILL.md) | Run the claims loop on an existing design and hand back the computed Coherent, Loose, Disjoint, or Incomplete ingest state with findings, distinct from advisory review. |
| [sigil-write](skills/sigil-write/SKILL.md) | Write compact contracts and apply supported corrections through independent delegated review. |
| [sigil-align](skills/sigil-align/SKILL.md) | Review and repair a selected component's implementation against its accepted contract, then report code and test evidence. |
| [sigil-compute-align](skills/sigil-compute-align/SKILL.md) | Run the design-first computed implementation check and hand back Closed, Converged, Drift, or Incomplete with findings and proposed excludes. |
| [sigil-egglog](skills/sigil-egglog/SKILL.md) | Teach egglog/datalog for claims data-only rows and `.egg` law programs. |

The four design skills and `sigil-align` start at artifact version 0.1.0 and
share the bundled 0.9.0 normative reference and grammar. `sigil-egglog` starts
at 0.1.0 with no design-skill dependency. Current skill versions are listed in
[COMPATIBILITY.md](COMPATIBILITY.md). Install the complete set through your
agent's [install guide](docs/install/README.md); writer and evaluator require
their sibling reference files.
`sigil-compute-design` requires its declared siblings `sigil-understand` and
`sigil-egglog`; it routes only explicit claims or computed-check requests, so a
generic review stays on `sigil-evaluate`. It needs the `sigilc` binary and
a host that can delegate a fresh child.
`sigil-evaluate` requires `sigil-understand` and `sigil-compute-design`;
`sigil-write` also requires `sigil-evaluate`. Before judging, they run
`sigil-compute-design`'s review preparation, which reuses stored readings and
ends with one linked `sigilc check`. The judge reads that check's compact
review view and reads prose through its verified byte ranges. Without `sigilc`
both continue from the sources and report computed coverage as unavailable.
`sigil-compute-align` starts at 0.1.0 and requires `sigil-compute-design`,
`sigil-understand`, and `sigil-egglog`, plus `sigilc` and fresh-child delegation.
It needs configured implementation selection and proposes excludes as output only;
a plain implementation review stays on `sigil-align`.
`sigil-align` requires `sigil-understand`, `sigil-evaluate`, and `sigil-write`.
Use it for implementation conformance and determinate code repairs; use
`sigil-evaluate` for read-only design review. A consequential contract change
routes through `sigil-write` and independent design review. `sigil-align`
uses contract, code, and test evidence; it does not require `sigilc`, and a
design review it routes through `sigil-write` continues source-only without it.

Writing and evaluation use a verified compatible CLI when available. The writer
runs `check`, formats only authored files, and rechecks before capturing inputs
for independent review. The evaluator runs `check` and `fmt --check` read-only.
Without compatible tooling they continue from source and explicitly report
mechanical validation as unavailable. The writer preserves unresolved human
choices, rechecks review freshness, and provides an independently unreviewed draft
and portable handoff if delegation cannot complete. Static package checks and observed agent evaluations against the
[`sigil-write` eval fixtures](skills/sigil-write/evals/README.md) provide
separate evidence. Mechanical checks do not establish design coherence or code
conformance. The [mechanical fixtures](skills/sigil-write/evals/mechanical-validation-fixture.md)
cover CLI-enabled behavior separately from the earlier offline observations,
recording actual commands, independent reviews, input identities, and
limitations in the PR that ran them.

`sigil fmt [paths...]` accepts multiple files or directories within one workspace:

```sh
sigil fmt first.sigil second.sigil
sigil fmt design
sigil fmt first.sigil design --check
```

Bare `sigil fmt` selects the current directory: all included workspace sources
when run at the root, or only sources beneath a nested working directory.
`--root` selects configuration context, not a replacement formatting target.
Overlapping targets are deduplicated; every target and the combined result
validate before any write. Workspace checks may report errors outside the
selected files, but formatting writes only changed selected `.sigil` files.

The canonical language specification is [docs/spec/sigil-reference.md](docs/spec/sigil-reference.md),
with the [EBNF grammar](docs/spec/sigil.ebnf). The [language guide](docs/spec/sigil-language.md)
provides authoring explanations and examples.

## Current Status

The Rust core (`sigil-core` 0.1.0), command line (`sigil` 0.9.0), language
server (`sigil-lsp` 0.8.0), native `sigilc` 0.3.0 and VS Code integration
implement Sigil language 0.9.0. `sigilc` writes tree format 1, design reports version 6,
and implementation reports version 1; version 0.3.0 retires the earlier Turtle
worlds and their commands. These are local, pre-production changes; this
migration does not publish a release. Artifact versions and legacy requirements
are listed in [COMPATIBILITY.md](COMPATIBILITY.md). See the
[migration guide](docs/spec/migrating-to-0.9.md) and
[configuration](docs/spec/sigil-config.md). `test:core`, `test:cli`, `test:lsp`,
`test:sigilc`, and `test:native:protocol` establish current conformance.

The shared core owns strict source capture, component-owned Tags, explicit
provider imports, exact references, protected links/payloads, staged recovery,
workspace boundaries, glossary projections,
formatting and source-faithful Design export. The CLI and the language server
(`sigil lsp`) use those shared results. VS Code runs `sigil lsp` and provides navigation, diagnostics, highlighting,
whole-document preview, and runs `sigilc check` and `sigilc align check` to show
computed findings.

Independent interpretation remains external to deterministic tooling. Native
states describe admitted readings and compiler laws; successful language
checks, canned-claims protocol tests and advisory design reviews establish different facts.
The 0.9 understanding, writing and evaluation skills provide the current design
workflow without requiring compiler-based proof.

Editor integrations other than VS Code, stricter body semantics, and additional
project configuration remain deferred.
