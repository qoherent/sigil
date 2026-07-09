import type { SigilFileSystem } from "./model.ts";
import { normalizePath } from "./path.ts";

export class InMemorySigilFileSystem implements SigilFileSystem {
  readonly #files: Map<string, string>;

  constructor(files: Record<string, string> | Map<string, string>) {
    this.#files = new Map();
    const entries = files instanceof Map ? files.entries() : Object.entries(files);
    for (const [path, source] of entries) {
      this.#files.set(normalizePath(path), source);
    }
  }

  async readTextFile(path: string): Promise<string> {
    const source = this.#files.get(normalizePath(path));
    if (source === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return source;
  }

  async exists(path: string): Promise<boolean> {
    return this.#files.has(normalizePath(path));
  }

  async listFiles(root: string): Promise<readonly string[]> {
    const normalizedRoot = normalizePath(root);
    const prefix = normalizedRoot === "." ? "" : `${normalizedRoot}/`;
    return [...this.#files.keys()]
      .filter((path) => path === normalizedRoot || path.startsWith(prefix))
      .sort();
  }
}
