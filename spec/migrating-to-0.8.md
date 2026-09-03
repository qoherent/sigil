# Migrating Sigil 0.7 to 0.8

Sigil 0.8 adds one optional component section. Update `.sigil/config.json` from
`0.7.0` to `0.8.0` after reading the change below.

## Declared scope

`scope` is a new optional component section recording what a component
deliberately does not cover. Nothing existing changes: every 0.7 source remains
valid, and a component without `scope` behaves exactly as before.

Use it when adopting Sigil incrementally. Before 0.8 the only way to narrow a
project was to narrow its goal, which left the remaining areas looking like
missing coverage rather than deliberate omissions.

```sigil
scope {
  Billing {
    Excluded: Payment capture and invoicing belong to the finance service.
  }

  Reporting {
    Deferred: Usage reporting is not modelled yet; ingest is the first slice.
  }
}
```

`Excluded:` is a settled boundary that is not expected to arrive.
`Deferred:` is uncovered for now and is expected to disappear as coverage
grows. An area named in `scope` is a stated boundary rather than a missing
contract, so review and compilation report a gap only for an area that is
neither covered nor declared.

## What did not change

The section vocabulary is otherwise unchanged, `scope` is not an
ownership-annotation target, and no diagnostic, formatter, or resolution
behavior was modified.
