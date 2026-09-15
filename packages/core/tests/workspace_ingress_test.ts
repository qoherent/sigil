import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { assert, assertEquals } from "./assert.ts";

const config = JSON.stringify({
  sigilVersion: "0.8.0",
  workspace: { name: "test" },
  files: { include: ["**/*.sigil"] },
  tools: {},
});
const bytes = (text: string) => new TextEncoder().encode(text);

class BinaryOnlyFileSystem extends InMemorySigilFileSystem {
  override readTextFile(_path: string): Promise<string> {
    return Promise.reject(
      new Error("Language ingress must read captured source input"),
    );
  }
}

// @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::SourceIngress logic
Deno.test("workspace ingress preserves an invalid source and independent diagnostics", async () => {
  const fs = new BinaryOnlyFileSystem({
    ".sigil/config.json": bytes(config),
    "bad.sigil": new Uint8Array([0x61, 0xff]),
    "other.sigil": bytes("component Other {\ngoal {\nResponsibility.\n}\n}"),
  });
  const workspace = await loadSigilWorkspace(fs, { startPath: "." });
  assert(workspace.config);
  assertEquals(workspace.diagnostics.map((d) => d.code).sort(), [
    "SIGIL_INVALID_ENCODING",
    "SIGIL_MISSING_INTERFACE",
  ]);
  assertEquals(
    workspace.files.find((f) => f.path === "bad.sigil")?.source,
    undefined,
  );
  const changed = await loadSigilWorkspace(
    new BinaryOnlyFileSystem({
      ".sigil/config.json": bytes(config),
      "bad.sigil": new Uint8Array([0x61, 0xfe]),
      "other.sigil": bytes("component Other {\ngoal {\nResponsibility.\n}\n}"),
    }),
    { startPath: "." },
  );
  assert(
    workspace.workspaceSnapshotIdentity !== changed.workspaceSnapshotIdentity,
  );
});

Deno.test("malformed config bytes stop workspace interpretation as a config error", async () => {
  const workspace = await loadSigilWorkspace(
    new BinaryOnlyFileSystem({
      ".sigil/config.json": new Uint8Array([0xff]),
      "bad.sigil": bytes("broken"),
    }),
    { startPath: "." },
  );
  assertEquals(workspace.config, undefined);
  assertEquals(workspace.files, []);
  assertEquals(workspace.diagnostics.map((d) => d.code), [
    "SIGIL_CONFIG_PARSE",
  ]);
});

Deno.test("in-memory source input retains byte provenance and protects its backing data", async () => {
  const original = bytes("\uFEFFhello\r\n");
  const fs = new InMemorySigilFileSystem({
    "disk.sigil": original,
    "overlay.sigil": "hello",
  });
  original[0] = 0;
  const read = await fs.readSourceFile("disk.sigil");
  assert(read instanceof Uint8Array);
  assertEquals(read[0], 0xef);
  read[0] = 0;
  assertEquals((await fs.readSourceFile("disk.sigil") as Uint8Array)[0], 0xef);
  assertEquals(await fs.readSourceFile("overlay.sigil"), "hello");
});
