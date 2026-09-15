import { validateNativeProtocol } from "./validate-native-protocol.ts";
import { join, resolve } from "node:path";
import { validateFoundation } from "./validate-skill.ts";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";

if (Deno.args.length !== 2 || Deno.args[0] !== "--distribution") {
  throw new Error("Usage: test-cli-release.ts --distribution <directory>");
}
const distribution = resolve(Deno.args[1]);
const scratch = await Deno.makeTempDir({ prefix: "sigil release smoke 空 " });
try {
  const relocated = join(scratch, "bundle with spaces and Ω");
  await copyDirectory(distribution, relocated);
  for (const name of ["lib", "repos", "packages", "node_modules"]) {
    assert(
      !await exists(join(relocated, name)),
      `Unexpected release payload: ${name}`,
    );
  }
  assert(await exists(join(relocated, "integrations/skills/sigil/SKILL.md")));
  await validateFoundation(join(relocated, "integrations/skills"));
  assert(
    !await exists(join(relocated, "integrations/skills/sigil-anchor-indexer")),
  );
  const suffix = Deno.build.os === "windows" ? ".exe" : "";
  const language = join(relocated, "bin", `sigil${suffix}`);
  const compiler = join(relocated, "bin", `sigilc${suffix}`);
  const home = join(scratch, "empty home");
  const fixture = join(scratch, "fixture project");
  await Deno.mkdir(home);
  await Deno.mkdir(join(fixture, ".sigil"), { recursive: true });
  await Deno.copyFile(
    new URL("./fixtures/release/project/main.sigil", import.meta.url),
    join(fixture, "main.sigil"),
  );
  await Deno.copyFile(
    new URL("./fixtures/release/project/fixture-config.json", import.meta.url),
    join(fixture, ".sigil/config.json"),
  );
  await Deno.writeTextFile(
    join(fixture, "main.any"),
    "fixed source-independent smoke fixture\n",
  );
  // No executable search directories: both programs must run by absolute path.
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    DENO_DIR: home,
    TMP: home,
    TEMP: home,
    TMPDIR: home,
    PATH: home,
  };
  for (const name of ["SystemRoot", "WINDIR", "ComSpec"]) {
    const value = Deno.env.get(name);
    if (value) env[name] = value;
  }
  const run = async (executable: string, args: string[], code = 0) => {
    const output = await new Deno.Command(executable, {
      args,
      cwd: scratch,
      env,
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);
    assertEquals(
      output.code,
      code,
      `${args.join(" ")}: ${
        new TextDecoder().decode(output.stderr)
      }\n${stdout}`,
    );
    return stdout;
  };
  const version = (await run(language, ["--version"])).trim();
  assert(/^\d+\.\d+\.\d+$/.test(version));
  const catalog = JSON.parse(await run(language, ["skill", "list"]));
  assertEquals(catalog.skills, [
    "sigil",
    "sigil-evaluate",
    "sigil-understand",
    "sigil-write",
  ]);
  assertEquals(
    catalog.catalog.find((s: { name: string }) => s.name === "sigil")
      .compatibility.languageCompatible,
    false,
  );
  await run(language, ["skill", "install", "--project", "--agent", "codex"]);
  await validateFoundation(join(scratch, ".agents/skills"));
  const compilerVersion = (await run(compiler, ["--version"])).trim();
  assert(/^sigilc \d+\.\d+\.\d+$/.test(compilerVersion));
  await run(language, ["check", fixture, "--format", "json"]);
  const protocol = await validateNativeProtocol({
    language,
    compiler,
    fixture,
    scratch,
    run,
  });
  console.log(
    JSON.stringify({
      version,
      compilerVersion,
      relocated: true,
      hostTools: false,
      ...protocol,
    }),
  );
} finally {
  await Deno.remove(scratch, { recursive: true });
}
async function exists(path: string) {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
async function copyDirectory(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    assert(!entry.isSymlink, "Release must not contain symlinks");
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory) await copyDirectory(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}
