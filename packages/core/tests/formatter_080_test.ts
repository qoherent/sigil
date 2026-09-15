import { parseSigilDocument } from "../src/parser.ts";
import { formatSigilDocument } from "../src/formatter.ts";
import { resolveSigilRelationships } from "../src/resolver.ts";
import type { SigilResolution } from "../src/model/resolution.ts";
import { assert, assertEquals } from "./assert.ts";
const component = (body: string) =>
  `component C {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${body}\n}\n}`;
function resolve(files: Record<string, string>): SigilResolution {
  const loaded = Object.entries(files).map(([path, source]) => ({
    path,
    source,
    document:
      parseSigilDocument(path, source, { sigilVersion: "0.8.0" }).document,
  }));
  return resolveSigilRelationships({
    root: ".",
    workspaceSnapshotIdentity: "fixture",
    memberRoots: [],
    files: loaded,
    diagnostics: loaded.flatMap((f) => f.document.diagnostics),
  });
}
const format = (source: string, context?: SigilResolution) =>
  formatSigilDocument(
    parseSigilDocument("c.sigil", source, { sigilVersion: "0.8.0" }).document,
    source,
    context,
  );

Deno.test("width-only formatting is safe, byte mapped, idempotent and preserves final newline", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    const source = "\uFEFF" +
      component("      " + "word ".repeat(30) + "😀.").replaceAll(
        "\n",
        ending,
      ) + ending;
    const result = format(source);
    assert(result.formattedSource);
    assert(result.changed);
    assertEquals(result.diagnostics, []);
    assert(result.formattedSource.startsWith("\uFEFFcomponent C"));
    assert(result.formattedSource.endsWith(ending));
    assertEquals(
      format(result.formattedSource).formattedSource,
      result.formattedSource,
    );
  }
});

Deno.test("formatting preserves exact multiword Tags and never creates references by joining lines", () => {
  const source = component(
    "A *search  results* has meaning.\n\n" + "prefix ".repeat(10) +
      "search  results follow.\n\nsearch\nresults remain separate.",
  );
  const before = resolve({ "c.sigil": source });
  const result = format(source, before);
  assert(result.formattedSource);
  const after = resolve({ "c.sigil": result.formattedSource });
  assertEquals(
    after.components[0].references.map((r) => r.name),
    before.components[0].references.map((r) => r.name),
  );
  assertEquals(after.components[0].tags[0].name, "search  results");
  assertEquals(after.components[0].declaration.sections[1].units.length, 3);
  assert(result.formattedSource.includes("search  results"));
});

Deno.test("import-dependent formatting requires the exact captured provider context", () => {
  const source = "@p.sigil from P import { search results }\n" +
    component("prefix ".repeat(10) + "search results follow.");
  const provider =
    "component P {\ngoal {\nOwn a responsibility.\n}\ninterface {\nA *search results* has meaning.\n}\n}";
  assertEquals(format(source).formattedSource, undefined);
  const context = resolve({ "c.sigil": source, "p.sigil": provider });
  const result = format(source, context);
  assert(result.formattedSource);
  assertEquals(
    resolve({ "c.sigil": result.formattedSource, "p.sigil": provider })
      .components.find((c) => c.name === "C")!.references.map((r) => r.name),
    ["search results"],
  );
  assertEquals(format(source + "\n", context).formattedSource, undefined);
});

Deno.test("unformattable recognized multiword references suppress ordinary width errors", () => {
  const name = "word ".repeat(18) + "end";
  const provider =
    `component P {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${name} {\nOffer an interaction.\n}\n}\n}`;
  const source = `@p.sigil from P import { ${name} }\n` + component(name);
  const context = resolve({ "c.sigil": source, "p.sigil": provider });
  assertEquals(context.diagnostics.map((d) => d.code), [
    "SIGIL_UNFORMATTABLE_LINE",
  ]);
  const result = format(source, context);
  assertEquals(result.formattedSource, undefined);
  assertEquals(result.changed, false);
});

Deno.test("formatting keeps complete links and payload bytes intact", () => {
  const link = `[a label](<./${"long/".repeat(40)}target.md> "a title")`;
  const payload = "```text\r\n  raw  \r\n\r\n }\r\n```";
  const source = component(
    "prefix ".repeat(10) + link + " follows.\n" + payload,
  );
  const result = format(source);
  assert(result.formattedSource);
  assert(result.formattedSource.includes(link));
  assert(result.formattedSource.includes(payload));
  assertEquals(
    parseSigilDocument("c.sigil", result.formattedSource, {
      sigilVersion: "0.8.0",
    }).diagnostics,
    [],
  );
});

Deno.test("formatting rejects structural recovery, broken names, collisions and unsafe structural lines", () => {
  for (
    const source of [
      component("A *broken"),
      component("An example.\n```text\nunclosed"),
      component("A *query* exists.\n\nAnother *query* exists."),
    ]
  ) {
    const result = format(source);
    assertEquals(result.formattedSource, undefined);
    assertEquals(result.changed, false);
  }
  const source = component("word ".repeat(15) + "tag { remains prose.");
  const result = format(source);
  if (result.formattedSource) {
    assertEquals(
      parseSigilDocument("c.sigil", result.formattedSource, {
        sigilVersion: "0.8.0",
      }).document.components[0].sections[1].groups,
      [],
    );
  }
});
