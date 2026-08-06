import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const repository = process.env.SIGIL_REPO_ROOT;
  assert(repository, "SIGIL_REPO_ROOT is required");
  const testNode = process.env.SIGIL_TEST_NODE;
  assert(testNode, "SIGIL_TEST_NODE is required");
  const source = vscode.Uri.file(
    path.join(repository, "examples/slotted/auth.sigil"),
  );
  const document = await vscode.workspace.openTextDocument(source);
  const editor = await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, "sigil");

  const extension = vscode.extensions.getExtension("sigil-dev.sigil");
  assert(extension, "Sigil extension was not discovered");
  await extension.activate();

  const position = new vscode.Position(0, 31);
  editor.selection = new vscode.Selection(position, position);

  const hovers = await eventually(async () =>
    await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      source,
      position,
    )
  );
  assert(hovers.length > 0, "Expected a Sigil hover result");
  assert(
    hovers.some((hover) =>
      hover.contents.some((content) =>
        (typeof content === "string" ? content : content.value).includes(
          "UserProfile",
        )
      )
    ),
    "Hover should contain the imported component contract",
  );

  const definitions = await eventually(async () =>
    await vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >(
      "vscode.executeDefinitionProvider",
      source,
      position,
    )
  );
  assert(definitions.length > 0, "Expected go-to-definition results");

  const sectionReferenceOffset = document.getText().indexOf("User.email");
  assert.notEqual(
    sectionReferenceOffset,
    -1,
    "Expected the section component reference fixture",
  );
  const sectionPosition = document.positionAt(sectionReferenceOffset);
  const sectionHovers = await eventually(async () =>
    await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      source,
      sectionPosition,
    )
  );
  assert(
    sectionHovers.some((hover) =>
      hover.contents.some((content) =>
        (typeof content === "string" ? content : content.value).includes(
          "User",
        )
      )
    ),
    "A component reference inside a section should provide hover",
  );
  const sectionDefinitions = await eventually(async () =>
    await vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >(
      "vscode.executeDefinitionProvider",
      source,
      sectionPosition,
    )
  );
  assert(
    sectionDefinitions.length > 0,
    "A component reference inside a section should provide a definition",
  );

  const fakeCompilerDirectory = await mkdtemp(
    path.join(os.tmpdir(), "sigil-vscode-compiler-"),
  );
  const compileConfiguration = vscode.workspace.getConfiguration(
    "sigil.compile",
    source,
  );
  const folder = vscode.workspace.getWorkspaceFolder(source);
  assert(folder, "The active Sigil document should belong to a workspace");
  const compilerScriptPath = path.join(folder.uri.fsPath, "compile");
  try {
    const argumentsPath = path.join(fakeCompilerDirectory, "arguments.json");
    const report = {
      reportVersion: 2,
      status: "yellow",
      componentNames: ["Auth"],
      diagnostics: [{
        code: "SEMANTIC_AMBIGUITY",
        severity: "warning",
        stage: "semantic-readiness",
        lifecycle: "new",
        message: "The test finding is active.",
        filePath: "auth.sigil",
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
        semanticSubjects: [],
      }, {
        code: "SEMANTIC_RESOLVED",
        severity: "warning",
        stage: "semantic-readiness",
        lifecycle: "resolved",
        message: "The test finding was corrected.",
        filePath: "auth.sigil",
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
        semanticSubjects: [],
      }],
    };
    await writeFile(
      compilerScriptPath,
      `
const fs = require("node:fs");
fs.writeFileSync(${
        JSON.stringify(argumentsPath)
      }, JSON.stringify([require("node:path").basename(process.argv[1]), ...process.argv.slice(2)]));
console.log(JSON.stringify({protocolVersion:1,runId:"editor-run",sequence:1,type:"started",payload:{}}));
console.log(JSON.stringify({protocolVersion:1,runId:"editor-run",sequence:2,type:"completed",payload:{report:${
        JSON.stringify(report)
      }}}));
`,
    );
    await compileConfiguration.update(
      "executable",
      testNode,
      vscode.ConfigurationTarget.Global,
    );
    await compileConfiguration.update(
      "focus",
      "design",
      vscode.ConfigurationTarget.Global,
    );
    editor.selection = new vscode.Selection(position, position);
    await vscode.commands.executeCommand("sigil.compileComponent");
    const compilerArguments = JSON.parse(
      await readFile(argumentsPath, "utf8"),
    ) as string[];
    assert.deepEqual(
      compilerArguments.slice(0, 10),
      [
        "compile",
        folder.uri.fsPath,
        "--file",
        source.fsPath,
        "--position",
        `${position.line + 1}:${position.character + 1}`,
        "--profile",
        "standard",
        "--focus",
        "design",
      ],
    );
    assert(
      vscode.languages.getDiagnostics(source).some((item) =>
        item.source === "sigil compile" &&
        item.code === "SEMANTIC_AMBIGUITY"
      ),
      "Expected the active compiler finding to be projected",
    );
    assert(
      !vscode.languages.getDiagnostics(source).some((item) =>
        item.source === "sigil compile" &&
        item.code === "SEMANTIC_RESOLVED"
      ),
      "Resolved compiler findings must not remain active editor problems",
    );

    await rm(argumentsPath, { force: true });
    assert(
      await editor.edit((edit) => {
        edit.insert(document.positionAt(document.getText().length), "\n");
      }),
      "Expected the document edit to succeed",
    );
    await eventually(() =>
      vscode.languages.getDiagnostics(source).some((item) =>
          item.source === "sigil compile"
        )
        ? []
        : [true]
    );
    await vscode.commands.executeCommand("sigil.compileComponent");
    await assert.rejects(
      readFile(argumentsPath, "utf8"),
      /ENOENT/,
      "Dirty Sigil documents must not invoke the external compiler",
    );
    await vscode.commands.executeCommand("workbench.action.files.revert");
  } finally {
    await compileConfiguration.update(
      "executable",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    await compileConfiguration.update(
      "focus",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    await rm(compilerScriptPath, { force: true });
    await rm(fakeCompilerDirectory, { recursive: true, force: true });
  }

  await vscode.commands.executeCommand("sigil.showComponentPreview");
  await eventually(() => {
    const active = vscode.window.activeTextEditor;
    return active?.document.uri.scheme === "sigil-preview" ? [active] : [];
  });
  const preview = vscode.window.activeTextEditor?.document;
  assert.equal(preview?.uri.scheme, "sigil-preview");
  assert(preview.getText().includes("UserProfile"));
}

async function eventually<T>(
  operation: () => T[] | Promise<T[]>,
): Promise<T[]> {
  const deadline = Date.now() + 10_000;
  let result: T[] = [];
  while (Date.now() < deadline) {
    result = await operation();
    if (result.length) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return result;
}
