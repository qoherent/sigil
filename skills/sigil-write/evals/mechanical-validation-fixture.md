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
````sigil
@search/service.sigil from SearchService import { query, search results }

component SearchPanel {
  goal {
    Help the user find records with query.
  }

  constraints {
    Only the active request may publish search results.
  }

  interface {
    Display search results for the active request while preserving visible records until the replacement request completes and supplies its own matching records.

    Follow the [display policy](../policy.md).

    Example payload stays exact.
    ```text
    literal  spacing and *not a Tag*
    ```
  }
}
````

## Computed evidence write scope

Run a direct `$sigil-evaluate` review of the first two inputs above with both
the `sigil` CLI and `sigilc` available, then a delegated review of the same
inputs with a captured review bundle. Hash every design source, the workspace
`.sigil/config.json`, and `.sigil/claims/interpretations/` before and after.

- **Direct:** design sources and configuration are unchanged. Only temporary
  files and the claims cache may change, through review preparation's
  write-back. No writing `fmt` runs.
- **Delegated:** nothing in the workspace or the capture changes, and no
  review preparation or `sigilc` command runs.
