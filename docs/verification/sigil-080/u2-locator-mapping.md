# U2 contribution and annotation locator mapping

All retained expands are consolidated into their existing declaring component and same contract section; repeated grouping occurrences remain additive. No U2 component moves to another source. The [machine-readable mapping](u2-locator-mapping.json) records every original expand, contract section, and grouping occurrence with its original line, current destination, and both source digests. Unmatched legacy-language groups are retired or replaced by the 0.8 commitments of the same owner, not runtime aliases.

## Language-dependent changes

- `ConceptIdentity`, `ConceptResolution`, `ConceptNamespaceProjection`, and `ConceptLanguageFeatures` become `TagIdentity`, `TagResolution`, `TagScopeProjection`, and `TagLanguageFeatures` where retained. Parser/resolver old Concept visibility, import-use, directory-surface, and expand collection rules are replaced under the adopted reference/grammar.
- `ExpansionProjection` becomes `ComponentDesignProjection`; the selected component exposes its complete declaration. `ModuleIndexContents`, `DirectoryImportSurface`, `CollectiveExpansions`, `ModuleIndexPreference`, `ExpandFileContextSelection`, and `ExpandPathOwnershipResolution` have no current-language counterpart. Their namespace/expand assumptions are retired, with ordinary-source selection and exact owner locators replacing them.
- Annotation locators keep the declaring file/component and selected contract role. Former expand-source locators must be updated in implementation units using this mapping; current runtime lookup does not redirect legacy paths. Component Tag suffixes may use exact JSON-quoted names. Imported Tag selections retain the provider origin separately from the consumer-owned Facets/implementation claim.
- Retrieval removes expansion and automatic module ancestry categories, retains purposes, deterministic ordering/identities, direct-use relevance, inclusion reasons, budget disclosure, and unavailable-evidence outcomes, and requires an updated policy identity for its changed vocabulary. Compact related-component projections do not replace full provider interpretation context in raw retrieval.
- Native frontend schema 2 and language 0.8.0 preserve source/Tag/Facet/link provenance; report schema 2 separately distinguishes byte ranges and Implementation coordinates. Existing objects are invalidated without translation or deletion. External producers prepare/ingest; editor commands export and compile stored projections.

## Preserved examples and historical context

The slotted `auth.sigil` import remains exactly `@user-profile.sigil from UserProfile import { UserProfile }`, resolved from the independent `examples/slotted` workspace root. `UserProfile` remains the provider-owned inline Tag. The Promise example validly introduces no Tags. The existing TypeScript payloads and calendar SVG link keep their exact contents/targets; multiline UserProfile signatures now use introduced payloads.

The old VS Code executable assertion for `User.email` has no corresponding Tag in current source. U9 must navigate a real selected Tag (the existing `UserProfile` selection is available); no new email Tag is introduced merely to preserve an obsolete test token.

All 12 `.sigil` files under `integrations/skills/sigil` remain frozen legacy 0.7 material. Root references are documentary history. Cutover removes that subtree from active discovery and reconciles any active annotation reference; the four-skill catalog retains its explicit incompatible legacy requirements.

## Evidence limits

Original bytes are in `/tmp/sigil080-execution/original`, with identities in `original-manifest.json`. The temporary authoring change log is `/tmp/sigil080-execution/u2-facet-changes.json`; it records paragraph-level language changes, not semantic approval. Existing payload byte sequences and current local documentary link targets were checked without invoking a compiler. Independent review and current freshness are recorded separately in [design-review.md](design-review.md). Implementation annotation edits, runtime tests, and cutover configuration remain later units.

## Owned source inventory

| Source | Current component owners |
| --- | --- |
| `.github/release.sigil` | `SigilReleaseDistribution` |
| `_module.sigil` | `Sigil` |
| `examples/promise/promise.sigil` | `Promise` |
| `examples/slotted/_module.sigil` | `Slotted` |
| `examples/slotted/auth.sigil` | `User`, `Auth` |
| `examples/slotted/booking-calendar-view.sigil` | `BookingCalendarView` |
| `examples/slotted/user-profile.sigil` | `UserProfile` |
| `integrations/editor/vscode/_module.sigil` | `SigilVsCodeExtension` |
| `integrations/editor/vscode/tests/extension/e2e-tester.sigil` | `SigilVsCodeE2ETester` |
| `packages/cli/_module.sigil` | `SigilCli` |
| `packages/cli/src/installer.sigil` | `SkillInstaller` |
| `packages/cli/src/retrieval-markdown.sigil` | `SigilRetrievalMarkdown` |
| `packages/cli/tests/fixtures/valid.sigil` | `Local` |
| `packages/core/_module.sigil` | `SigilCore` |
| `packages/core/src/compilation-boundary.sigil` | `SigilCompilationBoundary` |
| `packages/core/src/context-retrieval.sigil` | `SigilContextRetrieval` |
| `packages/core/src/design-input.sigil` | `SigilDesignInput` |
| `packages/core/src/diagnostics.sigil` | `SigilDiagnostics` |
| `packages/core/src/filesystem.sigil` | `SigilFileSystem` |
| `packages/core/src/formatter.sigil` | `SigilFormatter` |
| `packages/core/src/glossary.sigil` | `SigilGlossaryEngine` |
| `packages/core/src/graph.sigil` | `SigilGraphBuilder` |
| `packages/core/src/implementation-ownership.sigil` | `SigilImplementationOwnership` |
| `packages/core/src/parser.sigil` | `SigilParser` |
| `packages/core/src/path.sigil` | `SigilPath` |
| `packages/core/src/pipeline.sigil` | `SigilWorkspaceResolutionPipeline` |
| `packages/core/src/projections.sigil` | `SigilProjections` |
| `packages/core/src/resolver.sigil` | `SigilResolver` |
| `packages/core/src/workspace.sigil` | `SigilWorkspaceLoader` |
| `packages/lsp/_module.sigil` | `SigilLsp` |
| `packages/sigilc/_module.sigil` | `SigilSemanticCompiler` |
| `packages/sigilc/catalog.sigil` | `SigilEntityCatalog` |
| `packages/sigilc/eqval.sigil` | `SigilWorldClosure` |
| `packages/sigilc/report.sigil` | `SigilGateDiagnostics` |
| `packages/sigilc/scope.sigil` | `SigilComparisonScope` |
| `packages/sigilc/sources.sigil` | `SigilSourceIdentity` |
| `packages/sigilc/store.sigil` | `SigilProjectionStore` |
| `packages/sigilc/turtle.sigil` | `SigilTurtleInput` |
| `scripts/fixtures/release/project/main.sigil` | `ReleaseFixture` |

