# U1 contribution and locator mapping

U1 keeps declaration paths and domain owners, consolidates each section once, and preserves unrelated Facets. The two external `SigilWorkspaceConfig` contributions now belong to its declaration in `spec/language.sigil`. Line locators below identify the revised owner section; original ranges and exact bytes remain in the retained capture.

## Original and current evidence

- Original capture root: `/tmp/sigil080-execution/original`.
- Original digests: `/tmp/sigil080-execution/original-manifest.json`.
- Every U1 original was verified against that manifest before editing.
- Revision-bound current identities and historical resolution mappings are in the request and report linked from `u1-review.md`.

## Contribution locations

| Original contribution | Revised owner/section | Treatment |
| --- | --- | --- |
| `spec/language.sigil:2–7 (component SigilLanguage, goal)` | `spec/language.sigil:2 :: SigilLanguage / goal` | Obsolete language semantics replaced under R3; retained policy and rationale remain in their contract roles. |
| `spec/language.sigil:9–269 (component SigilLanguage, interface)` | `spec/language.sigil:9 :: SigilLanguage / interface` | Obsolete language semantics replaced under R3; retained policy and rationale remain in their contract roles. |
| `spec/language.sigil:273–520 (expand SigilLanguage, constraints)` | `spec/language.sigil:143 :: SigilLanguage / constraints` | Obsolete language semantics replaced under R3; retained policy and rationale remain in their contract roles. |
| `spec/language.sigil:522–760 (expand SigilLanguage, decisions)` | `spec/language.sigil:234 :: SigilLanguage / decisions` | Obsolete language semantics replaced under R3; retained policy and rationale remain in their contract roles. |
| `spec/language.sigil:762–938 (expand SigilLanguage, cases)` | `spec/language.sigil:396 :: SigilLanguage / cases` | Obsolete language semantics replaced under R3; retained policy and rationale remain in their contract roles. |
| `spec/language.sigil:942–948 (component SigilWorkspaceConfig, goal)` | `spec/language.sigil:430 :: SigilWorkspaceConfig / goal` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `spec/language.sigil:950–978 (component SigilWorkspaceConfig, interface)` | `spec/language.sigil:438 :: SigilWorkspaceConfig / interface` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `spec/language.sigil:982–1019 (expand SigilWorkspaceConfig, constraints)` | `spec/language.sigil:522 :: SigilWorkspaceConfig / constraints` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `spec/language.sigil:1021–1042 (expand SigilWorkspaceConfig, decisions)` | `spec/language.sigil:621 :: SigilWorkspaceConfig / decisions` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `spec/language.sigil:1046–1051 (component SigilModuleIndex, goal)` | `Retired` | KTD1; ordinary summary and explicit import rules now in SigilLanguage. |
| `spec/language.sigil:1053–1079 (component SigilModuleIndex, interface)` | `Retired` | KTD1; ordinary summary and explicit import rules now in SigilLanguage. |
| `spec/language.sigil:1083–1095 (expand SigilModuleIndex, logic)` | `Retired` | KTD1; ordinary summary and explicit import rules now in SigilLanguage. |
| `spec/language.sigil:1097–1150 (expand SigilModuleIndex, constraints)` | `Retired` | KTD1; ordinary summary and explicit import rules now in SigilLanguage. |
| `spec/language.sigil:1152–1199 (expand SigilModuleIndex, decisions)` | `Retired` | KTD1; ordinary summary and explicit import rules now in SigilLanguage. |
| `spec/language.sigil:1201–1251 (expand SigilModuleIndex, cases)` | `Retired` | KTD1; ordinary summary and explicit import rules now in SigilLanguage. |
| `spec/glossary.sigil:4–11 (component SigilWorkspaceGlossary, goal)` | `spec/glossary.sigil:2 :: SigilWorkspaceGlossary / goal` | Consolidated without changing the contract role. |
| `spec/glossary.sigil:13–73 (component SigilWorkspaceGlossary, interface)` | `spec/glossary.sigil:11 :: SigilWorkspaceGlossary / interface` | Consolidated without changing the contract role. |
| `spec/glossary.sigil:77–98 (expand SigilWorkspaceGlossary, logic)` | `spec/glossary.sigil:77 :: SigilWorkspaceGlossary / logic` | Consolidated without changing the contract role. |
| `spec/glossary.sigil:100–140 (expand SigilWorkspaceGlossary, constraints)` | `spec/glossary.sigil:100 :: SigilWorkspaceGlossary / constraints` | Consolidated without changing the contract role. |
| `spec/glossary.sigil:142–205 (expand SigilWorkspaceGlossary, decisions)` | `spec/glossary.sigil:142 :: SigilWorkspaceGlossary / decisions` | Consolidated without changing the contract role. |
| `spec/glossary.sigil:207–230 (expand SigilWorkspaceGlossary, cases)` | `spec/glossary.sigil:207 :: SigilWorkspaceGlossary / cases` | Consolidated without changing the contract role. |
| `packages/core/config.sigil:6–12 (component SigilConfigurationParser, goal)` | `packages/core/config.sigil:5 :: SigilConfigurationParser / goal` | Consolidated without changing the contract role. |
| `packages/core/config.sigil:14–22 (component SigilConfigurationParser, interface)` | `packages/core/config.sigil:13 :: SigilConfigurationParser / interface` | Consolidated without changing the contract role. |
| `packages/core/config.sigil:26–44 (expand SigilWorkspaceConfig, constraints)` | `spec/language.sigil:522 :: SigilWorkspaceConfig / constraints` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `packages/core/config.sigil:46–55 (expand SigilWorkspaceConfig, cases)` | `spec/language.sigil:644 :: SigilWorkspaceConfig / cases` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `packages/core/config.sigil:59–67 (expand SigilConfigurationParser, logic)` | `packages/core/config.sigil:23 :: SigilConfigurationParser / logic` | Consolidated without changing the contract role. |
| `packages/core/config.sigil:69–83 (expand SigilConfigurationParser, constraints)` | `packages/core/config.sigil:36 :: SigilConfigurationParser / constraints` | Consolidated without changing the contract role. |
| `packages/core/config.sigil:85–100 (expand SigilConfigurationParser, decisions)` | `packages/core/config.sigil:52 :: SigilConfigurationParser / decisions` | Consolidated without changing the contract role. |
| `packages/core/config.sigil:102–109 (expand SigilConfigurationParser, cases)` | `packages/core/config.sigil:69 :: SigilConfigurationParser / cases` | Consolidated without changing the contract role. |
| `packages/core/config.sigil:113–128 (expand SigilWorkspaceConfig, state)` | `spec/language.sigil:468 :: SigilWorkspaceConfig / state` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `packages/core/config.sigil:130–164 (expand SigilWorkspaceConfig, logic)` | `spec/language.sigil:486 :: SigilWorkspaceConfig / logic` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `packages/core/config.sigil:166–206 (expand SigilWorkspaceConfig, constraints)` | `spec/language.sigil:522 :: SigilWorkspaceConfig / constraints` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `packages/core/config.sigil:208–248 (expand SigilWorkspaceConfig, cases)` | `spec/language.sigil:644 :: SigilWorkspaceConfig / cases` | Preserved; retired index wording and ambiguous root wording updated to adopted authority. |
| `packages/core/src/model/_module.sigil:13–16 (component SigilSemanticModel, goal)` | `packages/core/src/model/_module.sigil:2 :: SigilSemanticModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/_module.sigil:18–25 (component SigilSemanticModel, interface)` | `packages/core/src/model/_module.sigil:7 :: SigilSemanticModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/_module.sigil:29–34 (expand SigilSemanticModel, constraints)` | `packages/core/src/model/_module.sigil:18 :: SigilSemanticModel / constraints` | Consolidated without changing the contract role. |
| `packages/core/src/model/_module.sigil:36–53 (expand SigilSemanticModel, decisions)` | `packages/core/src/model/_module.sigil:25 :: SigilSemanticModel / decisions` | Consolidated without changing the contract role. |
| `packages/core/src/model/configuration.sigil:4–7 (component SigilConfigurationModel, goal)` | `packages/core/src/model/configuration.sigil:4 :: SigilConfigurationModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/configuration.sigil:9–15 (component SigilConfigurationModel, interface)` | `packages/core/src/model/configuration.sigil:9 :: SigilConfigurationModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/diagnostics.sigil:4–6 (component SigilDiagnosticModel, goal)` | `packages/core/src/model/diagnostics.sigil:4 :: SigilDiagnosticModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/diagnostics.sigil:8–14 (component SigilDiagnosticModel, interface)` | `packages/core/src/model/diagnostics.sigil:8 :: SigilDiagnosticModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/glossary.sigil:5–8 (component SigilGlossaryModel, goal)` | `packages/core/src/model/glossary.sigil:5 :: SigilGlossaryModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/glossary.sigil:10–17 (component SigilGlossaryModel, interface)` | `packages/core/src/model/glossary.sigil:10 :: SigilGlossaryModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/graph.sigil:5–7 (component SigilGraphModel, goal)` | `packages/core/src/model/graph.sigil:5 :: SigilGraphModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/graph.sigil:9–15 (component SigilGraphModel, interface)` | `packages/core/src/model/graph.sigil:9 :: SigilGraphModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/language.sigil:2–5 (component SigilLanguageModel, goal)` | `packages/core/src/model/language.sigil:2 :: SigilLanguageModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/language.sigil:7–13 (component SigilLanguageModel, interface)` | `packages/core/src/model/language.sigil:7 :: SigilLanguageModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/language.sigil:17–32 (expand SigilLanguageModel, decisions)` | `packages/core/src/model/language.sigil:23 :: SigilLanguageModel / decisions` | Consolidated without changing the contract role. |
| `packages/core/src/model/ownership.sigil:5–8 (component SigilImplementationOwnershipModel, goal)` | `packages/core/src/model/ownership.sigil:5 :: SigilImplementationOwnershipModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/ownership.sigil:10–17 (component SigilImplementationOwnershipModel, interface)` | `packages/core/src/model/ownership.sigil:10 :: SigilImplementationOwnershipModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/resolution.sigil:5–7 (component SigilResolutionModel, goal)` | `packages/core/src/model/resolution.sigil:5 :: SigilResolutionModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/resolution.sigil:9–23 (component SigilResolutionModel, interface)` | `packages/core/src/model/resolution.sigil:9 :: SigilResolutionModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/retrieval.sigil:5–8 (component SigilRetrievalModel, goal)` | `packages/core/src/model/retrieval.sigil:5 :: SigilRetrievalModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/retrieval.sigil:10–67 (component SigilRetrievalModel, interface)` | `packages/core/src/model/retrieval.sigil:10 :: SigilRetrievalModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/retrieval.sigil:69–96 (component SigilRetrievalModel, constraints)` | `packages/core/src/model/retrieval.sigil:73 :: SigilRetrievalModel / constraints` | Consolidated without changing the contract role. |
| `packages/core/src/model/retrieval.sigil:98–167 (component SigilRetrievalModel, decisions)` | `packages/core/src/model/retrieval.sigil:102 :: SigilRetrievalModel / decisions` | Consolidated without changing the contract role. |
| `packages/core/src/model/retrieval.sigil:169–196 (component SigilRetrievalModel, cases)` | `packages/core/src/model/retrieval.sigil:174 :: SigilRetrievalModel / cases` | Consolidated without changing the contract role. |
| `packages/core/src/model/source.sigil:5–8 (component SigilSourceModel, goal)` | `packages/core/src/model/source.sigil:5 :: SigilSourceModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/source.sigil:10–34 (component SigilSourceModel, interface)` | `packages/core/src/model/source.sigil:10 :: SigilSourceModel / interface` | Consolidated without changing the contract role. |
| `packages/core/src/model/workspace.sigil:7–10 (component SigilWorkspaceModel, goal)` | `packages/core/src/model/workspace.sigil:7 :: SigilWorkspaceModel / goal` | Consolidated without changing the contract role. |
| `packages/core/src/model/workspace.sigil:12–19 (component SigilWorkspaceModel, interface)` | `packages/core/src/model/workspace.sigil:12 :: SigilWorkspaceModel / interface` | Consolidated without changing the contract role. |

