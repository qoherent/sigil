import type {
  CollectedExpansion,
  ComponentContractView,
  ResolvedComponent,
  SigilConfig,
  SigilDiagnostic,
  SigilDocument,
  SigilGraph,
} from "@sigil/core";

export type CommandResult =
  | InitCommandResult
  | VersionCommandResult
  | ParseCommandResult
  | CheckCommandResult
  | GraphCommandResult
  | ContextCommandResult
  | RenderCommandResult;
export interface DiagnosticCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
}
export interface WorkspaceMetadata {
  readonly workspaceRoot: string;
  readonly configPath: string | null;
  readonly configVersion: string | null;
  readonly languageVersion: string | null;
  readonly workspaceName: string | null;
}
export interface InitCommandResult extends WorkspaceMetadata {
  readonly command: "init";
  readonly config: SigilConfig | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface VersionCommandResult extends WorkspaceMetadata {
  readonly command: "version";
  readonly cliVersion: string;
  readonly coreVersion: string;
  readonly supportedConfigVersions: readonly string[];
  readonly supportedLanguageVersions: readonly string[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface ParseCommandResult extends WorkspaceMetadata {
  readonly command: "parse";
  readonly document: SigilDocument | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface CheckCommandResult extends WorkspaceMetadata {
  readonly command: "check";
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly diagnosticCounts: DiagnosticCounts;
}
export interface GraphCommandResult extends WorkspaceMetadata {
  readonly command: "graph";
  readonly graph: SigilGraph;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface ContextCommandResult extends WorkspaceMetadata {
  readonly command: "context";
  readonly selectedComponents: readonly ResolvedComponent[];
  readonly componentContracts: readonly ComponentContractView[];
  readonly collectedExpansions: readonly CollectedExpansion[];
  readonly relatedFilePaths: readonly string[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface RenderCommandResult extends WorkspaceMetadata {
  readonly command: "render";
  readonly markdown: string;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export function workspaceMetadata(
  workspace: {
    readonly root: string;
    readonly configPath?: string;
    readonly config?: SigilConfig;
  },
): WorkspaceMetadata {
  return {
    workspaceRoot: workspace.root,
    configPath: workspace.configPath ?? null,
    configVersion: workspace.config?.configVersion ?? null,
    languageVersion: workspace.config?.languageVersion ?? null,
    workspaceName: workspace.config?.workspace.name ?? null,
  };
}

export function diagnosticCounts(
  diagnostics: readonly SigilDiagnostic[],
): DiagnosticCounts {
  return {
    error: diagnostics.filter((item) => item.severity === "error").length,
    warning: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length,
  };
}
