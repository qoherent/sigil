# Sigil Language Guide

**Language version:** 0.8.0; implemented in this checkout, publication separate.

This guide teaches humans and coding agents how to read, write, and revise
Sigil. The [Language Reference](sigil-reference.md) and its
[EBNF grammar](sigil.ebnf) define the language. This guide explains their use;
its examples and authoring advice do not introduce additional language rules.

The active repository contracts and current core, CLI, LSP and VS Code tools
use 0.8.0. Historical skill sources remain excluded. See [Migrating to 0.8](migrating-to-0.8.md).

## Contents

1. [Write a small component](#1-write-a-small-component)
2. [Develop a design from a requirement](#2-develop-a-design-from-a-requirement)
3. [Choose the right contract](#3-choose-the-right-contract)
4. [Choose component and Facet boundaries](#4-choose-component-and-facet-boundaries)
5. [Introduce Tags when identity helps](#5-introduce-tags-when-identity-helps)
6. [Group related Facets](#6-group-related-facets)
7. [Connect components with imports](#7-connect-components-with-imports)
8. [Use diagrams, code, and linked material](#8-use-diagrams-code-and-linked-material)
9. [Keep uncertainty visible](#9-keep-uncertainty-visible)
10. [Revise an existing design](#10-revise-an-existing-design)
11. [Review before implementation](#11-review-before-implementation)
12. [Examples in other domains](#12-examples-in-other-domains)
13. [Workspace and authoring reminders](#13-workspace-and-authoring-reminders)

## 1. Write a small component

Sigil records what a part of a system does, the rules it follows, and the reasons
behind its design. A **component** owns a responsibility. Its **contracts**
organize the different kinds of statements about that responsibility.

Start with the two required contracts: `goal` and `interface`.

**Complete source — `search/panel.sigil`, first version:**

```sigil
component SearchPanel {
  goal {
    Help a user find records by their search text.
  }

  interface {
    Accept search text and display matching records.

    Show an empty result message when no records match.
  }
}
```

`goal` explains why this component exists. `interface` describes what it offers
its user. Each blank-line-separated paragraph is a **Facet**: one authored
contribution that can be discussed and reviewed. This component has three Facets.
Wrapping a paragraph over several physical lines does not add Facets.

You do not need Tags, grouping blocks, imports, or all seven contracts to begin.
Goal and Interface must each contain content. The other contracts are optional;
add them when the design has something useful to say in their roles.

Examples in this guide describe hypothetical designs. They are not requirements
for your project. Blocks labeled **complete source** can stand alone in a
workspace with the indicated dependencies. **Fragments** need the stated
surrounding structure. **Invalid examples** illustrate mistakes. Successive
versions of the running example replace the earlier version; do not concatenate
them into duplicate component declarations.

## 2. Develop a design from a requirement

Continue the SearchPanel example with this requirement:

> Users can replace or cancel a search. A late response must not undo either
> action. A failed search displays an error and allows another attempt.

First identify what the requirement establishes: replacement, cancellation,
late-response handling, and failure feedback. It does not establish a database,
transport library, timeout, or automatic retry policy.

For this example, the author chooses four lifecycle states and records why
only the active request may publish. Those are explicit design choices made
while developing the requirement.

**Complete source — replacement for `search/panel.sigil`:**

```sigil
component SearchPanel {
  goal {
    Help a user find records by their search text.
  }

  interface {
    Accept search text and display matching records.

    Show an empty result message when no records match.

    Let the user replace or cancel an active search.

    Show a search error when a request fails and allow another attempt.
  }

  state {
    The search is idle, loading, ready, or failed.

    At most one request is the active request.
  }

  logic {
    Submitting search text starts loading and replaces the active request.

    A successful active request enters ready and displays its results.

    A failed active request enters failed and displays a search error.

    Cancelling clears the active request and returns the search to idle.
  }

  constraints {
    Only the active request may publish results or an error.
  }

  decisions {
    Keep the active request authoritative because responses can arrive out
    of submission order, including after cancellation.
  }

  cases {
    A successful search with no matches shows the empty result message.

    A request fails; the user sees an error and can submit another search.

    A response arrives after cancellation; it does not change the display.

    An older response arrives after a newer result; the newer result remains.
  }
}
```

Each addition has a purpose. State names the configurations. Logic describes
changes between them. Constraints gives the rule those changes must respect.
Decisions explains the choice. Cases makes difficult event orderings reviewable.

This example uses all seven contracts because the requirement benefits from
all seven. It is not a template that every component must fill out. Nor does
it settle every search-product question: whether old results remain visible
while a new request loads would need a separate decision if it matters to the
current implementation task.

A practical authoring sequence is:

1. State the responsibility and its boundary.
2. Describe the interactions required by the task.
3. Add relevant state, behavior, and binding rules.
4. Record important reasons and unresolved choices.
5. Check the design against a normal case and its material failure cases.
6. Introduce names and grouping where they make these contributions easier to use.

For an agent, the task and available evidence bound this work. Do not silently
turn a plausible implementation preference into an authored requirement.

## 3. Choose the right contract

Use this table while deciding where a contribution belongs:

| Contract | Question it answers | Search example |
| --- | --- | --- |
| `goal` | Why does this responsibility exist? | Help users find records. |
| `interface` | What interaction or observable promise is offered? | Users can cancel a search. |
| `state` | What data, modes, or conditions matter? | A search is idle, loading, ready, or failed. |
| `logic` | What happens, and in what order? | Cancelling clears the active request. |
| `constraints` | What must remain true or is forbidden? | Only the active request may publish. |
| `decisions` | Why was a course chosen? | Late responses must not undo a newer action. |
| `cases` | What happens in a particular situation? | A response after cancellation leaves the display unchanged. |

### Related statements can have different roles

Cancellation belongs in several contracts because each contribution answers a
different question. You do not need to repeat the same sentence seven times.
An Interface promise describes what a caller can rely on; Logic explains the
behavior that delivers it; a Constraint can restrict all relevant paths.

State can describe runtime or domain data without prescribing storage. A schema
belongs there when its shape carries domain meaning. A selected persistence
technology belongs in Constraints, with its rationale in Decisions.

For a UI, put visible regions and user actions in Interface, changing modes in
State, interaction behavior in Logic, binding accessibility or responsive rules
in Constraints, and observable scenarios in Cases.

### Separate a binding choice from its reason

**Fragment — two sections inside one component:**

```sigil
constraints {
  ResultAuthority {
    Only the active request may publish results.
  }
}

decisions {
  ResultAuthority {
    Keep the active request authoritative because completion order can differ
    from submission order.

    Allowing every response to publish was rejected because an older response
    could replace newer results.
  }
}
```

ResultAuthority is a grouping name used in both contracts. The first Facet
states a rule. The others explain it. A rejected alternative is not a requested
feature. A rationale paragraph alone should not be the only place a binding
technology or architecture choice is recorded.

### Write Cases that expose a decision

Weak: "Cancellation works correctly."

Better: "A response arrives after cancellation; it does not change the display."

The second gives a situation and an observation a reviewer can assess. Useful
Cases include empty data, invalid input, cancellation, partial failure, retry,
and inconvenient event ordering, when relevant to the component.

Say whether an outcome is required or merely permitted. One concrete example
does not automatically establish a rule for every input.

A Case can be meaningful before tests exist. Later, distinguish whether a test
covers its situation, whether the assertions agree, whether production behavior
satisfies it, and whether the test was actually executed. A matching test name
or a mocked helper does not answer all of those questions.

## 4. Choose component and Facet boundaries

A component can describe an API, screen, policy, library, data model, workflow,
service, or architectural boundary. It need not correspond to one implementation
file, class, or process.

Keep SearchPanel and payment settlement separate: they serve different
responsibilities and change for different reasons. Keep SearchPanel's
cancellation behavior with SearchPanel: it explains the same responsibility.
Do not create a new component just because a paragraph is long.

Each component has one declaration with a workspace-unique name. All its
contracts belong there. Splitting a declaration across files with `expand` is
not part of 0.8. File placement is an organizational choice, but moving a source
requires updating its import paths and relative content links.

### Give independently reviewable ideas separate Facets

**Fragment — two Facets in a Constraints section:**

```sigil
constraints {
  A cancelled request cannot publish results.

  Search text is retained when a request fails.
}
```

These rules can be reviewed and changed independently. Conversely, keep related
clauses together when splitting them would obscure the contribution:

**Fragment — one Facet:**

```sigil
logic {
  When the active request fails, enter the failed state and display its error.
}
```

Keep a block's opening brace on its header line and its closing brace on its
own line. Inline expressions such as `Return { enabled: true }.` can remain prose.

Grouping headers are not Facets. Blank lines separate Facets; legal physical wrapping
within a paragraph does not. Review paragraph splits and merges as changes to
authored units even when the individual sentences are unchanged.

## 5. Introduce Tags when identity helps

A **Tag** gives a design concept a reusable identity owned by its component.
Introduce it inline with adjacent asterisks, then use its name without them.

**Fragment — an alternative Interface for a search component:**

```sigil
interface {
  A *query* contains search text and filters.

  The *search results* contain matching records in display order.

  Accept a query and display search results.
}
```

The first two Facets introduce names. The third refers to those identities.
Multiword names are allowed. Names are case-sensitive: Query and query differ.
Names are exact: repeated spaces, tabs, and Unicode spelling differences are
not normalized. For example, `search results` and `search  results` differ.
Keep each complete Tag name on one physical line in definitions and references.
Wrap surrounding prose without splitting the name.

Use a Tag when naming the same concept across contributions or components
clarifies the design. Leave a one-off explanation untagged when an identity adds
nothing. The word "example" does not need a Tag just because a paragraph presents
an example.

### Define once; reuse afterward

**Invalid fragment — two inline definitions in one component:**

```text
interface {
  A *query* contains search text.
}

logic {
  Reject a *query* with no searchable text.
}
```

**Corrected Logic fragment:**

```sigil
logic {
  Reject a query with no searchable text.
}
```

The second occurrence reuses query. It does not redefine it. This remains true
when the occurrences are in different contracts of the same component.

### Read the actual reference, not just its typography

Known names in eligible prose become references without extra markup. Unknown
words remain ordinary prose; a typo does not necessarily produce an error.
A Tag named order is not referenced inside pre-order or order.status.

When search, results, and search results are accessible, "Display search results"
references the longest name, search results. Adding a longer name can therefore
change references in existing prose. Review affected wording when vocabulary
changes; do not rely only on whether the source remains valid.

Asterisks are Tag syntax in prose, not Markdown emphasis. Write `*query*` for a
definition; `* query *` does not introduce it. Fenced payloads and complete
Inline Links do not introduce or reference Tags. A definition also needs whitespace, a line
boundary, a comma, or a period outside each asterisk. Thus `a *query*.` defines
query, but `` `*query*` `` does not: backticks are not allowed outer boundaries.
Inline backticks have no special effect in `.sigil` prose; an already accessible
name can still be referenced within them. Use a fenced payload when literal
notation must stay outside Tag scanning. See the
[reference's Tag rules](sigil-reference.md#tags-and-references) for exact matching.

## 6. Group related Facets

A **Concept Tag** is a local Tag used as a grouping heading. It connects related
Facets while keeping each Facet's contract role.

**Fragment — two sections inside one component:**

```sigil
interface {
  search lifecycle {
    Start a search from the caller's query.

    Cancel the active search.
  }
}

logic {
  search lifecycle {
    Cancelling prevents the active request from publishing results.
  }
}
```

Headings use bare names, including the first occurrence. Repeated headings reuse
one local identity. They are not duplicate inline definitions. You may also
use an inline-defined local Tag as a heading.

**Complete source — inline definition and grouping reuse:**

```sigil
component Session {
  goal {
    Manage one authenticated session.
  }

  interface {
    The *session lifecycle* starts when credentials are accepted.

    session lifecycle {
      Signing out ends the session.

      Expiry requires new credentials.
    }
  }
}
```

The Interface contains three Facets. The header is not a fourth. Direct and
grouped Facets can coexist. Groups are flat and nonempty; do not nest them.

Use grouping for a recurring concern with several contributions. Keep a lone
Facet direct when a heading would only repeat its first words. Sharing a heading
connects contributions but does not make different actions or resources the
same thing.

## 7. Connect components with imports

Imports select Tags from their owning component in an explicit source file.
Introduce a Tag locally when your component owns it; import it when your design
needs to refer to the provider's identity.

**Complete two-source example — both files belong to one configured workspace.**

**Provider — `search/service.sigil`:**

```sigil
component SearchService {
  goal {
    Find records matching a caller's request.
  }

  interface {
    A *query* contains search text and filters.

    The *search results* contain matching records in display order.

    *submit* accepts a query and produces search results.
  }
}
```

**Consumer — `screens/search.sigil`:**

```sigil
@search/service.sigil from SearchService import { query, search results, submit }

component SearchScreen {
  goal {
    Let the user find and inspect records.
  }

  interface {
    Accept a query and display search results.
  }

  logic {
    Pass the user's query to submit and display the returned search results.
  }
}
```

Long selections can use multiple lines and an optional trailing comma:

**Alternative import statement — replaces the one above:**

```sigil
@search/service.sigil from SearchService import {
  query,
  search results,
  submit,
}
```

Each name stays on one physical line. The import selects three Tags.
`from SearchService` identifies their owner; it
is not a component namespace import. The Logic Facet explicitly describes the
invocation. Importing or mentioning a Tag alone would not establish that call.

SearchService owns the Tags. SearchScreen owns its Facets and the behavior they
describe. A consumer's requirements do not rewrite its provider upstream.

### Import only names you use

Every selected Tag needs a prose reference in the importing source. References
in any contract count, including Goal and Decisions. A name appearing only in
a link label or fenced payload does not count. Repeated imports of the same
Tag are errors, including across separate import statements.

Only selected names become accessible. To interpret one imported Tag, however,
read it in the provider's complete component design, including relevant untagged
Facets. Selective naming does not mean that all other provider context can be
ignored. A provider's imports are not automatically imported into the consumer.

### Keep imported names out of local grouping headings

If Search is imported, use a local heading such as SearchPresentation and refer
to Search in its prose. A heading named Search would create or reuse a local
Tag and collide with the import. A heading never adopts the provider's identity.

Two providers can own different Tags named status, but importing both into one
source is ambiguous. There are no aliases or qualified Tag references in 0.8.
Choose distinct provider vocabulary where appropriate; do not pretend renaming
an unrelated local heading resolves two colliding imports.

Imports are file-scoped. If several components share a source, its imports are
accessible in each and can collide with any component's local vocabulary.

### Tags from State are also importable

**Complete two-source example — independent of the search examples above.**

**Provider — `jobs/worker.sigil`:**

```sigil
component JobWorker {
  goal {
    Process a submitted job.
  }

  interface {
    Accept a job and report whether work is active.
  }

  state {
    The worker is *Idle* or *Running*.
  }
}
```

**Consumer — `screens/job-status.sigil`:**

```sigil
@jobs/worker.sigil from JobWorker import { Running }

component JobStatus {
  goal {
    Explain whether the user's job is being processed.
  }

  interface {
    Show an activity indicator while the worker reports Running.
  }
}
```

Tags in any contract can be imported. Importability does not grant runtime
access to private data or override an access restriction. The design still
needs an interaction that supplies the information; here the worker offers it.

A component with no Tags is valid but has no Tags to import. Imports describe
vocabulary dependencies; they are not a complete inventory of runtime calls or
architectural relationships. Express those relationships in the contracts.

## 8. Use diagrams, code, and linked material

Choose a representation that makes the contribution easier to understand.
Ordinary paragraphs work well for concise statements. Put notation that depends
on line breaks or indentation in a fenced payload directly after its introduction.
The introduction and payload form one **Embedded Facet**. Each introduction
attaches one payload. Its closing fence ends the Facet; any following prose
starts a new one. Give a second payload its own introduction.

### A lifecycle diagram

**Complete source — `delivery.sigil`:**

````sigil
component Delivery {
  goal {
    Deliver a submitted message and report its outcome.
  }

  interface {
    Accept a message and expose pending, delivered, or failed status.
  }

  logic {
    A submitted message follows this lifecycle:
    ```mermaid
    stateDiagram-v2
      [*] --> Pending
      Pending --> Delivered: accepted by destination
      Pending --> Failed: delivery rejected
    ```
  }
}
````

The diagram contributes Logic. Its labels do not create Sigil Tags. If an
imported Tag connects the diagram to another component, mention that Tag in the
introducing prose. Attaching a fence preserves Tag recognition in that prose.

### A value shape or a layout

**Fragment — a shape in Interface:**

````sigil
interface {
  A search response has this shape:
  ```json
  {
    "records": [],
    "nextCursor": null
  }
  ```
}
````

Explain separately whether the JSON is an illustrative value or an exhaustive
shape when that distinction matters. A language label does not settle its role.

**Fragment — a layout in Interface:**

````sigil
interface {
  Place date navigation above the room calendar:
  ```text
  +------------------------------------------+
  | Previous | July 2026 | Next               |
  +------------------------------------------+
  | Room     | Confirmed bookings            |
  +------------------------------------------+
  ```
}
````

Keep the opening fence adjacent to its introduction. A blank line between them
would detach it. Markdown lists, tables, multiline code, pseudocode, and ASCII
sketches also need fenced payloads when their layout carries meaning.

### Link to material with an explicit role

An **Inline Link** uses `[label](destination)` in a Facet. Local relative paths
resolve from the source file's directory, unlike imports, which start at the
workspace root. Query strings and fragments select material within the target.

**Fragments — require the referenced artifacts; placeholder URLs are illustrative:**

```sigil
interface {
  Follow the layout in
  [Calendar design](https://www.figma.com/design/EXAMPLE/Calendar?node-id=1-2).
}

constraints {
  Requests must satisfy
  [request schema](./openapi.yaml#/components/schemas/Request).
}

decisions {
  The [design rationale](./search-design.md#alternatives) explains why the
  selected layout groups navigation above the calendar.
}
```

"Must satisfy" adopts a requirement; "explains why" provides rationale. State
which aspects of a design image are binding and which are suggestions. A link
label, filename, or Figma URL cannot make that choice for you. Markdown image
syntax can also present an image within prose.

A complete link, including its label, is outside Tag scanning. Write the Tag
reference in surrounding prose when you need both relationships:

**Fragment — request shape is defined outside the link:**

```sigil
interface {
  The *request shape* follows [API design](./api-design.md#request).
}
```

Read required linked material before relying on it. If the target or fragment
is unavailable, report the gap; do not invent its contents. A source can parse
successfully while its interpretation remains incomplete.

Manage versions of external requirements deliberately. The language does not
pin linked documents or automatically reevaluate them when they change.
Conflicting adopted requirements need an explicit resolution. A fence is not
execution, and embedded code is not automatically evidence of production behavior.

## 9. Keep uncertainty visible

Suppose the requirement says "search supports retries" but does not specify
whether retry is manual or automatic. That gap can materially change behavior.
Do not quietly choose a retry count and place it in Constraints.

**Complete source — a deliberately incomplete design under discussion:**

```sigil
component RetriableSearch {
  goal {
    Let a user recover from a failed search.
  }

  interface {
    Permit another attempt after a failed search.
  }

  decisions {
    Open question: Should retries require a user action or happen automatically?

    Proposal: Require an explicit user action to avoid unexpected requests.
    This choice has not been accepted.

    Assumption to verify: Repeating a search has no external side effects.
  }
}
```

These labels are ordinary prose, not new keywords, status fields, or comments.
The wording makes the unresolved choice explicit. The proposal and assumption
are not established requirements. The example is structurally complete but
not ready for implementation of retry behavior.

Once the author accepts a choice, update the affected Interface, Logic,
Constraints, and Cases as needed, then record the durable rationale in
Decisions. Remove or resolve obsolete questions rather than leaving contradictory
instructions scattered through the component.

An agent should identify the smallest question that blocks the requested work,
continue independent work, and preserve the answer in the appropriate contract.
A human reviewer should check that inferred preferences have not become binding
rules without a design decision.

## 10. Revise an existing design

Start by reading the owning component, its existing vocabulary, and the imported
or linked material relevant to the change. Reuse existing Tags rather than
introducing the same name again.

For the running SearchPanel, suppose the user adds this requirement:

> Keep the search text after a failed request so the user can correct it.

**Before — existing Logic Facet:**

```text
A failed active request enters failed and displays a search error.
```

**After — replacement Logic Facet:**

```text
A failed active request enters failed, displays a search error, and retains
its search text for correction.
```

**Additional Case Facet:**

```text
A search fails; the user corrects the retained search text and submits again.
```

This edit changes the existing Logic section and adds a Facet to the existing
Cases section. It does not create a second `logic` or `cases` section. The
active-request authority rule and its reason still apply.

Review related contracts for agreement. Add a separate Constraint if retention
must hold across a broader set of failure paths; do not duplicate the same
statement everywhere merely to fill sections.

When editing vocabulary or moving content:

- Keep one inline definition per Tag name in a component.
- Check longer names for changed reference matches in existing prose.
- Check imports for duplicates, unused selections, and local/name collisions.
- Preserve Facet ownership and distinguish consumer requirements from provider behavior.
- Update imports when a provider source moves; rebase relative links when a Facet moves.
- Keep diagrams, adopted schemas, and Cases consistent with the revised behavior.
- Preserve meaningful paragraph boundaries and rationale still relevant to the choice.

## 11. Review before implementation

A useful review asks whether a reader can explain what to build and identify
what remains undecided. Syntactic validity alone does not establish that.

| Review question | What to look for |
| --- | --- |
| Is the responsibility bounded? | One understandable purpose and clear interactions with adjacent components. |
| Is the requested behavior concrete? | Relevant inputs, outcomes, transitions, and material failure handling. |
| Are the roles clear? | Binding rules, reasons, examples, and proposals remain distinguishable. |
| Is the vocabulary intentional? | Useful Tags, one inline definition each, correct ownership and imports. |
| Are the examples informative? | Cases expose real choices instead of saying only that a feature works. |
| Is required context available? | Relevant provider design and adopted linked material have been read. |
| Is uncertainty visible? | Unresolved choices that could change implementation are called out. |
| Can the change be assessed? | Related contracts, links, and Cases agree with the revised requirement. |

Stop when the design is reviewable at the task's scope. Optional sections may
remain absent. Record material open questions instead of manufacturing detail
to make the document look finished.

For agent-assisted work, distinguish authored intent, inferred conclusions,
implementation observations, and executed checks in the review report. Do not
claim compiler validation with a tool that does not support the source version.

## 12. Examples in other domains

Each example below is a complete independent source. The chosen policies belong
to that example and should not be copied into unrelated projects as defaults.

### A small library abstraction

```sigil
component BoundedQueue {
  goal {
    Buffer work while bounding the number of pending items.
  }

  interface {
    Accept an item when space is available and report full otherwise.

    Remove the oldest pending item, or report empty.
  }

  state {
    Pending items have insertion order and a fixed positive capacity.
  }

  constraints {
    The number of pending items never exceeds capacity.
  }

  cases {
    An insertion into a full queue reports full and preserves pending items.

    Removing twice after inserting A then B returns A then B.
  }
}
```

This design needs no Tags or grouping. Capacity and ordering can be discussed
clearly without introducing extra identities. It also leaves implementation
choices such as arrays versus linked storage open.

### A domain data model

```sigil
component ReservationWindow {
  goal {
    Describe the time interval occupied by a reservation.
  }

  interface {
    Accept a start instant and an end instant.

    Report whether an instant falls within the reservation.
  }

  state {
    The window stores its start and end as absolute instants.
  }

  logic {
    An instant is within the window when it is at or after the start and
    strictly before the end.
  }

  constraints {
    The end must be later than the start.
  }

  cases {
    The start instant is within the window; the end instant is outside it.
  }
}
```

State describes meaningful domain data. It does not prescribe a database table.
The Case makes the boundary convention observable.

### A policy with a binding decision and rationale

```sigil
component AuditRetention {
  goal {
    Bound how long completed audit records remain available.
  }

  interface {
    Evaluate whether a completed audit record is eligible for deletion.
  }

  constraints {
    RetentionPeriod {
      Keep completed audit records for at least 30 days after completion.
    }
  }

  decisions {
    RetentionPeriod {
      Decision: Use a 30-day minimum for this example's audit history.

      Scope: Completed audit records only; active records are excluded.

      Trade-offs: Longer history would cost more storage.

      Discarded alternatives: Immediate deletion was rejected because recent
      incidents need investigation.

      Revisit when: Investigation needs require a longer history.
    }
  }

  cases {
    A record completed 29 days ago is not eligible for deletion.
  }
}
```

The labels are optional authoring conventions. A short decision can stay
unlabeled. Useful additional labels include `Assumptions:`,
`Design issues addressed:`, and `Consequences:`. Keep each paragraph focused on
one contribution. Explain important exclusions without listing every dependent.

### An architectural boundary

```sigil
component ApplicationPersistence {
  goal {
    Keep domain operations independent of database integration details.
  }

  interface {
    Provide repository operations for reading and saving domain records.
  }

  constraints {
    Domain operations access persisted records through repository interfaces.

    Database client types do not appear in domain operation signatures.
  }

  decisions {
    Keep database integration behind repositories so domain rules can be
    exercised without database access.
  }

  cases {
    A domain rule test supplies an in-memory repository and requires no
    database connection.
  }
}
```

A component can describe an architectural responsibility spanning many files.
The constraint expresses a dependency boundary. It does not identify production
files that satisfy it or establish that a test has been executed.

## 13. Workspace and authoring reminders

Sigil sources use `.sigil`. Place them near the code they describe where practical.
A strict JSON `.sigil/config.json` selects the workspace version and included
sources; see [workspace configuration](sigil-config.md). Additional projects
can be declared as workspace members. Excluded nested workspaces remain
independent. Read the reference for exact discovery and boundary rules.

`_module.sigil` is an ordinary filename in 0.8. It can hold a project summary,
but it does not re-export components or provide directory-import shorthand.
Import Tags from the explicit file declaring their owner.

| While writing | Remember |
| --- | --- |
| Starting a component | Goal and Interface need content; other contracts are optional. |
| Adding detail | Edit the existing section; repeated sections are invalid. |
| Naming a concept | Introduce `*name*` once; use bare names afterward. |
| Grouping | Bare local headings can repeat; groups are flat and nonempty. |
| Importing | Select used Tags from the owner; no aliases, wildcards, or re-exports. |
| Writing prose | Blank lines separate Facets; wrap prose to 79 content characters. |
| Adding notation | Attach a fence directly to introducing prose. |
| Adding context | State a link's role and read required targets. |
| Leaving a question | Use explicit prose; Sigil has no comment syntax. |
| Checking work | Use tooling that supports the source version and report actual checks. |

For exact rules, error conditions, and parser behavior, use the
[Language Reference](sigil-reference.md). For changes from the previous language,
use the [migration guide](migrating-to-0.8.md).
