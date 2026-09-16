import { join, resolve } from "node:path";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";

type Run = (
  executable: string,
  args: string[],
  code?: number,
) => Promise<string>;
/** Real fixed-Turtle protocol checks; no semantic reconstruction claim. */
export async function validateNativeProtocol(
  { language, compiler, fixture, scratch, run }: {
    language: string;
    compiler: string;
    fixture: string;
    scratch: string;
    run: Run;
  },
) {
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
  assertEquals(frontend.schemaVersion, 2);
  assertEquals(frontend.languageVersion, "0.8.0");
  assert(
    frontend.introductions.length && frontend.references.length &&
      frontend.links.length,
  );
  assert(frontend.entities.some((e: { type: string }) => e.type === "Tag"));
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
  const loose = await native(["compile", "design"]);
  assertEquals(loose.version, 2);
  assertEquals(loose.world.state, "Loose");
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

  const tagRoot = join(scratch, "Tag import probe");
  await Deno.mkdir(join(tagRoot, ".sigil"), { recursive: true });
  const config = {
    sigilVersion: "0.8.0",
    workspace: { name: "tag-probe", members: [] },
    files: { include: ["**/*.sigil"], exclude: [] },
  };
  await Deno.writeTextFile(
    join(tagRoot, ".sigil/config.json"),
    JSON.stringify(config),
  );
  const providerText =
    "\uFEFFcomponent Provider {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* preserves content.\r\n}\r\n}\r\n";
  await Deno.writeTextFile(join(tagRoot, "provider.sigil"), providerText);
  await Deno.writeTextFile(
    join(tagRoot, "consumer.sigil"),
    "@provider.sigil from Provider import { café results }\ncomponent Consumer {\ngoal {\nUse vocabulary.\n}\ninterface {\nConsume café results and [notes](./notes.md).\n}\n}\n",
  );
  await run(language, ["check", tagRoot, "--format", "json"]);
  const tagExport = JSON.parse(
    await run(language, ["export", "design", tagRoot, "--root", tagRoot]),
  );
  assertEquals(
    tagExport.sources.find((source: { path: string }) =>
      source.path === "provider.sigil"
    ).text,
    providerText,
  );
  assertEquals(tagExport.imports.length, 1);
  assertEquals(tagExport.references.length, 1);
  assertEquals(tagExport.links.length, 1);
  const tagFrontend = join(scratch, "tag-frontend.json"),
    tagScope = join(scratch, "tag-scope.json");
  await Deno.writeTextFile(tagFrontend, JSON.stringify(tagExport));
  await Deno.writeTextFile(
    tagScope,
    JSON.stringify({
      version: 1,
      design: { paths: ["consumer.sigil"] },
      implementation: { exclude: ["**"], allowEmpty: true },
    }),
  );
  const selected = JSON.parse(
    await run(compiler, [
      "scope",
      "--root",
      tagRoot,
      "--frontend",
      tagFrontend,
      "--scope",
      tagScope,
    ]),
  );
  assertEquals(selected.scope.design.sources, [
    "consumer.sigil",
    "provider.sigil",
  ]);
  await Deno.writeTextFile(
    tagFrontend,
    JSON.stringify({ ...tagExport, schemaVersion: 1 }),
  );
  await run(
    compiler,
    [
      "scope",
      "--root",
      tagRoot,
      "--frontend",
      tagFrontend,
      "--scope",
      tagScope,
    ],
    3,
  );
  await Deno.writeTextFile(
    join(tagRoot, ".sigil/config.json"),
    JSON.stringify({ ...config, sigilVersion: "0.7.0" }),
  );
  const rejected = JSON.parse(
    await run(language, ["check", tagRoot, "--format", "json"], 1),
  );
  assert(
    rejected.diagnostics.some((d: { code: string }) =>
      d.code === "SIGIL_UNSUPPORTED_VERSION"
    ),
  );
  return {
    design: ["Loose", "Coherent", "Disjoint"],
    implementation: ["Closed", "Converged", "Drift"],
    unavailable: 3,
    staleIngest: 3,
  };
}

if (import.meta.main) {
  const suffix = Deno.build.os === "windows" ? ".exe" : "";
  const language = resolve(
    Deno.env.get("SIGIL_TEST_LANGUAGE") ?? `build/sigil${suffix}`,
  );
  const compiler = resolve(
    Deno.env.get("SIGIL_TEST_COMPILER") ??
      `packages/sigilc/target/debug/sigilc${suffix}`,
  );
  const scratch = await Deno.makeTempDir({
    prefix: "sigil current protocol Ω ",
  });
  try {
    const fixture = join(scratch, "workspace");
    await Deno.mkdir(join(fixture, ".sigil"), { recursive: true });
    await Deno.copyFile(
      new URL("./fixtures/release/project/main.sigil", import.meta.url),
      join(fixture, "main.sigil"),
    );
    await Deno.copyFile(
      new URL(
        "./fixtures/release/project/fixture-config.json",
        import.meta.url,
      ),
      join(fixture, ".sigil/config.json"),
    );
    await Deno.writeTextFile(
      join(fixture, "main.any"),
      "fixed source-independent fixture\n",
    );
    const run: Run = async (executable, args, code = 0) => {
      const output = await new Deno.Command(executable, {
        args,
        cwd: scratch,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder().decode(output.stdout);
      assertEquals(
        output.code,
        code,
        `${args.join(" ")}: ${
          new TextDecoder().decode(output.stderr)
        }\n${text}`,
      );
      return text;
    };
    console.log(
      JSON.stringify(
        await validateNativeProtocol({
          language,
          compiler,
          fixture,
          scratch,
          run,
        }),
      ),
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}
