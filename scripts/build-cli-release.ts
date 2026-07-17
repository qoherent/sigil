import { basename, join, resolve } from "node:path";

const TARGETS = [
  {
    deno: "aarch64-apple-darwin",
    asset: "sigil-aarch64-apple-darwin",
    executable: "sigil",
  },
  {
    deno: "x86_64-apple-darwin",
    asset: "sigil-x86_64-apple-darwin",
    executable: "sigil",
  },
  {
    deno: "aarch64-unknown-linux-gnu",
    asset: "sigil-aarch64-unknown-linux-gnu",
    executable: "sigil",
  },
  {
    deno: "x86_64-unknown-linux-gnu",
    asset: "sigil-x86_64-unknown-linux-gnu",
    executable: "sigil",
  },
  {
    deno: "x86_64-pc-windows-msvc",
    asset: "sigil-x86_64-pc-windows-msvc",
    executable: "sigil.exe",
  },
] as const;

const args = parseArgs(Deno.args);
const root = resolve(import.meta.dirname!, "..");
const output = resolve(root, args.output ?? "build/release");
const manifest = JSON.parse(
  await Deno.readTextFile(join(root, "packages/cli/deno.json")),
);
const version = args.version ?? manifest.version;
if (manifest.version !== version) {
  throw new Error(
    `Release version ${version} does not match CLI manifest ${manifest.version}.`,
  );
}

await Deno.remove(output, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await Deno.mkdir(output, { recursive: true });

for (const target of TARGETS) {
  const stage = join(output, ".stage", target.asset, `sigil-${version}`);
  const binary = join(stage, "bin", target.executable);
  await Deno.mkdir(join(stage, "bin"), { recursive: true });
  await run([
    Deno.execPath(),
    "compile",
    "--allow-read",
    "--allow-write",
    "--allow-env=HOME,USERPROFILE",
    "--target",
    target.deno,
    "--output",
    binary,
    join(root, "packages/cli/src/main.ts"),
  ]);
  await copyValidSkills(
    join(root, "integrations/skills"),
    join(stage, "integrations/skills"),
  );
  if (target.deno.includes("windows")) {
    await run([
      "zip",
      "-qr",
      join(output, `${target.asset}.zip`),
      `sigil-${version}`,
    ], dirname(stage));
  } else {
    await run([
      "tar",
      "-czf",
      join(output, `${target.asset}.tar.gz`),
      `sigil-${version}`,
    ], dirname(stage));
  }
}

for (const script of ["install.sh", "install.ps1"]) {
  const source = await Deno.readTextFile(join(root, script));
  await Deno.writeTextFile(
    join(output, script),
    source.replaceAll("__SIGIL_VERSION__", version),
  );
}

const assets: string[] = [];
for await (const entry of Deno.readDir(output)) {
  if (entry.isFile && entry.name !== "checksums.txt") assets.push(entry.name);
}
assets.sort();
const checksums: string[] = [];
for (const asset of assets) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(join(output, asset)),
  );
  checksums.push(`${hex(digest)}  ${asset}`);
}
await Deno.writeTextFile(
  join(output, "checksums.txt"),
  `${checksums.join("\n")}\n`,
);
await Deno.remove(join(output, ".stage"), { recursive: true });
console.log(`Built ${assets.length} release assets in ${output}.`);

function parseArgs(
  values: readonly string[],
): { version?: string; output?: string } {
  let version: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < values.length; index++) {
    if (values[index] === "--version") version = values[++index];
    else if (values[index] === "--output") output = values[++index];
    else throw new Error(`Unsupported argument ${values[index]}.`);
  }
  return { version, output };
}

async function copyValidSkills(source: string, target: string): Promise<void> {
  for await (const entry of Deno.readDir(source)) {
    if (!entry.isDirectory || entry.isSymlink || entry.name.startsWith(".")) {
      continue;
    }
    const skill = join(source, entry.name);
    try {
      if (!(await Deno.stat(join(skill, "SKILL.md"))).isFile) continue;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    await copyDirectory(skill, join(target, entry.name));
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory) await copyDirectory(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

async function run(command: readonly string[], cwd = root): Promise<void> {
  const result = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    throw new Error(`${basename(command[0])} exited with ${result.code}.`);
  }
}

function dirname(path: string): string {
  return path.slice(
    0,
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")),
  ) || ".";
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
