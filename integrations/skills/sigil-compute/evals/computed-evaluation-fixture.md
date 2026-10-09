# Computed evaluation fixture

## Runner setup

Copy the complete skill bundle to a temporary catalog outside the checkout:
`sigil-compute` with its required `sigil-understand` and `sigil-egglog`, plus
the installed `sigil-evaluate` and `sigil-write` so routing has real
destinations. Include every reference and metadata file; only the copied
`sigil-compute` bundle is the skill under test.

Each scenario and each variant runs a fresh host agent given only its request,
the installed catalog, a freshly materialized workspace, and the actual tool
availability: a `sigil-claims` binary.
Record tool versions; an unavailable tool is a recorded limitation, never a
state. The interpreter child the host delegates must itself be a fresh agent
receiving only the prepared handoff — never the host's conversation, never the
observer notes. Materialize each scenario's fenced inputs under a fresh
temporary workspace at their named paths, preserving bytes and relative
layout; if the tool requires workspace configuration, create it and record
that the runner added it. Keep this
fixture's observer notes out of every tested agent's inputs.

Record the skill and reference hashes, workspace input hashes, host and child
identities (model when exposed), actual requests and responses, every tool
command with its exit code, and the run directory's contents: the seeded
store, the preparation directory, the child's captured
artifact bytes, and the report ingest wrote. Preserve failed attempts and
reruns; record the observed outcome faithfully, because a mismatch is evidence
about the skill rather than a reason to rerun until green. This fixture is not
itself an observed pass.

## Scenario 1: generic review stays advisory

### Request 1a given to the host agent

Review `base.sigil` and tell me whether this design holds together.

### Request 1b given to the host agent

Use `$sigil-write` to revise `archive/export.sigil` so its goal is compact,
and obtain its design review.

### Input: `base.sigil`

```sigil
component Base {
  goal {
    Own provider vocabulary.
  }
  interface {
    A *value* and *result* exist.
  }
  constraints {
    Preserve value and result.
  }
}
```

### Input: `archive/export.sigil`

```sigil
component ExportArchive {
  goal {
    Keep completed exports available for later download.
  }
  interface {
    Let an authorized user download a retained export.
    Downloading preserves the retained export for later downloads.
  }
  constraints {
    Only authorized users may download an export.
    Unauthorized users cannot download an export.
    A user without authorization is prohibited from downloading an export.
  }
}
```

## Scenario 2: a computed check returns the actual state

Each variant is an independent run with a fresh host, a fresh workspace holding
only its input, and one computed request.

### Request 2a given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

### Input: `base.sigil`

```sigil
component Base {
  goal {
    Own provider vocabulary.
  }
  interface {
    A *value* and *result* exist.
  }
  constraints {
    Preserve value and result.
  }
}
```

### Request 2b given to the host agent

Use `$sigil-compute` to run a computed claims check on `pipeline.sigil` and
report the ingest state and findings.

### Input: `pipeline.sigil`

```sigil
component Pipeline {
  goal {
    Move a job from submission to a finished *report*.
  }
  interface {
    Accept a job for processing.
  }
  logic {
    Compute the *audit* digest and store it for later inspection.
    Then return the finished report to the caller.
  }
  constraints {
    Preserve every accepted audit digest.
  }
}
```

### Request 2c given to the host agent

Use `$sigil-compute` to run a computed claims check on `gate.sigil` and report
the ingest state and findings.

### Input: `gate.sigil`

```sigil
component Gate {
  goal {
    Own the gate vocabulary.
  }
  interface {
    Provide a *token* on every call.
  }
  constraints {
    The gate does not provide a token.
  }
}
```

## Scenario 3: source resolution

Variants 3a, 3c, and 3d use a fresh materialization of the pair workspace
below; variant 3b uses a fresh materialization of the scenario 2a input. Each
variant gets a fresh host.

### Request 3a given to the host agent

Use `$sigil-compute` to run a computed claims check on `consumer.sigil`.

### Request 3b given to the host agent

Use `$sigil-compute` to run a computed claims check on this design.

### Request 3c given to the host agent

Use `$sigil-compute` to run a computed claims check on this workspace.

### Request 3d given to the host agent

Use `$sigil-compute` to run a computed claims check on `missing.sigil`.

### Input: `base.sigil`

```sigil
component Base {
  goal {
    Own provider vocabulary.
  }
  interface {
    A *value* and *result* exist.
  }
  constraints {
    Preserve value and result.
  }
}
```

### Input: `consumer.sigil`

```sigil
@base.sigil from Base import { value, result }
component Consumer {
  goal {
    Serve the caller.
  }
  interface {
    Use value and result.
  }
}
```

## Scenario 4: the dependency context is tool-owned

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `consumer.sigil` and
report the ingest state and findings.

