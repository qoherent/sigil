# Migrating To Sigil 0.2

Sigil 0.2.0 replaces project-root-only `#module.sigil` behavior with explicit
directory indexes.

1. Set `sigilVersion` to `0.2.0` in `.sigil/config.json`.
2. Upgrade the CLI and core packages to compatible `0.2.x` versions.
3. Remove workarounds that declared workspace members solely to permit a
   directory import.
4. Add `#module.sigil` to any directory that should support import shorthand.
5. Directly import each component name that the directory index should expose,
   or declare the component in the module index itself.
6. Keep explicit `.sigil` imports for components omitted from a module index;
   all component declarations remain public.
7. Remove handling for `SIGIL_INVALID_ROOT_MODULE` and
   `SIGIL_INVALID_DIRECTORY_IMPORT`; 0.2.0 no longer emits them.
8. Preserve ordinary project-summary components at the workspace root and
   declared members when Brownfield workflow establishes those configured
   boundaries.
9. Run `sigil check`, `sigil graph`, and focused editor navigation tests.

The old 0.1 behavior is not silently reinterpreted. Workspaces configured for
0.1.0 require a compatible 0.1 tool; a 0.2 tool requires an explicit version
update.