## Authorized U1 provider consistency correction

`packages/core/src/model/retrieval.sigil::SigilRetrievalModel` retains its owner and declaration path. Its U2 correction preserves consumer-owned OwnershipLinks while storing optional exact accessible Tag scope and originating owner separately from authored local grouping. Sigil projection locations retain authoritative bytes and captured identity alongside derived one-based scalar presentation; implementation coordinates remain explicitly distinct. Explicit project summaries use ordinary component roles. The current raw protocol is `sigil-purpose-retrieval/v2` with policy 2; the independently versioned agent protocol is `sigil-retrieval-projection/v2`. The original U1 summary is marked historical; its reports and hashes remain unchanged.

The JSON mapping records the exact before-U2 provider digest and final digest, with affected fields. These corrections follow KTD3/6/7 and the verified independent findings; there is no runtime v1 compatibility interpretation.

## User-directed explicit-import correction

The user rejected links to Sigil files as this repository's dependency notation. All such Inline Links have been removed from the 53 active designs. Supporting Markdown, schema, grammar, skill, and image links retain their targets. This is an authoring preference; the language-wide InlineLinks contract is unchanged. Legacy skill context uses the existing SKILL.md link and creates no current Tag import.

The [correction mapping](u2-import-correction-mapping.json) records 23 changed files, their exact before/after identities, 107 added import declarations with actual provider identities and digests, and all 19 local concern renames. The complete source inventory now has 129 import declarations selecting 168 Tags, including preexisting valid imports. These counts are audit evidence, not authoring targets. Consumers select required provider contracts and use them in their own Facets; operational model consumers import the actual domain owners instead of the old aggregate model namespace.

The main JSON mapping composes the original migration with these renames. For example, parser ConceptIdentity becomes TagIdentity in the first draft and TagSyntaxParsing now. Its original Logic, Constraints, and Cases destinations all remain under SigilParser. Later annotation edits must use the new local concerns below; a provider Tag selector is a different identity and must not substitute for the consumer's old local concern. WorkspaceDiscovery retains its name and all original contract roles.

| Source | Previous local concern | Current local concern |
| --- | --- | --- |
| `packages/core/src/parser.sigil` | `SourceDocument` | `DocumentParsing` |
| `packages/core/src/parser.sigil` | `SourceRecovery` | `ParserRecovery` |
| `packages/core/src/parser.sigil` | `ComponentContract` | `RequiredContractParsing` |
| `packages/core/src/parser.sigil` | `TagIdentity` | `TagSyntaxParsing` |
| `packages/core/src/parser.sigil` | `FormattingStyle` | `WidthChecking` |
| `packages/core/src/parser.sigil` | `LanguageVersion` | `VersionChecking` |
| `packages/core/src/parser.sigil` | `DiagnosticConstruction` | `ParserDiagnostics` |
| `packages/core/src/glossary.sigil` | `ContextResolution` | `ContextResolutionEngine` |
| `packages/core/src/glossary.sigil` | `TermRecognition` | `TermRecognitionEngine` |
| `packages/core/src/workspace.sigil` | `LocalToolConfiguration` | `LocalToolConfigurationLoading` |
| `packages/core/src/workspace.sigil` | `FileSystemPort` | `WorkspaceFileAccess` |
| `packages/core/src/workspace.sigil` | `GlossaryInterpretation` | `GlossaryInterpretationLoading` |
| `packages/cli/_module.sigil` | `SkillCatalog` | `CliSkillCatalog` |
| `packages/cli/_module.sigil` | `SkillInstallation` | `CliSkillInstallation` |
| `packages/cli/_module.sigil` | `GlossaryInspection` | `CliGlossaryInspection` |
| `packages/cli/_module.sigil` | `OwnershipDiagnostics` | `CliOwnershipDiagnostics` |
| `_module.sigil` | `LanguageVersion` | `RootLanguageVersion` |
| `_module.sigil` | `ComponentContract` | `RootComponentContract` |
| `_module.sigil` | `ConfigFile` | `RootWorkspaceConfiguration` |

The additional U1 changes are `packages/core/config.sigil`, `packages/core/src/model/_module.sigil`, and `spec/glossary.sigil`. Their component owners and contract roles remain unchanged; the main mapping records current contributions and exact identity deltas alongside the earlier retrieval-provider correction. All earlier review captures and reports remain immutable historical evidence. The new source revision requires fresh independent review.
