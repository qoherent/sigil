import assert from "node:assert/strict";
import path from "node:path";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const repository = process.env.SIGIL_REPO_ROOT;
  assert(repository, "SIGIL_REPO_ROOT is required");
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
