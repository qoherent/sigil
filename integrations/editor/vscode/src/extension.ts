import path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  RevealOutputChannelOn,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { type HoverLike, hoverToMarkdown } from "./preview.ts";
import {
  type CompilationEvent,
  type CompilationProcess,
  type CompilationReport,
  diagnosticDisplayRange,
  runCompilationProcess,
} from "./compilation.ts";

const PREVIEW_COMMAND = "sigil.showComponentPreview";
const PREVIEW_SCHEME = "sigil-preview";
const COMPILE_COMPONENT_COMMAND = "sigil.compileComponent";
const COMPILE_WORKSPACE_COMMAND = "sigil.compileWorkspace";
const SELECT_COMPILATION_FOCUS_COMMAND = "sigil.selectCompilationFocus";
type CompilationFocus = "design" | "implementation";
let client: LanguageClient | undefined;
let activeCompilation: CompilationProcess | undefined;
let displayedCompilationRoot: string | undefined;
let displayedCompilationFocus: CompilationFocus | undefined;
const workspaceRevisions = new Map<string, number>();

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::ComponentPreview interface,state,logic,cases
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

/**
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::ComponentPreview interface,state,logic,cases
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::SupportedExtensionHosts interface,constraints,cases
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::ReadOnlyEditorSupport interface,constraints
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,logic,constraints
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface interface,state,logic,constraints,cases
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  displayedCompilationRoot = undefined;
  displayedCompilationFocus = undefined;
  workspaceRevisions.clear();
  const output = vscode.window.createOutputChannel("Sigil", { log: true });
  const previews = new PreviewContentProvider();
  const compilationDiagnostics = vscode.languages.createDiagnosticCollection(
    "sigil-compile",
  );
  const compilationStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    90,
  );
  compilationStatus.name = "Sigil Compilation";
  compilationStatus.command = SELECT_COMPILATION_FOCUS_COMMAND;
  compilationStatus.text = "$(play) Sigil Compile $(chevron-down)";
  compilationStatus.tooltip = "Select Sigil compilation focus";
  compilationStatus.show();
  context.subscriptions.push(
    output,
    compilationDiagnostics,
    compilationStatus,
    vscode.workspace.registerTextDocumentContentProvider(
      PREVIEW_SCHEME,
      previews,
    ),
    vscode.commands.registerCommand(PREVIEW_COMMAND, async () => {
      await showComponentPreview(previews);
    }),
    vscode.commands.registerCommand(
      COMPILE_COMPONENT_COMMAND,
      async (requestedFocus?: CompilationFocus) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "sigil") {
          await vscode.window.showInformationMessage(
            "Open a Sigil document to compile its component.",
          );
          return;
        }
        const focus = requestedFocus ?? await resolveCompilationFocus();
        if (!focus) return;
        const position = editor.selection.active;
        await compileFromEditor(
          context,
          output,
          compilationDiagnostics,
          compilationStatus,
          [
            "--file",
            editor.document.uri.fsPath,
            "--position",
            `${position.line + 1}:${position.character + 1}`,
          ],
          focus,
          editor.document.uri,
        );
      },
    ),
    vscode.commands.registerCommand(
      COMPILE_WORKSPACE_COMMAND,
      async (requestedFocus?: CompilationFocus) => {
        const focus = requestedFocus ?? await resolveCompilationFocus();
        if (!focus) return;
        await compileFromEditor(
          context,
          output,
          compilationDiagnostics,
          compilationStatus,
          [],
          focus,
          vscode.window.activeTextEditor?.document.uri,
        );
      },
    ),
    vscode.commands.registerCommand(
      SELECT_COMPILATION_FOCUS_COMMAND,
      async () => {
        const selected = await vscode.window.showQuickPick([
          {
            label: "$(symbol-interface) Design readiness",
            description: "Active component",
            command: COMPILE_COMPONENT_COMMAND,
            focus: "design" as const,
          },
          {
            label: "$(references) Implementation alignment",
            description: "Active component",
            command: COMPILE_COMPONENT_COMMAND,
            focus: "implementation" as const,
          },
          {
            label: "$(project) Design readiness",
            description: "Workspace",
            command: COMPILE_WORKSPACE_COMMAND,
            focus: "design" as const,
          },
          {
            label: "$(project) Implementation alignment",
            description: "Workspace",
            command: COMPILE_WORKSPACE_COMMAND,
            focus: "implementation" as const,
          },
          {
            label: "$(gear) Configure profile…",
            description: "Open Sigil compilation settings",
            command: "workbench.action.openSettings",
          },
        ], {
          placeHolder: "Select the Sigil compilation focus",
        });
        if (!selected) return;
        if (selected.command === "workbench.action.openSettings") {
          await vscode.commands.executeCommand(
            selected.command,
            "sigil.compile",
          );
          return;
        }
        await vscode.commands.executeCommand(selected.command, selected.focus);
      },
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        event.document.languageId !== "sigil" ||
        event.document.uri.scheme !== "file" ||
        event.contentChanges.length === 0
      ) return;
      const folder = vscode.workspace.getWorkspaceFolder(event.document.uri);
      if (!folder) return;
      const key = folder.uri.toString();
      workspaceRevisions.set(key, (workspaceRevisions.get(key) ?? 0) + 1);
      if (displayedCompilationRoot === key) {
        markCompilationStale(
          compilationDiagnostics,
          compilationStatus,
          displayedCompilationFocus,
        );
      }
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

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
export async function deactivate(): Promise<void> {
  activeCompilation?.cancel();
  activeCompilation = undefined;
  displayedCompilationRoot = undefined;
  displayedCompilationFocus = undefined;
  workspaceRevisions.clear();
  const running = client;
  client = undefined;
  if (running?.isRunning()) await running.stop();
}

/**
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface interface,state,logic,constraints,cases
 * @sigil uses packages/cli/_module.sigil::SigilCli::CompilationFacade interface,constraints
 */
