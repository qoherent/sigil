import { readdir, readFile, stat } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import type { SigilFileSystem } from "@sigil/core";
import { normalizePath } from "@sigil/core";
import { runLanguageServer } from "../../../../packages/sigil-lsp/src/protocol.ts";
import { SigilLanguageServer } from "../../../../packages/sigil-lsp/src/server.ts";

class NodeSigilFileSystem implements SigilFileSystem {
  async readTextFile(path: string): Promise<string> {
    return await readFile(path, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      return isNotFound(error) ? false : Promise.reject(error);
    }
  }

  async listFiles(root: string): Promise<readonly string[]> {
    const files: string[] = [];
    await collectFiles(normalizePath(root), files);
    return files.sort();
  }
}

async function collectFiles(path: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return;
    const info = await stat(path);
    if (info.isFile()) files.push(normalizePath(path));
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const child = normalizePath(`${path}/${entry.name}`);
    if (entry.isDirectory()) await collectFiles(child, files);
    else if (entry.isFile()) files.push(child);
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function main(): Promise<void> {
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const server = new SigilLanguageServer({
    fs: new NodeSigilFileSystem(),
    currentDirectory: process.cwd(),
  });
  process.exitCode = await runLanguageServer(input, output, server);
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
