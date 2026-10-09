import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { InMemorySigilFileSystem, loadDesignInput } from "../src/mod.ts";
import { DenoSigilFileSystem } from "../../cli/src/fs-adapter.ts";
import { structuralView } from "./conformance_view.ts";

const corpus = new URL("../../../spec/conformance/", import.meta.url);

/** Set SIGIL_UPDATE_CONFORMANCE=1 to rewrite `expected.json` after a reviewed change. */
const update = Deno.env.get("SIGIL_UPDATE_CONFORMANCE") === "1";

const cases: string[] = [];
for await (const entry of Deno.readDir(corpus)) {
  if (entry.isDirectory) cases.push(entry.name);
}
cases.sort();

for (const name of cases) {
  Deno.test(`conformance ${name}`, async () => {
    const dir = new URL(`${name}/`, corpus);
    const root = decodeURIComponent(dir.pathname).replace(/\/$/, "");
    // The case sits inside this repository, whose own workspace config would
    // conflict as a nested root. List files with the real adapter (so its skip
    // rules apply), then load them under a virtual root outside the repository.
    const disk = new DenoSigilFileSystem();
    const base = `${root}/workspace`;
    const files = new Map<string, Uint8Array>();
    for (const path of await disk.listFiles(base)) {
      files.set(
        `/conformance/${path.slice(base.length + 1)}`,
        await Deno.readFile(path),
      );
    }
    const result = await loadDesignInput(new InMemorySigilFileSystem(files), {
      startPath: "/conformance",
    });
    const actual = structuralView(result);
    const expectedUrl = new URL("expected.json", dir);
    if (update) {
      await Deno.writeTextFile(
        expectedUrl,
        JSON.stringify(actual, null, 2) + "\n",
      );
      return;
    }
    const expected = JSON.parse(await Deno.readTextFile(expectedUrl));
    assertEquals(JSON.parse(JSON.stringify(actual)), expected);
  });
}