async function compileFromEditor(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem,
  targetArgs: readonly string[],
  focus: CompilationFocus,
  preferredUri?: vscode.Uri,
): Promise<void> {
  const folder = await selectCompilationFolder(preferredUri);
  if (!folder) {
    await vscode.window.showInformationMessage(
      "Sigil compilation requires a file-backed workspace.",
    );
    return;
  }
  const dirtyDocument = dirtySigilDocument(folder);
  if (dirtyDocument) {
    activeCompilation?.cancel();
    activeCompilation = undefined;
    void vscode.window.showWarningMessage(
      `Save ${path.basename(dirtyDocument.uri.fsPath)} before compiling Sigil.`,
    );
    return;
  }
  const folderKey = folder.uri.toString();
  const startingRevision = workspaceRevisions.get(folderKey) ?? 0;
  activeCompilation?.cancel();
  diagnostics.clear();
  displayedCompilationRoot = undefined;
  displayedCompilationFocus = undefined;
  const configuration = vscode.workspace.getConfiguration("sigil.compile");
  const executable = configuration.get<string>("executable", "sigil");
  const profile = configuration.get<string>("profile", "standard");
  const label = compilationFocusLabel(focus);
  status.text = `$(sync~spin) Sigil ${label}…`;
  status.tooltip = `Focus: ${label}\nProfile: ${profile}`;
  const process = runCompilationProcess(
    executable,
    [
      "compile",
      folder.uri.fsPath,
      ...targetArgs,
      "--profile",
      profile,
      "--focus",
      focus,
    ],
    folder.uri.fsPath,
    (event) => showCompilationEvent(output, event),
    (line) => output.info(line),
  );
  activeCompilation = process;
  try {
    const report = await process.result;
    if (activeCompilation !== process) return;
    projectCompilationReport(
      report,
      diagnostics,
      status,
      folder.uri,
      focus,
      profile,
    );
    displayedCompilationRoot = folderKey;
    displayedCompilationFocus = focus;
    if ((workspaceRevisions.get(folderKey) ?? 0) !== startingRevision) {
      markCompilationStale(diagnostics, status, focus);
    }
    output.show(true);
  } catch (error) {
    if (activeCompilation !== process) return;
    status.text = `$(error) Sigil ${label}: failed`;
    const message = error instanceof Error ? error.message : String(error);
    output.error(message);
    const action = await vscode.window.showErrorMessage(
      `Sigil compilation failed: ${message}`,
      "Open Settings",
    );
    if (action === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "sigil.compile.executable",
      );
    }
  } finally {
    if (activeCompilation === process) activeCompilation = undefined;
  }
  void context;
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface state,logic,constraints,cases
async function resolveCompilationFocus(): Promise<
  CompilationFocus | undefined
