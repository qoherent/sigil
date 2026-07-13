import {
  collectedExpansionFor,
  componentContracts,
  DEFAULT_SIGIL_EXCLUDES,
  DEFAULT_SIGIL_INCLUDES,
  diagnostic,
  discoverSigilWorkspace,
  loadSigilWorkspace,
  parseSigilDocument,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  SIGIL_CONFIG_VERSION,
  SIGIL_CORE_VERSION,
  SIGIL_LANGUAGE_VERSION,
  type SigilFileSystem,
  type SigilWorkspace,
} from "@sigil/core";
import { DenoSigilFileSystem, joinPath, normalizePath } from "./fs-adapter.ts";

export const SIGIL_CLI_VERSION = "1.0.0" as const;

interface WritableSigilFileSystem extends SigilFileSystem {
  writeTextFile(path: string, source: string): Promise<void>;
}

export interface CoreAdapterOptions {
  readonly fs?: SigilFileSystem;
  readonly currentDirectory?: string;
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

  async parseFile(path: string, explicitRoot?: string) {
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
      languageVersion: discovery.config.languageVersion,
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
  ) {
    const root = this.resolveTarget(path ?? this.#currentDirectory);
    const configPath = joinPath(root, "sigil.config");
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
      configVersion: SIGIL_CONFIG_VERSION,
      languageVersion: SIGIL_LANGUAGE_VERSION,
      project: { name: name?.trim() || basename(root) },
      files: {
        include: include.length ? [...include] : [...DEFAULT_SIGIL_INCLUDES],
        exclude: exclude.length ? [...exclude] : [...DEFAULT_SIGIL_EXCLUDES],
      },
      tools: {},
    };
    const writable = this.#fs as Partial<WritableSigilFileSystem>;
    if (!writable.writeTextFile) {
      throw new Error("Filesystem does not support writing sigil.config.");
    }
    await writable.writeTextFile(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
    return { root, configPath, config, diagnostics: [] };
  }

  versions() {
    return {
      cliVersion: SIGIL_CLI_VERSION,
      coreVersion: SIGIL_CORE_VERSION,
      supportedConfigVersions: [SIGIL_CONFIG_VERSION],
      supportedLanguageVersions: [SIGIL_LANGUAGE_VERSION],
    };
  }
  componentContracts(resolved: ResolvedSigilWorkspace) {
    return componentContracts(resolved);
  }
  collectedExpansionFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ) {
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
