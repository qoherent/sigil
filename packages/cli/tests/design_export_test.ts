import { assert, assertEquals } from "@std/assert";
import { normalizePath, SIGIL_VERSION } from "@qoherent/sigil-core";
import { runCli } from "../src/main.ts";
import { DenoSigilFileSystem } from "../src/fs-adapter.ts";
import { CoreAdapter } from "../src/core-adapter.ts";

async function workspace() {
  const root = normalizePath(
    // The root also appears as prose, whose indivisible spans have a width limit.
    await Deno.makeTempDir(),
  );
  await Deno.mkdir(`${root}/.sigil`);
  const config = JSON.stringify({
    sigilVersion: SIGIL_VERSION,
    workspace: { name: "export", members: [] },
    files: { include: ["**/*.sigil"], exclude: [] },
  });
  await Deno.writeTextFile(`${root}/.sigil/config.json`, config);
  const source =
    `component Exact {\n  goal {\n    ${root}/verbatim\n    preserves café.\n  }\n  interface {\n    Text {\n      Preserve captured text.\n    }\n  }\n}\n`;
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  return { root, source, config };
}

Deno.test("export emits the raw native bundle and preserves captured text without invoking a compiler", async () => {
  const { root, source, config } = await workspace();
  try {
    const result = await runCli(["export", "design", ".", "--pretty"], {
      core: new CoreAdapter({ currentDirectory: root }),
    });
    assertEquals(result.exitCode, 0, result.stdout);
    assertEquals(result.stderr, "");
    const bundle = JSON.parse(result.stdout);
    assertEquals(Object.keys(bundle).sort(), [
      "context",
      "diagnostics",
      "entities",
      "frontendVersion",
      "groups",
      "imports",
      "introductions",
      "languageVersion",
      "links",
      "references",
      "schemaVersion",
      "sources",
      "units",
    ]);
    assertEquals(bundle.schemaVersion, 2);
    assertEquals(bundle.sources, [{ path: "main.sigil", text: source }]);
    assertEquals(
      bundle.context.find((c: { path: string }) =>
        c.path === ".sigil/config.json"
      ).text,
      config,
    );
    assertEquals(
      bundle.context.find((c: { path: string }) =>
        c.path === ".sigil/local.json"
      ).text,
      null,
    );
    assert(bundle.units.length > 0);
    assertEquals(
      JSON.parse(
        (await runCli(["export", "design", "--root", root, "--format", "json"]))
          .stdout,
      ),
      bundle,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("export retains language errors in its bundle and never reports them as semantic success", async () => {
  const { root } = await workspace();
  try {
    await Deno.writeTextFile(
      `${root}/main.sigil`,
      "expand Missing { goal { Keep unknown meaning. } }",
    );
    const result = await runCli(["export", "design", root]);
    assertEquals(result.exitCode, 1);
    const bundle = JSON.parse(result.stdout);
    assert(
      bundle.diagnostics.some((d: { severity: string }) =>
        d.severity === "error"
      ),
    );
    assertEquals(bundle.sources[0].path, "main.sigil");
    assertEquals(bundle.world, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("export rejects incomplete, lossy and compiler-specific invocations", async () => {
  for (
    const args of [
      ["export"],
      ["export", "implementation"],
      ["export", "design", "a", "b"],
      ["export", "design", "--quiet"],
      ["export", "design", "--format", "markdown"],
      ["export", "design", "--profile", "legacy"],
      ["export", "design", "--scope", "native.json"],
    ]
  ) {
    const result = await runCli(args);
    assertEquals(result.exitCode, 2, args.join(" "));
    assertEquals(result.stdout, "");
  }
  const help = await runCli(["export", "design", "--help"]);
  assertEquals(help.exitCode, 0);
  assert(help.stdout.includes("sigilc"));
});

Deno.test("host discovery preserves nested configs while excluding generated Sigil metadata", async () => {
  const { root, config } = await workspace();
  try {
    await Deno.mkdir(`${root}/nested/.sigil`, { recursive: true });
    await Deno.writeTextFile(`${root}/nested/.sigil/config.json`, config);
    for (const dir of ["worlds", "unrecognized-generated-tree"]) {
      await Deno.mkdir(`${root}/.sigil/${dir}`);
      await Deno.writeTextFile(
        `${root}/.sigil/${dir}/fake.sigil`,
        "not authored",
      );
    }
    const files = await new DenoSigilFileSystem().listFiles(root);
    assert(files.includes(`${root}/nested/.sigil/config.json`));
    assert(!files.some((p) => p.endsWith("fake.sigil")));
    const result = await runCli(["export", "design", root]);
    assertEquals(result.exitCode, 1);
    assert(
      JSON.parse(result.stdout).diagnostics.some((d: { code: string }) =>
        d.code === "SIGIL_NESTED_CONFIG"
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("child workspace export reports nested parent evidence as a language error", async () => {
  const parent = normalizePath(
    await Deno.makeTempDir({ prefix: "sigil-nested-export-" }),
  );
  const child = `${parent}/child`;
  const config = JSON.stringify({
    sigilVersion: SIGIL_VERSION,
    workspace: { name: "nested", members: [] },
    files: { include: ["**/*.sigil"], exclude: [] },
  });
  try {
    await Deno.mkdir(`${parent}/.sigil`);
    await Deno.mkdir(`${child}/.sigil`, { recursive: true });
    await Deno.writeTextFile(`${parent}/.sigil/config.json`, config);
    await Deno.writeTextFile(`${child}/.sigil/config.json`, config);
    const result = await runCli(["export", "design", "."], {
      core: new CoreAdapter({ currentDirectory: child }),
    });
    assertEquals(result.exitCode, 1);
    assertEquals(result.stdout, "");
    const output = JSON.parse(result.stderr);
    assertEquals(
      output.diagnostics.map((item: { code: string }) => item.code),
      [
        "SIGIL_NESTED_CONFIG",
      ],
    );
    assertEquals(output.diagnostics[0].filePath, `${child}/.sigil/config.json`);
    assertEquals(
      output.diagnostics[0].related.map((item: { filePath: string }) =>
        item.filePath
      ),
      [`${parent}/.sigil/config.json`],
    );
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("invalid UTF-8 exports no transport and parse retains encoding diagnostics", async () => {
  const { root } = await workspace();
  try {
    await Deno.writeFile(`${root}/main.sigil`, new Uint8Array([0xc3, 0x28]));
    const result = await runCli(["export", "design", root]);
    assertEquals(result.exitCode, 1);
    assertEquals(result.stdout, "");
    assert(result.stderr.includes("SIGIL_INVALID_ENCODING"));
    const parsed = await runCli(["parse", `${root}/main.sigil`]);
    assertEquals(parsed.exitCode, 1);
    assert(
      JSON.parse(parsed.stdout).diagnostics.some((d: { code: string }) =>
        d.code === "SIGIL_INVALID_ENCODING"
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("relative display paths do not rewrite authored prose or captured payloads", async () => {
  const { root, source } = await workspace();
  try {
    const result = await runCli(["context", ".", "--component", "Exact"], {
      core: new CoreAdapter({ currentDirectory: root }),
    });
    assertEquals(result.exitCode, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert(
      output.componentContracts[0].goalLines[0].includes(`${root}/verbatim`),
    );
    const parsed = await runCli(["parse", "main.sigil"], {
      core: new CoreAdapter({ currentDirectory: root }),
    });
    assertEquals(JSON.parse(parsed.stdout).document.source.text, source);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fmt repairs width across selected providers and consumers before writing", async () => {
  const { root } = await workspace();
  try {
    const make = (name: string, body: string) =>
      `component ${name} {\ngoal {\nOwn this contract.\n}\ninterface {\n${body}\n}\n}\n`;
    const provider = make(
      "Provider",
      "A *search results* exists.\n\n" + "word ".repeat(25),
    );
    const consumer = "@main.sigil from Provider import { search results }\n" +
      make("Consumer", "prefix ".repeat(12) + "search results follow.");
    await Deno.writeTextFile(`${root}/main.sigil`, provider);
    await Deno.writeTextFile(`${root}/consumer.sigil`, consumer);
    const check = await runCli(["fmt", root, "--check"]);
    assertEquals(check.exitCode, 1);
    assertEquals(await Deno.readTextFile(`${root}/main.sigil`), provider);
    const formatted = await runCli(["fmt", root]);
    assertEquals(formatted.exitCode, 0, formatted.stdout);
    assertEquals((await runCli(["check", root])).exitCode, 0);
    assertEquals((await runCli(["fmt", root, "--check"])).exitCode, 0);
    const exported = JSON.parse(
      (await runCli(["export", "design", root])).stdout,
    );
    assertEquals(
      exported.references.filter((r: { source: string }) =>
        r.source === "consumer.sigil"
      ).map((r: { name: string }) => r.name),
      ["search results"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("CLI export matches the shared schema-2 native fixture exactly", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-shared-" });
  try {
    const fixture = JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../core/tests/fixtures/design-input-080.json",
          import.meta.url,
        ),
      ),
    );
    for (const file of [...fixture.sources, ...fixture.context]) {
      if (file.text === null) continue;
      await Deno.mkdir(
        `${root}/${
          file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "."
        }`,
        { recursive: true },
      );
      await Deno.writeTextFile(`${root}/${file.path}`, file.text);
    }
    const result = await runCli(["export", "design", root]);
    assertEquals(result.exitCode, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout), fixture);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("text diagnostic columns derive from captured Unicode source", async () => {
  const { root } = await workspace();
  try {
    const source =
      "\uFEFFcomponent Exact {\r\ngoal {\r\nPreserve text.\r\n}\r\ninterface {\r\n😀 café *broken\r\n}\r\n}\r\n";
    await Deno.writeTextFile(`${root}/main.sigil`, source);
    const output = JSON.parse(
      (await runCli(["check", root, "--format", "json"])).stdout,
    );
    const diagnostic = output.diagnostics.find((d: { code: string }) =>
      d.code === "SIGIL_INCOMPLETE_TAG"
    );
    assertEquals(diagnostic.sourceLocation, { line: 6, column: 8 });
    assertEquals(typeof diagnostic.range.start, "number");
    const text = await runCli(["check", root, "--show-locations"]);
    assert(text.stdout.includes("main.sigil:6:8"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
