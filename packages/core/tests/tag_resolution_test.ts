import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { resolveSigilRelationships } from "../src/resolver.ts";
import { isTagWordCharacter } from "../src/tag-matching.ts";
import { assert, assertEquals } from "./assert.ts";

const config = JSON.stringify({
  sigilVersion: "0.8.0",
  workspace: { name: "test" },
  files: { include: ["**/*.sigil"] },
});
const component = (name: string, prose: string, rest = "") =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${prose}\n}\n${rest}\n}\n`;
const provider = (name = "Provider", tags = ["query", "submit"]) =>
  component(name, tags.map((n) => `A *${n}* has meaning.`).join("\n\n"));
const importing = (path: string, owner: string, names: string) =>
  `@${path} from ${owner} import { ${names} }\n`;
async function resolve(files: Record<string, string>) {
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({ ".sigil/config.json": config, ...files }),
    { startPath: "." },
  );
  return resolveSigilRelationships(workspace);
}
const codes = (r: Awaited<ReturnType<typeof resolve>>) =>
  r.diagnostics.map((d) => d.code);

Deno.test("reference word characters stay pinned to Unicode 15.1", () => {
  for (
    const character of ["A", "é", "́", "٣", "‿", "\u200c", "\u200d", "\u{2ebf0}"]
  ) assert(isTagWordCharacter(character));
  // U+1C89 became a letter in Unicode 16.0; host Unicode upgrades must not change 0.8.
  for (const character of ["-", ".", "😀", "\u1c89", "\u{2ee5e}"]) {
    assert(!isTagWordCharacter(character));
  }
});

Deno.test("C05: explicit Tag selection preserves independent successes and consumer ownership", async () => {
  const r = await resolve({
    "provider.sigil": provider(),
    "consumer.sigil":
      importing("provider.sigil", "Provider", "query, missing, submit") +
      component("Consumer", "Use query."),
  });
  assertEquals(codes(r), [
    "SIGIL_UNRESOLVED_IMPORTED_TAG",
    "SIGIL_UNUSED_TAG_IMPORT",
  ]);
  assertEquals(r.imports[0].names.map((n) => [n.name, n.status, n.used]), [
    ["query", "resolved", true],
    ["missing", "unresolved", false],
    ["submit", "resolved", false],
  ]);
  const consumer = r.components.find((c) => c.name === "Consumer")!;
  assertEquals(
    consumer.references.map(
      (r) => [r.name, r.tagIdentity?.owner.componentName],
    ),
    [["query", "Provider"]],
  );
  assertEquals(consumer.references[0].componentId, consumer.declaration.id);
  assert(
    consumer.references[0].facetId ===
      consumer.declaration.sections[1].units[0].id,
  );
});

Deno.test("C02: collective local introductions reuse exact identities and conflicting definitions stay unresolved", async () => {
  const r = await resolve({
    "p.sigil": component(
      "Provider",
      "query {\nUse query.\n}\n\nA *query* has meaning.\n\nquery {\nRepeat query.\n}\n\nA *bad* repeats.\n\nAnother *bad* repeats.\n\nbad {\nUse bad.\n}",
    ),
  });
  assertEquals(codes(r), ["SIGIL_DUPLICATE_TAG_DEFINITION"]);
  const c = r.components[0];
  const q = c.tags.find((t) => t.name === "query")!;
  assertEquals(q.introductions.map((i) => i.kind), [
    "group",
    "inline",
    "group",
  ]);
  assertEquals(q.status, "resolved");
  assertEquals(c.tags.find((t) => t.name === "bad")?.identity, undefined);
  assertEquals(
    c.references.filter((r) => r.name === "bad").map((r) => r.status),
    ["ambiguous"],
  );
  assertEquals(r.diagnostics[0].related.length, 1);
});

Deno.test("provider failure stays on its selection with related ambiguous declarations", async () => {
  const r = await resolve({
    "a.sigil": provider(),
    "b.sigil": provider(),
    "z.sigil": importing("a.sigil", "Provider", "query") +
      component("C", "Use query."),
  });
  const failure = r.diagnostics.find((d) =>
    d.code === "SIGIL_UNRESOLVED_IMPORTED_COMPONENT"
  )!;
  assertEquals(failure.filePath, "z.sigil");
  assertEquals(failure.related.map((d) => d.filePath), ["a.sigil", "b.sigil"]);
});

Deno.test("root-relative imports work from absolute POSIX and Windows workspaces", async () => {
  for (const root of ["/checkout", "C:/checkout"]) {
    const workspace = await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        [`${root}/.sigil/config.json`]: config,
        [`${root}/p.sigil`]: provider(),
        [`${root}/c.sigil`]: importing("p.sigil", "Provider", "query") +
          component("C", "Use query."),
      }),
      { startPath: root },
    );
    const r = resolveSigilRelationships(workspace);
    assertEquals(codes(r), []);
    assertEquals(r.imports[0].targetFile, `${root}/p.sigil`);
  }
});

Deno.test("C03: exact physical matching uses complete boundaries and global longest overlap", async () => {
  const examples: [string[], string, string[]][] = [
    [["order"], "order pre-order order.status (order). orders", [
      "order",
      "order",
    ]],
    [["C++"], "Use C++ here. C++17", ["C++"]],
    [["query"], "Query query", ["query"]],
    [["search results"], "search  results search\tresults search\nresults", []],
    [
      ["search", "results", "search results"],
      "search results replace results",
      ["search results", "results"],
    ],
    [["new order", "order status"], "new order status", ["order status"]],
    [["a b", "b c"], "a b c", ["a b"]],
    [["é", "é"], "é é", ["é", "é"]],
    [["query"], "querý query‿ query‌ query‍ query..word word--query", []],
    [["query"], "😀query😀 query. [query](./doc.md) `query`", [
      "query",
      "query",
      "query",
    ]],
  ];
  for (const [names, prose, want] of examples) {
    const r = await resolve({
      "p.sigil": provider("P", names),
      "c.sigil": importing("p.sigil", "P", names.join(", ")) +
        component("C", prose),
    });
    assertEquals(
      r.components.find((c) => c.name === "C")!.references.map((r) => r.name),
      want,
    );
  }
});

Deno.test("duplicate selections and collisions have no import-order winner or extra unused errors", async () => {
  const files = {
    "p.sigil": provider("P"),
    "q.sigil": provider("Q", ["query"]),
    "c.sigil": importing("p.sigil", "P", "query, submit") +
      importing("./p.sigil", "P", "query") +
      component("C", "Use query and submit."),
  };
  const duplicate = await resolve(files);
  assertEquals(codes(duplicate), ["SIGIL_DUPLICATE_TAG_IMPORT"]);
  assertEquals(duplicate.imports.flatMap((i) => i.names).map((n) => n.status), [
    "duplicate",
    "resolved",
    "duplicate",
  ]);
  const collision = await resolve({
    ...files,
    "c.sigil": importing("p.sigil", "P", "query") +
      importing("q.sigil", "Q", "query") + component("C", "Use query."),
  });
  assertEquals(codes(collision), ["SIGIL_TAG_NAME_COLLISION"]);
  assertEquals(
    collision.components.find((c) => c.name === "C")!.references[0].tagIdentity,
    undefined,
  );
  const local = await resolve({
    ...files,
    "c.sigil": importing("p.sigil", "P", "query") +
      component("C", "query {\nUse query.\n}"),
  });
  assertEquals(codes(local), ["SIGIL_TAG_NAME_COLLISION"]);
  assertEquals(
    local.components.find((c) => c.name === "C")!.references[0].status,
    "ambiguous",
  );
});

Deno.test("mutual imports resolve collectively, never re-export, and ignore discovery order", async () => {
  const files = {
    "a.sigil": importing("b.sigil", "B", "beta") +
      component("A", "A *alpha* exists.\n\nUse beta."),
    "b.sigil": importing("a.sigil", "A", "alpha") +
      component("B", "A *beta* exists.\n\nUse alpha."),
    "c.sigil": importing("b.sigil", "B", "alpha") +
      component("C", "Use alpha."),
  };
  const first = await resolve(files),
    second = await resolve(Object.fromEntries(Object.entries(files).reverse()));
  assertEquals(codes(first), ["SIGIL_UNRESOLVED_IMPORTED_TAG"]);
  assertEquals(first.imports, second.imports);
  assertEquals(first.components, second.components);
  assertEquals(first.diagnostics, second.diagnostics);
});

Deno.test("file imports are shared while sibling local Tags remain private to their component", async () => {
  const r = await resolve({
    "p.sigil": provider(),
    "c.sigil": importing("p.sigil", "Provider", "query") +
      component("One", "A *local* exists.") +
      component("Two", "Use query and local."),
  });
  assertEquals(codes(r), []);
  assertEquals(
    r.components.find((c) => c.name === "Two")!.references.map((r) => r.name),
    ["query"],
  );
});

Deno.test("path and provider failures suppress dependent errors without module index fallback", async () => {
  for (
    const path of [
      "folder",
      "/p.sigil",
      "\\p.sigil",
      "C:p.sigil",
      "../p.sigil",
      "missing.sigil",
    ]
  ) {
    const r = await resolve({
      "p.sigil": provider(),
      "folder/_module.sigil": provider("Summary"),
      "c.sigil": importing(path, "Provider", "query") +
        component("C", "Use query."),
    });
    assertEquals(codes(r), ["SIGIL_UNRESOLVED_IMPORT_PATH"]);
  }
  const r = await resolve({
    "folder/_module.sigil": provider(),
    "c.sigil": importing("folder//./x/../_module.sigil", "Provider", "query") +
      component("C", "Use query."),
  });
  assertEquals(codes(r), []);
  const missing = await resolve({
    "p.sigil": provider(),
    "c.sigil": importing("p.sigil", "Missing", "query") +
      component("C", "Use query."),
  });
  assertEquals(codes(missing), ["SIGIL_UNRESOLVED_IMPORTED_COMPONENT"]);
});

Deno.test("global duplicate components retain physical evidence without an owner", async () => {
  const r = await resolve({
    "a.sigil": provider(),
    "b.sigil": provider(),
    "c.sigil": importing("a.sigil", "Provider", "query") +
      component("C", "Use query."),
  });
  assertEquals(codes(r), [
    "SIGIL_DUPLICATE_COMPONENT",
    "SIGIL_UNRESOLVED_IMPORTED_COMPONENT",
  ]);
  const copies = r.components.filter((c) => c.name === "Provider");
  assertEquals(copies.map((c) => c.identity), [undefined, undefined]);
  assert(copies[0].declaration.id !== copies[1].declaration.id);
  assertEquals(r.diagnostics[0].related.length, 1);
});

Deno.test("all contracts and embedded introductions use imports; protected text and incomplete recovery do not invent use", async () => {
  for (
    const section of [
      "goal",
      "interface",
      "state",
      "logic",
      "constraints",
      "cases",
      "decisions",
    ]
  ) {
    const body = section === "goal"
      ? `component C {\ngoal {\nUse query.\n}\ninterface {\nOffer an interaction.\n}\n}`
      : component(
        "C",
        section === "interface" ? "Use query." : "Offer an interaction.",
        section === "interface" ? "" : `${section} {\nUse query.\n}`,
      );
    const r = await resolve({
      "p.sigil": provider(),
      "c.sigil": importing("p.sigil", "Provider", "query") + body,
    });
    assertEquals(codes(r), []);
  }
  for (
    const [prose, used] of [["Use query.\n```text\nquery\n```", true], [
      "Read [query](./doc.md).\n```text\nquery\n```",
      false,
    ]] as const
  ) {
    const r = await resolve({
      "p.sigil": provider(),
      "c.sigil": importing("p.sigil", "Provider", "query") +
        component("C", prose),
    });
    assertEquals(r.imports[0].names[0].used, used);
    assertEquals(codes(r), used ? [] : ["SIGIL_UNUSED_TAG_IMPORT"]);
  }
  const incomplete = await resolve({
    "p.sigil": provider(),
    "c.sigil": importing("p.sigil", "Provider", "query") +
      component("C", "An example.\n```text\nquery"),
  });
  assertEquals(codes(incomplete), ["SIGIL_UNCLOSED_LITERAL_BLOCK"]);
});
