import {
  excludesSigilSubtree,
  matchesSigilFile,
  parseSigilConfig,
} from "./config.ts";
import { diagnostic } from "./diagnostics.ts";
import { SIGIL_CONFIG_PATH } from "./model.ts";
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
    return await readDiscoveredConfig(
      fs,
      root,
      joinPath(root, SIGIL_CONFIG_PATH),
    );
  }

  const candidates: string[] = [];
  for (const ancestor of ancestorsFrom(options.startPath)) {
    if (await fs.exists(joinPath(ancestor, SIGIL_CONFIG_PATH))) {
      candidates.push(ancestor);
    }
  }

  if (candidates.length === 0) {
    const root = normalizePath(options.currentDirectory ?? ".");
    return {
      root,
      diagnostics: [diagnostic(
        "SIGIL_CONFIG_NOT_FOUND",
        `No ancestor ${SIGIL_CONFIG_PATH} was found from ${
          normalizePath(options.startPath)
        }.`,
        { filePath: joinPath(root, SIGIL_CONFIG_PATH) },
      )],
    };
  }

  const root = candidates[0];
  const selected = await readDiscoveredConfig(
    fs,
    root,
    joinPath(root, SIGIL_CONFIG_PATH),
  );
  if (!selected.config) return selected;

  for (const parentRoot of candidates.slice(1)) {
    const parent = await readDiscoveredConfig(
      fs,
      parentRoot,
      joinPath(parentRoot, SIGIL_CONFIG_PATH),
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
    return {
      ...discovery,
      memberRoots: [],
      files: loadedFiles,
      diagnostics,
    };
  }

  const allPaths = (await fs.listFiles(discovery.root)).map(normalizePath);
  const memberRoots = discovery.config.workspace.members.map((member) =>
    joinPath(discovery.root, member)
  );
  const nestedConfigs = allPaths
    .filter((path) => isSigilConfigPath(path) && path !== discovery.configPath)
    .sort();
  const nestedRoots = nestedConfigs.map((path) =>
    path.slice(0, -`/${SIGIL_CONFIG_PATH}`.length)
  );
  for (let index = 0; index < nestedConfigs.length; index++) {
    const path = nestedConfigs[index];
    const nestedRoot = nestedRoots[index];
    if (memberRoots.includes(nestedRoot)) {
      diagnostics.push(diagnostic(
        "SIGIL_NESTED_CONFIG",
        `Workspace member ${nestedRoot} must not contain its own ${SIGIL_CONFIG_PATH}.`,
        { filePath: path },
      ));
      continue;
    }
    if (
      excludesSigilSubtree(
        relativePath(discovery.root, nestedRoot),
        discovery.config,
      )
    ) continue;
    diagnostics.push(diagnostic(
      "SIGIL_NESTED_CONFIG",
      `Nested ${SIGIL_CONFIG_PATH} must be inside a subtree excluded by workspace ${discovery.root}.`,
      { filePath: path },
    ));
  }

  const paths = allPaths
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
      sigilVersion: discovery.config.sigilVersion,
    });
    loadedFiles.push({ path, document: parsed.document });
    diagnostics.push(...parsed.diagnostics);
  }

  return { ...discovery, memberRoots, files: loadedFiles, diagnostics };
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
        `Expected ${SIGIL_CONFIG_PATH} directly inside workspace root ${root}.`,
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

function isSigilConfigPath(path: string): boolean {
  return path === SIGIL_CONFIG_PATH || path.endsWith(`/${SIGIL_CONFIG_PATH}`);
}
