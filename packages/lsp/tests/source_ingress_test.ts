import { InMemorySigilFileSystem } from "../../core/src/filesystem.ts";
import { OverlaySigilFileSystem } from "../src/filesystem.ts";
import { assert, assertEquals } from "../../core/tests/assert.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

// @sigil tests packages/lsp/_module.sigil::SigilLsp::DocumentSynchronization interface,state,logic,cases
Deno.test("editor overlays supply scalar text while untouched files retain disk bytes", async () => {
  const overlay = new OverlaySigilFileSystem(
    new InMemorySigilFileSystem({ "a.sigil": bytes("\uFEFForiginal\r\n") }),
  );
  assert(await overlay.readSourceFile("a.sigil") instanceof Uint8Array);
  overlay.set("a.sigil", "edited😀\n");
  assertEquals(await overlay.readSourceFile("a.sigil"), "edited😀\n");
  overlay.delete("a.sigil");
  assertEquals([...(await overlay.readSourceFile("a.sigil") as Uint8Array)], [
    ...bytes("\uFEFForiginal\r\n"),
  ]);
});
