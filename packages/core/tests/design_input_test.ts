import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { InMemorySigilFileSystem, loadDesignInput } from "../src/mod.ts";

export const designFixtureFiles = {
  ".sigil/config.json": JSON.stringify({
    sigilVersion: "0.8.0",
    workspace: { name: "fixture" },
    files: { include: ["**/*.sigil"] },
  }),
  "base.sigil":
    "\uFEFFcomponent Base {\r\ngoal {\r\nOwn provider vocabulary.\r\n}\r\ninterface {\r\nA *value* and *result* exist.\r\n}\r\nconstraints {\r\nvalue {\r\nPreserve value and result.\r\n}\r\n}\r\n}\r\n",
  "consumer.sigil":
    "@base.sigil from Base import { value, result }\ncomponent Consumer {\ngoal {\nServe the caller.\n}\ninterface {\nUse value and result with [notes](./notes.md).\n```text\nraw 😀  \n```\n}\n}\n",
};
Deno.test("Design schema 2 preserves all Tag relations and exact source buffers", async () => {
  const { bundle } = await loadDesignInput(
    new InMemorySigilFileSystem(designFixtureFiles),
    { startPath: "." },
  );
  assert(bundle);
  assertEquals(bundle.schemaVersion, 2);
  assertEquals(bundle.languageVersion, "0.8.0");
  assertEquals(bundle.entities.filter((e) => e.type === "Tag").length, 2);
  assertEquals(bundle.introductions.length, 3);
  assertEquals(bundle.groups.length, 1);
  assertEquals(bundle.references.length, 4);
  assertEquals(bundle.links.length, 1);
  const unit = bundle.units.find((u) => u.payload)!;
  assertEquals(unit.references.length, 2);
  assertEquals(unit.links.length, 1);
  assertEquals(unit.payload!.rawBody, "raw 😀  \n");
  assertEquals(
    bundle.sources.find((s) => s.path === "base.sigil")!.text,
    designFixtureFiles["base.sigil"],
  );
  assertEquals(bundle.diagnostics, []);
  assert(!JSON.stringify(bundle).includes('"exported"'));
  assert(!JSON.stringify(bundle).includes('"concept"'));
  const shared = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/design-input-080.json", import.meta.url),
    ),
  );
  assertEquals(JSON.parse(JSON.stringify(bundle)), shared);
});
Deno.test("Design capture is deterministic and nested context belongs to the selected workspace", async () => {
  const first = await loadDesignInput(
    new InMemorySigilFileSystem(designFixtureFiles),
    { startPath: "." },
  );
  const nested = Object.fromEntries(
    Object.entries(designFixtureFiles).reverse().map((
      [p, t],
    ) => [`child/${p}`, t]),
  );
  const second = await loadDesignInput(new InMemorySigilFileSystem(nested), {
    startPath: "child",
  });
  assertEquals(second.root, "child");
  assertEquals(first.bundle, second.bundle);
  assertEquals(second.bundle!.context.length, 3);
});
Deno.test("Design capture rejects malformed bytes without exporting replacement text", async () => {
  for (const path of ["base.sigil", ".sigil/config.json"]) {
    const result = await loadDesignInput(
      new InMemorySigilFileSystem({
        ...designFixtureFiles,
        [path]: new Uint8Array([0xc3, 0x28]),
      }),
      { startPath: "." },
    );
    assertEquals(result.bundle, null);
    assert(result.diagnostics.some((d) => d.code === "SIGIL_INVALID_ENCODING"));
  }
});
Deno.test("Design capture retains independent invalid structure and ambiguous introductions", async () => {
  const { bundle } = await loadDesignInput(
    new InMemorySigilFileSystem({
      ...designFixtureFiles,
      "invalid.sigil":
        "component Broken {\ngoal {\nA purpose.\n}\ninterface {\nA *duplicate* exists.\n\nAnother *duplicate* exists.\n}\n}\n",
    }),
    { startPath: "." },
  );
  assert(bundle);
  const introductions = bundle.introductions.filter((i) =>
    i.name === "duplicate"
  );
  assertEquals(introductions.length, 2);
  assert(introductions.every((i) => i.tag === null));
  assert(bundle.diagnostics.some((d) => d.severity === "error"));
  assertEquals(bundle.sources.length, 3);
});

Deno.test("native cycle and scope fixtures are reproducible current frontend exports", async () => {
  for (const name of ["design-cycle-080.json", "design-scope-080.json"]) {
    const fixture = JSON.parse(
      await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)),
    );
    const files = Object.fromEntries(
      [...fixture.sources, ...fixture.context]
        .filter((s) => s.text !== null).map((s) => [s.path, s.text]),
    );
    const { bundle } = await loadDesignInput(
      new InMemorySigilFileSystem(files),
      { startPath: "." },
    );
    assert(bundle);
    assertEquals(JSON.parse(JSON.stringify(bundle)), fixture);
  }
});
