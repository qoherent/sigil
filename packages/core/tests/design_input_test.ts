import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { InMemorySigilFileSystem, loadDesignInput } from "../src/mod.ts";

const config = JSON.stringify({
  sigilVersion: "0.8.0",
  workspace: { name: "fixture", members: [] },
  files: { include: ["**/*.sigil"], exclude: [] },
});
const files = {
  ".sigil/config.json": config,
  "base.sigil": `component Base {
  interface {
    Value {
      Expose a value.
    }
  }
}
`,
  "extra.sigil": `@base.sigil import { Base }
expand Base {
  constraints {
    Value {
      Preserve the value.
      ${"`".repeat(3)}ts
      const example = 1;
      ${"`".repeat(3)}
    }
  }
}
`,
  "index.sigil": "@base.sigil import { Base }\n",
  "unresolved.sigil": `expand Missing {
  logic {
    Keep this unresolved prose in the inventory.
  }
}
`,
};

Deno.test("nested Design workspace binds only its selected config", async () => {
  const parent = JSON.stringify({
    ...JSON.parse(config),
    files: { include: ["**/*.sigil"], exclude: ["child/**"] },
  });
  const nested = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [`child/${path}`, text]),
  );
  const { root, bundle } = await loadDesignInput(
    new InMemorySigilFileSystem({ ".sigil/config.json": parent, ...nested }),
    { startPath: "child" },
  );
  assertEquals(root, "child");
  assertEquals(
    bundle.context.find((c) => c.path === ".sigil/config.json")?.text,
    config,
  );
  assertEquals(bundle.context.length, 3);
  assert(bundle.sources.every((s) => !s.path.startsWith("child/")));
});

Deno.test("Design transport preserves physical units and resolved identity without lowering imports", async () => {
  const { bundle } = await loadDesignInput(
    new InMemorySigilFileSystem(files),
    { startPath: "." },
  );
  assertEquals(bundle.sources.length, 4);
  assertEquals(bundle.units.length, 3);
  const base = bundle.entities.find((e) => e.type === "Component")!;
  assertEquals(base.id, "urn:sigil:component:base.sigil:Base");
  assertEquals(
    bundle.units.find((u) => u.source === "extra.sigil")?.owner,
    base.id,
  );
  assertEquals(
    bundle.units.find((u) => u.source === "unresolved.sigil")?.owner,
    null,
  );
  assert(bundle.entities.some((e) => e.type === "Tag" && e.exported));
  assert(bundle.diagnostics.some((d) => d.severity === "error"));
  assertEquals(bundle.imports.find((i) => i.source === "index.sigil")?.names, [
    { name: "Base", entity: base.id },
  ]);
  assertEquals(
    bundle.sources.find((s) => s.path === "extra.sigil")?.text,
    files["extra.sigil"],
  );
  assertEquals(bundle.context, [
    { path: ".sigil/config.json", text: config },
    { path: ".sigil/glossary.json", text: null },
    { path: ".sigil/local.json", text: null },
  ]);
  assertEquals(Object.keys(bundle).sort(), [
    "context",
    "diagnostics",
    "entities",
    "frontendVersion",
    "imports",
    "schemaVersion",
    "sources",
    "units",
  ]);
  assert(!JSON.stringify(bundle).includes("dependsOn"));
});

Deno.test("Design transport is deterministic across discovery order and captures loaded buffers", async () => {
  const first = await loadDesignInput(new InMemorySigilFileSystem(files), {
    startPath: ".",
  });
  const second = await loadDesignInput(
    new InMemorySigilFileSystem(
      Object.fromEntries(Object.entries(files).reverse()),
    ),
    { startPath: "." },
  );
  assertEquals(first, second);
  const changed = { ...files, "base.sigil": files["base.sigil"] + "\n" };
  const third = await loadDesignInput(new InMemorySigilFileSystem(changed), {
    startPath: ".",
  });
  assertEquals(
    first.bundle.sources.find((s) => s.path === "base.sigil")?.text,
    files["base.sigil"],
  );
  assertEquals(
    third.bundle.sources.find((s) => s.path === "base.sigil")?.text,
    changed["base.sigil"],
  );
});
