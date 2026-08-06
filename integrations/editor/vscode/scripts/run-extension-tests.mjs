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

await runTests({
  vscodeExecutablePath,
  extensionDevelopmentPath: extension,
  extensionTestsPath: path.join(extension, "dist/test/extension.js"),
  launchArgs: [
    path.join(repository, "examples/slotted"),
    "--disable-extensions",
  ],
  extensionTestsEnv: {
    SIGIL_REPO_ROOT: repository,
    SIGIL_TEST_NODE: process.execPath,
  },
});
