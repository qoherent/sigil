# Migrating Sigil 0.5 to 0.6

Sigil 0.6 changes language interpretation. Update
`.sigil/config.json` from `0.5.0` to `0.6.0` only after reviewing the source
changes below with a compatible CLI and core.

## 1. Preserve semantic-unit boundaries

In 0.5, every non-empty physical line was a separate semantic unit. In 0.6,
each blank-line-delimited prose paragraph is one semantic unit, and adjacent
physical lines are wrapping of that same idea.

Add a blank line between adjacent old lines that must remain independently
reviewable ideas. Leave adjacent lines together when they are one paragraph.
Do not run the formatter until this semantic-boundary review is complete.

## 2. Make every import effective

Every resolved imported name now requires its own qualifying use. Exact-case
component references and imported public concepts count in `interface`,
`state`, `logic`, `constraints`, or `cases`. A matching local `expand` or a
direct `#module.sigil` surface import also counts.

Mentions in `goal`, `decisions`, literal blocks, comments, annotations, other
files, differently cased words, and identifier substrings do not count. Remove
accidental imports. When a real dependency is missing from the operational
contract, state its actual use in a qualifying section. Do not add a fabricated
reference merely to silence `SIGIL_UNUSED_IMPORT`.

## 3. Convert layout-sensitive content to literal blocks

Attach multiline code, JSON, configuration, data, or diagrams directly to
introducing prose:

````sigil
The service uses this configuration:
```json
{
  "enabled": true
}
```
````

There must be no blank line between the prose and opening fence. A type is
optional and must match `[A-Za-z][A-Za-z0-9_+.-]*`. Literal bodies preserve
blank lines, braces, apparent Sigil syntax, and relative indentation. They do
not create semantic or import references and are excluded from glossary and
width processing.

## 4. Review prose width and format explicitly

Ordinary prose is limited to 79 content characters per physical line. Leading
indentation does not count; structural lines, fences, and literal bodies are
excluded.

After `sigil check` reports no errors, use:

```bash
sigil fmt <selected-path> --check
sigil fmt <selected-path>
```

Formatting is explicit and selection-scoped. Migration does not authorize an
automatic repository-wide formatting pass. `--check` is read-only and exits
unsuccessfully when selected sources are noncanonical.

## 5. Validate

Run the compatible 0.7 CLI over each configured workspace:

```bash
sigil version <workspace-root> --format json --pretty
sigil check <workspace-root> --format json --pretty
sigil fmt <workspace-root> --check
```

Resolve all error diagnostics before treating the migration as complete.