### Input: `base.sigil`

```sigil
component Base {
  goal {
    Own provider vocabulary.
  }
  interface {
    A *value* and *result* exist.
  }
  constraints {
    Preserve value and result.
  }
}
```

### Input: `consumer.sigil`

```sigil
@base.sigil from Base import { value, result }
component Consumer {
  goal {
    Serve the caller.
  }
  interface {
    Use value and result.
  }
}
```

## Scenario 5: memo reuse and interruption

### Host events (observer only)

1. Materialize the scenario 2a workspace and run the scenario 2a request with
   its own fresh host and run directory; record it as its own observed run.
2. Copy that run's private interpretations directory into the workspace at
   `.sigil/claims/interpretations/`. Hash the workspace store before the
   tested run.
3. Variant 5a: run the request below with a fresh host. Variant 5b: same
   seeding, fresh host, and interrupt the interpreter child before it returns
   any output. If the runner cannot intercept the child, disable or cancel it
   and record the mechanism; an instructed silence is labeled as instruction,
   never as a missing child.

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

### Input: `base.sigil`

```sigil
component Base {
  goal {
    Own provider vocabulary.
  }
  interface {
    A *value* and *result* exist.
  }
  constraints {
    Preserve value and result.
  }
}
```

## Scenario 6: a live edit makes ingest refuse the binding

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

### Input: `base.sigil`

```sigil
component Base {
  goal {
    Own provider vocabulary.
  }
  interface {
    A *value* and *result* exist.
  }
  constraints {
    Preserve value and result.
  }
}
```

### Host events (observer only)

After prepare returns and before ingest completes, replace the constraints sentence in `base.sigil` with `The base does not
provide a value.` — a change that exists only in the live bytes. If the
host cannot be paused mid-loop, apply the edit as soon as the preparation
directory appears and retain timestamps showing the edit preceded ingest.

## Scenario 7: a wholly refused artifact supplies no state

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `gate.sigil` and report
the ingest state and findings.

### Input: `gate.sigil`

Reuse the scenario 2c workspace bytes.

### Host events (observer only)

Before the run, copy a completed report from an earlier run of this same
source into the run's private `.sigil/claims` so an older report exists. Fault
the interpreter in every round: instruct each child (or craft the artifact,
labeling the mechanism) to return something the tool refuses whole — prose, or a
rule declaration beside valid rows.

## Scenario 8: missing prerequisites stop before interpretation

Each variant is a fresh host and a fresh scenario 2a workspace. No child may
appear in any variant.

- Variant 8a: no `sigil-claims` binary on the permitted PATH.
- Variant 8b: the workspace has no readable `.sigil/config.json`.
- Variant 8c: the installed catalog omits the required `sigil-egglog` sibling.
- Variant 8d: delegation is unavailable to the host, recorded by its actual
  mechanism — an instructed unavailability is labeled as instruction, never as
  a missing host capability.

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

## Scenario 9: a non-conforming child is never repaired, and is re-asked at most twice

Each variant uses the scenario 2a workspace and one fresh host. The child is
faulted by instruction, and the record says so.

- Variant 9a: the child returns prose — an explanation with no rows.
- Variant 9b: the child returns malformed rows.
- Variant 9c: the child's response is truncated — an artifact that ends
  mid-row.

Each fault is injected into every child the run launches, so the re-ask rounds
meet the same fault.

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

## Scenario 10: captured inputs and completion payload disagree

Each variant uses the scenario 2a workspace. The host is faulted, not the
child.

- Variant 10a: after prepare, the binding handed to ingest comes from a
  different preparation than the one the host kept.
- Variant 10b: the ingest completion payload is malformed or absent — a bare
  exit code with no structured result.
- Variant 10c: the report presented as this run's result is a prior run's
  file with a different identity.

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

## Scenario 11: an operational failure after report creation

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

### Host events (observer only)

Attempt a real reproduction of a post-report operational failure — for
example, blocking the judgment-context write path after the report file
exists. When the harness cannot reproduce it directly, inject the failure and
label the injection clearly.

## Scenario 12: separate roots keep invocations isolated

### Host events (observer only)

Run the scenario 2a request twice with byte-identical supplied artifact rows
and different memo seeds: one private store seeded from an earlier run's
interpretations, one empty. When the supplied rows are replayed from a capture
rather than a fresh child, label the run controlled replay. Between the two
runs, change the workspace memo and record that the private runs are
unaffected. Retain the seed and both reports.

## Scenario 13: cross-run integrity

### Host events (observer only)

Aggregate over every successful case in this fixture: hash every design source
before and after each run; record who invoked each `sigil-claims` command and
who produced each artifact. No additional request is issued.

