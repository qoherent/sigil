import path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  RevealOutputChannelOn,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { type HoverLike, hoverToMarkdown } from "./preview.ts";

const PREVIEW_COMMAND = "sigil.showComponentPreview";
const PREVIEW_SCHEME = "sigil-preview";

let client: LanguageClient | undefined;

class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  readonly #contents = new Map<string, string>();
  #sequence = 0;

  create(content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      path: "/Component Preview.md",
      query: String(++this.#sequence),
    });
    this.#contents.set(uri.toString(), content);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.#contents.get(uri.toString()) ?? "";
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel("Sigil", { log: true });
  const previews = new PreviewContentProvider();
  context.subscriptions.push(
    output,
    vscode.workspace.registerTextDocumentContentProvider(
      PREVIEW_SCHEME,
      previews,
    ),
    vscode.commands.registerCommand(PREVIEW_COMMAND, async () => {
      await showComponentPreview(previews);
    }),
  );

  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };
  client = new LanguageClient(
    "sigil",
    "Sigil",
    serverOptions,
    {
      documentSelector: [{ scheme: "file", language: "sigil" }],
      outputChannel: output,
      revealOutputChannelOn: RevealOutputChannelOn.Error,
    },
  );

  try {
    await client.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Failed to start Sigil language server: ${message}`);
    const action = await vscode.window.showErrorMessage(
      "The Sigil language server failed to start.",
      "Open Output",
    );
    if (action === "Open Output") output.show(true);
  }
}

export async function deactivate(): Promise<void> {
  const running = client;
  client = undefined;
  if (running?.isRunning()) await running.stop();
}

async function showComponentPreview(
  previews: PreviewContentProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "sigil") {
    await vscode.window.showInformationMessage(
      "Open a Sigil document and place the cursor on a component to preview it.",
    );
    return;
  }
  if (!client?.isRunning()) {
    await vscode.window.showInformationMessage(
      "The Sigil language server is not available.",
    );
    return;
  }
  const hover = await client.sendRequest<HoverLike | null>(
    "textDocument/hover",
    {
      textDocument: { uri: editor.document.uri.toString() },
      position: {
        line: editor.selection.active.line,
        character: editor.selection.active.character,
      },
    },
  );
  const markdown = hoverToMarkdown(hover);
  if (!markdown) {
    await vscode.window.showInformationMessage(
      "No Sigil component is available at the active cursor.",
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(
    previews.create(markdown),
  );
  await vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: false,
    viewColumn: vscode.ViewColumn.Beside,
  });
}
