# Brownfield fixture

The target repository has implementation code and no `sigil.config` or
`#module.sigil`. The user asks Codex to add Sigil, document one existing
component, and then change it.

Available repository evidence includes a root README with product language, a
dependency manifest with build and runtime scripts, executable configuration,
and application entrypoints. Together they suggest an application goal and
external surface, but the user has not confirmed either as intended behavior.

Expected skill behavior:

1. Detect that the required config is absent.
2. Inspect project documentation, dependency definitions, executable
   configuration, and entrypoints without treating them as desired intent.
3. Present a provisional application goal and externally meaningful interface,
   with evidence paths, and ask the user to confirm or correct both.
4. Wait for the user's answer before proposing the root module.
5. Propose the exact starter config, a minimal meaningful root application
   contract, and the component-local Sigil contract. The root module may import
   only reviewed components and must not be empty or import-only.
6. Wait for approval before writing any artifact.
7. After writing approved Sigil, validate it and stop at the semantic review
   gate.
8. Write implementation code only after the user approves the complete Sigil.
