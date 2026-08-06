import metadata from "../deno.json" with { type: "json" };

export type SigilFormKind = "component" | "expand";
export type SigilSectionName =
  | "goal"
  | "interface"
  | "state"
  | "logic"
  | "constraints"
  | "decisions"
  | "cases";

export type SigilDiagnosticSeverity = "error" | "warning" | "info";

export type SigilDiagnosticCode =
  | "SIGIL_PARSE_STRUCTURE"
  | "SIGIL_UNKNOWN_SECTION"
  | "SIGIL_MISSING_GOAL"
  | "SIGIL_MISSING_INTERFACE"
  | "SIGIL_MODULE_WITHOUT_COMPONENT"
  | "SIGIL_MISSING_CONCEPT_IDENTIFIER"
  | "SIGIL_INVALID_CONCEPT_IDENTIFIER"
  | "SIGIL_EMPTY_CONCEPT_BLOCK"
  | "SIGIL_NESTED_CONCEPT_BLOCK"
  | "SIGIL_AMBIGUOUS_CONCEPT_IDENTIFIER"
  | "SIGIL_CONCEPT_IDENTIFIER_STYLE"
  | "SIGIL_DETACHED_LITERAL_BLOCK"
  | "SIGIL_LITERAL_WITHOUT_INTRODUCTION"
  | "SIGIL_UNCLOSED_LITERAL_BLOCK"
  | "SIGIL_INVALID_LITERAL_TYPE"
  | "SIGIL_LINE_TOO_LONG"
  | "SIGIL_UNFORMATTABLE_LINE"
  | "SIGIL_UNRESOLVED_IMPORT_PATH"
  | "SIGIL_UNRESOLVED_IMPORTED_COMPONENT"
  | "SIGIL_UNUSED_IMPORT"
  | "SIGIL_EXPAND_WITHOUT_COMPONENT"
  | "SIGIL_DUPLICATE_COMPONENT"
  | "SIGIL_IMPORT_CYCLE"
  | "SIGIL_CONFIG_NOT_FOUND"
  | "SIGIL_CONFIG_PARSE"
  | "SIGIL_CONFIG_INVALID"
  | "SIGIL_UNSUPPORTED_VERSION"
  | "SIGIL_NESTED_CONFIG"
  | "SIGIL_CONFIG_EXISTS"
  | "SIGIL_GLOSSARY_PARSE"
  | "SIGIL_GLOSSARY_INVALID"
  | "SIGIL_GLOSSARY_CONTEXT_OVERLAP"
  | "SIGIL_GLOSSARY_TERM_COLLISION"
  | "SIGIL_IMPLEMENTATION_SOURCE_DISCOVERY"
  | "SIGIL_RETRIEVAL_TARGET_PATH_INVALID"
  | "SIGIL_RETRIEVAL_COMPONENT_NOT_FOUND"
  | "SIGIL_RETRIEVAL_COMPONENT_IDENTITY_MISMATCH"
  | "SIGIL_RETRIEVAL_FILE_NOT_FOUND"
  | "SIGIL_RETRIEVAL_FILE_EMPTY"
  | "SIGIL_RETRIEVAL_IMPLEMENTATION_DISCOVERY_UNAVAILABLE"
  | "SIGIL_RETRIEVAL_IDENTITY_COLLISION"
  | "SIGIL_RETRIEVAL_EVIDENCE_SNAPSHOT_MISMATCH";

export const SIGIL_VERSION = "0.7.0";
export const SIGIL_CORE_VERSION = metadata.version;
export const SIGIL_CONFIG_PATH = ".sigil/config.json" as const;
export const SIGIL_GLOSSARY_PATH = ".sigil/glossary.json" as const;

export interface SigilWorkspaceConfig {
  readonly name: string;
  readonly members: readonly string[];
}

