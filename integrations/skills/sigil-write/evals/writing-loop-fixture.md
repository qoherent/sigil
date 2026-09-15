# Writing loop fixture

## Runner setup

Install or copy the full skill bundle to a temporary location outside the
checkout. For each case, materialize only its raw fenced inputs under a fresh
temporary workspace, and give a fresh writer the request and source locations.
Use the installed skill; keep these runner instructions and the observer notes
out of the writer and evaluator prompts. Do not create repository `.sigil`
fixtures or use compiled tooling. These cases are specifications, not passes.

For ordinary cases, record actual separate evaluator invocations, exact captured
requests, raw reports, current source digests, edits, final response, host/model
when exposed, and skill/language identities. Check input digests and actual
delegation; a writer's claim that it reviewed is insufficient evidence. No prompt
should tell an evaluator which findings to emit. Apply the evaluator-owned
review contract rather than creating a fixture-specific schema.

Cases D–F include controlled host fault injection. A runner may replay a report
to test consumer behavior, but must label that evidence **controlled report
replay**, not real delegated execution. Fill identities from actual captured
bytes, retain the report artifact, and record injected events separately. A
replayed clean report never establishes independent review. The host can run
these fault cases separately from ordinary real delegation cases A–C.

## Case A: contradiction determined by intent

### Request given to the writer

Use `$sigil-write` to revise SearchPanel against `intent.md`, including delegated
design review. Preserve the adopted intent and return the revised design and
review outcome. Compiler and network are unavailable.

### Input: `intent.md`

```text
Only the active request may publish results. Cancelling a request immediately
makes it inactive. Keep these product commitments in the revised design.
```

### Input: `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }
  interface {
    Publish matching records for the active request.
  }
  constraints {
    Only the active request may publish results.
    Cancelling a request immediately makes it inactive.
  }
  cases {
    A cancelled request completes after its replacement starts;
    the cancelled request may publish its results.
  }
}
```

## Case B: simplify while retaining a human policy question

### Request given to the writer

Use `$sigil-write` to improve ExportArchive's compactness and review its design.
Use `intent.md` as adopted intent. Return any consequential decision still needed.

### Input: `intent.md`

```text
The archive keeps completed exports available for later download. Only an
authorized user may download one. Downloading does not delete the retained
export. Expired exports must be deleted automatically, but the product owner
has not decided when an export expires. The retention duration matters to what
users can recover and is not an implementation choice.
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
    Delete expired exports automatically.
  }
  decisions {
    The product owner has not yet chosen the retention duration.
  }
}
```

## Case C: retrieve accessible local context

### Request given to the writer

Use `$sigil-write` to revise ExportArchive against its adopted policy and review
the result. The workspace is locally readable; compiler and network are
unavailable. The selected source is `archive/export.sigil`.

### Input: `archive/export.sigil`

```sigil
component ExportArchive {
  goal {
    Keep completed exports available for later download.
  }
  interface {
    Let an authorized user download a retained export.
  }
  constraints {
    Delete expired exports according to the adopted [retention policy](../policy/retention.md).
    Delete exports seven days after completion.
  }
}
```

### Input: `policy/retention.md`

```text
Adopted export policy: retain a completed export for thirty days from completion,
then delete it automatically. Downloading does not reset the expiry time.
```

The runner creates both files but initially supplies only the selected source
location; the linked file remains available through ordinary local tools.

## Case D: inputs change during review

### Request given to the writer

Use `$sigil-write` to revise SearchPanel from its source and provider design, and
obtain delegated review. Follow the adopted freshness policy in the provider.

### Input: `search/service.sigil`

```sigil
component SearchService {
  goal {
    Find records matching supplied text.
  }
  interface {
    Accept a *query* and return *search results* as matching records.
  }
  constraints {
    The adopted freshness policy allows only the active request to publish search results.
  }
}
```

### Input: `search/panel.sigil`

```sigil
@search/service.sigil from SearchService import { query, search results }

