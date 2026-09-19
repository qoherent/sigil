import type { SigilDiagnostic } from "./diagnostics.ts";
import type { GlossaryProjection } from "./glossary.ts";
import type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
import type {
  ComponentDeclaration,
  TagGroup,
  ExpandDeclaration,
  ImportDeclaration,
  Section,
} from "./source.ts";
import type { SigilWorkspace } from "./workspace.ts";
import type { ImportedComponentEdge, SigilGraph } from "./graph.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type { GlossaryProjection } from "./glossary.ts";
export type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
export type {
  ComponentDeclaration,
  TagGroup,
  ExpandDeclaration,
  ImportDeclaration,
  Section,
  Facet,
} from "./source.ts";
export type { SigilWorkspace } from "./workspace.ts";
export type { ImportedComponentEdge, SigilGraph } from "./graph.ts";

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
    | "public-tag-reference"
    | "structural-expand";
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

export interface TagGroupView {
  readonly identifier: string;
  readonly lines: readonly string[];
  readonly sourceRange: TagGroup["range"];
}

export interface ComponentContractView {
  readonly name: string;
  readonly filePath: string;
  readonly goalLines: readonly string[];
  readonly interfaceLines: readonly string[];
  readonly ungroupedInterfaceLines: readonly string[];
  readonly interfaceTags: readonly TagGroupView[];
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
  readonly tagScope: ResolvedTagScope;
}

/**
 * Origin identity shared by related Concept occurrences across contracts.
 * Reuse an accessible imported identity when meaning matches; consumer Facets
 * retain their context rather than becoming provider-owned requirements.
 */
export interface TagIdentity {
  readonly identifier: string;
  readonly normalizedIdentifier: string;
  readonly componentName: string;
  readonly filePath: string;
}

export interface ResolvedTagOccurrence {
  readonly componentName: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly sectionName: SigilSectionName;
  readonly block: TagGroup;
}

/**
 * Collective occurrences of one Concept, retaining each contract and location.
 * Identity groups contributions; it does not make their meanings equivalent.
 * Direct Facets remain on their sections, outside this collection.
 */
export interface ResolvedTag {
  readonly identity: TagIdentity;
  readonly identifier: string;
  readonly isPublic: boolean;
  readonly isImported: boolean;
  readonly occurrences: readonly ResolvedTagOccurrence[];
}

export interface ResolvedTagReference {
  readonly tagIdentity: TagIdentity;
  readonly componentName: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly range: SourceRange;
}

export interface ResolvedTagScope {
  readonly componentName: string;
  readonly tags: readonly ResolvedTag[];
  readonly accessibleTags: readonly ResolvedTag[];
  readonly publicTags: readonly ResolvedTag[];
  readonly references: readonly ResolvedTagReference[];
}

// @sigil implements packages/core/src/model/resolution.sigil::SigilResolutionModel::ResolutionModel interface
export interface SigilResolution {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/core/src/model/resolution.sigil::SigilResolutionModel::ResolutionModel interface
export interface ResolvedSigilWorkspace {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly graph: SigilGraph;
  readonly glossary: GlossaryProjection;
  readonly diagnostics: readonly SigilDiagnostic[];
}
