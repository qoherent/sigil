import {
  excludesSigilSubtree,
  matchesSigilFile,
  mergeToolConfiguration,
  parseSigilConfig,
  parseSigilLocalConfig,
} from "./config.ts";
import {
  compareScalarText,
  diagnostic,
  orderDiagnostics,
} from "./diagnostics.ts";
import {
  captureSource,
  type SourceCapture,
  type SourceInput,
} from "./source-text.ts";
import { parseSigilGlossary } from "./glossary.ts";
import {
  SIGIL_CONFIG_PATH,
  SIGIL_GLOSSARY_PATH,
  SIGIL_LOCAL_CONFIG_PATH,
} from "./model/language.ts";
import type { SigilConfig } from "./model/configuration.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import type {
  LoadedSigilFile,
  SigilFileSystem,
  SigilWorkspace,
  WorkspaceLoadOptions,
} from "./model/workspace.ts";
import { parseSigilDocument } from "./parser.ts";
import {
  ancestorsFrom,
  joinPath,
  normalizePath,
  relativePath,
} from "./path.ts";
import { sha256Canonical } from "./canonical.ts";

// @sigil implements packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery interface,logic,cases
export interface WorkspaceDiscoveryResult {
  readonly root: string;
  readonly configPath?: string;
  readonly config?: SigilConfig;
  readonly configSource?: string;
  readonly localConfigPath?: string;
  readonly localConfigSource?: string;
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery interface,logic,cases
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
          {
            filePath: selected.configPath,
            related: [{ filePath: parent.configPath }],
          },
        )],
      };
    }
  }

  return selected;
}

/*
 * @sigil implements packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceLoading interface,logic,cases
 * @sigil implements packages/core/src/workspace.sigil::SigilWorkspaceLoader::GlossaryInterpretationLoading interface
 * @sigil implements packages/core/src/workspace.sigil::SigilWorkspaceLoader::GlossaryInterpretationLoading logic,constraints,cases
 */
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
      workspaceSnapshotIdentity: "unavailable",
      memberRoots: [],
      files: loadedFiles,
      diagnostics: orderDiagnostics(diagnostics),
    };
  }

  const allPaths = (await fs.listFiles(discovery.root)).map(normalizePath);
  const memberRoots = discovery.config.workspace.members.map((member) =>
    joinPath(discovery.root, member)
  );
  const nestedConfigs = allPaths
    .filter((path) => isSigilConfigPath(path) && path !== discovery.configPath)
    .sort(compareScalarText);
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
        { filePath: path, related: [{ filePath: discovery.configPath }] },
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
      { filePath: path, related: [{ filePath: discovery.configPath }] },
    ));
  }

  const paths = allPaths
    .filter((path) =>
      !nestedRoots.some((root) => path === root || path.startsWith(`${root}/`))
    )
    .filter((path) =>
      matchesSigilFile(relativePath(discovery.root, path), discovery.config!)
    )
    .sort(compareScalarText);

  for (const path of paths) {
    const input = await fs.readSourceFile(path);
    const parsed = parseSigilDocument(path, input, {
      sigilVersion: discovery.config.sigilVersion,
    });
    loadedFiles.push({
      path,
      source: parsed.document.source?.text,
      document: parsed.document,
    });
    diagnostics.push(...parsed.diagnostics);
  }

  const glossaryPath = joinPath(discovery.root, SIGIL_GLOSSARY_PATH);
  if (await fs.exists(glossaryPath)) {
    const glossaryInput = await fs.readSourceFile(glossaryPath);
    const glossaryCapture = captureSource(glossaryPath, glossaryInput);
    const glossarySource = glossaryCapture.source?.text;
    const parsed = glossaryCapture.diagnostics.length
      ? {
        glossary: undefined,
        diagnostics: glossaryCapture.diagnostics.map((d) =>
          diagnostic("SIGIL_GLOSSARY_PARSE", d.message, {
            filePath: glossaryPath,
            range: d.range,
          })
        ),
      }
      : parseSigilGlossary(glossarySource!, glossaryPath);
    diagnostics.push(...parsed.diagnostics);
    return {
      ...discovery,
      workspaceSnapshotIdentity: await workspaceSnapshotIdentity(
        discovery.root,
        discovery.configPath,
        discovery.configSource!,
        loadedFiles,
        glossaryPath,
        glossaryInput,
        discovery.localConfigPath,
        discovery.localConfigSource,
      ),
      glossaryPath,
      glossary: parsed.glossary,
      memberRoots,
      files: loadedFiles,
      diagnostics: orderDiagnostics(diagnostics),
    };
  }

  return {
    ...discovery,
    workspaceSnapshotIdentity: await workspaceSnapshotIdentity(
      discovery.root,
      discovery.configPath,
      discovery.configSource!,
      loadedFiles,
      undefined,
      undefined,
      discovery.localConfigPath,
      discovery.localConfigSource,
    ),
    memberRoots,
    files: loadedFiles,
    diagnostics: orderDiagnostics(diagnostics),
  };
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
  const configCapture = captureSource(
    configPath,
    await fs.readSourceFile(configPath),
  );
  if (configCapture.diagnostics.length) {
    return {
      root,
      configPath,
      diagnostics: configCapture.diagnostics.map((d) =>
        diagnostic("SIGIL_CONFIG_PARSE", d.message, {
          filePath: configPath,
          range: d.range,
        })
      ),
    };
  }
  const configSource = configCapture.source!.text;
  const parsed = parseSigilConfig(
    configSource,
    configPath,
  );
  const localConfigPath = joinPath(root, SIGIL_LOCAL_CONFIG_PATH);
  if (!parsed.config || !await fs.exists(localConfigPath)) {
    return {
      root,
      configPath,
      config: parsed.config,
      configSource,
      diagnostics: parsed.diagnostics,
    };
  }
  const localCapture = captureSource(
    localConfigPath,
    await fs.readSourceFile(localConfigPath),
  );
  if (localCapture.diagnostics.length) {
    return {
      root,
      configPath,
      configSource,
      localConfigPath,
      diagnostics: localCapture.diagnostics.map((d) =>
        diagnostic("SIGIL_CONFIG_PARSE", d.message, {
          filePath: localConfigPath,
          range: d.range,
        })
      ),
    };
  }
  const localConfigSource = localCapture.source!.text;
  const local = parseSigilLocalConfig(localConfigSource, localConfigPath);
  return {
    root,
    configPath,
    configSource,
    localConfigPath,
    localConfigSource,
    config: local.diagnostics.length ? undefined : {
      ...parsed.config,
      tools: mergeToolConfiguration(parsed.config.tools, local.tools),
    },
    diagnostics: [...parsed.diagnostics, ...local.diagnostics],
  };
}

