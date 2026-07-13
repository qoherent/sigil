# Migrating to Sigil 1.0

Before v1, tools used the topmost ancestor `#module.sigil` as a root marker and
could infer a workspace when none existed. Version 1 removes both behaviors.

1. Install `@sigil/cli` 1.x.
2. Run `sigil init` at the intended workspace root, or create the documented
   `sigil.config` manually.
3. Keep an existing root `#module.sigil` when it remains useful as a product or
   architecture summary; it no longer controls discovery.
4. Remove nested `sigil.config` files from included paths, or exclude the entire
   nested subtree from its parent when it is an intentional independent workspace.
5. Review include and exclude globs.
6. Run `sigil version . --format json` and `sigil check . --format json`.
7. Update raw core parser calls to pass `{ languageVersion: "1.0.0" }`.

There is no compatibility fallback. Missing, invalid, unsupported, and
unexcluded nested configs produce error diagnostics and prevent workspace
source loading.
