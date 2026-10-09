import { dirname, join } from "node:path";

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return false;
    throw cause;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await Deno.rename(temp, path);
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.length);
  stable.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", stable.buffer),
  );
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Copy a directory tree of regular files. `skip` names relative paths (with `/`
 * separators) that are left out, together with everything beneath them.
 */
export async function copyTree(
  source: string,
  destination: string,
  skip: ReadonlySet<string> = new Set(),
  prefix = "",
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (skip.has(name)) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory) await copyTree(from, to, skip, name);
    else if (entry.isFile) await Deno.copyFile(from, to);
    else throw new Error(`Unsupported entry in a copied tree: ${from}`);
  }
}

/** Copy the files a staged skill needs: SKILL.md, VERSION and references/. */
export async function copySkill(
  source: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for (const file of ["SKILL.md", "VERSION"]) {
    try {
      await Deno.copyFile(join(source, file), join(destination, file));
    } catch (cause) {
      if (file === "VERSION" && cause instanceof Deno.errors.NotFound) {
        continue;
      }
      throw cause;
    }
  }
  await copyTree(join(source, "references"), join(destination, "references"));
}

/** A stable hash of every file name and its content under a directory. */
export async function treeSha256(root: string): Promise<string> {
  const rows: string[] = [];
  async function visit(dir: string, prefix: string): Promise<void> {
    const entries = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) await visit(join(dir, entry.name), name);
      else if (entry.isFile) {
        rows.push(
          `${name}:${await sha256(await Deno.readFile(join(dir, entry.name)))}`,
        );
      }
    }
  }
  await visit(root, "");
  return sha256(new TextEncoder().encode(rows.join("\n")));
}
