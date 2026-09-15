import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { resolveSigilWorkspace } from "../src/pipeline.ts";
import { selectCompilationBoundary } from "../src/compilation-boundary.ts";
import { assert, assertEquals } from "./assert.ts";
const config = JSON.stringify({
  sigilVersion: "0.8.0",
  workspace: { name: "test" },
  files: { include: ["**/*.sigil"] },
});
const component = (name: string, body: string) =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${body}\n}\n}`;
async function fixture(files: Record<string, string>) {
  return resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({ ".sigil/config.json": config, ...files }),
      { startPath: "." },
    ),
  );
}

Deno.test("boundary selection uses direct Tag providers and gives summaries no ancestry privilege", async () => {
  const r = await fixture({
    "_module.sigil": component("Summary", "Describe the project."),
    "p.sigil": component("P", "A *query* exists."),
    "c.sigil": "@p.sigil from P import { query }\n" +
      component("C", "Use query."),
    "other.sigil": component("Other", "Offer an unrelated interaction."),
  });
  const result = selectCompilationBoundary(r, {
    kind: "component",
    componentName: "P",
  });
  assertEquals(result.diagnostics, []);
  assertEquals(result.selection.strategy, "covering-component");
  assert(result.resolvedTarget.kind === "component");
  assert(result.resolvedTarget.name !== "Summary");
  const exact = selectCompilationBoundary(r, {
    kind: "component",
    componentName: "P",
  }, { exactTarget: true });
  assertEquals(exact.resolvedTarget, {
    kind: "component",
    name: "P",
    declarationPath: "p.sigil",
  });
  const all = selectCompilationBoundary(r, {
    kind: "directory",
    directoryPath: ".",
  });
  assertEquals(all.selection.strategy, "workspace-fallback");
});

Deno.test("source locations select the original scalar position with a half-open range", async () => {
  const text = "\uFEFF" + component("First", "A 😀 illustration.") + "\r\n" +
    component("Second", "Offer another interaction.");
  const r = await fixture({ "two.sigil": text });
  const second = r.components.find((c) => c.name === "Second")!;
  const source = r.workspace.files[0].document.source!;
  const at = source.locationAtByte(second.declaration.nameRange.start)!;
  const result = selectCompilationBoundary(r, {
    kind: "location",
    filePath: "two.sigil",
    line: at.line,
    column: at.column,
  });
  assertEquals(
    result.selection.affectedSemanticUnits.filter((x) =>
      x.startsWith("component:")
    ),
    ["component:Second@two.sigil"],
  );
});

Deno.test("invalid and unresolved boundary seeds never silently widen to a real workspace selection", async () => {
  const r = await fixture({
    "c.sigil": component("C", "Offer an interaction."),
  });
  for (const filePath of ["", "a/../c.sigil", "/c.sigil", "C:c.sigil"]) {
    assertEquals(
      selectCompilationBoundary(r, { kind: "file", filePath }).diagnostics.map(
        (d) => d.code,
      ),
      ["SIGIL_BOUNDARY_SEED_PATH_INVALID"],
    );
  }
  assertEquals(
    selectCompilationBoundary(r, { kind: "file", filePath: "missing.sigil" })
      .diagnostics.map((d) => d.code),
    ["SIGIL_BOUNDARY_SEED_NOT_FOUND"],
  );
  assertEquals(
    selectCompilationBoundary(r, { kind: "directory", directoryPath: "." }, {
      exactTarget: true,
    }).diagnostics.map((d) => d.code),
    ["SIGIL_BOUNDARY_EXACT_TARGET_UNSUPPORTED"],
  );
});

Deno.test("ambiguous component seeds do not choose a physical declaration", async () => {
  const r = await fixture({
    "a.sigil": component("C", "First responsibility."),
    "b.sigil": component("C", "Second responsibility."),
  });
  for (const declarationPath of [undefined, "a.sigil"]) {
    const result = selectCompilationBoundary(r, {
      kind: "component",
      componentName: "C",
      declarationPath,
    }, { exactTarget: true });
    assert(
      result.diagnostics.some((d) =>
        d.code === "SIGIL_BOUNDARY_SEED_NOT_FOUND"
      ),
    );
    assertEquals(result.resolvedTarget, { kind: "workspace" });
  }
});