## Named locator changes

| Prior identity or interpretation | Current meaning |
| --- | --- |
| `SigilLanguage::ConceptIdentity` | `SigilLanguage::TagIdentity`; exact owner-scoped identity, local grouping, and selected imports replace Concept visibility and expansion reuse. |
| `SigilLanguage::StrictImportUse` | `ImportSemantics` and reference `import.use`; each unambiguous selection needs eligible prose use in any contract. |
| `SigilLanguage::ExplicitCrossFileExpansion` | Retired; the owning component contains all contributions under `ComponentContract`. |
| `SigilLanguage::DeclarationMultiplicity` | Same constraint locator; one section per kind, invalid duplicate definitions/selections, and reusable local headings replace legacy composition. |
| `SigilLanguage::SourceGrammar` and `SourceRecovery` | Same interface locators; shared reference and EBNF replace embedded 0.7 grammar and recovery matrix. |
| `SigilWorkspaceConfig::ModuleIndexFile` | `SigilWorkspaceConfig::SummaryFiles`; ordinary summaries have no discovery or membership authority. |
| `SigilModuleIndex::*` | Retired language owner; explicit Tag selection is `SigilLanguage::ImportSemantics`, while configured boundaries remain `SigilWorkspaceConfig::WorkspaceBoundary`. |
| `SigilSemanticModel::ModelNamespace` and `DomainModelAssembly` | Locators retained as ordinary documentary summary commitments with no namespace or re-export behavior. |
| All configuration-parser and domain-model component/group locators | Retained at their existing declaration paths; provider component imports become exact selections of their existing `*Model` grouping Tags. |

