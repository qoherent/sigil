import type {
  AgentDependencyContext,
  AgentDependentContext,
  CollectedExpansion,
  ComponentContractView,
  GlossaryContext,
  GlossaryContextProjection,
  GlossaryOccurrence,
  GlossaryTerm,
  OwnedImplementationProjection,
  PurposeRetrievalResult,
  ResolvedComponent,
  ResolvedConceptNamespace,
  ResolvedGlossaryContext,
  SigilConfig,
  SigilDiagnostic,
  SigilDocument,
  SigilGraph,
} from "@qoherent/sigil-core";

export type CommandResult =
  | SkillListCommandResult
  | SkillInstallCommandResult
  | InitCommandResult
  | ConfigSetDefaultCommandResult
  | ConfigSetProfileCommandResult
  | VersionCommandResult
  | ParseCommandResult
  | CheckCommandResult
  | FmtCommandResult
  | GlossaryCommandResult
  | GraphCommandResult
  | ContextCommandResult
  | RetrieveCommandResult
  | RenderCommandResult;
export interface DiagnosticCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
}
export interface SkillListCommandResult {
  readonly command: "skill-list";
  readonly sourceDirectory: string;
  readonly skills: readonly string[];
  readonly supportedAgents: readonly string[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface SkillInstallCommandResult {
  readonly command: "skill-install";
  readonly scope: "global" | "project";
  readonly agents: readonly string[];
  readonly sourceDirectory: string;
  readonly skills: readonly {
    readonly name: string;
    readonly agents: readonly string[];
    readonly source: string;
    readonly target: string;
    readonly status:
      | "installed"
      | "updated"
      | "existing"
      | "copied";
  }[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface WorkspaceMetadata {
  readonly workspaceRoot: string;
  readonly configPath: string | null;
  readonly sigilVersion: string | null;
  readonly workspaceName: string | null;
}
export interface InitCommandResult extends WorkspaceMetadata {
  readonly command: "init";
  readonly config: SigilConfig | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface ConfigSetDefaultCommandResult extends WorkspaceMetadata {
  readonly command: "config-set-default";
  readonly config: SigilConfig | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface ConfigSetProfileCommandResult extends WorkspaceMetadata {
  readonly command: "config-set-profile";
  readonly config: SigilConfig | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface VersionCommandResult extends WorkspaceMetadata {
  readonly command: "version";
  readonly cliVersion: string;
  readonly coreVersion: string;
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
export interface FmtCommandResult extends WorkspaceMetadata {
  readonly command: "fmt";
  readonly check: boolean;
  readonly files: readonly {
    readonly filePath: string;
    readonly status: "formatted" | "unchanged" | "noncanonical" | "failed";
  }[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface GlossaryCommandResult extends WorkspaceMetadata {
  readonly command: "glossary";
  readonly glossaryPath: string | null;
  readonly schemaVersion: 1 | null;
  readonly terms: readonly GlossaryTerm[];
  readonly contexts: readonly GlossaryContext[];
  readonly resolvedContexts: readonly ResolvedGlossaryContext[];
  readonly occurrences: readonly GlossaryOccurrence[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface GraphCommandResult extends WorkspaceMetadata {
  readonly command: "graph";
  readonly graph: SigilGraph;
  readonly diagnostics: readonly SigilDiagnostic[];
}
// @sigil implements packages/cli/_module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
export interface ContextCommandResult extends WorkspaceMetadata {
  readonly command: "context";
  readonly selectedComponents: readonly ResolvedComponent[];
  readonly componentContracts: readonly ComponentContractView[];
  readonly conceptNamespaces: readonly ResolvedConceptNamespace[];
  readonly collectedExpansions: readonly CollectedExpansion[];
  readonly agentDependencyContexts: readonly AgentDependencyContext[];
  readonly agentDependentContexts?: readonly AgentDependentContext[];
  readonly ownedImplementationProjections:
    readonly OwnedImplementationProjection[];
  readonly relatedFilePaths: readonly string[];
  readonly glossaryContext: GlossaryContextProjection | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export type RetrieveCommandResult = PurposeRetrievalResult & {
  readonly command: "retrieve";
};
export interface RenderCommandResult extends WorkspaceMetadata {
  readonly command: "render";
  readonly markdown: string;
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
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
    sigilVersion: workspace.config?.sigilVersion ?? null,
    workspaceName: workspace.config?.workspace.name ?? null,
  };
}

// @sigil implements packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
export function diagnosticCounts(
  diagnostics: readonly SigilDiagnostic[],
): DiagnosticCounts {
  return {
    error: diagnostics.filter((item) => item.severity === "error").length,
    warning: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length,
  };
}
