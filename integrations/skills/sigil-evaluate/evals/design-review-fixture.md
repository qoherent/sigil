# Design evaluation fixture

## Runner setup

Install or copy the complete skill bundle into a temporary location outside the
checkout. Each case runs in a fresh agent context with the evaluator skill, the
case request, and only its raw inputs below. Materialize fenced sources at the
stated paths under a temporary workspace root; do not add them to root source
discovery. Supply explicit root/path mapping and hash the exact input bytes.
Keep this fixture's observer notes out of the agent request.

Use host read-only enforcement when available and record the actual restriction.
Record input/skill revisions, model and host when exposed, raw responses, and
source hashes before/after. A report of no edits is not evidence of unchanged
files without that check. These scenarios are specifications, not observed passes.

## Case A: compact design

### Request given to the agent

Use `$sigil-evaluate` to review SearchPanel's design and provider context. Return
the revision-bound report. Work read-only from the supplied files and installed
language authority; compiler and network are unavailable.

### Input: `search/service.sigil`

```sigil
component SearchService {
  goal {
    Find records matching supplied text.
  }
  interface {
    Accept a *query* as search text and return *search results* as matching records.
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
    Display search results for the current search.
  }
  constraints {
    Only the active request may publish search results.
  }
}
```

## Case B: contradiction with established intent

### Request given to the agent

Use `$sigil-evaluate` to review SearchPanel against the supplied adopted intent.
Return the revision-bound report and make no edits.

### Input: `intent.md`

```text
Adopted product intent: only the active request may publish results. Cancelling
a request immediately makes it inactive. Preserve this invariant when revising
the draft.
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

## Case C: final-state ownership conflict

### Request given to the agent

Use `$sigil-evaluate` to review the selected components' ownership of the account
status. The file describes one account-status store. Return the revision-bound
report and leave all files unchanged.

### Input: `account/owners.sigil`

```sigil
component AccountService {
  goal {
    Own account-status changes.
  }
  interface {
    Set the account's status in the shared account-status store.
  }
  constraints {
    AccountService is the sole final authority for the stored account status.
  }
}

component AccountConsole {
  goal {
    Let operators manage account status.
  }
  interface {
    Set the same account's status in the shared account-status store.
  }
  constraints {
    AccountConsole is the sole final authority for the stored account status.
  }
}
```

## Case D: repetition with an independent promise

### Request given to the agent

Use `$sigil-evaluate` to review SearchPanel, including opportunities to simplify
its design. Return the revision-bound report read-only.

### Input: `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }
  interface {
    Display matching records.
    Starting a new request preserves the already displayed results until its replacement is ready.
  }
  constraints {
    Only the active request may publish new results.
    An inactive request must never publish new results.
    A response from a request that is no longer active cannot publish new results.
  }
}
```

## Case E: missing adopted policy

### Request given to the agent

Use `$sigil-evaluate` to assess ExportArchive's retention commitments at the
requested scope, including its adopted linked policy. Return the revision-bound
report read-only. The supplied workspace is all available local context and
network access is unavailable.

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
  }
}
```

The runner does not create `policy/retention.md`.

## Acceptance notes for the observer

All cases must identify actual assessed inputs, coverage, and limitations, and
must leave source files unchanged. They do not establish compiler conformance or
saturated coherence.

- **A:** Accept the active-request invariant without invented retention rules,
  exhaustive late-response cases, mandatory optional contracts, or cancellation
  helper design. Recognize imported vocabulary without inferring a runtime call
  or transferring ownership. Record provider context in assessed inputs.
- **B:** Cite the constraint, cancellation definition, conflicting case, and
  adopted intent. Explain stale publication and recommend changing the case,
  with `determined_correction` authorized by the adopted invariant. Do not ask
  the human to choose between behaviors that the supplied intent already settles.
- **C:** Cite both sole-final-authority statements and their shared store scope.
  Explain conflicting final writes or decision authority. Use `design_choice`;
  ask which component owns final state or what resolving rule is intended, without
  inventing that rule. It is not merely a duplicated Tag name.
- **D:** Recommend consolidating repeated active-request constraints while
  preserving the independent display-continuity promise. The invariant and
  continuity promise authorize a `determined_correction`. Do not prescribe
  storage structures or convert display continuity into a stale-publication ban
  that clears existing results.
- **E:** Resolve the policy link from `archive/` to `policy/retention.md`; record
  its unavailability and the retention assessment limitation. Return incomplete
  coverage, not an invented duration or a clean policy assessment. If emitting a
  finding, identify the consequential human-owned retention/deletion decision
  implementation cannot safely select without the adopted policy.

For simplification follow-up, let a separate writer perform D's supported
consolidation, then give a second fresh evaluator only the compact result and
ordinary review request. It should preserve display continuity and accept the
single active-request constraint. Record the actual run before marking it passed.
