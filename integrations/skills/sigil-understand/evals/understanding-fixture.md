# Understanding fixture

## Runner setup

Copy the complete skill bundle to a temporary directory outside the checkout.
Use a fresh agent with only the request below, the installed understanding skill,
and the two source inputs below. Materialize the source blocks at their stated
workspace-relative paths in a temporary workspace. Do not provide the acceptance
notes to the agent. Do not run the legacy compiler as a proxy for interpretation.
Record the skill/input hashes, host/model when exposed, actual response, and
limitations in the foundation evaluation report. This fixture is not itself an
observed pass.

## Request given to the agent

Use `$sigil-understand` to explain SearchPanel's responsibility, promises, Tag
ownership, and provider relationship. Separate commitments, supported
conclusions, unresolved intent, and free implementation choices. Work from these
sources and the installed references without a compiler or network.

## Input: `search/service.sigil`

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

## Input: `search/panel.sigil`

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
  decisions {
    Request cancellation is one possible implementation, not a selected design.
  }
}
```

## Acceptance notes for the observer

- SearchService owns both selected Tags, including the single exact multiword
  name search results. SearchPanel retains ownership of its Facets.
- The selected vocabulary does not establish a runtime call, provider namespace,
  re-export, or ownership transfer. No 0.7 expansion or module-index rule appears.
- The active-request invariant is sufficient without exhaustive late-response
  cases, cancellation helpers, all optional sections, or code-declaration maps.
- A superseded request cannot publish; cancellation is an unselected option,
  not an authored obligation. Supported alternative implementations remain open.
- No retention policy, test result, compiler success, or saturated-coherence
  claim is invented. Absent compiler validation is stated accurately when relevant.
