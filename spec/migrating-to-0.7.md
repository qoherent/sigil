# Migrating Sigil 0.6 to 0.7

Sigil 0.7 tightens parsing and relationship resolution. Update
`.sigil/config.json` from `0.6.0` to `0.7.0` only after reviewing these changes.

## Module index filename

Rename every reserved directory index from `#module.sigil` to `_module.sigil`
and update direct source imports, ownership annotations, documentation links,
and tooling configuration that names those files. `_module.sigil` is the sole
reserved directory-index basename in 0.7.

The legacy `#module.sigil` basename has no compatibility behavior. It remains
an ordinary `.sigil` source and can be imported only by an explicit file path;
a directory import never selects it.

## Imported concept identity

An imported public concept now retains its provider identity only when an
exact-name concept block reuses it in a matching `expand`. A same-named concept
declared directly in an importing `component` is local. Because Sigil has no
qualification or shadowing, the local and imported identities are ambiguous.

Rename the local interface concept so its name still communicates the
relationship, such as `GlossaryInspectionFacade`, and say explicitly that it
adapts or delegates to `GlossaryInspection`. If the intent is re-exposure,
place the exact-name block in a matching expand instead.

## Duplicate components and imports

A component name declared more than once in a workspace binds neither imports
nor matching expands until the duplicate is resolved. Import paths remain
workspace-root-relative, normalize slash, repeated slash, `.` and internal
`..` segments, and reject traversal outside the workspace. Import-cycle
diagnostics point to the closing import declaration while retaining resolved
edges and names.

## Parser, formatter, and locations

Recovery now follows the normative retained-result ordering in the language
specification. Unsupported versions return an empty document with a zero-width
diagnostic at the start of the source. Source locations use one-based UTF-16
code-unit columns. Formatting returns no formatted source when parsing has an
error, and prose wrapping uses the specified Unicode whitespace set.

## Section guidance

`goal` states responsibility, boundary, and intended outcome. `interface`
describes public operations, data, events, results, failures, and observable
promises. `state` includes meaningful runtime or domain data as well as
configurations, modes, conditions, and lifecycle states.