async function workspaceSnapshotIdentity(
  root: string,
  configPath: string,
  configSource: string,
  files: readonly LoadedSigilFile[],
  glossaryPath?: string,
  glossarySource?: SourceInput,
  localConfigPath?: string,
  localConfigSource?: string,
): Promise<string> {
  let completeText = true;
  const capturedText = (capture: SourceCapture) => {
    if (
      capture.source &&
      !capture.diagnostics.some((d) =>
        d.code === "SIGIL_INVALID_ENCODING" ||
        d.code === "SIGIL_INVALID_CHARACTER"
      )
    ) {
      return { text: capture.source.text };
    }
    completeText = false;
    // This identifies retained invalid evidence, never a complete textual snapshot.
    return {
      invalidInput: capture.rawBytes ? [...capture.rawBytes] : capture.rawText,
    };
  };
  const records = [
    {
      kind: "config",
      path: relativePath(root, configPath),
      text: configSource,
    },
    ...(localConfigPath && localConfigSource !== undefined
      ? [{
        kind: "local-config",
        path: relativePath(root, localConfigPath),
        text: localConfigSource,
      }]
      : []),
    ...files.map((file) => ({
      kind: "sigil",
      path: relativePath(root, file.path),
      ...capturedText(file.document),
    })),
    ...(glossaryPath && glossarySource !== undefined
      ? [{
        kind: "glossary",
        path: relativePath(root, glossaryPath),
        ...capturedText(captureSource(glossaryPath, glossarySource)),
      }]
      : []),
  ].sort((left, right) =>
    compareScalarText(left.path, right.path) ||
    compareScalarText(left.kind, right.kind)
  );
  const digest = await sha256Canonical({ records });
  return completeText ? digest : `invalid:${digest}`;
}

function isSigilConfigPath(path: string): boolean {
  return path === SIGIL_CONFIG_PATH || path.endsWith(`/${SIGIL_CONFIG_PATH}`);
}
