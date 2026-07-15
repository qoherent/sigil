import type { SigilFileSystem } from "@sigil/core";
import { normalizePath } from "@sigil/core";

export class DenoSigilFileSystem implements SigilFileSystem {
  async readTextFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }

  async listFiles(root: string): Promise<readonly string[]> {
    const files: string[] = [];
    await collectFiles(normalizePath(root), files);
    return files.sort();
  }
}

export class OverlaySigilFileSystem implements SigilFileSystem {
  readonly #base: SigilFileSystem;
  readonly #overlays = new Map<string, string>();

  constructor(base: SigilFileSystem) {
    this.#base = base;
  }

  set(path: string, source: string): void {
    this.#overlays.set(normalizePath(path), source);
  }

  delete(path: string): void {
    this.#overlays.delete(normalizePath(path));
  }

  has(path: string): boolean {
    return this.#overlays.has(normalizePath(path));
  }

  async readTextFile(path: string): Promise<string> {
    const normalized = normalizePath(path);
    const overlay = this.#overlays.get(normalized);
    return overlay ?? await this.#base.readTextFile(normalized);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    return this.#overlays.has(normalized) ||
      await this.#base.exists(normalized);
  }

  async listFiles(root: string): Promise<readonly string[]> {
    const normalizedRoot = normalizePath(root);
    const prefix = normalizedRoot === "." ? "" : `${normalizedRoot}/`;
    const files = new Set(await this.#base.listFiles(normalizedRoot));
    for (const path of this.#overlays.keys()) {
      if (path === normalizedRoot || path.startsWith(prefix)) files.add(path);
    }
    return [...files].sort();
  }
}

async function collectFiles(path: string, files: string[]): Promise<void> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (stat.isFile) {
    files.push(normalizePath(path));
    return;
  }
  if (!stat.isDirectory) return;
  for await (const entry of Deno.readDir(path)) {
    if (entry.name === ".git") continue;
    await collectFiles(`${path}/${entry.name}`, files);
  }
}

export function fileUriToPath(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== "file:") {
    throw new Error(`Only file URIs are supported: ${uri}`);
  }
  let path = decodeURIComponent(url.pathname);
  if (url.hostname) path = `//${url.hostname}${path}`;
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return normalizePath(path);
}

export function pathToFileUri(path: string): string {
  const normalized = normalizePath(path);
  const url = new URL("file:///");
  url.pathname = /^[A-Za-z]:\//.test(normalized)
    ? `/${normalized}`
    : normalized;
  return url.href;
}