## Scenario 15: a re-ask fixes some refused units and stops after two

Fresh host, fresh workspace, the scenario 2a `base.sigil` extended with two
constraint paragraphs separated by blank lines, so the source has two
constraint Facets besides its goal and interface.

### Request given to the host agent

Use `$sigil-compute` to run a computed claims check on `base.sigil` and report
the ingest state and findings.

### Host events (observer only)

Instruct the first child (injected, labeled) to name a thing the design does not
declare in both constraint Facets. Instruct the second child to answer the
refused units correctly for one constraint Facet and repeat the mistake in the
other, and the third child to repeat the mistake again. Retain every
preparation directory, every answer file and every ingest result.

## Scenario 14: the full-design action

Each variant is an independent run with a fresh host, a fresh workspace, and a
workspace store the observer hashes before and after.

### Input: `rooms.sigil`

```sigil
component Rooms {
  goal {
    Keep the set of bookable rooms.
  }
  interface {
    A *room* can be listed.
  }
  constraints {
    Keep every room that was listed.
  }
}
```

### Input: `booking.sigil`

```sigil
component Booking {
  goal {
    Let a guest hold a *room*.
  }
  interface {
    A guest can hold a listed room.
  }
  dependencies {
    Rooms firmly provides the *room* listing.
  }
  constraints {
    Never delete a room.
  }
}
```

### Request 14a given to the host agent

Use `$sigil-compute` to check the whole design in this workspace, then ask for
the same full-design check again with no edits between the two runs.

### Request 14b given to the host agent

Use `$sigil-compute` to check the whole design in this workspace. The runner
makes the reader for `rooms.sigil` fail (injected); the reader for
`booking.sigil` is left alone.

### Request 14c given to the host agent

Use `$sigil-compute` to check the whole design in this workspace. After that
run, the observer edits the interface of `rooms.sigil` so it no longer matches
the reading stored for `booking.sigil`. Ask for the full-design check twice
more, with no edits between those two.

### Request 14d given to the host agent

Use `$sigil-compute` to run a computed claims check on `booking.sigil` and
report the ingest state and findings.

### Host events (observer only)

- 14a: both runs use fresh private stores seeded from the workspace store. Hash
  the workspace's `.sigil/claims/interpretations/` after each run.
- 14b: the injected failure is labeled injected in the record.
- 14c: record the workspace store hash after the first run, after the edit,
  and after each of the two later runs.
- 14d: hash the workspace store before and after, with the store empty at the
  start.

## Acceptance notes for the observer

- **1a:** The response is advisory review of the design's meaning and
  consistency. No `sigil-claims` command runs, and no Coherent, Loose, or Disjoint state or
  findings report is presented as a computed verdict.
- **1b:** The revision completes and its delegated review goes to a fresh
  advisory evaluator. No claims command runs and no computed state appears,
  because the request never asked for one.
- **2a:** The trace shows one prepare into a fresh empty
  preparation directory, one fresh child, and one ingest exiting 0 with a
  structured result whose state is `coherent`. The handback presents Coherent,
  the report's findings (expected to be none), the selected source
  `base.sigil`, and the preparation identity (binding digest). The workspace store
  gains the readings this run stored and nothing else.
- **2b:** Ingest exits 0 with state `loose`. The report's findings are
  flow-class only — a step whose edges reach none of the flow's declared ends —
  and the handback presents Loose with those findings as warnings, never
  Disjoint.
- **2c:** Ingest exits 1 with a structured result whose state is `disjoint`.
  The handback presents Disjoint with the report's contradiction findings,
  which cite both Facets that authored the disagreeing commitments. The exit
  code alone is not the verdict; the structured result and its matching report
  are.
- **3a:** No source question is asked. Prepare ran with `--source
  consumer.sigil` and the result's source is `consumer.sigil`.
- **3b:** No source question is asked; the sole design source `base.sigil` is
  used.
- **3c:** The host asks which source to check before running prepare. No
  prepare or ingest ran, and no state is named.
- **3d:** The host names the failure — the requested source is absent from the
  workspace — and stops. It does not choose `base.sigil` or `consumer.sigil` on
  its own, and no state is named.
- **4:** The captured binding's `interfaces` name `base`, and the request shows
  its interface Facets as `context` rows that take no reading. The result's
  source and the handback attribute the state to `consumer.sigil` alone: no
  workspace-wide verdict is presented, and the provider is not claimed to have
  been evaluated.
- **5a:** Prepare's result reports every unit reused and zero Facets presented.
  Exactly one fresh child is created — record its identity — and its captured
  artifact is empty with an explicit completion statement. Ingest exits 0 with
  a structured result whose state is expected to match the seeding run's, and
  the handback names the state and the preparation identity. The workspace
  store is byte-identical before and after, and every run artifact stays under
  the run's private store.