export interface SigilFileDiscoveryConfig {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface SigilConfig {
  readonly sigilVersion: string;
  readonly workspace: SigilWorkspaceConfig;
  readonly files: SigilFileDiscoveryConfig;
  readonly tools: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface SigilConfigParseResult {
  readonly config?: SigilConfig;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
}

export interface SigilDiagnostic {
  readonly code: SigilDiagnosticCode;
  readonly severity: SigilDiagnosticSeverity;
  readonly message: string;
  readonly filePath?: string;
  readonly range?: SourceRange;
}

export interface LiteralBlock {
  readonly type?: string;
  readonly body: string;
  readonly sourceLines: readonly string[];
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly fenceLength: number;
  readonly indentation: number;
}

export interface SemanticUnit {
  readonly filePath: string;
  readonly range: SourceRange;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly conceptIdentifier?: string;
  readonly prose: string;
  readonly sourceLines: readonly string[];
  readonly literalBlocks: readonly LiteralBlock[];
}

export interface ConceptBlock {
  readonly identifier: string;
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly units: readonly SemanticUnit[];
}

export interface Section {
  readonly name: SigilSectionName;
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly units: readonly SemanticUnit[];
  readonly concepts: readonly ConceptBlock[];
}

export interface ImportDeclaration {
  readonly path: string;
  readonly names: readonly string[];
  readonly nameRanges: readonly SourceRange[];
  readonly range: SourceRange;
}

export interface ComponentDeclaration {
  readonly kind: "component";
  readonly name: string;
  readonly range: SourceRange;
  readonly sections: readonly Section[];
}

export interface ExpandDeclaration {
  readonly kind: "expand";
  readonly name: string;
  readonly range: SourceRange;
  readonly sections: readonly Section[];
}

// @sigil implements packages/core/src/model.sigil::SigilSemanticModel::SourceModel interface,constraints,cases
export interface SigilDocument {
  readonly filePath: string;
  readonly imports: readonly ImportDeclaration[];
  readonly components: readonly ComponentDeclaration[];
  readonly expands: readonly ExpandDeclaration[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ParseResult {
  readonly document: SigilDocument;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface FormatResult {
  readonly formattedSource?: string;
  readonly changed: boolean;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ParseOptions {
  readonly sigilVersion: string;
}

export type GlossaryScope =
  | { readonly kind: "workspace" }
  | { readonly kind: "context"; readonly id: string };

export interface GlossaryTerm {
  readonly term: string;
  readonly definition: string;
  readonly aliases: readonly string[];
  readonly agentContext: boolean;
  readonly scope: GlossaryScope;
  readonly declarationRange: SourceRange;
}

export interface GlossaryContext {
  readonly id: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly terms: readonly GlossaryTerm[];
}

// @sigil implements packages/core/src/model.sigil::SigilSemanticModel::GlossaryModel interface,constraints,cases
export interface WorkspaceGlossary {
  readonly schemaVersion: 1;
  readonly filePath: string;
  readonly terms: readonly GlossaryTerm[];
  readonly contexts: readonly GlossaryContext[];
}

export interface GlossaryParseResult {
  readonly glossary?: WorkspaceGlossary;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ResolvedGlossaryContext {
  readonly filePath: string;
  readonly contextId?: string;
  readonly entries: readonly GlossaryTerm[];
}

export interface GlossaryOccurrence {
  readonly term: GlossaryTerm;
  readonly matchedSpelling: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly range: SourceRange;
}

export interface GlossaryProjection {
  readonly workspaceSnapshotIdentity: string;
  readonly glossaryPath?: string;
  readonly schemaVersion?: 1;
  readonly terms: readonly GlossaryTerm[];
  readonly contexts: readonly GlossaryContext[];
  readonly resolvedContexts: readonly ResolvedGlossaryContext[];
  readonly occurrences: readonly GlossaryOccurrence[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface GlossaryContextProjection {
  readonly glossaryPath?: string;
  readonly terms: readonly GlossaryTerm[];
  readonly resolvedContexts: readonly ResolvedGlossaryContext[];
  readonly occurrences: readonly GlossaryOccurrence[];
}

export type ImplementationRelation = "implements" | "uses" | "tests";

export type ImplementationSection =
  | "interface"
  | "state"
  | "logic"
  | "constraints"
  | "cases";

export type ImplementationArtifactKind = "code" | "test" | "markdown";

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::OwnedImplementationLookup interface,cases
export interface ImplementationSource {
  readonly filePath: string;
  readonly text: string;
}

export interface ImplementationEvidenceInput {
  readonly workspaceSnapshotIdentity: string;
  readonly discoveryState: "complete" | "unavailable";
  readonly sources: readonly ImplementationSource[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ComponentIdentity {
  readonly componentName: string;
  readonly declarationPath: string;
}

export interface OwnedImplementationTarget {
  readonly relation: ImplementationRelation;
  readonly artifactKind: ImplementationArtifactKind;
  readonly filePath: string;
  readonly sections: readonly ImplementationSection[];
  readonly symbolIdentity?: string;
  readonly range?: SourceRange;
  readonly targetRange?: SourceRange;
  readonly annotationRange: SourceRange;
}

export interface OwnedImplementationProjection {
  readonly owningComponent: ResolvedComponent;
  readonly concept?: ResolvedConcept;
  readonly sectionName?: ImplementationSection;
  readonly targets: readonly OwnedImplementationTarget[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/core/src/model.sigil::SigilSemanticModel::FileSystemModel interface
export interface SigilFileSystem {
  readTextFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  listFiles(root: string): Promise<readonly string[]>;
}

export interface LoadedSigilFile {
  readonly path: string;
  readonly source?: string;
  readonly document: SigilDocument;
}

export interface SigilWorkspace {
  readonly root: string;
  readonly workspaceSnapshotIdentity: string;
  readonly configPath?: string;
  readonly config?: SigilConfig;
  readonly glossaryPath?: string;
  readonly glossary?: WorkspaceGlossary;
  readonly memberRoots: readonly string[];
  readonly files: readonly LoadedSigilFile[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface WorkspaceLoadOptions {
  readonly startPath: string;
  readonly explicitRoot?: string;
  readonly currentDirectory?: string;
}

export interface ResolvedImport {
  readonly declaration: ImportDeclaration;
  readonly sourceFile: string;
  readonly targetFile?: string;
  readonly names: readonly ResolvedImportName[];
}

export interface ResolvedImportName {
  readonly name: string;
  readonly component?: ComponentDeclaration;
  readonly componentFile?: string;
  readonly used: boolean;
  readonly uses: readonly ImportUse[];
}

export interface ImportUse {
  readonly kind:
    | "component-reference"
    | "public-concept-reference"
    | "structural-expand"
    | "module-index-surface";
  readonly filePath: string;
  readonly ownerKind?: SigilFormKind;
  readonly ownerName?: string;
  readonly sectionName?: SigilSectionName;
  readonly range: SourceRange;
}

export interface CollectedExpansion {
  readonly componentName: string;
  readonly expands: readonly ResolvedExpansion[];
}

export interface ConceptBlockView {
  readonly identifier: string;
  readonly lines: readonly string[];
  readonly sourceRange: ConceptBlock["range"];
}

export interface ComponentContractView {
  readonly name: string;
  readonly filePath: string;
  readonly goalLines: readonly string[];
  readonly interfaceLines: readonly string[];
  readonly ungroupedInterfaceLines: readonly string[];
  readonly interfaceConcepts: readonly ConceptBlockView[];
}

export interface DependencyDecisionView {
  readonly componentName: string;
  readonly filePath: string;
  readonly section: Section;
}

export interface AgentDependencyContext {
  readonly selectedComponent: ResolvedComponent;
  readonly collectedExpansion: CollectedExpansion;
  readonly dependencyContracts: readonly ComponentContractView[];
  readonly dependencyDecisions: readonly DependencyDecisionView[];
  readonly relatedFilePaths: readonly string[];
}

export interface AgentDependentContext {
  readonly selectedComponent: ResolvedComponent;
  readonly importingFiles: readonly DependentImportingFileContext[];
  readonly relatedFilePaths: readonly string[];
}

export interface DependentImportingFileContext {
  readonly filePath: string;
  readonly importedComponent: ImportedComponentReference;
  readonly importEdges: readonly ImportedComponentEdge[];
  readonly contextualContracts: readonly ComponentContractView[];
}

export interface ImportedComponentReference {
  readonly name: string;
  readonly filePath: string;
}

export interface ResolvedExpansion {
  readonly filePath: string;
  readonly declaration: ExpandDeclaration;
}

export interface ResolvedComponent {
  readonly name: string;
  readonly declaration: ComponentDeclaration;
  readonly filePath: string;
  readonly expansions: CollectedExpansion;
  readonly conceptNamespace: ResolvedConceptNamespace;
}

export interface ConceptIdentity {
  readonly identifier: string;
  readonly normalizedIdentifier: string;
  readonly componentName: string;
  readonly filePath: string;
}

export interface ResolvedConceptOccurrence {
  readonly componentName: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly sectionName: SigilSectionName;
  readonly block: ConceptBlock;
}

export interface ResolvedConcept {
  readonly identity: ConceptIdentity;
  readonly identifier: string;
  readonly isPublic: boolean;
  readonly isImported: boolean;
  readonly occurrences: readonly ResolvedConceptOccurrence[];
}

export interface ResolvedConceptReference {
  readonly conceptIdentity: ConceptIdentity;
  readonly componentName: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly range: SourceRange;
}

export interface ResolvedConceptNamespace {
  readonly componentName: string;
  readonly concepts: readonly ResolvedConcept[];
  readonly accessibleConcepts: readonly ResolvedConcept[];
  readonly publicConcepts: readonly ResolvedConcept[];
  readonly references: readonly ResolvedConceptReference[];
}

// @sigil implements packages/core/src/model.sigil::SigilSemanticModel::ResolutionModel interface,constraints,cases
export interface SigilResolution {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/core/src/model.sigil::SigilSemanticModel::GraphModel interface
export interface SigilGraph {
  readonly componentNodes: readonly ComponentNode[];
  readonly fileEdges: readonly FileDependencyEdge[];
  readonly importedComponentEdges: readonly ImportedComponentEdge[];
  readonly componentExpansionEdges: readonly ComponentExpansionEdge[];
}

export interface ComponentNode {
  readonly name: string;
  readonly filePath: string;
}

export interface ImportedComponentEdge {
  readonly sourceFile: string;
  readonly targetFile: string;
  readonly componentName: string;
  readonly importPath: string;
  readonly sourceComponents: readonly ComponentIdentity[];
  readonly originRange: SourceRange;
}

export interface FileDependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly importPath: string;
}

export interface ComponentExpansionEdge {
  readonly componentName: string;
  readonly componentFile: string;
  readonly expandFile: string;
}

// @sigil implements packages/core/src/model.sigil::SigilSemanticModel::ResolvedWorkspaceModel interface,cases
export interface ResolvedSigilWorkspace {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly graph: SigilGraph;
  readonly glossary: GlossaryProjection;
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/core/src/model.sigil::SigilSemanticModel::RetrievalModel interface,constraints
export type RetrievalPurpose = "semantic" | "architecture" | "implementation";
export type PurposeRetrievalTarget =
  | {
    readonly kind: "component";
    readonly componentName: string;
    readonly path: string;
  }
  | { readonly kind: "file"; readonly path: string };
export interface RetrievalTargetIdentity {
  readonly kind: "component" | "file";
  readonly componentName?: string;
  readonly pathStatus: "accepted" | "rejected";
  readonly path: string;
}
export type RetrievalNodeKind =
  | "request-target"
  | "component-declaration"
  | "sigil-file"
  | "expansion"
  | "module-index"
  | "public-concept-origin"
  | "implementation-target"
  | "implementation-source";
export type RetrievalRelation =
  | "selected-declaration"
  | "matching-expansion"
  | "direct-dependency"
  | "direct-importer"
  | "containing-module-index"
  | "cycle-member"
  | "public-concept-origin"
  | "owned-implementation";
export type EvidenceKind =
  | "selected-contract"
  | "selected-expansion"
  | "dependency-contract"
  | "dependency-decision"
  | "importer-contract"
  | "cycle-contract"
  | "module-index-summary"
  | "public-concept-origin"
  | "glossary-definition"
  | "ownership-projection"
  | "implementation-source"
  | "diagnostic";
export interface RetrievalNode {
  readonly identity: string;
  readonly kind: RetrievalNodeKind;
  readonly path: string;
  readonly componentName?: string;
  readonly range?: SourceRange;
}
export interface RetrievalEdge {
  readonly identity: string;
  readonly relation: RetrievalRelation;
  readonly sourceIdentity: string;
  readonly targetIdentity: string;
  readonly originPath: string;
  readonly originRange?: SourceRange;
}
export interface SelectedRetrievalGraph {
  readonly nodes: readonly RetrievalNode[];
  readonly edges: readonly RetrievalEdge[];
}
export interface EvidenceUnit {
  readonly identity: string;
  readonly kind: EvidenceKind;
  readonly path?: string;
  readonly componentName?: string;
  readonly sectionName?: SigilSectionName | ImplementationSection;
  readonly conceptIdentity?: string;
  readonly range?: SourceRange;
  readonly text: string;
  readonly inclusionReasonIdentities: readonly string[];
}
export interface InclusionReason {
  readonly identity: string;
  readonly rule: string;
  readonly seedIdentity: string;
  readonly selectedIdentity: string;
  readonly edgeIdentities: readonly string[];
}
export interface ExcludedRelation {
  readonly identity: string;
  readonly rule: string;
  readonly edgeIdentity: string;
  readonly sourceIdentity: string;
  readonly targetIdentity: string;
}
export interface ContextSection {
  readonly kind: EvidenceKind;
  readonly text: string;
  readonly evidenceIdentity: string;
  readonly inclusionReasonIdentities: readonly string[];
}
export interface AggregatedRetrievalContext {
  readonly sections: readonly ContextSection[];
}
export interface PurposeRetrievalResult {
  readonly schema: "sigil-purpose-retrieval/v1";
  readonly policyVersion: 1;
  readonly workspaceSnapshotIdentity: string;
  readonly target: RetrievalTargetIdentity;
  readonly purpose: RetrievalPurpose;
  readonly graph: SelectedRetrievalGraph;
  readonly evidence: readonly EvidenceUnit[];
  readonly inclusionReasons: readonly InclusionReason[];
  readonly exclusions: readonly ExcludedRelation[];
  readonly context: AggregatedRetrievalContext;
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly fingerprint: string;
}
