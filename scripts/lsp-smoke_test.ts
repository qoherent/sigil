import { deepStrictEqual as equal, rejects } from "node:assert/strict";
import { join, resolve } from "node:path";
import { lspSmoke } from "./lsp-smoke.ts";

const root = resolve(import.meta.dirname!, "..");
const suffix = Deno.build.os === "windows" ? ".exe" : "";
const SIGIL = Deno.env.get("SIGIL_TEST_LANGUAGE") ??
  join(root, `packages/cli/target/debug/sigil${suffix}`);
const FIXTURE = join(root, "scripts/fixtures/release/project");

async function workspace(
  document = "main.sigil",
  text?: string,
): Promise<{ dir: string; document: string }> {
  const dir = await Deno.makeTempDir({ prefix: "sigil lsp smoke Ω " });
  await Deno.mkdir(join(dir, ".sigil"));
  await Deno.copyFile(
    join(FIXTURE, "fixture-config.json"),
    join(dir, ".sigil/config.json"),
  );
  const path = join(dir, document);
  if (text === undefined) {
    await Deno.copyFile(join(FIXTURE, "main.sigil"), path);
  } else await Deno.writeTextFile(path, text);
  return { dir, document: path };
}

Deno.test("a built sigil answers a session that opens the release fixture", async () => {
  const { dir, document } = await workspace();
  try {
    const result = await lspSmoke({
      executable: SIGIL,
      workspace: dir,
      document,
    });
    equal(result.diagnostics, 0);
    equal(result.symbols > 0, true);
    equal(result.stderr, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a built sigil serves a file of a workspace nested inside the folder it started in", async () => {
  const { dir } = await workspace();
  try {
    const config = JSON.parse(
      await Deno.readTextFile(join(FIXTURE, "fixture-config.json")),
    );
    config.files.exclude = [...(config.files.exclude ?? []), "inner/**"];
    await Deno.writeTextFile(
      join(dir, ".sigil/config.json"),
      JSON.stringify(config),
    );
    await Deno.mkdir(join(dir, "inner/.sigil"), { recursive: true });
    await Deno.copyFile(
      join(FIXTURE, "fixture-config.json"),
      join(dir, "inner/.sigil/config.json"),
    );
    const document = join(dir, "inner/main.sigil");
    await Deno.copyFile(join(FIXTURE, "main.sigil"), document);
    const result = await lspSmoke({
      executable: SIGIL,
      workspace: dir,
      document,
    });
    equal(result.symbols > 0, true);
    equal(result.stderr, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a document with no component yields no symbols and the smoke fails", async () => {
  const { dir, document } = await workspace("plain.sigil", "just words\n");
  try {
    await rejects(
      lspSmoke({ executable: SIGIL, workspace: dir, document }),
      /symbol answer was empty/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a binary that prints a non-protocol line on standard output fails the smoke", async () => {
  const { dir, document } = await workspace();
  const windows = Deno.build.os === "windows";
  const noisy = join(dir, windows ? "noisy.cmd" : "noisy");
  await Deno.writeTextFile(
    noisy,
    windows ? "@echo not a frame\r\n" : "#!/bin/sh\necho not a frame\n",
  );
  if (!windows) await Deno.chmod(noisy, 0o755);
  try {
    await rejects(
      lspSmoke({
        executable: noisy,
        workspace: dir,
        document,
        timeoutMs: 10_000,
      }),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
