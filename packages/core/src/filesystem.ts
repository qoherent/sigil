import type { SigilFileSystem } from "./model/workspace.ts";
import { normalizePath } from "./path.ts";
import type { SourceInput } from "./source-text.ts";

// @sigil implements packages/core/src/filesystem.sigil::SigilFileSystem::InMemoryFileSystem interface,logic,constraints,cases
export class InMemorySigilFileSystem implements SigilFileSystem {
  readonly #files: Map<string, SourceInput>;

  constructor(files: Record<string, SourceInput> | Map<string, SourceInput>) {
    this.#files = new Map();
    const entries = files instanceof Map
      ? files.entries()
      : Object.entries(files);
    for (const [path, source] of entries) {
      this.#files.set(
        normalizePath(path),
        typeof source === "string" ? source : source.slice(),
      );
    }
  }

  readSourceFile(path: string): Promise<SourceInput> {
    const source = this.#files.get(normalizePath(path));
    if (source === undefined) {
      return Promise.reject(new Error(`File not found: ${path}`));
    }
    return Promise.resolve(
      typeof source === "string" ? source : source.slice(),
    );
  }

  async readTextFile(path: string): Promise<string> {
    const source = await this.readSourceFile(path);
    return typeof source === "string"
      ? source
      : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        source,
      );
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(normalizePath(path)));
  }

  listFiles(root: string): Promise<readonly string[]> {
    const normalizedRoot = normalizePath(root);
    const prefix = normalizedRoot === "." ? "" : `${normalizedRoot}/`;
    return Promise.resolve(
      [...this.#files.keys()]
        .filter((path) => path === normalizedRoot || path.startsWith(prefix))
        .sort(),
    );
  }
}
