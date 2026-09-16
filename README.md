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
the two actually realize each other. Change the code and Sigil can follow its
semantic correspondence back through the design to show what may be affected.
Ambiguity stays ambiguity; contradictions become errors; missing realization
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

Install the complete Sigil skill bundle globally for Codex, Claude Code, OpenCode, and
Pi:

```bash
sigil skill install
```

Use `sigil skill install --project` for repository-local installation, or
`--agent codex|claude|opencode|pi` to target one agent.

VS Code extension releases are currently available as manually installable
`.vsix` files on the
[GitHub Releases page](https://github.com/qoherent/sigil/releases). Marketplace
publishing remains deferred.


The [language guide](spec/sigil-language.md) teaches the 0.8.0 language;
the [normative reference](spec/sigil-reference.md) and [EBNF grammar](spec/sigil.ebnf)
define its rules:
inline `*Tags*`, unchanged Concept Tag grouping syntax, and explicit imports
such as `@search/records.sigil from RecordSearch import { query, search results }`.
All seven contracts belong directly to components; `expand` and language-level
public/private distinctions are removed. Tags introduced in any contract may
be imported. This checkout implements 0.8.0; released artifacts have independent
versions and must be checked before installation. See the
[Tag migration guide](spec/migrating-to-0.8.md).

## Seven Words

Sigil's authored language revolves around seven contract kinds:

```text
goal
interface
state
logic
constraints
decisions
cases
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

```ts
component SearchPublication {
  goal {
    Keep displayed Results aligned with the active uncancelled request.
  }

  interface {
    publish(ResponseId, IncomingResults) returns Published or Ignored.

    Admission {
      Eligibility is the Boolean decision controlling whether publish may
      replace Results.
    }

    Publication {
      Published means IncomingResults became the current Results.

      Ignored means the current Results remain unchanged.
    }
  }

  state {
    Admission {
      ActiveRequest identifies the request whose response is current.

      Cancelled records whether that request was cancelled.
    }

    Publication {
      Results holds the currently published result.
    }
  }

  logic {
    publish evaluates Eligibility against the starting state.

    Admission {
      Eligibility is true exactly when ResponseId equals ActiveRequest and
      Cancelled is false.
    }

    Publication {
      When Eligibility is true, replace Results with IncomingResults and
      return Published.

      Otherwise preserve Results and return Ignored.
    }
  }

  constraints {
    publish leaves ActiveRequest and Cancelled unchanged.

    Admission {
      Stale or cancelled responses never replace Results.
    }

    Publication {
      Ignored performs no publication and leaves Results unchanged.
    }
  }

  decisions {
    Use the active request as authority because responses can arrive out
    of submission order.
  }

  cases {
    A response for an older request is ignored.

    Admission {
      A response for the active request after cancellation is ignored.
    }

    Publication {
      An active uncancelled response publishes its IncomingResults and
      returns Published.
    }
  }
}
```

Read [more about the syntax here.](spec/sigil-language.md)

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

That produces three implementation states:

```text
🔴 Drift
   Implementation positively disagrees with Design.

🟡 Converged
   No known disagreement, but some realization is still unresolved.

🟢 Closed
   Every finite Design obligation is realized by the current
   Implementation world.
```

Design itself has the matching progression:

```text
🔴 Disjoint    contradictory
🟡 Loose       coherent enough to work with, but incomplete
🟢 Coherent    closed under the current Design laws
```

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

Sigil preserves those as different **source-local anchors** connected by explicit correspondence.

```text
Origin        Design        Implementation

Age  ◀──────  age  ◀──────  age_years
        denotes       denotes
```

The compiler does not lowercase them, fuzzy-match them, or pretend they are one global identifier.

The LLM interpreting each source understands its local language and proposes the mapping. Sigil preserves that mapping as graph structure.

From those direct mappings the kernel can derive broader correspondence:

```text
denotes(A, B)
denotes(B, C)

→ correspondsTo(A, C)
```

without erasing A, B, or C.

That means the path by which meaning crossed Markdown, Sigil, Rust, Python, TypeScript, or anything else remains inspectable.

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
Concepts + Facets
    ↓
Sigil contracts
    ↓
origin material
```

So a changed Rust file can point back toward the Design decisions, interface Facets, constraints, or origin sections it previously realized.

Stale knowledge may explain impact.

It can never make the current implementation green.

### Numbers can participate too

Semantic facts do not have to carry only true/false information.

The kernel can define different algebras for different properties:

```text
path cost
    compose with +
    merge alternatives with min

risk
    propagate through reachability
    merge with max

latency
    compare actual against budget
    emit a crisp violation
```

This is why Semantic Worlds are more than graphs with labels.

Their edges participate in computation.

---

## The Core Idea

Sigil deliberately splits fuzzy interpretation from deterministic reasoning.

```text
                 LLM territory
                      │
                      ▼
source ───────→ Turtle generators
                      │
                      ▼
                semantic objects
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
Design semantic objects
    ↓
D
    ↓
D*


source code
    ↓
independent semanticize
    ↓
Implementation semantic objects
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

---

## Local Facts, Global Meaning

Semanticization is incremental.

Each source file produces one disposable semantic object:

```text
auth.ts        → auth.ts.egg
storage.py     → storage.py.egg
engine.rs      → engine.rs.egg
```

Each object contains only direct facts attributable to that source.

It does not attempt fuzzy whole-program analysis.

```text
a.ts.egg:
A dependsOn B

b.ts.egg:
B dependsOn C
```

The objects are linked into one world and Egglog derives:

```text
A reaches C
```

So changing `b.ts` requires reconstructing `b.ts.egg`, not `a.ts.egg`.

Then the cheap deterministic world closure runs again.

> **Local facts in files. Global meaning in closure.**

The expensive part, LLM semanticization, is incremental. The deterministic circuitry can simply recompute.

---

## Concepts and Facets

A **Concept** is the semantic thing that persists across contracts and source languages.

A **Facet** is one named contribution to that Concept.

For example:

```text
Concept: Authentication

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

A source anchor may broadly:

```text
implement Authentication
```

while specifically:

```text
realize Authentication.Login
```

Implementing the Concept does not magically realize every Facet.

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
| Designing something new          | [Greenfield Design](integrations/skills/sigil/references/greenfield-design.md)          |
| Writing Sigil, need the syntax   | [Language Guide](spec/sigil-language.md)                                        |
| Tuning `.sigil/config.json`      | [Config Reference](spec/sigil-config.md)                                                |
| Upgrading an existing workspace  | [Compatibility](COMPATIBILITY.md), then the `spec/migrating-to-*.md` for your target    |
| Changing Sigil itself            | [CONTRIBUTING.md](CONTRIBUTING.md)                                                      |

The brownfield and greenfield procedures are written for a coding agent running
the bundled skill. They are readable on their own, but you get them applied for
you by installing the skill above.

## Setup for development

For Contributors using the codebase directly, use the following.

1. Clone the repo:

```sh
git clone https://github.com/qoherent/sigil.git
cd sigil
```

Use `git@github.com:qoherent/sigil.git` instead if you have SSH keys set up for
GitHub.

2. Install [Deno](https://docs.deno.com/runtime/getting_started/installation/)

   A fresh Deno install adds `~/.deno/bin` to your `PATH` only for new shells.
   If `deno` or `sigil` is not found afterwards, open a new terminal or reload
   your shell:

   ```sh
   exec $SHELL -l
   ```

3. Install the Sigil CLI with deno, changes to code are hot reloaded this way:

```sh
deno task --cwd packages/cli install
sigil --version
```

The installed command runs this clone, so it follows whichever branch is checked
out here. To pin one instead, add a detached worktree and install it under its
own name:

```sh
git worktree add --detach ../sigil-pinned <branch-or-commit>
cd ../sigil-pinned
deno install --global --force --config "$PWD/deno.json" \
  --allow-read --allow-write --allow-run --allow-env=HOME,USERPROFILE \
  --name sigil-pinned packages/cli/src/main.ts
```

## Usage

The `.sigil` files are the durable place where
decisions, assumptions, component boundaries, and behavior are recorded before
implementation.

The intended workflow is:

1. The user writes the minimum useful Sigil, or selects a reviewed pilot when
   adopting Sigil in a brownfield repository.
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

The full workflow is described in
[spec/sigil-workflow.md](spec/sigil-workflow.md).

The Sigil platform architecture is drafted in
[spec/sigil-platform-architecture.md](spec/sigil-platform-architecture.md).

Rejected historical architecture exploration for generated Receipts, evidence,
and anchors is recorded in
[ADR-011](spec/decisions/adr-011-generated-rationale-evidence-and-review-records.md),
but those capabilities are outside the active 0.8 workspace.

Project-specific terms, statuses, reserved names, and abbreviations are defined
in the [Sigil glossary](spec/glossary.md).

Open design questions are tracked in
[spec/open-questions.md](spec/open-questions.md).

## Repository Layout

Legacy skill sources remain retained but excluded from active discovery.
The root [.sigil/config.json](./.sigil/config.json) defines this repository as a
Sigil 0.8.0 workspace and excludes the independent example projects. The root
[_module.sigil](./_module.sigil) is an ordinary source containing the
high-level project summary for this configured boundary.

- `spec/` contains language, workflow, platform architecture, and open-question
  documents.
- `examples/` contains independently configured Sigil projects used as
  design-pressure fixtures.
- `packages/` contains the implemented `sigil-core`, `sigil-compiler`,
  standalone Claude, OpenCode, and Pi compiler adapters, `sigil-cli`, and
  initial `sigil-lsp`.
- `integrations/` contains host adapters such as coding-agent skills, the
  initial VS Code extension, and future editor integrations.

## Examples

`Promise` in [examples/promise/promise.sigil](examples/promise/promise.sigil)
shows how Sigil can describe a programming abstraction with an API, lifecycle
states, and transition logic.

Its [.sigil/config.json](examples/promise/.sigil/config.json) makes it an
independent workspace named `promise`.

`Slotted` in [examples/slotted/_module.sigil](examples/slotted/_module.sigil) is
an example room booking product used to test Sigil against product and module
modeling.

Its [.sigil/config.json](examples/slotted/.sigil/config.json) makes it an
independent workspace named `slotted`; imports beginning with `@` resolve from
that directory.

`Auth` and `User` in [examples/slotted/auth.sigil](examples/slotted/auth.sigil)
show a smaller module-level specification inside the Slotted example.

`UserProfile` in
[examples/slotted/user-profile.sigil](examples/slotted/user-profile.sigil) shows
an imported component with a TypeScript-shaped public interface.

`BookingCalendarView` in
[examples/slotted/booking-calendar-view.sigil](examples/slotted/booking-calendar-view.sigil)
shows a UI component whose interface combines natural language, an ASCII
wireframe, and a repository image reference.

`Slotted` is only an example project used to test the language. It is not the
purpose of this repository.

## Coding-Agent Skills

The bundle provides three independent Sigil 0.8 design entry points:

| Skill | Use it to |
| --- | --- |
| [sigil-understand](integrations/skills/sigil-understand/SKILL.md) | Explain intent, contract roles, Tag ownership, and relevant context. |
| [sigil-evaluate](integrations/skills/sigil-evaluate/SKILL.md) | Review design read-only for consequential problems and useful simplification. |
| [sigil-write](integrations/skills/sigil-write/SKILL.md) | Write compact contracts and apply supported corrections through independent delegated review. |

All three start at artifact version 0.1.0 and share the bundled 0.8.0 normative
reference and grammar. Install the complete catalog with `sigil skill install`
(or `--project`); writer and evaluator require their sibling reference files.
Writing and evaluation use a verified compatible CLI when available. The writer
runs `check`, formats only authored files, and rechecks before capturing inputs
for independent review. The evaluator runs `check` and `fmt --check` read-only.
Without compatible tooling they continue from source and explicitly report
mechanical validation as unavailable. The writer preserves unresolved human
choices, rechecks review freshness, and provides an independently unreviewed draft
and portable handoff if delegation cannot complete. Static package checks and
[observed agent evaluations](docs/skill-evaluation/sigil-0.8-foundation.md) provide
separate evidence. Mechanical checks do not establish design coherence or code
conformance. The [mechanical fixtures](integrations/skills/sigil-write/evals/mechanical-validation-fixture.md)
cover CLI-enabled behavior separately from the earlier offline observations.

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

### Legacy Sigil 0.7 native workflow

The existing `sigil` skill remains at its own artifact version, with its existing
compiler compatibility metadata. Its 0.7 workflow lives in
[integrations/skills/sigil/SKILL.md](integrations/skills/sigil/SKILL.md), with
host adapters supplied separately. Its frozen compiler requirements are incompatible
with the current 0.8 tools; `sigil skill list` reports that explicitly.

The skill teaches coding-agent hosts to:

- bootstrap and validate the configured workspace before interpreting `.sigil`
  files;
- preserve and initialize repositories that contain Sigil sources without a
  config before selecting a semantic workflow;
- follow Sigil imports;
- identify public component contracts and matching expands;
- detect missing, conflicting, or vague information;
- assess semantic readiness, modularity, applicable standards, and common
  implementation pitfalls;
- introduce Sigil incrementally into brownfield codebases through a
  change-frontier pilot;
- derive provisional boundary pictures from documentation, dependency
  definitions, executable configuration, and entrypoints, then confirm goals and
  interfaces before proposing ordinary summaries at the workspace root and
  declared members;
- preserve material boundary-wide runtime modes, flows, binding architecture
  decisions, and observable outcomes in minimal expands while excluding
  incidental and task-specific details;
- record durable rationale for material selected choices in optional `decisions`
  sections while keeping binding outcomes in `constraints`;
- propose brownfield and externally informed semantic units before editing;
- stop at the review gate after semantic changes;
- colocate approved Sigil with the implementation it explains;
- use approved Sigil as implementation context.

The compact `SKILL.md` dispatches into progressive references. The
[workspace bootstrap](integrations/skills/sigil/references/workspace-bootstrap.md)
reference defines root discovery, configuration-state handling, initialization,
and compatibility validation. The
[authoring conventions](integrations/skills/sigil/references/authoring-conventions.md)
reference owns section discipline, concept identifiers, decision rationale, and
colocation. The reference file at
[integrations/skills/sigil/references/sigil-format.md](integrations/skills/sigil/references/sigil-format.md)
is a concise agent-facing guide. The
[standards review](integrations/skills/sigil/references/standards-review.md) and
[brownfield adoption](integrations/skills/sigil/references/brownfield-adoption.md)
references define the corresponding host-side workflows. The canonical language
specification is [spec/sigil-reference.md](spec/sigil-reference.md), with the
[EBNF grammar](spec/sigil.ebnf). The [language guide](spec/sigil-language.md)
provides authoring explanations and examples.

## Current Status

The core, CLI, LSP and VS Code integration implement Sigil language 0.8.0.
Native structural transport and reports use schema 2. These are local,
pre-production changes; this migration does not publish a release. Artifact
versions and legacy requirements are listed in [COMPATIBILITY.md](COMPATIBILITY.md).
See the [migration guide](spec/migrating-to-0.8.md),
[configuration](spec/sigil-config.md), and
[verification evidence](docs/verification/sigil-080/).

The shared core owns strict source capture, component-owned Tags, explicit
provider imports, exact references, protected links/payloads, staged recovery,
workspace boundaries, glossary and ownership projections, graph/context retrieval,
formatting and source-faithful Design export. The CLI and bundled language server
use those shared results. VS Code provides navigation, diagnostics, highlighting,
whole-document preview and direct native compilation with verified source ranges.

Independent interpretation remains external to deterministic tooling. Native
states describe the supplied projections and compiler laws; successful language
checks, fixed-Turtle protocol tests and design reviews make different claims.
The retained 0.7 skill is historical and excluded from active workspace discovery.
The 0.8 understanding, writing and evaluation skills provide the current design
workflow without requiring compiler-based proof.

Editor integrations other than VS Code, stricter body semantics, and additional
project configuration remain deferred.

Receipts and anchors are rejected historical design explorations rather than
active or deferred Sigil components.
[ADR-011](spec/decisions/adr-011-generated-rationale-evidence-and-review-records.md)
records the rejected proposal for deterministic shared packages, attributed
host-assisted interpretation, a `sigil-indexer`, and generated review records
without adding inline Sigil syntax. Its indexer and anchor contracts are not
part of the active 0.8 workspace.
