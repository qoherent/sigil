import {
  type CollectedExpansion,
  collectedExpansionFor,
  componentContracts,
  type ComponentContractView,
  DEFAULT_SIGIL_EXCLUDES,
  DEFAULT_SIGIL_INCLUDES,
  diagnostic,
  discoverSigilWorkspace,
  loadSigilWorkspace,
  parseSigilDocument,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  SIGIL_CONFIG_PATH,
  SIGIL_VERSION,
  type SigilConfig,
  type SigilDiagnostic,
  type SigilDocument,
  type SigilFileSystem,
  type SigilWorkspace,
  type WorkspaceDiscoveryResult,
} from "@qoherent/sigil-core";
import { DenoSigilFileSystem, joinPath, normalizePath } from "./fs-adapter.ts";
import metadata from "../deno.json" with { type: "json" };

export const SIGIL_CLI_VERSION = metadata.version;

interface WritableSigilFileSystem extends SigilFileSystem {
  makeDirectory(path: string): Promise<void>;
  writeTextFile(path: string, source: string): Promise<void>;
}

export interface CoreAdapterOptions {
  readonly fs?: SigilFileSystem;
  readonly currentDirectory?: string;
}

export interface ParseFileResult {
  readonly discovery: WorkspaceDiscoveryResult;
  readonly document: SigilDocument | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface InitConfigResult {
  readonly root: string;
  readonly configPath: string;
  readonly config: SigilConfig | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface VersionInfo {
  readonly cliVersion: string;
  readonly coreVersion: string;
}

export class CoreAdapter {
  readonly #fs: SigilFileSystem;
  readonly #currentDirectory: string;

  constructor(options: CoreAdapterOptions = {}) {
    this.#fs = options.fs ?? new DenoSigilFileSystem();
    this.#currentDirectory = normalizePath(
      options.currentDirectory ?? Deno.cwd(),
    );
  }

  async parseFile(
    path: string,
    explicitRoot?: string,
  ): Promise<ParseFileResult> {
    const filePath = this.resolveTarget(path);
    const discovery = await discoverSigilWorkspace(this.#fs, {
      startPath: filePath,
      explicitRoot: explicitRoot ? this.resolveTarget(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
    if (!discovery.config) {
      return { discovery, document: null, diagnostics: discovery.diagnostics };
    }
    const source = await this.#fs.readTextFile(filePath);
    const parsed = parseSigilDocument(filePath, source, {
      sigilVersion: discovery.config.sigilVersion,
    });
    return {
      discovery,
      document: parsed.document,
      diagnostics: [...discovery.diagnostics, ...parsed.diagnostics],
    };
  }

  async loadWorkspace(
    path?: string,
    explicitRoot?: string,
  ): Promise<SigilWorkspace> {
    return await loadSigilWorkspace(this.#fs, {
      startPath: this.resolveTarget(path ?? this.#currentDirectory),
      explicitRoot: explicitRoot ? this.resolveTarget(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
  }

  async resolveWorkspace(
    path?: string,
    explicitRoot?: string,
  ): Promise<ResolvedSigilWorkspace> {
    return resolveSigilWorkspace(await this.loadWorkspace(path, explicitRoot));
  }

  async initConfig(
    path: string | undefined,
    name: string | undefined,
    include: readonly string[],
    exclude: readonly string[],
  ): Promise<InitConfigResult> {
    const root = this.resolveTarget(path ?? this.#currentDirectory);
    const configPath = joinPath(root, SIGIL_CONFIG_PATH);
    if (await this.#fs.exists(configPath)) {
      return {
        root,
        configPath,
        config: null,
        diagnostics: [
          diagnostic(
            "SIGIL_CONFIG_EXISTS",
            `Refusing to overwrite existing ${configPath}.`,
            { filePath: configPath },
          ),
        ],
      };
    }
    const config = {
      sigilVersion: SIGIL_VERSION,
      workspace: {
        name: name?.trim() || basename(root),
        members: [],
      },
      files: {
        include: include.length ? [...include] : [...DEFAULT_SIGIL_INCLUDES],
        exclude: exclude.length ? [...exclude] : [...DEFAULT_SIGIL_EXCLUDES],
      },
      tools: {},
    };
    const writable = this.#fs as Partial<WritableSigilFileSystem>;
    if (!writable.makeDirectory || !writable.writeTextFile) {
      throw new Error(
        `Filesystem does not support writing ${SIGIL_CONFIG_PATH}.`,
      );
    }
    await writable.makeDirectory(joinPath(root, ".sigil"));
    await writable.writeTextFile(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
    return { root, configPath, config, diagnostics: [] };
  }

  versions(): VersionInfo {
    return {
      cliVersion: SIGIL_CLI_VERSION,
      coreVersion: SIGIL_VERSION,
    };
  }
  componentContracts(
    resolved: ResolvedSigilWorkspace,
  ): readonly ComponentContractView[] {
    return componentContracts(resolved);
  }
  collectedExpansionFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ): CollectedExpansion | undefined {
    return collectedExpansionFor(resolved, componentName);
  }
  normalizePath(path: string): string {
    return normalizePath(path);
  }
  resolveTarget(path: string): string {
    const normalized = normalizePath(path);
    return isAbsolute(normalized)
      ? normalized
      : joinPath(this.#currentDirectory, normalized);
  }
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "sigil";
}
