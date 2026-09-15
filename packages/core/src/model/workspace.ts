import type { SigilConfig } from "./configuration.ts";
import type { SigilDiagnostic } from "./diagnostics.ts";
import type { WorkspaceGlossary } from "./glossary.ts";
import type { SigilDocument } from "./source.ts";
import type { SourceInput } from "../source-text.ts";
export type { SigilConfig } from "./configuration.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type { WorkspaceGlossary } from "./glossary.ts";
export type { SigilDocument } from "./source.ts";

// @sigil implements packages/core/src/model/workspace.sigil::SigilWorkspaceModel::WorkspaceModel interface
export interface SigilFileSystem {
  /** Disk adapters return original bytes; editor overlays return supplied text. */
  readSourceFile(path: string): Promise<SourceInput>;
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
