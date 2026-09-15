import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { resolveSigilWorkspace } from "../src/pipeline.ts";
import {
  ownedImplementationTargetsFor,
  ownershipDiagnosticsFor,
} from "../src/implementation-ownership.ts";
import { assert, assertEquals } from "./assert.ts";
const config = JSON.stringify({
  sigilVersion: "0.8.0",
  workspace: { name: "test" },
  files: { include: ["**/*.sigil"] },
});
const component = (name: string, body: string, rest = "") =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${body}\n}\n${rest}\n}`;
async function fixture(files: Record<string, string>) {
  return resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({ ".sigil/config.json": config, ...files }),
      { startPath: "." },
    ),
  );
}

Deno.test("quoted exact Tag selectors retain provider origin and only consumer-owned Facets", async () => {
  const name = 'search "quoted" \\ path::result';
  const r = await fixture({
    "p.sigil": component("P", `A *${name}* has meaning.`),
    "c.sigil": `@p.sigil from P import { ${name} }\n` +
      component(
        "C",
        `Use ${name}.\n\nOffer another interaction.`,
        `constraints {\nConstrain ${name}.\n}`,
      ),
  });
  assertEquals(r.diagnostics, []);
  const source = {
    filePath: "entry.ts",
    text: `// 😀\r\n// @sigil implements c.sigil::C::${
      JSON.stringify(name)
    } interface,constraints\r\nexport function entry() {}\r\n`,
  };
  const owned = ownedImplementationTargetsFor(r, [source], {
    componentName: "C",
    declarationPath: "c.sigil",
  }, name)!;
  assertEquals(owned.diagnostics, []);
  assertEquals(owned.tag?.identity?.owner.componentName, "P");
  assertEquals(owned.facets.map((f) => [f.ownerName, f.sectionName]), [[
    "C",
    "interface",
  ], ["C", "constraints"]]);
  assertEquals(owned.targets.map((t) => t.symbolIdentity), ["entry"]);
  assertEquals(owned.targets[0].location, { line: 3, column: 17 });
  assertEquals(owned.targets[0].annotationRange.start, { line: 1, column: 1 });
  assertEquals(owned.targets[0].annotationRange.end.line, 2);
  const upstream = ownedImplementationTargetsFor(r, [source], {
    componentName: "P",
    declarationPath: "p.sigil",
  }, name)!;
  assertEquals(upstream.targets, []);
  assertEquals(upstream.facets.map((f) => f.ownerName), ["P"]);
});

Deno.test("local grouping, inline introduction and bare references select their own Facets", async () => {
  const r = await fixture({
    "c.sigil": component(
      "C",
      "A *query* has meaning.\n\nquery {\nOffer the grouped interaction.\n}\n\nUse query.\n\nOffer another interaction.",
    ),
  });
  const owned = ownedImplementationTargetsFor(r, [], {
    componentName: "C",
    declarationPath: "c.sigil",
  }, "query")!;
  assertEquals(owned.facets.length, 3);
  assertEquals(owned.targets, []);
  assertEquals(
    ownedImplementationTargetsFor(r, [], {
      componentName: "C",
      declarationPath: "c.sigil",
    }, "Query"),
    undefined,
  );
  assertEquals(
    ownedImplementationTargetsFor(r, [], {
      componentName: "Missing",
      declarationPath: "c.sigil",
    }),
    undefined,
  );
  const noSection = ownedImplementationTargetsFor(
    r,
    [],
    { componentName: "C", declarationPath: "c.sigil" },
    "query",
    "state",
  )!;
  assertEquals(noSection.facets, []);
  assertEquals(noSection.targets, []);
});

Deno.test("ownership rejects absent Tag sections, ambiguous names and removed declaration paths", async () => {
  const r = await fixture({
    "c.sigil": component(
      "C",
      "A *query* has meaning.",
      "logic {\nAn independent algorithm.\n}",
    ),
  });
  const sources = [{
    filePath: "a.ts",
    text:
      "// @sigil implements c.sigil::C::query logic\nexport function wrongSection() {}",
  }, {
    filePath: "b.ts",
    text:
      "// @sigil uses old-expand.sigil::C interface\nexport function oldPath() {}",
  }];
  const errors = ownershipDiagnosticsFor(r, sources);
  assertEquals(errors.length, 2);
  assert(
    errors.every((d) =>
      d.stage === "host" && d.implementationRange !== undefined &&
      d.range === undefined
    ),
  );
  const ambiguous = await fixture({
    "c.sigil": component(
      "C",
      "A *query* has meaning.\n\nAnother *query* repeats.",
    ),
  });
  assertEquals(
    ownedImplementationTargetsFor(ambiguous, [], {
      componentName: "C",
      declarationPath: "c.sigil",
    }, "query"),
    undefined,
  );
});

Deno.test("Markdown and component-file annotations preserve file and entrypoint binding", async () => {
  const r = await fixture({
    "c.sigil": component("C", "query {\nOffer an interaction.\n}"),
  });
  const source = [{
    filePath: "guide.md",
    text: "<!-- @sigil uses c.sigil::C::query interface -->\n# Guide",
  }, {
    filePath: "view.vue",
    text:
      "<template><!-- @sigil implements c.sigil::C::query interface --><p>hello</p></template>\n<script>\n// @sigil uses c.sigil::C::query interface\nexport function load() {}\n</script>",
  }];
  const owned = ownedImplementationTargetsFor(r, source, {
    componentName: "C",
    declarationPath: "c.sigil",
  }, "query")!;
  assertEquals(owned.diagnostics, []);
  assertEquals(owned.targets.map((t) => [t.filePath, t.symbolIdentity]), [
    ["guide.md", undefined],
    ["view.vue", undefined],
    ["view.vue", "load"],
  ]);
  assertEquals(owned.targets[0].location, { line: 1, column: 1 });
});
