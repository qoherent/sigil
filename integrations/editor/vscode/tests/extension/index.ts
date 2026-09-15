import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const repository = process.env.SIGIL_REPO_ROOT;
  assert(repository, "SIGIL_REPO_ROOT is required");
  const workspace = process.env.SIGIL_TEST_WORKSPACE ??
    path.join(repository, "examples/slotted");
  const source = vscode.Uri.file(path.join(workspace, "auth.sigil"));
  const document = await vscode.workspace.openTextDocument(source);
  const editor = await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, "sigil");

  const extension = vscode.extensions.getExtension("sigil-dev.sigil");
  assert(extension, "Sigil extension was not discovered");
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (
    const command of [
      "sigil.openPreview",
      "sigil.compileFile",
      "sigil.compileWorkspace",
      "sigil.selectCompilationFocus",
    ]
  ) {
    assert(commands.includes(command), `Missing retained command ${command}`);
  }
  assert(
    !commands.includes("sigil.compileComponent"),
    "Obsolete component alias must be absent",
  );
  assert(
    !commands.some((command) => command.startsWith("sigil.semantic")),
    "Removed beam/world/view/handoff/receipt commands must not be registered",
  );

  const position = document.positionAt(
    document.getText().indexOf("import { UserProfile") + "import { ".length,
  );
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

  const sectionReferenceOffset =
    document.getText().indexOf("Auth uses UserProfile") + "Auth uses ".length;
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
          "UserProfile",
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

  const nativeCompiler = process.env.SIGIL_TEST_COMPILER;
  const languageCli = process.env.SIGIL_TEST_LANGUAGE;
  assert(
    nativeCompiler && languageCli,
    "Current native compiler and language CLI are required",
  );
  const fixtureDirectory = await mkdtemp(
    path.join(os.tmpdir(), "sigil-vscode-native-"),
  );
  const compileConfiguration = vscode.workspace.getConfiguration(
    "sigil.compile",
    source,
  );
  const folder = vscode.workspace.getWorkspaceFolder(source);
  assert(folder);
  const errors: string[] = [];
  const originalError = vscode.window.showErrorMessage;
  (vscode.window as unknown as {
    showErrorMessage: (message: string) => Promise<undefined>;
  }).showErrorMessage = (message) => {
    errors.push(message);
    return Promise.resolve(undefined);
  };
  try {
    await compileConfiguration.update(
      "executable",
      nativeCompiler,
      vscode.ConfigurationTarget.Global,
    );
    await compileConfiguration.update(
      "languageExecutable",
      languageCli,
      vscode.ConfigurationTarget.Global,
    );
    await compileConfiguration.update(
      "focus",
      "design",
      vscode.ConfigurationTarget.Global,
    );
    const report = await vscode.commands.executeCommand<{
      version: number;
      world: { state: string };
      scope: { design: { roots: string[]; sources: string[] } };
      diagnostics: { items: Array<{ code: string; locations: unknown[] }> };
    }>("sigil.compileFile");
    assert(report, `Native Design report missing: ${errors.join("; ")}`);
    assert.equal(report.version, 2);
    assert.equal(report.world.state, "Loose");
    assert.deepEqual(report.scope.design.roots, ["auth.sigil"]);
    assert(report.scope.design.sources.includes("user-profile.sigil"));
    assert(
      report.diagnostics.items.some((item) =>
        item.code === "DESIGN_UNRESOLVED"
      ),
    );
    assert(
      vscode.languages.getDiagnostics(source).some((item) =>
        item.source === "sigilc" && item.code === "DESIGN_UNRESOLVED"
      ),
      "Native ranged findings must reach editor diagnostics",
    );

    const selection = path.join(fixtureDirectory, "selection.json");
    await writeFile(selection, JSON.stringify({ paths: ["auth.sigil"] }));
    await compileConfiguration.update(
      "selection",
      selection,
      vscode.ConfigurationTarget.Global,
    );
    const unavailable = await vscode.commands.executeCommand<
      {
        comparison: null;
        implementation: null;
        diagnostics: { items: Array<{ code: string }> };
      }
    >("sigil.compileFile", "implementation");
    assert(
      unavailable,
      `Native unavailable report missing: ${errors.join("; ")}`,
    );
    assert.equal(unavailable.comparison, null);
    assert.equal(unavailable.implementation, null);
    assert.equal(
      unavailable.diagnostics.items[0].code,
      "COMPARISON_UNAVAILABLE",
    );
    assert.equal(errors.length, 0);

    await compileConfiguration.update(
      "executable",
      path.join(fixtureDirectory, "missing-sigilc"),
      vscode.ConfigurationTarget.Global,
    );
    assert.equal(
      await vscode.commands.executeCommand("sigil.compileFile"),
      undefined,
    );
    assert.equal(errors.length, 1);
    assert(errors[0].includes("ENOENT"));
    assert(
      !vscode.languages.getDiagnostics(source).some((item) =>
        item.source === "sigilc"
      ),
    );

    assert(
      await editor.edit((edit) =>
        edit.insert(document.positionAt(document.getText().length), "\n")
      ),
    );
    await eventually(() =>
      vscode.languages.getDiagnostics(source).some((item) =>
          item.source === "sigilc"
        )
        ? []
        : [true]
    );
    assert.equal(
      await vscode.commands.executeCommand("sigil.compileFile"),
      undefined,
      "Dirty documents must not produce a report",
    );
    assert.equal(
      errors.length,
      1,
      "Dirty documents must not launch the missing executable again",
    );
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await compileConfiguration.update(
      "executable",
      nativeCompiler,
      vscode.ConfigurationTarget.Global,
    );
    await verifyCoordinates(workspace, errors);
    await vscode.window.showTextDocument(document);
  } finally {
    (vscode.window as unknown as { showErrorMessage: typeof originalError })
      .showErrorMessage = originalError;
    for (
      const key of ["executable", "languageExecutable", "selection", "focus"]
    ) {
      await compileConfiguration.update(
        key,
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
    await rm(fixtureDirectory, { recursive: true, force: true });
  }

  // Success: previewing the whole Sigil file opens a Markdown preview webview
  // beside the source editor, independent of cursor position.
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  await vscode.commands.executeCommand("sigil.openPreview");
  const previewTabs = await eventually(() =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputWebview)
  );
  assert(previewTabs.length > 0, "Expected a Markdown preview webview tab");

  // Informational path: running preview on a non-Sigil editor shows a
  // non-destructive message and opens no additional preview. The command awaits
  // showInformationMessage, which does not resolve on its own in the headless
  // host, so stub it to resolve immediately and capture the message.
  const plain = await vscode.workspace.openTextDocument({
    content: "not sigil",
    language: "plaintext",
  });
  await vscode.window.showTextDocument(plain, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  const webviewCountBefore = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview).length;

  const originalShowInfo = vscode.window.showInformationMessage;
  let infoMessage: string | undefined;
  // deno-lint-ignore no-explicit-any
  (vscode.window as any).showInformationMessage = (message: string) => {
    infoMessage = message;
    return Promise.resolve(undefined);
  };
  try {
    await vscode.commands.executeCommand("sigil.openPreview");
  } finally {
    // deno-lint-ignore no-explicit-any
    (vscode.window as any).showInformationMessage = originalShowInfo;
  }

  assert(
    infoMessage?.includes("Open a Sigil document"),
    "A non-Sigil editor should surface the informational message",
  );
  const webviewCountAfter = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview).length;
  assert.equal(
    webviewCountAfter,
    webviewCountBefore,
    "A non-Sigil editor should not open another preview",
  );
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

