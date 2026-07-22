# ADR-012: Descriptive Sigil Filenames And The Root Module Boundary

**Status:** Superseded by ADR-013

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-20

> Historical note: Sigil 0.2.0 adopted the directory-index interpretation in
> ADR-013 and removed the special project-root contract described here.

## 1. Context

Sigil needs to serve two related but different navigation needs:

1. A project needs one recognizable, importable summary of its purpose, public
   surface, and project-wide decisions.
2. Internal components and implementation modules need colocated Sigil files
   whose names explain what they describe.

There are two competing interpretations of `#module.sigil`:

- treat it like `index.js` or `index.ts`, so it may appear in every directory as
  that directory's default Sigil entry point;
- treat it as `RootSigil`, so it may appear only at the workspace root or at a
  project root explicitly declared by `workspace.members`.

The first interpretation provides familiar directory-entry behavior. The
second gives `#module.sigil` a strong architectural meaning and lets tools
distinguish configured project boundaries from incidental source directories.

The current Sigil 0.1 language, core, CLI, documentation, and skill implement
the second interpretation. Ordinary internal Sigil files use descriptive
filenames and must be imported by explicit filename.

This ADR records that behavior as a proposed deliberate design decision so it
can be reviewed against the directory-index alternatives rather than retained
only as an implementation fact.

## 2. Decision Drivers

The decision should:

- make project boundaries visible and mechanically unambiguous;
- keep Sigil files understandable in search results, editor tabs, diffs, links,
  diagnostics, and agent context;
- preserve colocation between a contract or expand and its implementation;
- avoid turning arbitrary directory structure into architecture authority;
- keep import resolution deterministic and easy to explain;
- support monorepos without treating every package-like directory as a Sigil
  project;
- avoid adding re-export, shadowing, or implicit-discovery semantics merely to
  support a filename convention;
- remain usable when files are viewed outside their containing directory;
- minimize migration and compatibility cost for the implemented 0.1 contract.

## 3. Proposed Decision

Reserve `#module.sigil` for `RootSigil` project summaries.

`#module.sigil` is permitted only at:

- the workspace root containing `.sigil/config.json`; or
- a workspace member root explicitly declared by `workspace.members`.

Every other Sigil source uses a descriptive filename that communicates the
owned component, behavior, or implementation concern, such as:

- `auth.sigil`;
- `booking-calendar-view.sigil`;
- `workspace.sigil`;
- `installer.sigil`;
- `payment-retry-policy.sigil`.

Do not give `index.sigil`, `module.sigil`, or any other internal filename
special resolution behavior in the initial contract. Such a file remains legal
only as an ordinary explicitly imported Sigil source, and its name should still
be judged by the descriptive-filename rule.

Directory imports remain project imports:

```sigil
@packages/core import { SigilCore }
```

They resolve only to an eligible project-root `#module.sigil`.

Internal imports always name the source file:

```sigil
@packages/core/src/workspace.sigil import { SigilWorkspaceLoader }
```

Directory structure, package manifests, and conventional filenames do not
declare Sigil project roots. `.sigil/config.json` and `workspace.members` remain
the sole authority.

## 4. Definitions

### Workspace

The directory governed by one `.sigil/config.json`. The configuration defines
the workspace identity, version, members, and source-discovery rules.

### Project Root

The workspace root or a directory explicitly declared in
`workspace.members`. A project root is eligible to contain `#module.sigil`.

### RootSigil

The project summary stored in an eligible `#module.sigil`. It describes the
project's purpose, public interaction surfaces, and project-wide operational
decisions. It does not define the workspace boundary.

### Internal Sigil Source

Any Sigil file that describes a component, view, state machine, internal API,
implementation-specific expand, or other concern below the project boundary.
Its filename is descriptive and imports refer to it explicitly.

## 5. Options Considered

### Option A: `#module.sigil` In Every Directory

Treat `#module.sigil` as the default Sigil entry point for any directory,
similar to `index.js` or `index.ts`.

Example:

```text
project/
├── #module.sigil
└── features/
    └── auth/
        ├── #module.sigil
        ├── session.ts
        └── permissions.ts
```

Possible import:

```sigil
@features/auth import { Auth }
```

Benefits:

- familiar to developers from directory-index ecosystems;
- short imports;
- gives every directory an optional landing page;
- permits moving internal files behind a stable directory import.

Costs and risks:

- the same filename means both project summary and internal directory index;
- tools need configuration context to explain what any `#module.sigil` means;
- search results, tabs, diagnostics, and diffs contain many indistinguishable
  filenames;
- directory organization gains accidental architectural significance;
- moving a folder or introducing a directory index can change public import
  behavior;
- directory indexes encourage barrel-style re-export expectations that Sigil
  does not currently support;
