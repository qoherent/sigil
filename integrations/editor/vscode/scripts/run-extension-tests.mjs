import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const directory = path.dirname(fileURLToPath(import.meta.url));
const extension = path.resolve(directory, "..");
const repository = path.resolve(extension, "../../..");

// Automation may launch this script from a VS Code extension host. Do not leak that
// host's Electron/VS Code process mode into the separate test instance.
for (const key of Object.keys(process.env)) {
  if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("VSCODE_")) {
    delete process.env[key];
  }
}

let vscodeExecutablePath = await downloadAndUnzipVSCode({
  version: "stable",
  timeout: 120_000,
});
if (
  process.platform === "darwin" &&
  !existsSync(vscodeExecutablePath) &&
  vscodeExecutablePath.endsWith("/Electron")
) {
  const renamedExecutable = vscodeExecutablePath.slice(
    0,
    -"/Electron".length,
  ) + "/Code";
  if (existsSync(renamedExecutable)) vscodeExecutablePath = renamedExecutable;
}

const sigilExecutable = process.env.SIGIL_TEST_LANGUAGE ??
  path.join(
    repository,
    "packages/cli/target/debug",
    process.platform === "win32" ? "sigil.exe" : "sigil",
  );

const fixture = process.env.SIGIL_TEST_WORKSPACE
  ? undefined
  : await mkdtemp(path.join(os.tmpdir(), "sigil-editor-workspace-"));
const workspacePath = process.env.SIGIL_TEST_WORKSPACE ??
  path.join(fixture, "slotted");
if (fixture) {
  await cp(path.join(repository, "examples/slotted"), workspacePath, {
    recursive: true,
  });
}
try {
  // Windows temp paths can contain 8.3 aliases. Give the editor and its filesystem
  // watcher the same expanded path so native writes produce accurate file events.
  const workspace = await realpath(workspacePath);
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: extension,
    extensionTestsPath: path.join(extension, "dist/test/extension.js"),
    launchArgs: [
      workspace,
      "--disable-extensions",
    ],
    extensionTestsEnv: {
      SIGIL_REPO_ROOT: repository,
      SIGIL_TEST_WORKSPACE: workspace,
      SIGIL_TEST_COMPILER: process.env.SIGIL_TEST_COMPILER ??
        path.join(
          repository,
          "packages/sigilc/target/debug",
          process.platform === "win32" ? "sigilc.exe" : "sigilc",
        ),
      SIGIL_TEST_BUNDLED: process.env.SIGIL_TEST_BUNDLED ?? "0",
      SIGIL_TEST_LANGUAGE: sigilExecutable,
    },
  });
} finally {
  if (fixture) await rm(fixture, { recursive: true, force: true });
}

// A second run opens an enclosing workspace that excludes a nested copy of the
// example, and checks that a nested file is still served.
if (!process.env.SIGIL_TEST_WORKSPACE) {
  const enclosing = await mkdtemp(
    path.join(os.tmpdir(), "sigil-editor-nested-"),
  );
  try {
    await mkdir(path.join(enclosing, ".sigil"));
    await writeFile(
      path.join(enclosing, ".sigil/config.json"),
      JSON.stringify({
        sigilVersion: "0.9.0",
        workspace: { name: "enclosing", members: [] },
        files: { include: ["**/*.sigil"], exclude: ["inner/**"] },
        tools: {},
      }),
    );
    await cp(
      path.join(repository, "examples/slotted"),
      path.join(enclosing, "inner/slotted"),
      { recursive: true },
    );
    const workspace = await realpath(enclosing);
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: extension,
      extensionTestsPath: path.join(extension, "dist/test/extension.js"),
      launchArgs: [workspace, "--disable-extensions"],
      extensionTestsEnv: {
        SIGIL_REPO_ROOT: repository,
        SIGIL_TEST_WORKSPACE: workspace,
        SIGIL_TEST_NESTED: "1",
        SIGIL_TEST_LANGUAGE: sigilExecutable,
      },
    });
  } finally {
    await rm(enclosing, { recursive: true, force: true });
  }
}
