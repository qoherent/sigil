import { assert, assertEquals, assertRejects } from "@std/assert";
import { InMemorySigilFileSystem } from "@qoherent/sigil-core";
import { CoreAdapter } from "../src/core-adapter.ts";

const component = (name: string, prose: string) =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${prose}\n}\n}\n`;

class FormattingFileSystem extends InMemorySigilFileSystem {
  readonly writes = new Map<string, string>();
  readonly writeCalls: string[] = [];

  override readSourceFile(path: string) {
    return this.writes.has(path)
      ? Promise.resolve(this.writes.get(path)!)
      : super.readSourceFile(path);
  }

  replaceTextFile(path: string, source: string): Promise<void> {
    this.writeCalls.push(path);
    this.writes.set(path, source);
    return Promise.resolve();
  }
}

Deno.test("formatting validates mixed unchanged providers and width repairs together", async () => {
  const provider = component("Provider", "A *search results* has meaning.");
  const fs = new FormattingFileSystem({
    "/work/.sigil/config.json": JSON.stringify({
      sigilVersion: "0.8.0",
      workspace: { name: "format" },
      files: { include: ["**/*.sigil"] },
    }),
    "/work/provider.sigil": provider,
    "/work/consumer.sigil":
      "@provider.sigil from Provider import { search results }\n" +
      component("Consumer", "prefix ".repeat(12) + "search results follow."),
    "/work/other.sigil": component("Other", "word ".repeat(30) + "ends."),
  });
  const core = new CoreAdapter({ fs, currentDirectory: "/work" });
  const checked = await core.formatSources(["."], undefined, true);
  assertEquals(checked.diagnostics, []);
  assertEquals(checked.files.map((f) => f.status), [
    "noncanonical",
    "noncanonical",
    "unchanged",
  ]);
  assertEquals(fs.writes.size, 0);

  const formatted = await core.formatSources(["."], undefined, false);
  assertEquals(formatted.diagnostics, []);
  assertEquals([...fs.writes.keys()], [
    "/work/consumer.sigil",
    "/work/other.sigil",
  ]);
  assertEquals(await fs.readSourceFile("/work/provider.sigil"), provider);
  assert(fs.writes.get("/work/consumer.sigil")!.includes("search results"));
  const canonical = await core.formatSources(["."], undefined, true);
  assertEquals(canonical.diagnostics, []);
  assertEquals(canonical.files.map((f) => f.status), [
    "unchanged",
    "unchanged",
    "unchanged",
  ]);
});

// @sigil tests packages/cli/_module.sigil::SigilCli::SourceFormatting logic,constraints,cases
Deno.test("formatting deduplicates overlapping batch targets and repairs both sides of imports", async () => {
  const provider = component(
    "Provider",
    "prefix ".repeat(12) + "A *search results* has meaning.",
  );
  const consumer =
    "@sources/provider.sigil from Provider import { search results }\n" +
    component("Consumer", "prefix ".repeat(12) + "search results follow.");
  const other = component("Other", "Keep this source untouched.");
  const fs = new FormattingFileSystem({
    "/work/.sigil/config.json": JSON.stringify({
      sigilVersion: "0.8.0",
      workspace: { name: "format" },
      files: { include: ["**/*.sigil"] },
    }),
    "/work/sources/provider.sigil": provider,
    "/work/sources/consumer.sigil": consumer,
    "/work/other.sigil": other,
  });
  const core = new CoreAdapter({ fs, currentDirectory: "/work" });
  const incomplete = await core.formatSources(
    ["sources/provider.sigil"],
    undefined,
    false,
  );
  assert(
    incomplete.diagnostics.some((diagnostic) =>
      diagnostic.code === "SIGIL_LINE_TOO_LONG"
    ),
  );
  assertEquals(fs.writeCalls, []);

  const targets = [
    "sources/provider.sigil",
    "sources",
    "sources/consumer.sigil",
    "./sources/",
  ];
  const checked = await core.formatSources(targets, undefined, true);
  assertEquals(checked.diagnostics, []);
  assertEquals(checked.files, [
    { filePath: "/work/sources/consumer.sigil", status: "noncanonical" },
    { filePath: "/work/sources/provider.sigil", status: "noncanonical" },
  ]);
  assertEquals(fs.writeCalls, []);
  const reversed = await core.formatSources(
    targets.toReversed(),
    undefined,
    true,
  );
  assertEquals(reversed.files, checked.files);

  const formatted = await core.formatSources(targets, undefined, false);
  assertEquals(formatted.diagnostics, []);
  assertEquals(fs.writeCalls, [
    "/work/sources/consumer.sigil",
    "/work/sources/provider.sigil",
  ]);
  assertEquals(await fs.readSourceFile("/work/other.sigil"), other);
  assert(
    fs.writes.get("/work/sources/provider.sigil")!.includes("*search results*"),
  );
  assert(
    fs.writes.get("/work/sources/consumer.sigil")!.includes("search results"),
  );
  const canonical = await core.formatSources([], undefined, true);
  assertEquals(canonical.diagnostics, []);
  assertEquals(canonical.files.map((file) => file.status), [
    "unchanged",
    "unchanged",
    "unchanged",
  ]);
  assertEquals(fs.writeCalls.length, 2);
});

// @sigil tests packages/cli/_module.sigil::SigilCli::SourceFormatting constraints,cases
Deno.test("formatting aborts a batch before any replacement when targets or source are invalid", async () => {
  const config = JSON.stringify({
    sigilVersion: "0.8.0",
    workspace: { name: "format" },
    files: { include: ["**/*.sigil"], exclude: ["excluded/**"] },
  });
  for (
    const invalidTarget of [
      "missing.sigil",
      "excluded/skip.sigil",
      "empty",
      "/foreign/other.sigil",
      "broken.sigil",
    ]
  ) {
    const source = component("Valid", "words ".repeat(30) + "end.");
    const fs = new FormattingFileSystem({
      "/work/.sigil/config.json": config,
      "/work/valid.sigil": source,
      "/work/excluded/skip.sigil": component("Skip", "Skip."),
      "/work/empty/readme.txt": "No Sigil source here.",
      "/foreign/.sigil/config.json": config,
      "/foreign/other.sigil": component("Other", "Other."),
      ...(invalidTarget === "broken.sigil"
        ? {
          "/work/broken.sigil": "component Broken {\n",
        }
        : {}),
    });
    const core = new CoreAdapter({ fs, currentDirectory: "/work" });
    if (invalidTarget === "broken.sigil") {
      const result = await core.formatSources(
        ["valid.sigil", invalidTarget],
        undefined,
        false,
      );
      assert(
        result.diagnostics.some((diagnostic) =>
          diagnostic.severity === "error"
        ),
      );
      assert(result.files.every((file) => file.status === "failed"));
    } else {
      await assertRejects(() =>
        core.formatSources(["valid.sigil", invalidTarget], undefined, false)
      );
    }
    assertEquals(fs.writeCalls, []);
    assertEquals(await fs.readSourceFile("/work/valid.sigil"), source);
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::SourceFormatting logic,constraints,cases
Deno.test("formatting rejects ancestor targets without a discovered workspace", async () => {
  for (const targets of [["main.sigil", ".."], ["..", "main.sigil"]]) {
    const source = component("Main", "words ".repeat(30) + "end.");
    const other = component("Other", "words ".repeat(30) + "end.");
    const fs = new FormattingFileSystem({
      "/work/.sigil/config.json": JSON.stringify({
        sigilVersion: "0.8.0",
        workspace: { name: "format" },
        files: { include: ["**/*.sigil"] },
      }),
      "/work/main.sigil": source,
      "/work/other.sigil": other,
    });
    const core = new CoreAdapter({ fs, currentDirectory: "/work" });
    for (const check of [false, true]) {
      await assertRejects(() => core.formatSources(targets, undefined, check));
      assertEquals(fs.writeCalls, []);
      assertEquals(await fs.readSourceFile("/work/main.sigil"), source);
      assertEquals(await fs.readSourceFile("/work/other.sigil"), other);
    }
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::SourceFormatting logic,constraints,cases
Deno.test("formatting retains ancestor directory selection with an explicit workspace root", async () => {
  const fs = new FormattingFileSystem({
    "/work/nested/.sigil/config.json": JSON.stringify({
      sigilVersion: "0.8.0",
      workspace: { name: "format" },
      files: { include: ["**/*.sigil"] },
    }),
    "/work/nested/main.sigil": component("Main", "words ".repeat(30) + "end."),
  });
  const core = new CoreAdapter({ fs, currentDirectory: "/work" });
  for (const targets of [[], ["."], ["nested/main.sigil", ".", "."]]) {
    const checked = await core.formatSources(targets, "nested", true);
    assertEquals(checked.diagnostics, []);
    assertEquals(checked.files, [{
      filePath: "/work/nested/main.sigil",
      status: "noncanonical",
    }]);
    assertEquals(fs.writeCalls, []);
  }
});
