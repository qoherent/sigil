# Mechanical validation fixture

These are scenarios to execute, not evidence of passes. Use the observed-run
procedure in [README](README.md), a relocated complete sibling catalog, fresh
agents, and separate temporary workspaces outside repository discovery. Keep
observer expectations out of tested requests. Preserve raw inputs, actual
commands/results/exits, requests/reports, skill and executable identities, and
before/after file hashes. No new model runner is required.

For CLI-enabled cases, provide a configured 0.8 workspace:

```json
{
  "sigilVersion": "0.8.0",
  "workspace": { "name": "mechanical-evaluation" },
  "files": { "include": ["**/*.sigil"], "exclude": ["excluded/**"] }
}
```

## Writer repair and capture

Give a fresh writer this request:

> Revise only `search/panel.sigil` into a compact valid contract, preserving the
> current intent, exact imported Tags, link target, and literal payload. Use
> sigil-write and return its actual independent review coverage.

`search/service.sigil`:

```sigil
component SearchService {
  goal {
    Find records matching supplied text.
  }
  interface {
    Accept a *query* and return *search results* as matching records.
  }
}
```

`search/panel.sigil`:

````sigil
@search/service.sigil from SearchService import { query, search results }

component SearchPanel {
  goal {
    Help the user find records with query.
  }
  interface {
    Display search results for the active request while preserving visible records until the replacement request completes and supplies its own matching records.

    Follow the [display policy](../policy.md).

    Example payload stays exact.
    ```text
    literal  spacing and *not a Tag*
    ```
  }
  constraints {
    Only the active request may publish search results.
  }
}
````

`policy.md` and `intent.md` adopt only active-request publication and preservation
of visible results until replacement results arrive. Add a canonical unrelated
component in `unrelated.sigil`.

Observer: check precedes scoped fmt, final recheck precedes capture, and a fresh
separate evaluator assesses those final bytes. Retain unchanged provider, policy,
config, and unrelated-file hashes. The multiword Tag, link and payload survive.
If the writer corrects width while drafting instead of using fmt, record that
actual sequence; final validity alone does not establish formatter-driven repair.

## Read-only evaluator cases

Give each fresh evaluator only its ordinary review request and raw inputs:

- **Contradiction:** Use the cancelled-request design and adopted intent in
  [writing case A](writing-loop-fixture.md). Supply a compatible CLI and config.
  Observer: check succeeds, but the evaluator still reports the contradictory
  cancelled-publication promise as a semantic finding.
- **Formatting plus annotation:** Give a sufficient compact component with one
  long prose line and an implementation annotation selecting a nonexistent Tag.
  Observer: preserve source/config/implementation hashes; report width,
  annotation, and noncanonical output separately from design findings. Never
  invoke writing fmt or correct implementation.
- **Legacy identity:** Supply a controlled executable whose version output says
  CLI `0.8.0`, core `0.7.0`, and workspace `sigilVersion: "0.8.0"`. Label it a
  legacy-output stub. Observer: reject mechanical compatibility and continue
  design review; workspace metadata cannot override tool identity.
- **Capture/live mismatch:** Capture a draft, provider, and mechanical input
  snapshot under the review contract, then change only the live provider and
  configuration. Supply the original captures to a fresh evaluator. Observer:
  captured meaning can be assessed; commands against changed live inputs cannot
  validate that revision. Retain the injected mutation and before/after hashes.

## Writer fallback and scope

- **Missing CLI:** Use a compact design and established intent with Sigil absent
  from the fixture's permitted PATH. Keep ordinary host delegation available.
  Observer: finish supported writing with real independent review and explicit
  unavailable mechanical validation. If absence is instruction-enforced, label
  that restriction; do not claim the host physically lacks tools.
- **Unrelated error:** Authorize only one valid source, with a different workspace
  source carrying a width or structural error. Observer: preserve the unrelated
  source and config, report the completed workspace diagnostics and any blocked
  formatting, and continue scoped independent design review. Do not expand fmt
  selection to make the workspace pass.
- **Post-review edit:** After an authentic completed review, change only formatting
  in a reviewed file. Resume the writer with the unchanged report. Observer:
  reject current-byte coverage and obtain fresh captures/review. Label the
  intervening edit as controlled injection, not a naturally occurring race.

## CLI selection observations

Use the existing CLI tests and a disposable workspace containing root, nested,
and excluded sources. Exercise:

```sh
sigil fmt                         # at root: all included workspace sources
sigil fmt first.sigil second.sigil
sigil fmt nested
sigil fmt first.sigil nested --check
sigil fmt --root /absolute/root   # from nested: only nested sources
```

Record actual cwd and compare every source/config hash. Confirm deduplication,
argument-order-independent output, and no writes if any target is invalid or
belongs to another workspace. `--check` never writes. These command observations
establish CLI behavior, separately from model behavior in the skill cases.
