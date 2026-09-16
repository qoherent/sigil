import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { resolveSigilRelationships } from "../src/resolver.ts";
import { assertEquals } from "./assert.ts";

const config = (exclude: string[] = [], members: string[] = []) =>
  JSON.stringify({
    sigilVersion: "0.8.0",
    workspace: { name: "test", members },
    files: { include: ["**/*.sigil"], exclude },
  });
const source =
  "component C {\ngoal {\nOwn a responsibility.\n}\ninterface {\nOffer an interaction.\n}\n}";

// @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery interface,logic,cases
Deno.test("excluded nested workspaces retain independent discovery and included boundaries fail", async () => {
  for (
    const [exclude, allowed] of [[[], false], [["nested/**/*.sigil"], false], [[
      "nested/**",
    ], true]] as const
  ) {
    const workspace = await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        ".sigil/config.json": config([...exclude]),
        "nested/.sigil/config.json": config(),
        "nested/c.sigil": source,
      }),
      { startPath: "nested/c.sigil" },
    );
    assertEquals(workspace.files.length, allowed ? 1 : 0);
    assertEquals(
      workspace.diagnostics.map((d) => d.code),
      allowed ? [] : ["SIGIL_NESTED_CONFIG"],
    );
    if (!allowed) {
      assertEquals(workspace.diagnostics[0].related.map((d) => d.filePath), [
        ".sigil/config.json",
      ]);
    }
  }
});

Deno.test("nested configs retain parent evidence and cannot turn a member into an independent workspace", async () => {
  for (
    const [exclude, members, expected] of [
      [[], [], 1],
      [["nested/**"], [], 0],
      [["nested/**"], ["nested"], 1],
    ] as [string[], string[], number][]
  ) {
    const workspace = await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        ".sigil/config.json": config(exclude, members),
        "root.sigil": source,
        "nested/.sigil/config.json": config(),
        "nested/c.sigil": source,
      }),
      { startPath: ".", explicitRoot: "." },
    );
    assertEquals(workspace.files.map((f) => f.path), ["root.sigil"]);
    assertEquals(workspace.diagnostics.length, expected);
    if (expected) {
      assertEquals(workspace.diagnostics[0].related.map((d) => d.filePath), [
        ".sigil/config.json",
      ]);
    }
  }
});

Deno.test("excluded providers cannot be reached by explicit imports and module summaries add no access", async () => {
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": config(["hidden/**"]),
      "hidden/provider.sigil": source,
      "_module.sigil": "@hidden/provider.sigil from C import { query }\n",
      "consumer.sigil": "@hidden/provider.sigil from C import { query }\n" +
        source,
    }),
    { startPath: "." },
  );
  const resolution = resolveSigilRelationships(workspace);
  assertEquals(resolution.diagnostics.map((d) => d.code), [
    "SIGIL_UNRESOLVED_IMPORT_PATH",
    "SIGIL_UNRESOLVED_IMPORT_PATH",
  ]);
  assertEquals(resolution.imports.map((i) => i.status), [
    "unresolved-path",
    "unresolved-path",
  ]);
});

Deno.test("explicit workspace roots require their own config and unsupported versions stop loading", async () => {
  const missing = await loadSigilWorkspace(
    new InMemorySigilFileSystem({ "parent/.sigil/config.json": config() }),
    { startPath: "parent/child", explicitRoot: "parent/child" },
  );
  assertEquals(missing.diagnostics.map((d) => d.code), [
    "SIGIL_CONFIG_NOT_FOUND",
  ]);
  for (const version of ["0.7.0", "0.9.0"]) {
    const workspace = await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        ".sigil/config.json": config().replace("0.8.0", version),
        "c.sigil": source,
      }),
      { startPath: "." },
    );
    assertEquals(workspace.files, []);
    assertEquals(workspace.diagnostics.map((d) => d.code), [
      "SIGIL_UNSUPPORTED_VERSION",
    ]);
  }
});
