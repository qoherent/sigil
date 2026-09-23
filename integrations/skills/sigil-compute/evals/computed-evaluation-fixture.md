# Computed evaluation fixture

## Runner setup

Copy the complete skill bundle to a temporary catalog outside the checkout:
`sigil-compute` with its required `sigil-understand` and `sigil-egglog`, plus
the installed `sigil-evaluate` and `sigil-write` so routing has real
destinations. Include every reference and metadata file; only the copied
`sigil-compute` bundle is the skill under test.

Each scenario and each variant runs a fresh host agent given only its request,
the installed catalog, a freshly materialized workspace, and the actual tool
availability: a `sigil` CLI for `export design` and a `sigil-claims` binary.
Record tool versions; an unavailable tool is a recorded limitation, never a
state. The interpreter child the host delegates must itself be a fresh agent
receiving only the prepared handoff — never the host's conversation, never the
observer notes. Materialize each scenario's fenced inputs under a fresh
temporary workspace at their named paths, preserving bytes and relative
layout; if the export command requires workspace configuration, create it with
the tool's own init command and record that the runner added it. Keep this
fixture's observer notes out of every tested agent's inputs.

Record the skill and reference hashes, workspace input hashes, host and child
identities (model when exposed), actual requests and responses, every tool
command with its exit code, and the run directory's contents: the captured
export, the seeded store, the preparation directory, the child's captured
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
    Preserve *value* and *result*.
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
    Preserve *value* and *result*.
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
  logic {
    Compute the *audit* digest and store it for later inspection.
    Then return the finished *report* to the caller.
  }
  constraints {
    Preserve every accepted *audit* digest.
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
    The gate does not provide a *token*.
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
    Preserve *value* and *result*.
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
    Use *value* and *result*.
  }
}
```

## Scenario 4: the closure is tool-owned

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
    Preserve *value* and *result*.
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
    Use *value* and *result*.
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
    Preserve *value* and *result*.
  }
}
```

## Scenario 6: a live edit stays bound to the captured snapshot

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
    Preserve *value* and *result*.
  }
}
```

### Host events (observer only)

After the host captures the structural export and before ingest completes,
replace the constraints sentence in `base.sigil` with `The base does not
provide a *value*.` — a contradiction that exists only in the live bytes. If
the host cannot be paused mid-loop, apply the edit as soon as the captured
export appears and retain timestamps showing the edit preceded ingest.

## Acceptance notes for the observer

- **1a:** The response is advisory review of the design's meaning and
  consistency. No `sigil-claims` command runs, the export command is never
  used to start a claims loop, and no Coherent, Loose, or Disjoint state or
  findings report is presented as a computed verdict.
- **1b:** The revision completes and its delegated review goes to a fresh
  advisory evaluator. No claims command runs and no computed state appears,
  because the request never asked for one.
- **2a:** The trace shows one export, one prepare into a fresh empty
  preparation directory, one fresh child, and one ingest exiting 0 with a
  structured result whose state is `coherent`. The handback presents Coherent,
  the report's findings (expected to be none), the selected source
  `base.sigil`, and the captured snapshot identity. The workspace store is
  untouched by the run.
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
  export — and stops. It does not choose `base.sigil` or `consumer.sigil` on
  its own, and no state is named.
- **4:** The captured binding's closure names both `base.sigil` and
  `consumer.sigil`, and the child saw the closure as context. The result's
  source and the handback attribute the state to `consumer.sigil` alone: no
  workspace-wide verdict is presented, and the provider is not claimed to have
  been evaluated.
- **5a:** Prepare's result reports every unit reused and zero Facets presented.
  Exactly one fresh child is created — record its identity — and its captured
  artifact is empty with an explicit completion statement. Ingest exits 0 with
  a structured result whose state is expected to match the seeding run's, and
  the handback names the state and the snapshot identity. The workspace store
  is byte-identical before and after, and every run artifact stays under the
  run's private root.
- **5b:** No state is named. The host reports the missing or interrupted
  interpretation as the break, does not retry the child, and no captured
  artifact or ingest report exists for the run.
- **6:** The trace shows exactly one export, one prepare, one child, and one
  ingest: no re-export and no retry. The report's export digest matches the
  captured binding's, and the handback states that the result describes the
  captured snapshot — it does not claim the edited design's state. The
  observer may re-export the edited workspace and confirm the live bytes no
  longer match the captured export.
