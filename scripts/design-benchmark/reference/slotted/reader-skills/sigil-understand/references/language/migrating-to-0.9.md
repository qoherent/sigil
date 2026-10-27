# Migrating Sigil 0.8 to 0.9

Sigil 0.9 is a breaking language revision. The [normative reference](sigil-reference.md)
and [EBNF grammar](sigil.ebnf) define the supported syntax; current tools accept
only an explicit `sigilVersion: "0.9.0"`. They reject stale 0.8 workspace
configuration rather than interpreting it as 0.9. No automatic source converter
is provided.

## Normalize section order

Each component may contain at most one of each known section. Present sections
must appear in this order:

```text
goal, state, logic, constraints, cases, interface, decisions
```

Move existing blocks without changing their Facets, Tag introductions, links,
payloads, or source meaning. A source with an old order receives
`SIGIL_SECTION_ORDER` and is invalid until reordered.

## Recheck Tag imports at the Interface boundary

Tags remain component-owned, and imports never re-export through an intermediate
component. A provider Tag is directly importable only when the provider's
Interface contains valid evidence for that Tag:

- a valid inline `*Tag*` definition;
- a valid grouping heading; or
- eligible Interface prose that references a valid local Tag introduced elsewhere
  in the provider.

Tags introduced only in Goal, State, Logic, Constraints, Cases, or Decisions are
not automatically exported. If the Tag is part of the provider's external
contract, add the smallest truthful Interface evidence and keep the original
introduction in its owning section. A consumer may use an imported Tag in any
canonical section, but only the direct owner can export it.

## Recheck Facet warnings

`SIGIL_UNTAGGED_FACET` remains a warning for operational sections: State, Logic,
Constraints, Cases, and Interface. Goal and Decisions are intentionally exempt;
their prose may remain untagged without that warning. This does not change the
requirement that Goal and Interface contain nonempty content.

## Update tool and artifact metadata

Change workspace configuration and language-facing fixtures to `0.9.0`. Keep
package, extension, native, and skill artifact versions independent: update
their compatibility declarations only when the artifact itself changes. Refresh
the bundled language pack from the current specification with
`scripts/sync-skill-language.ts` and verify it with
`deno task test:skill`.

After migration, run `sigil check`, `sigil fmt --check`, the core/CLI/LSP tests,
native protocol tests, and the editor/skill gates appropriate to the installation.
