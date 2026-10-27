# .sigil/conventions/

`.sigil/conventions/` is an optional, committed folder that records how a
workspace's designs should be written. It does not change `.sigil` syntax or
the language rules; it adds a workspace's own guidance on top of them. A
workspace without the folder behaves as it always has, and `sigil init` does not
create one.

The machine-readable schema for the check rules is
[sigil-conventions.schema.json](sigil-conventions.schema.json).

## Structure

```text
.sigil/conventions/
  write.md      write instructions for sigil-write
  check.json    declarative check rules for sigil check
  judge.md      judge rules for sigil-evaluate
```

Each part is optional and independent, and each is read from its exact path;
other files in the folder are ignored. A workspace has at most one conventions
set. A nested workspace uses only its own and inherits nothing from an
enclosing workspace.

| Part | Read by | Role |
| --- | --- | --- |
| `write.md` | `sigil-write` | Added authoring guidance. It cannot relax a language rule. |
| `check.json` | `sigil check` and the language server | Rules checked without an LLM. |
| `judge.md` | `sigil-evaluate` | Added review criteria. A finding still points at authored text. |

`sigil check` reads only `check.json`. It never reads `write.md` or `judge.md`,
runs no LLM, and executes no code: check rules are data.

## check.json

`check.json` is strict UTF-8 JSON.

```json
{
  "rules": [
    {
      "section": "decisions",
      "groups": ["RetentionPeriod"],
      "require": ["Decision:", "Scope:"]
    }
  ]
}
```

`rules` is required and may be empty. Each rule requires `section`, the name of
a contract section such as `decisions`, and `require`, a non-empty list of
labels. `groups` is optional; when present it is a non-empty list of group
names that narrows the rule to those groups. Every string is non-empty. Unknown
keys at the root or in a rule are rejected.

A rule applies to every named group in its section, or only to the listed
groups. A Facet outside a named group is never matched. A label is satisfied
when a Facet in the group starts with it, after leading whitespace; the same
words in the middle of a Facet do not count.

## What sigil check reports

Each missing label produces one warning, `SIGIL_CONVENTION_MISSING_LABEL`, on
the group's header. Its message names the label and the rule's section. A
warning does not change the exit status, since only errors fail the check. The
language server shows the same warnings in the editor.

A malformed `check.json` produces one error, `SIGIL_CONVENTION_PARSE`, on that
file, and no rule warnings. The error belongs to the host, not to the language,
so it does not stop `sigilc` from reading the workspace, and `sigil fmt`
ignores it: only `sigil check` reports it.

In the editor, a change to `check.json` applies when the file is saved.

## The decision structure as a conventions example

How a decision is structured is a convention, not language. Decisions explains
a choice; a workspace may agree on labels that make that explanation easy to
review. This contract records a decision with labels:

```sigil
component AuditRetention {
  goal {
    Bound how long each *completed audit record* remains available.
  }

  constraints {
    RetentionPeriod {
      Keep each completed audit record for at least 30 days after completion.
    }
  }

  cases {
    A deletion eligibility check reports a completed audit record from
    29 days ago as ineligible for deletion.
  }

  interface {
    A *deletion eligibility check* reports whether a completed audit record
    is eligible for deletion.
  }

  decisions {
    RetentionPeriod {
      Decision: Use a 30-day minimum for this example's audit history.

      Scope: Each completed audit record; active records are excluded.

      Trade-offs: Longer history would cost more storage.

      Discarded alternatives: Immediate deletion was rejected because recent
      incidents need investigation.

      Revisit when: Investigation needs require a longer history.
    }
  }
}
```

A workspace that wants every named decision group to carry `Decision:` and
`Scope:` writes this `check.json`:

```json
{
  "rules": [
    {
      "section": "decisions",
      "require": ["Decision:", "Scope:"]
    }
  ]
}
```

The labels are ordinary prose. A short decision can stay unlabeled outside a
named group, where no rule matches it. Useful additional labels include
`Assumptions:`, `Design issues addressed:`, `Consequences:`, `Trade-offs:`,
`Discarded alternatives:`, and `Revisit when:`. Keep each paragraph focused on
one contribution. Explain important exclusions without listing every dependent.
