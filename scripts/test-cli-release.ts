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
  await run(language, ["skill", "install", "--project", "--agent", "codex"]);
  await validateFoundation(join(scratch, ".agents/skills"));
  const compilerVersion = (await run(compiler, ["--version"])).trim();
  assert(/^sigilc \d+\.\d+\.\d+$/.test(compilerVersion));
  await run(language, ["check", fixture, "--format", "json"]);
  const frontendPath = join(scratch, "frontend.json");
  const exportText = await run(language, [
    "export",
    "design",
    fixture,
    "--root",
    fixture,
  ]);
  await Deno.writeTextFile(frontendPath, exportText);
  const frontend = JSON.parse(exportText);
  const scopePath = join(scratch, "scope.json");
  await Deno.writeTextFile(
    scopePath,
    JSON.stringify({
      version: 1,
      design: { paths: ["main.sigil"] },
      implementation: { paths: ["main.any"] },
    }),
  );
  const native = async (args: string[], code = 0) => {
    return JSON.parse(
      await run(compiler, [
        ...args,
        "--root",
        fixture,
        "--frontend",
        frontendPath,
        "--scope",
        scopePath,
      ], code),
    );
  };
  assertEquals((await native(["scope"])).scope.design.focus_order, [
    "main.sigil",
  ]);
  assertEquals((await native(["compile", "design"])).world.state, "Loose");
  assertEquals((await native(["compare"], 3)).comparison, null);
  await native(["stale", "design"], 1);
  const turtle = join(scratch, "facts.ttl");
  const publish = async (side: string, text: string, label: string) => {
    const source = side === "design" ? "main.sigil" : "main.any";
    const bindingDir = join(scratch, label);
    const prepared = await native([
      "prepare",
      side,
      "--source",
      source,
      "--out",
      bindingDir,
    ]);
    if (side === "implementation") assertEquals(prepared.inputs.length, 3);
    await Deno.writeTextFile(turtle, text);
    await native([
      "ingest",
      side,
      "--source",
      source,
      "--binding",
      join(bindingDir, "binding.json"),
      "--turtle",
      turtle,
    ]);
  };
  const prefix = "@prefix s: <https://sigil.dev/ontology/1#> .\n";
  const entity = `<${
    frontend.entities.find((e: { label: string }) =>
      e.label === "ReleaseFixture"
    ).id
  }>`;
  // Fixed Turtle tests the shipped native protocol. This is not a model or a
  // claim about this repository's independent semantic reconstruction.
  const negative = frontend.units.map((unit: { id: string }) =>
    `<${unit.id}> s:from ${entity}; s:relation "uses"; s:target ${entity}; s:expected false .`
  ).join("\n");
  const positive = frontend.units.map((unit: { id: string }) =>
    `<${unit.id}> s:from ${entity}; s:relation "provides"; s:target ${entity}; s:expected true .`
  ).join("\n");
  await publish(
    "design",
    prefix + positive + `\n${entity} s:provides ${entity} .`,
    "positive design binding",
  );
  await publish(
    "implementation",
    prefix + `${entity} s:provides ${entity} .`,
    "closed implementation binding",
  );
  const closed = await native(["compile", "implementation"]);
  assertEquals(
    closed.comparison.implementation,
    "Closed",
    JSON.stringify(closed.diagnostics),
  );
  await publish("design", prefix + negative, "design binding");
  await native(["stale", "design"]);
  assertEquals((await native(["compile", "design"])).world.state, "Coherent");
  assertEquals((await native(["entities"])).status, "authoritative");
  assertEquals(
    (await native(["compare"])).comparison.implementation,
    "Converged",
  );
  await publish(
    "implementation",
    prefix + `${entity} s:uses ${entity} .`,
    "implementation binding",
  );
  assertEquals(
    (await native(["compile", "implementation"], 1)).comparison.implementation,
    "Drift",
  );
  await publish(
    "design",
    prefix + `${entity} s:uses ${entity}; s:excludes ${entity} .`,
    "contradiction binding",
  );
  assertEquals(
    (await native(["compile", "design"], 1)).world.state,
    "Disjoint",
  );
  await publish("design", prefix + negative, "restored design binding");
  const staleBinding = join(scratch, "stale binding");
  await native([
    "prepare",
    "implementation",
    "--source",
    "main.any",
    "--out",
    staleBinding,
  ]);
  await Deno.writeTextFile(
    join(fixture, "main.any"),
    "changed after preparation\n",
  );
  await Deno.writeTextFile(turtle, prefix + `${entity} s:uses ${entity} .`);
  await run(compiler, [
    "ingest",
    "implementation",
    "--source",
    "main.any",
    "--binding",
    join(staleBinding, "binding.json"),
    "--turtle",
    turtle,
    "--root",
    fixture,
    "--frontend",
    frontendPath,
    "--scope",
    scopePath,
  ], 3);
  console.log(
    JSON.stringify({
      version,
      compilerVersion,
      relocated: true,
      hostTools: false,
      design: ["Loose", "Coherent", "Disjoint"],
      implementation: ["Closed", "Converged", "Drift"],
      unavailable: 3,
      staleIngest: 3,
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
