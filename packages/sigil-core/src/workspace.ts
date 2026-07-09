import { diagnostic } from "./diagnostics.ts";
import type {
  LoadedSigilFile,
  SigilDiagnostic,
  SigilFileSystem,
  SigilWorkspace,
  WorkspaceLoadOptions,
} from "./model.ts";
import { parseSigilDocument } from "./parser.ts";
import { ancestorsFrom, isModuleFile, isSigilFile, joinPath, normalizePath } from "./path.ts";

export async function discoverSigilWorkspace(
  fs: SigilFileSystem,
  options: WorkspaceLoadOptions,
): Promise<{ root: string; rootInferred: boolean; rootModulePath?: string; diagnostics: SigilDiagnostic[] }> {
  if (options.explicitRoot) {
    const root = normalizePath(options.explicitRoot);
    const rootModulePath = joinPath(root, "#module.sigil");
    return {
      root,
      rootInferred: false,
      rootModulePath: await fs.exists(rootModulePath) ? rootModulePath : undefined,
      diagnostics: [],
    };
  }

  const candidates: string[] = [];
  for (const ancestor of ancestorsFrom(options.startPath)) {
    const modulePath = joinPath(ancestor, "#module.sigil");
    if (await fs.exists(modulePath)) candidates.push(ancestor);
  }

  if (candidates.length > 0) {
    const root = normalizePath(candidates.at(-1)!);
    return {
      root,
      rootInferred: false,
      rootModulePath: joinPath(root, "#module.sigil"),
      diagnostics: [],
    };
  }

  const root = normalizePath(options.currentDirectory ?? ".");
  return {
    root,
    rootInferred: true,
    diagnostics: [
      diagnostic(
        "SIGIL_INFERRED_WORKSPACE_ROOT",
        `No ancestor #module.sigil was found; inferred workspace root ${root}.`,
        { severity: "warning" },
      ),
    ],
  };
}

export async function loadSigilWorkspace(
  fs: SigilFileSystem,
  options: WorkspaceLoadOptions,
): Promise<SigilWorkspace> {
  const discovery = await discoverSigilWorkspace(fs, options);
  const diagnostics = [...discovery.diagnostics];
  const loadedFiles: LoadedSigilFile[] = [];
  const paths = (await fs.listFiles(discovery.root)).filter(isSigilFile);

  for (const path of paths) {
    try {
      const source = await fs.readTextFile(path);
      const parsed = parseSigilDocument(path, source);
      loadedFiles.push({ path, document: parsed.document });
      diagnostics.push(...parsed.diagnostics);
    } catch (error) {
      diagnostics.push(diagnostic(
        "SIGIL_UNRESOLVED_IMPORT_PATH",
        error instanceof Error ? error.message : `Unable to read ${path}.`,
        { filePath: path },
      ));
    }
  }

  return {
    root: discovery.root,
    rootInferred: discovery.rootInferred,
    rootModulePath: discovery.rootModulePath,
    files: loadedFiles,
    diagnostics,
  };
}

export function isWorkspaceRootModule(workspace: SigilWorkspace, path: string): boolean {
  return workspace.rootModulePath === normalizePath(path);
}

export function isNestedModuleSummary(workspace: SigilWorkspace, path: string): boolean {
  return isModuleFile(path) && !isWorkspaceRootModule(workspace, path);
}