> {
  const configured = vscode.workspace.getConfiguration("sigil.compile").get<
    "ask" | CompilationFocus
  >("focus", "ask");
  if (configured !== "ask") return configured;
  const selected = await vscode.window.showQuickPick([
    {
      label: "Design readiness",
      description: "Evaluate desired Sigil without implementation drift",
      focus: "design" as const,
    },
    {
      label: "Implementation alignment",
      description: "Compare current implementation with desired Sigil",
      focus: "implementation" as const,
    },
  ], {
    placeHolder: "Select the Sigil compilation focus",
  });
  return selected?.focus;
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface state,logic,cases
export function compilationFocusLabel(focus: CompilationFocus): string {
  return focus === "design" ? "Design" : "Implementation";
}

function dirtySigilDocument(
  folder: vscode.WorkspaceFolder,
): vscode.TextDocument | undefined {
  const folderKey = folder.uri.toString();
  return vscode.workspace.textDocuments.find((document) =>
    document.isDirty &&
    document.languageId === "sigil" &&
    document.uri.scheme === "file" &&
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() ===
      folderKey
  );
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface state,logic,cases
function markCompilationStale(
  diagnostics: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem,
  focus?: CompilationFocus,
): void {
  diagnostics.clear();
  const label = focus ? ` ${compilationFocusLabel(focus)}` : "";
  status.text = `$(warning) Sigil${label}: stale`;
  status.tooltip = "Sigil sources changed after the displayed compilation.";
}

async function selectCompilationFolder(
  preferredUri?: vscode.Uri,
): Promise<vscode.WorkspaceFolder | undefined> {
  if (preferredUri?.scheme === "file") {
    const enclosing = vscode.workspace.getWorkspaceFolder(preferredUri);
    if (enclosing?.uri.scheme === "file") return enclosing;
  }
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) =>
    folder.uri.scheme === "file"
  );
  if (folders.length === 1) return folders[0];
  if (folders.length < 2) return undefined;
  const selected = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: "Select the workspace folder to compile" },
  );
  return selected?.folder;
}

function showCompilationEvent(
  output: vscode.LogOutputChannel,
  event: CompilationEvent,
): void {
  if (event.type === "stage-started") {
    output.info(`Running ${String(event.payload.stage)}...`);
  } else if (event.type === "diagnostic") {
    const diagnostic = event.payload.diagnostic as
      | { severity?: string; code?: string; message?: string }
      | undefined;
    if (diagnostic) {
      output.info(
        `${diagnostic.severity ?? "information"} ${
          diagnostic.code ?? "COMPILER"
        }: ${diagnostic.message ?? ""}`,
      );
    }
  }
}

function projectCompilationReport(
  report: CompilationReport,
  collection: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem,
  root: vscode.Uri,
  focus: CompilationFocus,
  profile: string,
): void {
  const byUri = new Map<string, vscode.Diagnostic[]>();
  for (const item of report.diagnostics) {
    if (item.lifecycle === "resolved") continue;
    if (!item.filePath) continue;
    const uri = path.isAbsolute(item.filePath)
      ? vscode.Uri.file(item.filePath)
      : vscode.Uri.joinPath(root, item.filePath);
    const displayRange = diagnosticDisplayRange(item);
    const range = displayRange
      ? new vscode.Range(
        Math.max(0, displayRange.start.line - 1),
        Math.max(0, displayRange.start.column - 1),
        Math.max(0, displayRange.end.line - 1),
        Math.max(0, displayRange.end.column - 1),
      )
      : new vscode.Range(0, 0, 0, 1);
    const severity = item.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : item.severity === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;
    const diagnostic = new vscode.Diagnostic(range, item.message, severity);
    diagnostic.code = item.code;
    diagnostic.source = "sigil compile";
    const key = uri.toString();
    byUri.set(key, [...(byUri.get(key) ?? []), diagnostic]);
  }
  collection.set(
    [...byUri].map(([uri, items]) => [vscode.Uri.parse(uri), items]),
  );
  const icon = report.status === "green"
    ? "$(pass-filled)"
    : report.status === "yellow"
    ? "$(warning)"
    : "$(error)";
  const label = compilationFocusLabel(focus);
  const outcome = report.status === "green"
    ? focus === "design" ? "ready" : "aligned"
    : report.status === "yellow"
    ? focus === "design" ? "warnings" : "drift"
    : "blocked";
  status.text = `${icon} Sigil ${label}: ${outcome}`;
  const activeFindingCount =
    report.diagnostics.filter((item) => item.lifecycle !== "resolved").length;
  status.tooltip = `Focus: ${label}\nProfile: ${profile}\n${
    report.componentNames.join(", ") || "Workspace"
  }: ${activeFindingCount} active findings`;
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