## Annotation handoff

The existing implementation/test annotations were inspected only as locator text, without comparing implementation behavior. Existing configuration and model locators remain valid owner/group targets after consolidation. These annotations target the retired language module-index owner and require later implementation-unit updates:

- `packages/core/tests/core_test.ts:428` and `:1074`: `SigilModuleIndex::ModuleIndexContents`.
- `packages/core/tests/core_test.ts:963`: `SigilModuleIndex::DirectoryImportSurface`.
- `packages/core/tests/core_test.ts:1022` and `:1052`: `SigilModuleIndex::ModuleIndexFile`.

Those tests describe retired behavior; update their scenarios with the implementation migration before selecting an applicable current owner. U1 changes no annotations or tests.

## Facet, payload, and link preservation

Configuration and glossary contributions keep their original paragraph boundaries, source-owner identities, contract roles, and policy. Cross-file config movement preserves section contribution order; there were no relative Inline Links or fenced payloads in those moved contributions. The root is explicitly the parent of `.sigil`, per the reference. Glossary matching remains independently governed, including its pre-existing inline-code and URL exclusions.

The language owner intentionally retires its fenced 0.7 grammar and diagnostic matrix under R3. Their exact original bytes remain in the baseline, rather than appearing as an alternative normative grammar in the 0.8 source. All remaining legacy language obligations are mapped to the shared reference or retained author policy. Model Facets keep their contract roles; source and resolution structures replace legacy Concept/expand fields with distinct 0.8 records. Retrieval preserves independent raw/projection ownership, deterministic ordering, projection membership, fingerprints, glossary behavior, and advisory ownership links.

New Inline Links resolve from each authored source directory. The model summary links directly to its domain-owner files; the config parser links to `packages/core/src/diagnostics.sigil` for diagnostic construction, whose later language migration belongs to U2. Existing U1 sources contained no Inline Link targets requiring rebasing.

## Scope limitation

This map is U1 evidence, not proof of complete downstream migration, language compilation, or implementation conformance. U2 must review the combined dependency closure before implementation.
