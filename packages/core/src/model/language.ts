import metadata from "../../deno.json" with { type: "json" };

export type SigilFormKind = "component";
export type SigilSectionName =
  | "goal"
  | "interface"
  | "state"
  | "logic"
  | "constraints"
  | "decisions"
  | "cases";

export type SigilDiagnosticSeverity = "error" | "warning" | "info";

export interface SourceLocation {
  /** One-based line and Unicode-scalar column in the original source. */
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  /** Half-open offsets in the original UTF-8 source. */
  readonly start: number;
  readonly end: number;
}

/** Implementation comments use their host's one-based UTF-16 coordinates. */
export interface ImplementationLocation {
  readonly line: number;
  readonly column: number;
}

export interface ImplementationRange {
  readonly start: ImplementationLocation;
  readonly end: ImplementationLocation;
}

export interface Utf16Position {
  readonly line: number;
  readonly character: number;
}

export const SIGIL_VERSION = "0.8.0";
export const SIGIL_CORE_VERSION = metadata.version;
export const SIGIL_CONFIG_PATH = ".sigil/config.json" as const;
export const SIGIL_LOCAL_CONFIG_PATH = ".sigil/local.json" as const;
export const SIGIL_GLOSSARY_PATH = ".sigil/glossary.json" as const;
