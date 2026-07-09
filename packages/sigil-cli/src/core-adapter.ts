import {
  collectedExpansionFor,
  componentContracts,
  loadSigilWorkspace,
  parseSigilDocument,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  type SigilFileSystem,
  type SigilWorkspace,
} from "../../sigil-core/src/mod.ts";
import { DenoSigilFileSystem, normalizePath } from "./fs-adapter.ts";

export interface CoreAdapterOptions {
  readonly fs?: SigilFileSystem;
  readonly currentDirectory?: string;
}

export class CoreAdapter {
  readonly #fs: SigilFileSystem;
  readonly #currentDirectory: string;

  constructor(options: CoreAdapterOptions = {}) {
    this.#fs = options.fs ?? new DenoSigilFileSystem();
    this.#currentDirectory = normalizePath(options.currentDirectory ?? ".");
  }

  async parseFile(path: string) {
    const filePath = normalizePath(path);
    const source = await this.#fs.readTextFile(filePath);
    return parseSigilDocument(filePath, source);
  }

  async loadWorkspace(
    path: string | undefined,
    explicitRoot: string | undefined,
  ): Promise<SigilWorkspace> {
    return await loadSigilWorkspace(this.#fs, {
      startPath: normalizePath(path ?? this.#currentDirectory),
      explicitRoot: explicitRoot ? normalizePath(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
  }

  async resolveWorkspace(
    path: string | undefined,
    explicitRoot: string | undefined,
  ): Promise<ResolvedSigilWorkspace> {
    const workspace = await this.loadWorkspace(path, explicitRoot);
    return resolveSigilWorkspace(workspace);
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
}