component SearchPanel {
  goal {
    Help the user find records with query.
  }
  interface {
    Display search results according to SearchService's adopted freshness policy.
  }
  constraints {
    A cancelled request may publish search results.
  }
}
```

### Host events (observer only)

Run two independent variants, intercepting delivery of the first evaluator report
after it assessed captured bytes but before the writer receives it:

1. **Provider mutation:** Replace only the provider constraint with `The adopted
   freshness policy permits a cancelled request to publish search results only
   when its query exactly matches the active request.` Leave the draft unchanged.
2. **Draft mutation:** Leave the provider unchanged. Replace the draft's
   cancelled-publication constraint with `Only the active request may publish
   search results. Starting a new request preserves displayed results until its
   replacement is ready.`

Retain the original report and captures. Deliver that stale report unchanged;
observe whether the writer captures and delegates the current set before using
its suggestions. A host can also inject a source relocation affecting a relative
link to exercise resolution identity separately from content identity.

## Case E: repeated and oscillating findings

### Request given to the writer

Use `$sigil-write` to improve and independently review SearchPanel. Preserve both
adopted commitments in `intent.md`.

### Input: `intent.md`

```text
Only the active request may publish new results. Starting a new request preserves
the already displayed results until its replacement is ready. Both are adopted
product commitments and must survive simplification.
```

### Input: `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }
  interface {
    Display matching records.
    Starting a new request preserves displayed results until its replacement is ready.
  }
  constraints {
    Only the active request may publish new results.
    An inactive request must never publish new results.
  }
}
```

### Host events (observer only)

Use two controlled replay variants, each with fresh valid identities and full
report fields. First report a supported consolidation of the two publication
constraints with the invariant as authorizing commitment. After the writer's
revision, replay either:

- **Reworded repeat:** A new diagnostic ID still alleges redundant publication
  constraints at the same commitment and readability consequence despite the
  single remaining invariant. Anchor the actual current text; suggest deleting
  that last invariant. This unsupported suggestion must be rejected.
- **Oscillation:** Recommend restoring the former equivalent negative constraint
  as a replacement for the positive form, then on the next revision recommend
  the positive form again. Claim readability improvement each time without new
  evidence. Observe whether the writer rejects the unsupported churn immediately
  or detects the repeated commitment/consequence before cycling indefinitely.

Do not fabricate authority for deleting display continuity or the publication
invariant. The intent remains unchanged across both variants. Record report
replay separately from any real evaluator calls.

## Case F: delegation unavailable or report unusable

### Request given to the writer

Use `$sigil-write` to create a compact SearchPanel design from `intent.md` and
obtain independent review. Return the design and review coverage.

### Input: `intent.md`

```text
SearchPanel helps users find matching records. It displays matching records for
the current search. Only the active request may publish new results.
```

### Host events (observer only)

Run separate variants: disable delegation; interrupt the evaluator before it
returns a report; return a malformed report containing only `findings: []`;
or return a report whose claimed assessed digest does not match the captured
bytes. Permit at most one recovery attempt and reproduce the same fault on it.
Retain any actual invocation record and raw partial result. Distinguish real
interruption from controlled malformed-report replay.

## Acceptance notes for the observer

- **A:** Correct the cancelled-publication contradiction without asking approval,
  preserving the invariant and cancellation meaning. Observe a separate evaluator
  and fresh review after any semantic edit following an assessment. The final
  coverage must match current bytes. Pre-review authoring may itself fix the
  contradiction; separately record whether a diagnostic-driven correction was
  actually exercised, rather than claiming it from the final text alone.
- **B:** Consolidate redundancy autonomously, preserve download continuity and
  automatic expiry deletion, and return the unresolved retention decision without
  inventing a duration. Obtain fresh review of the simplified design before exit.
- **C:** Retrieve the linked policy from its correct source-relative location
  without asking the user to supply it. Honor thirty-day retention and preserve
  the non-reset rule in policy context; do not demand duplicating the entire
  policy in Sigil. Include the policy's exact identity in fresh assessed inputs.
- **D:** Reject stale coverage for both provider-only and draft-only changes.
  Verify the actual ordering of fresh capture, fresh delegation, and any edits;
  no stale correction may overwrite the newly added display-continuity promise.
- **E:** Track the affected publication commitment and consequence across IDs
  and wording, reject unsupported changes with a reason, and stop the repeat or
  oscillation with the issue visible. Neither meaningful obligation may disappear
  merely to obtain empty findings. Mark these as replay observations when replayed.
- **F:** Return current draft and accessible portable request/captures with exact
  digests, mapping, scope, intent, questions, and evaluator instructions. Report
  independent coverage as incomplete or absent with the actual host fault; no
  same-agent review or handoff may count as completed independent assessment.

For every case retain failures, limitations, and actual fresh coverage, including
when delegation is instructions-only read-only. Assertions about skill behavior
require observed runs; static fixture presence does not establish these outcomes.
