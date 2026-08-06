# Sigil Workspace Glossary

`.sigil/glossary.json` is an optional, committed, human-reviewed vocabulary
authority for a configured Sigil workspace. It does not change `.sigil` syntax
or create concept identities.

The machine-readable schema is
[sigil-glossary.schema.json](sigil-glossary.schema.json). The governing design
decision is [ADR-018](decisions/adr-018-reviewed-workspace-glossary.md).

## Structure

```json
{
  "schemaVersion": 1,
  "terms": [
    {
      "term": "workspace root",
      "definition": "The directory containing .sigil/config.json.",
      "agentContext": false
    }
  ],
  "contexts": [
    {
      "id": "booking",
      "include": [
        "features/booking/**/*.sigil"
      ],
      "exclude": [],
      "terms": [
        {
          "term": "hold",
          "definition": "Booking capacity reserved before confirmation.",
          "aliases": [
            "temporary reservation"
          ]
        }
      ]
    }
  ]
}
```

The top-level object and every nested object are strict. `schemaVersion`,
`terms`, and `contexts` are required. Contexts require a stable identifier,
non-empty include globs, exclude globs, and their term array.

Each term may set `agentContext` to `false` to omit that term and its
occurrences from agent-facing scoped context. The property defaults to `true`.
It does not affect glossary validation, recognition, inspection, or editor
features.

## Resolution

Workspace terms apply to every loaded `.sigil` source. A source may match at
most one bounded context. Context entries replace workspace spellings only
inside that context; overlapping contexts are invalid.

Canonical terms and aliases match case-insensitively as whole words or phrases.
The longest phrase wins. Matching covers free-form Sigil prose and excludes
structural syntax, fenced code, inline code, and URLs.

## Commands

```bash
sigil glossary . --format json --pretty
sigil check . --format json --pretty
```

`glossary` reports accepted entries, resolved contexts, occurrences, and
diagnostics. Both commands are read-only. Absence of the optional glossary is
valid.

`sigil context` includes a `glossaryContext` containing only accepted terms
recognized in the selected component or file and its related expansion sources
whose `agentContext` value is not `false`. It reports `null` when the workspace
has no GlossaryFile.

## Editor behavior

`sigil-lsp` consumes core glossary projections. Recognized terms receive the
`term` semantic-token type, hover shows the canonical definition and context,
and go-to-definition opens the authoritative JSON entry.

## Review workflow

After every approved Sigil write or semantic edit, the Sigil skill runs
`sigil check` and `sigil glossary`, then extracts candidates from changed
semantic units. Material terminology ambiguity blocks review and implementation;
ordinary unambiguous vocabulary does not require an entry.

The skill presents exact JSON changes and waits for human approval. Accepted
Sigil remains normative when a glossary definition conflicts with a component
contract. Before coding, the skill carries scoped `sigil context` terminology
and any accepted request-matched term into the handoff without injecting the
unrelated complete glossary.

The initial implementation scans `.sigil` prose only. Markdown extraction is
deferred.