async function verifyCoordinates(
  workspace: string,
  errors: string[],
): Promise<void> {
  const provider = vscode.Uri.file(
    path.join(workspace, "coordinate-provider.sigil"),
  );
  const consumer = vscode.Uri.file(
    path.join(workspace, "coordinate-consumer.sigil"),
  );
  const raw =
    "\uFEFFcomponent Coordinates {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* preserves content.\r\n}\r\n}\r\n";
  const using =
    "@coordinate-provider.sigil from Coordinates import { café results }\ncomponent Consumer {\ngoal {\nUse vocabulary.\n}\ninterface {\n😀 Use café results here.\n}\n}\n";
  try {
    await writeFile(provider.fsPath, raw);
    await writeFile(consumer.fsPath, using);
    const document = await vscode.workspace.openTextDocument(consumer);
    await vscode.window.showTextDocument(document);
    for (const name of ["Coordinates", "café results"]) {
      const definitions = await eventually(async () =>
        await vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeDefinitionProvider",
          consumer,
          document.positionAt(using.indexOf(name)),
        )
      );
      assert(definitions.length, `No coordinate definition for ${name}`);
      const target = await vscode.workspace.openTextDocument(
        definitions[0].uri,
      );
      assert.equal(target.getText(definitions[0].range), name);
      assert(
        !target.getText().startsWith("\uFEFF"),
        "VS Code should hide the disk BOM",
      );
    }
    const target = await vscode.workspace.openTextDocument(provider);
    await vscode.window.showTextDocument(target);
    const reports = await eventually(async () => {
      const report = await vscode.commands.executeCommand<
        {
          version: number;
          diagnostics: {
            items: {
              code: string;
              locations: {
                source: string;
                range?: { start: number; end: number };
              }[];
            }[];
          };
        }
      >("sigil.compileFile");
      return report ? [report] : [];
    });
    const report = reports[0];
    assert(report, `Coordinate compilation failed: ${errors.join("; ")}`);
    assert.equal(report.version, 2);
    const expected = report.diagnostics.items.flatMap((item) =>
      item.locations.filter((l) =>
        l.source === "coordinate-provider.sigil" && l.range
      ).map((l) =>
        Buffer.from(raw).subarray(l.range!.start, l.range!.end).toString()
          .replace(/\r\n|\r/g, "\n")
      )
    );
    assert(expected.length, "Expected native source locations");
    const actual = vscode.languages.getDiagnostics(provider).filter((d) =>
      d.source === "sigilc" && !d.range.isEmpty
    ).map((d) => target.getText(d.range).replace(/\r\n|\r/g, "\n"));
    assert.deepEqual(
      actual,
      expected,
      "Native byte ranges must select the original Facets in the real editor",
    );
  } finally {
    await rm(provider.fsPath, { force: true });
    await rm(consumer.fsPath, { force: true });
  }
}
