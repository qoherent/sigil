import type { SigilFileSystem } from "@qoherent/core";

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

  async writeTextFile(path: string, source: string): Promise<void> {
    await Deno.writeTextFile(path, source, { createNew: true });
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
    await collectFiles(joinPath(path, entry.name), files);
  }
}

export function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (normalized === "") return ".";
  const absolute = normalized.startsWith("/");
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  if (absolute) return `/${joined}`;
  return joined || ".";
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}
