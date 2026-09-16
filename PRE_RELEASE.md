# Sigil pre-release status

Sigil remains a pre-production 0.x toolchain. The language frontend, native
compiler, skill, LSP and editor have independent versions owned by their manifests.
The legacy skill's [compatibility metadata](integrations/skills/sigil/compatibility.json)
declares supported language, CLI, core and sigilc combinations.

Current architecture:

- The language frontend owns parsing, resolution, inspection and structural export.
- Rust `sigilc` owns source identity, disposable worlds, fixed semantic rules,
  ordered scope, catalogs and Design/Implementation reports.
- The 0.8 design skills guide source-based understanding, writing and review;
  external producers prepare and ingest native interpretations.
- The retained VS Code extension provides language features, preview/navigation
  and native gate status/diagnostics.
- Independent reconstruction, model execution and the coding loop remain external.

Acceptance requires applicable formatting, lint, type and behavioral checks,
editor integration, executable skill examples, packaging checks and real use.
Fixed fixtures prove protocol behavior; they do not prove application delivery
or faithful independent reconstruction.

Native release acceptance requires all five supported targets to build and run
on matching environments, include both binaries and an honestly labeled skill catalog, pass
relocated/source-free consumption checks and have SHA-256 manifests. A foreign
cargo check is not an executable platform test. The 0.8 migration has local macOS arm64 execution evidence; Linux, Windows and
other release targets require their own matching-runner evidence.

The ongoing refactor's complete delivery, semantic comparison and temporary-state
retirement gate is tracked operationally while the temporary loop documents are
present; the durable workflow is the repository-owned Sigil skill and native
command guide. A pre-release milestone does not waive it. Publishing or
deploying requires separate authorization.

## Sigil 0.8 design skills

`sigil-understand`, `sigil-evaluate`, and `sigil-write` are separate 0.1.0 skill
artifacts for source-based 0.8 design work. They ship together with their bundled
language authority and declared sibling dependencies. Their artifact versions are independent of the activated 0.8 root workspace and
updated core, CLI, LSP, editor and native compiler artifacts.

`test:skill` validates this foundation offline. `test:skill:native` checks retained
legacy material statically; optional runtime checks require explicitly supplied
compatible old tools. `test:native:protocol` runs the current six-state native
protocol smoke and is included in aggregate tests and relocated CLI acceptance. Behavioral acceptance also needs observed fresh
agent runs, recorded in [the foundation evidence report](docs/skill-evaluation/sigil-0.8-foundation.md).
The evaluator stays advisory and read-only. Writer automation is supported only
where the host supplies independent delegation; otherwise its output includes
an unreviewed draft and portable handoff. Model review does not prove compiler
conformance, implementation alignment, or saturated coherence.
