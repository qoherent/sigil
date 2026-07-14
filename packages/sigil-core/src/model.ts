export type SigilFormKind = "component" | "expand";
export type SigilSectionName =
  | "goal"
  | "interface"
  | "state"
  | "logic"
  | "constraints"
  | "cases";

export type SigilDiagnosticSeverity = "error" | "warning" | "info";

export type SigilDiagnosticCode =
  | "SIGIL_PARSE_STRUCTURE"
  | "SIGIL_UNKNOWN_SECTION"
  | "SIGIL_MISSING_GOAL"
  | "SIGIL_MISSING_INTERFACE"
  | "SIGIL_UNRESOLVED_IMPORT_PATH"
  | "SIGIL_UNRESOLVED_IMPORTED_COMPONENT"
  | "SIGIL_INVALID_ROOT_MODULE"
  | "SIGIL_INVALID_DIRECTORY_IMPORT"
  | "SIGIL_EXPAND_WITHOUT_COMPONENT"
  | "SIGIL_DUPLICATE_COMPONENT"
  | "SIGIL_IMPORT_CYCLE"
  | "SIGIL_CONFIG_NOT_FOUND"
  | "SIGIL_CONFIG_PARSE"
  | "SIGIL_CONFIG_INVALID"
  | "SIGIL_UNSUPPORTED_CONFIG_VERSION"
  | "SIGIL_UNSUPPORTED_LANGUAGE_VERSION"
  | "SIGIL_NESTED_CONFIG"
  | "SIGIL_CONFIG_EXISTS";

export const SIGIL_CONFIG_VERSION = "1.0.0" as const;
export const SIGIL_LANGUAGE_VERSION = "1.0.0" as const;
export const SIGIL_CORE_VERSION = "1.0.0" as const;

export interface SigilWorkspaceConfig {
  readonly name: string;
  readonly members: readonly string[];
}

export interface SigilFileDiscoveryConfig {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface SigilConfig {
  readonly configVersion: string;
  readonly languageVersion: string;
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

export interface SemanticLine {
  readonly filePath: string;
  readonly range: SourceRange;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly text: string;
}

export interface Section {
  readonly name: SigilSectionName;
  readonly range: SourceRange;
  readonly bodyRange: SourceRange;
  readonly lines: readonly SemanticLine[];
}

export interface ImportDeclaration {
  readonly path: string;
  readonly names: readonly string[];
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

export interface ParseOptions {
  readonly languageVersion: string;
}

export interface SigilFileSystem {
  readTextFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  listFiles(root: string): Promise<readonly string[]>;
}

export interface LoadedSigilFile {
  readonly path: string;
  readonly document: SigilDocument;
}

export interface SigilWorkspace {
  readonly root: string;
  readonly configPath?: string;
  readonly config?: SigilConfig;
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
}

export interface CollectedExpansion {
  readonly componentName: string;
  readonly expands: readonly ResolvedExpansion[];
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
}

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

export interface ResolvedSigilWorkspace {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly graph: SigilGraph;
  readonly diagnostics: readonly SigilDiagnostic[];
}
