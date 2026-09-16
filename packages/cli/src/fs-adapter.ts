import {
  joinPath,
  normalizePath,
  type SigilFileSystem,
} from "@qoherent/sigil-core";

// @sigil uses packages/core/src/filesystem.sigil::SigilFileSystem::FileSystemPort interface,constraints,cases
export class DenoSigilFileSystem implements SigilFileSystem {
  async readSourceFile(path: string): Promise<Uint8Array> {
    return await Deno.readFile(path);
  }

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

  async replaceTextFile(path: string, source: string): Promise<void> {
    await Deno.writeTextFile(path, source);
  }

  async makeDirectory(path: string): Promise<void> {
    await Deno.mkdir(path, { recursive: true });
  }
}

// @sigil implements packages/cli/_module.sigil::SigilCli::SourceDiscovery interface
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
    if (
      entry.name === ".git" || entry.isSymlink ||
      (path.split("/").at(-1) === ".sigil" &&
        (!entry.isFile ||
          !["config.json", "local.json", "glossary.json"].includes(entry.name)))
    ) continue;
    await collectFiles(joinPath(path, entry.name), files);
  }
}