- duplicate names, re-exports, shadowing, and collected-expand visibility need
  additional language rules;
- package manifests and source layout may appear to declare project boundaries
  even though `.sigil/config.json` is intended to be authoritative;
- the option conflicts with implemented 0.1 diagnostics and import resolution.

Expected outcome:

Navigation is concise within a repository, but project identity becomes weaker
and the language must define additional index and export semantics to avoid
ambiguity.

### Option B: Root-Only `#module.sigil` Plus Special `index.sigil`

Keep `#module.sigil` for project roots and introduce `index.sigil` as the
default entry point for ordinary directories.

Example:

```text
project/
├── #module.sigil
└── features/
    └── auth/
        ├── index.sigil
        ├── session.sigil
        └── permissions.sigil
```

Benefits:

- preserves the special meaning of `#module.sigil`;
- gives internal directories a familiar entry-point convention;
- makes project imports and directory imports visually distinguishable on
  disk.

Costs and risks:

- `index.sigil` remains non-descriptive in tabs, search results, diagnostics,
  and links;
- Sigil must define whether an index declares components, re-exports imported
  components, collects expands, or only renders a directory summary;
- implicit directory resolution gains a second target and precedence rule;
- refactoring between a descriptive file and an index changes import behavior;
- barrel semantics may obscure the actual owner and location of a component;
- the language and every resolver, CLI, LSP, editor, and skill need new rules.

Expected outcome:

The project/internal distinction remains visible, but internal navigation gains
new semantics and retains much of the ambiguity associated with generic index
filenames.

### Option C: Root-Only `#module.sigil` And Descriptive Internal Filenames

Keep `#module.sigil` exclusively for configured project roots and require
ordinary Sigil files to use descriptive filenames with explicit imports.

Example:

```text
project/
├── #module.sigil
└── features/
    └── auth/
        ├── auth.sigil
        ├── session.sigil
        └── permissions.sigil
```

Possible imports:

```sigil
@features/auth/auth.sigil import { Auth }
@features/auth/session.sigil import { SessionLifecycle }
```

Benefits:

- `#module.sigil` always communicates a project-level RootSigil;
- internal filenames remain meaningful without directory context;
- imports expose the actual source and owner of a contract;
- search, editor tabs, diagnostics, review links, and agent context are easier
  to interpret;
- no re-export, precedence, shadowing, or implicit internal-index semantics are
  required;
- colocation and ownership remain explicit;
- this matches the implemented and documented Sigil 0.1 behavior.

Costs and risks:

- internal import paths are longer;
- moving a descriptive file requires explicit import updates;
- large directories need naming discipline;
- authors cannot hide internal file organization behind a directory barrel;
- a directory containing several components has no automatic single landing
  page unless one coherent directory-level component deserves its own
  descriptively named contract.

Expected outcome:

Project boundaries and component ownership remain unambiguous at the cost of
slightly more verbose internal imports. Repository-scale navigation favors
clarity over shorthand.

### Option D: Descriptive Filenames Everywhere, Including Project Roots

Remove the special `#module.sigil` filename and give every project summary a
descriptive name such as `sigil.sigil` or `core.sigil`.

Benefits:

- every Sigil filename is meaningful in isolation;
- no filename has contextual semantics;
- search results and editor tabs remain descriptive everywhere.

Costs and risks:

- tools need a new configuration field to identify each project's RootSigil;
- directory imports lose their single conventional target or require manifest
  lookup;
- project renaming may imply file renaming and import churn;
- the option breaks the implemented 0.1 language and migration contract;
- users lose one immediately recognizable project-summary filename.

Expected outcome:

Naming is maximally explicit, but project discovery and imports become more
configuration-heavy and compatibility cost is high.

## 6. Detailed Comparison

| Criterion | A: `#module` everywhere | B: Root `#module` + `index` | C: Root `#module` + descriptive files | D: Descriptive everywhere |
| --- | --- | --- | --- | --- |
| Project boundary clarity | Low | High | High | Depends on configuration |
| Internal filename clarity | Low | Low | High | High |
| Import brevity | High | High | Moderate | Moderate |
| Import target explicitness | Low | Medium | High | High |
| Search and editor usability | Low | Medium-low | High | High |
| Need for re-export rules | Likely | Likely | None | None |
| Refactor encapsulation | High if barrels are stable | High if indexes are stable | Explicit import updates | Explicit import updates |
| Ownership visibility | Low-medium | Medium | High | High |
| Resolver complexity | High | High | Low | Medium |
| Compatibility with Sigil 0.1 | Breaking | Breaking | Current behavior | Breaking |
| Risk of accidental architecture | High | Medium | Low | Low |
| Monorepo project distinction | Weak | Strong | Strong | Configuration-dependent |

