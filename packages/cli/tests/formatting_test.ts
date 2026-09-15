import { assert, assertEquals } from "@std/assert";
import { InMemorySigilFileSystem } from "@qoherent/sigil-core";
import { CoreAdapter } from "../src/core-adapter.ts";

const component = (name: string, prose: string) =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${prose}\n}\n}\n`;

class FormattingFileSystem extends InMemorySigilFileSystem {
  readonly writes = new Map<string, string>();

  override readSourceFile(path: string) {
    return this.writes.has(path)
      ? Promise.resolve(this.writes.get(path)!)
      : super.readSourceFile(path);
  }

  replaceTextFile(path: string, source: string): Promise<void> {
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
  const checked = await core.formatSources(".", undefined, true);
  assertEquals(checked.diagnostics, []);
  assertEquals(checked.files.map((f) => f.status), [
    "noncanonical",
    "noncanonical",
    "unchanged",
  ]);
  assertEquals(fs.writes.size, 0);

  const formatted = await core.formatSources(".", undefined, false);
  assertEquals(formatted.diagnostics, []);
  assertEquals([...fs.writes.keys()], [
    "/work/consumer.sigil",
    "/work/other.sigil",
  ]);
  assertEquals(await fs.readSourceFile("/work/provider.sigil"), provider);
  assert(fs.writes.get("/work/consumer.sigil")!.includes("search results"));
  const canonical = await core.formatSources(".", undefined, true);
  assertEquals(canonical.diagnostics, []);
  assertEquals(canonical.files.map((f) => f.status), [
    "unchanged",
    "unchanged",
    "unchanged",
  ]);
});