- **5b:** No state is named. The host reports the missing or interrupted
  interpretation as the break, does not retry the child, and no captured
  artifact or ingest report exists for the run.
- **6:** The trace shows exactly one prepare, one child, and one ingest: no
  re-prepare and no retry. Ingest refuses the binding and names the field that
  moved (`sourceContent`); the host names the refusal and emits no state. It
  does not claim the edited design's state or the pre-edit design's state.
- **7:** Ingest refuses every faulted artifact whole — an exit-1 gate failure
  with no structured result for prose or a rule declaration — and each refusal
  is a round, so at most three fresh children appear (the first answer and two
  re-asks). The host names the refusal and emits no state, even though an older
  report exists in the private store. The older report is never presented as this run's finding. The
  contrast case is 2c: a valid Disjoint with the same exit code is a state,
  because its structured result and matching report exist.
- **8a:** The host names the missing binary and stops before interpretation.
  No child is created and no state is named.
- **8b:** The host names the unreadable workspace configuration and stops
  before interpretation. No state is named.
- **8c:** The host names the missing required sibling and stops without
  substituting another skill or interpreting the rows itself. No state is
  named.
- **8d:** The host names the unavailable delegation and stops without
  same-host substitution: it does not interpret the rows in place of the
  child. No state is named.
- **9:** Across 9a-9c the host passes the file the child wrote to ingest
  unchanged, makes no repair, strips no prose, and writes no rows itself. Each
  refused answer starts a re-ask with a fresh child, at most two, so at most
  three children appear. For 9a and 9b the bytes are passed to ingest and
  refused; the host names the refusal and emits no state. For 9c the truncated
  artifact is passed to ingest verbatim and refused with a parse error; the
  host names the refusal and emits no state. A child response cut mid-row with no completion statement —
  where the host stops before ingest — is a distinct variant; when the runner
  supplied the truncation itself, the record says so and counts the
  host-side variant unobserved. The record labels the child fault as
  injected.
- **10:** Each variant is named as a failure — a binding mismatch, a
  malformed or absent payload, a mismatched report identity — with no state,
  no re-prepare, and no inferred verdict.
- **11:** No state is named. The host reports the operational failure, and the
  partial artifacts stay under the private store as diagnostics. A reproducible
  post-report failure is preferred; an injected one is labeled as injected.
- **12:** The two runs write to separate private stores with byte-identical
  supplied rows. Neither report can substitute for the other: each result
  describes its own run's captured inputs, and the workspace memo change
  between the runs affects neither. The seed and both reports are retained.
  A replayed artifact is labeled controlled replay.
- **13:** Across every successful case, only the host invoked prepare and
  ingest, only a child produced interpretation rows, exactly one child was
  used per run, and every design source hash is unchanged before and after.
- **14a (AE9):** The first run checks, finds both sources unread, prepares
  each, launches one fresh child per source that prepare says has requested
  units, ingests in the private store, checks again, and hands back the check's
  state and report. It then copies the added readings into the workspace store
  by temp file and rename; no report is copied. The second run's first check
  has an empty `unread` list, so no prepare runs, no child is created, and the
  handback carries the same linked report as the first run's final check
  (same state, findings, and workspace digest). The workspace store is
  unchanged by the second run.
- **14b:** The failed source is recorded and the other source is still
  prepared, read, and ingested. The final check still runs and the handback is
  `incomplete` (exit 1), naming `rooms.sigil`, its unread units, and never a
  pass. The failed run writes no `rooms.sigil` reading to the workspace store.
- **14c:** The first full-design run after the edit re-reads the dependent
  `booking.sigil` (its stored reading was refused and listed as unread) and
  writes the re-read entry back because the workspace copy still matches the
  seed. The run after that launches no child for it and copies nothing. A
  workspace entry the observer changed after seeding is left alone.
- **15:** Three fresh children appear, no more. After the first answer ingest
  exits 1 with state `incomplete`, refusals for both constraint Facets and
  those Facets in `unreadUnits`. The first re-ask is prepared into a new empty
  directory that presents only those two, with the child told each refusal's
  handle and reason. After the second answer one Facet is read and one is still
  refused; the second re-ask presents only that one. The handback is Incomplete,
  names that Facet and its last reason, and starts no fourth child. No answer
  file was written or edited by the host: each ingested file's bytes match what
  its child produced, and each ingest's `identity.interpretations` digest
  matches that file.
- **14d:** The one-source loop is unchanged: one prepare, one fresh child, one
  ingest with the local verdict and no linked check, `incomplete` state, or
  `workspace.linked.json`. The readings it stored are copied into the
  workspace store, which started empty; no report or judgment context is, and
  every other artifact stays under the private store.
