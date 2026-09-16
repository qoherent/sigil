import type { ComponentDeclaration, Section, SourceRange } from "./source.ts";
import type { ImportedTagEdge } from "./graph.ts";
import type {
  ImportUse,
  ResolvedComponent,
  ResolvedImportName,
} from "./resolution.ts";
export interface TagBlockView {
  readonly name: string;
  readonly lines: readonly string[];
  readonly sourceRange: SourceRange;
}
export interface ComponentContractView {
  readonly name: string;
  readonly filePath: string;
  readonly declaration: ComponentDeclaration;
  readonly goalLines: readonly string[];
  readonly interfaceLines: readonly string[];
  readonly ungroupedInterfaceLines: readonly string[];
  readonly interfaceTags: readonly TagBlockView[];
}
export type TagNamespace = Pick<
  ResolvedComponent,
  "name" | "identity" | "tags" | "accessibleTags" | "references"
>;
export interface ProviderContext {
  readonly component: ResolvedComponent;
  readonly selections: readonly ResolvedImportName[];
  readonly uses: readonly ImportUse[];
}
export interface DependencyDecisionView {
  readonly componentName: string;
  readonly filePath: string;
  readonly section: Section;
}
export interface AgentDependencyContext {
  readonly selectedComponent: ResolvedComponent;
  readonly providers: readonly ProviderContext[];
  readonly dependencyContracts: readonly ComponentContractView[];
  readonly dependencyDecisions: readonly DependencyDecisionView[];
  readonly relatedFilePaths: readonly string[];
}
export interface DependentImportingFileContext {
  readonly filePath: string;
  readonly provider: ResolvedComponent;
  readonly importEdges: readonly ImportedTagEdge[];
  readonly contextualContracts: readonly ComponentContractView[];
}
export interface AgentDependentContext {
  readonly selectedComponent: ResolvedComponent;
  readonly importingFiles: readonly DependentImportingFileContext[];
  readonly relatedFilePaths: readonly string[];
}