## 7. Rationale For The Recommendation

Option C is recommended.

Sigil is intended to preserve rationale and ownership, so a filename that
exposes the owning concern has more value than a short directory import.
Generic index files optimize local path brevity but lose information whenever a
file is viewed outside its directory. That loss is especially visible in agent
context, diagnostics, review comments, editor tabs, rendered graphs, and search
results.

`#module.sigil` remains useful as the one exception because its generic name has
a single strong meaning: this is the configured project's RootSigil. The
workspace configuration makes that meaning deterministic.

The recommendation also avoids introducing re-export behavior before Sigil has
a demonstrated need and an approved contract for aliases, exports, shadowing,
cycles, and collected expansions through barrels.

## 8. Consequences

### Positive

- Humans and tools can identify project summaries by filename and validated
  location.
- Internal files remain understandable when detached from their directory.
- Component ownership and implementation colocation remain visible.
- Import resolution stays small, deterministic, and compatible with 0.1.
- The language does not inherit JavaScript barrel semantics accidentally.
- Workspace membership remains an explicit architectural decision.

### Negative

- Internal imports are more verbose.
- File moves require import updates.
- Authors must choose names carefully when one directory contains several
  related contracts.
- Directory-level overviews are not created automatically.

### Neutral

- A directory may still contain a descriptively named component that summarizes
  one coherent module, such as `auth.sigil`; it is not a magical index and does
  not re-export unrelated contracts.
- A declared workspace member may omit `#module.sigil`; it then has no project
  contract available through a directory import.
- Multiple expands for a component remain collective regardless of their
  descriptive filenames.

## 9. Naming Guidance

Use a filename that describes the stable responsibility owned by the file.

Prefer:

- `auth.sigil` for an authentication component contract;
- `session-lifecycle.sigil` for a session state machine;
- `booking-calendar-view.sigil` for a UI surface;
- `workspace.sigil` for workspace-loading behavior;
- `payment-retry-policy.sigil` for an implementation-specific policy expand.

Avoid generic internal names unless the word is genuinely the domain concept:

- `index.sigil`;
- `module.sigil`;
- `components.sigil`;
- `spec.sigil`;
- `main.sigil`.

Do not mechanically create one Sigil file per source directory. Create a file
when a coherent component contract or durable implementation rationale needs an
owner and location.

## 10. Compatibility And Adoption

Accepting this ADR preserves current Sigil 0.1 behavior. No grammar, resolver,
CLI, LSP, editor, or migration change is required.

Adoption work after acceptance is documentation-oriented:

1. Link this ADR from the language and platform architecture documents.
2. Add the descriptive-filename rationale to authoring guidance.
3. Keep the existing invalid-root-module and invalid-directory-import
   diagnostics.
4. Add focused acceptance cases if current tests do not already demonstrate the
   naming and import boundary clearly.

If Option A, B, or D is selected instead, a separate approved language change
must define exact import resolution, export visibility, conflict behavior,
diagnostics, graph representation, migration, and compatibility consequences
before implementation begins.

## 11. Acceptance Scenarios

- A workspace-root `#module.sigil` is accepted as the root project's RootSigil.
- A declared member-root `#module.sigil` is accepted as that member project's
  RootSigil.
- `features/auth/#module.sigil` is rejected when `features/auth` is not a
  declared workspace member.
- `@packages/core import { SigilCore }` resolves to the declared member's
  `#module.sigil`.
- `@features/auth/auth.sigil import { Auth }` resolves by explicit filename.
- `@features/auth import { Auth }` does not fall back to `auth.sigil`,
  `index.sigil`, or another inferred internal file.
- `features/auth/auth.sigil` may describe the coherent Auth module without
  gaining project-root or re-export authority.
- Moving `auth.sigil` requires affected explicit imports to be updated and
  checked.

## 12. Discussion Questions

Reviewers should decide:

1. Is the distinction between workspace, project root, and internal component
   understandable without relying on JavaScript module conventions?
2. Is explicit ownership worth the additional import verbosity?
3. Is there a demonstrated use case that requires internal barrel or re-export
   semantics, rather than only a desire for shorter imports?
4. If internal barrels are needed later, should they be modeled as a separate
   language feature instead of overloading `#module.sigil`?
5. Should descriptive filenames be guidance only, or should future tooling warn
   about generic internal filenames?

## 13. Approval Outcome

If accepted, the durable outcome is:

> `#module.sigil` identifies a configured project RootSigil. Every ordinary
> Sigil source uses an explicit, descriptive filename, and internal directory
> indexes receive no special language behavior.

Until this ADR is accepted, existing Sigil 0.1 behavior remains unchanged and
the alternatives stay open for discussion. This document does not authorize
implementation or semantic changes by itself.
