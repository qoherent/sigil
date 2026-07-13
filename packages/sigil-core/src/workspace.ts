import {
  excludesSigilSubtree,
  matchesSigilFile,
  parseSigilConfig,
} from "./config.ts";
import { diagnostic } from "./diagnostics.ts";
import type {
  LoadedSigilFile,
  SigilConfig,
  SigilDiagnostic,
  SigilFileSystem,
  SigilWorkspace,
  WorkspaceLoadOptions,
} from "./model.ts";
import { parseSigilDocument } from "./parser.ts";
import {
  ancestorsFrom,
  basename,
  isModuleFile,
  joinPath,
  normalizePath,
  relativePath,
} from "./path.ts";

export interface WorkspaceDiscoveryResult {
  readonly root: string;
  readonly configPath?: string;
  readonly config?: SigilConfig;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export async function discoverSigilWorkspace(
  fs: SigilFileSystem,
  options: WorkspaceLoadOptions,
): Promise<WorkspaceDiscoveryResult> {
  if (options.explicitRoot) {
    const root = normalizePath(options.explicitRoot);
    return await readDiscoveredConfig(fs, root, joinPath(root, "sigil.config"));
  }

  const candidates: string[] = [];
  for (const ancestor of ancestorsFrom(options.startPath)) {
    if (await fs.exists(joinPath(ancestor, "sigil.config"))) {
      candidates.push(ancestor);
    }
  }

  if (candidates.length === 0) {
    const root = normalizePath(options.currentDirectory ?? ".");
    return {
      root,
      diagnostics: [diagnostic(
        "SIGIL_CONFIG_NOT_FOUND",
        `No ancestor sigil.config was found from ${
          normalizePath(options.startPath)
        }.`,
        { filePath: joinPath(root, "sigil.config") },
      )],
    };
  }

  const root = candidates[0];
  const selected = await readDiscoveredConfig(
    fs,
    root,
    joinPath(root, "sigil.config"),
  );
  if (!selected.config) return selected;

  for (const parentRoot of candidates.slice(1)) {
    const parent = await readDiscoveredConfig(
      fs,
      parentRoot,
      joinPath(parentRoot, "sigil.config"),
    );
    if (!parent.config) {
      return { root, diagnostics: parent.diagnostics };
    }
    const relativeRoot = relativePath(parentRoot, root);
    if (!excludesSigilSubtree(relativeRoot, parent.config)) {
      return {
        root,
        diagnostics: [diagnostic(
          "SIGIL_NESTED_CONFIG",
          `Workspace ${root} is nested inside parent workspace ${parentRoot} without being excluded by it.`,
          { filePath: selected.configPath },
        )],
      };
    }
  }

  return selected;
}

export async function loadSigilWorkspace(
  fs: SigilFileSystem,
  options: WorkspaceLoadOptions,
): Promise<SigilWorkspace> {
  const discovery = await discoverSigilWorkspace(fs, options);
  const diagnostics = [...discovery.diagnostics];
  const loadedFiles: LoadedSigilFile[] = [];
  if (!discovery.config || !discovery.configPath) {
    return { ...discovery, files: loadedFiles, diagnostics };
  }

  const allPaths = await fs.listFiles(discovery.root);
  const nestedConfigs = allPaths
    .map(normalizePath)
    .filter((path) =>
      basename(path) === "sigil.config" && path !== discovery.configPath
    )
    .sort();
  const nestedRoots = nestedConfigs.map((path) =>
    path.slice(0, -"/sigil.config".length)
  );
  for (let index = 0; index < nestedConfigs.length; index++) {
    const path = nestedConfigs[index];
    const nestedRoot = nestedRoots[index];
    if (
      excludesSigilSubtree(
        relativePath(discovery.root, nestedRoot),
        discovery.config,
      )
    ) continue;
    diagnostics.push(diagnostic(
      "SIGIL_NESTED_CONFIG",
      `Nested sigil.config must be inside a subtree excluded by workspace ${discovery.root}.`,
      { filePath: path },
    ));
  }

  const paths = allPaths
    .map(normalizePath)
    .filter((path) =>
      !nestedRoots.some((root) => path === root || path.startsWith(`${root}/`))
    )
    .filter((path) =>
      matchesSigilFile(relativePath(discovery.root, path), discovery.config!)
    )
    .sort();

  for (const path of paths) {
    const source = await fs.readTextFile(path);
    const parsed = parseSigilDocument(path, source, {
      languageVersion: discovery.config.languageVersion,
    });
    loadedFiles.push({ path, document: parsed.document });
    diagnostics.push(...parsed.diagnostics);
  }

  return { ...discovery, files: loadedFiles, diagnostics };
}

export function isWorkspaceRootModule(
  workspace: SigilWorkspace,
  path: string,
): boolean {
  return normalizePath(path) === joinPath(workspace.root, "#module.sigil");
}

export function isNestedModuleSummary(
  workspace: SigilWorkspace,
  path: string,
): boolean {
  return isModuleFile(path) && !isWorkspaceRootModule(workspace, path);
}

async function readDiscoveredConfig(
  fs: SigilFileSystem,
  root: string,
  configPath: string,
): Promise<WorkspaceDiscoveryResult> {
  if (!await fs.exists(configPath)) {
    return {
      root,
      diagnostics: [diagnostic(
        "SIGIL_CONFIG_NOT_FOUND",
        `Expected sigil.config directly inside workspace root ${root}.`,
        { filePath: configPath },
      )],
    };
  }
  const parsed = parseSigilConfig(
    await fs.readTextFile(configPath),
    configPath,
  );
  return {
    root,
    configPath,
    config: parsed.config,
    diagnostics: parsed.diagnostics,
  };
}
