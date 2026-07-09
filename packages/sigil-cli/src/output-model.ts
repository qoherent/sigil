import type {
  CollectedExpansion,
  ComponentContractView,
  ResolvedComponent,
  SigilDiagnostic,
  SigilDocument,
  SigilGraph,
} from "../../sigil-core/src/mod.ts";

export type CommandResult =
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

export interface ParseCommandResult {
  readonly command: "parse";
  readonly document: SigilDocument;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface CheckCommandResult {
  readonly command: "check";
  readonly workspaceRoot: string;
  readonly rootInferred: boolean;
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly diagnosticCounts: DiagnosticCounts;
}

export interface GraphCommandResult {
  readonly command: "graph";
  readonly workspaceRoot: string;
  readonly rootInferred: boolean;
  readonly graph: SigilGraph;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ContextCommandResult {
  readonly command: "context";
  readonly workspaceRoot: string;
  readonly rootInferred: boolean;
  readonly selectedComponents: readonly ResolvedComponent[];
  readonly componentContracts: readonly ComponentContractView[];
  readonly collectedExpansions: readonly CollectedExpansion[];
  readonly relatedFilePaths: readonly string[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface RenderCommandResult {
  readonly command: "render";
  readonly markdown: string;
  readonly diagnostics: readonly SigilDiagnostic[];
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
