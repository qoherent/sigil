import metadata from "../../deno.json" with { type: "json" };

export type SigilFormKind = "component" | "expand";
export type SigilSectionName =
  | "goal"
  | "interface"
  | "scope"
  | "state"
  | "logic"
  | "constraints"
  | "decisions"
  | "cases";

export type SigilDiagnosticSeverity = "error" | "warning" | "info";

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
}

export const SIGIL_VERSION = "0.8.0";
export const SIGIL_CORE_VERSION = metadata.version;
export const SIGIL_CONFIG_PATH = ".sigil/config.json" as const;
export const SIGIL_LOCAL_CONFIG_PATH = ".sigil/local.json" as const;
export const SIGIL_GLOSSARY_PATH = ".sigil/glossary.json" as const;
