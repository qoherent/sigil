import { readFile } from "node:fs/promises";
import { publishCompilationDiagnostics } from "./diagnostic-projection.ts";
import path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  RevealOutputChannelOn,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import {
  type CompilationFocus,
  type CompilationProcess,
  diagnosticGroups,
  type NativeReport,
  nativeState,
  runCompilationProcess,
} from "./compilation.ts";

const PREVIEW_COMMAND = "sigil.openPreview";
const RENDER_DOCUMENT_COMMAND = "sigil.renderDocument";
const PREVIEW_SCHEME = "sigil-preview";
const COMPILE_FILE_COMMAND = "sigil.compileFile";
const COMPILE_WORKSPACE_COMMAND = "sigil.compileWorkspace";
const SELECT_COMPILATION_FOCUS_COMMAND = "sigil.selectCompilationFocus";
let client: LanguageClient | undefined;
let activeCompilation: CompilationProcess | undefined;
let displayedCompilationRoot: string | undefined;
let displayedCompilationFocus: CompilationFocus | undefined;
const workspaceRevisions = new Map<string, number>();

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::DocumentPreview interface,state,logic,cases
class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  readonly #contents = new Map<string, string>();
  readonly #emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.#emitter.event;

  // One stable preview URI per source document so re-running the command
  // refreshes the same preview rather than opening a new tab. The `.md` path
  // makes VS Code treat the virtual document as Markdown.
  previewUri(source: vscode.Uri): vscode.Uri {
    const name = source.path.split("/").pop() ?? "preview";
    return vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      path: `/${name}.md`,
      query: source.toString(),
    });
  }

  set(uri: vscode.Uri, content: string): void {
    this.#contents.set(uri.toString(), content);
    this.#emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.#contents.get(uri.toString()) ?? "";
  }
}

/**
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
 * @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::DocumentPreview interface,state,logic,cases
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
      await openPreview(previews);
    }),
    vscode.commands.registerCommand(
      COMPILE_FILE_COMMAND,
      async (requestedFocus?: unknown) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "sigil") {
          await vscode.window.showInformationMessage(
            "Open a Sigil document to compile its file.",
          );
          return;
        }
        const focus = asCompilationFocus(requestedFocus) ??
          await resolveCompilationFocus();
        if (!focus) return;
        return await compileFromEditor(
          output,
          compilationDiagnostics,
          compilationStatus,
          editor.document.uri,
          focus,
          editor.document.uri,
        );
      },
    ),
    vscode.commands.registerCommand(
      COMPILE_WORKSPACE_COMMAND,
      async (requestedFocus?: unknown) => {
        const focus = asCompilationFocus(requestedFocus) ??
          await resolveCompilationFocus();
        if (!focus) return;
        return await compileFromEditor(
          output,
          compilationDiagnostics,
          compilationStatus,
          undefined,
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
            description: "Active file and native dependency closure",
            command: COMPILE_FILE_COMMAND,
            focus: "design" as const,
          },
          {
            label: "$(references) Implementation alignment",
            description: "Active file and native dependency closure",
            command: COMPILE_FILE_COMMAND,
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
            label: "$(gear) Configure compilation…",
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

  // Compilation invalidation observes all inputs; LSP ownership watching remains
  // independently registered by the server. Ignore native cache writes.
  const invalidate = (uri: vscode.Uri) => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const relative = workspaceRelativeSigilPath(folder.uri, uri);
    if (
      relative.split("/").some((part) =>
        [".git", "node_modules", "target", "build"].includes(part)
      ) ||
      (relative === ".sigil/worlds" || relative.startsWith(".sigil/worlds/"))
    ) return;
    const key = folder.uri.toString();
    workspaceRevisions.set(key, (workspaceRevisions.get(key) ?? 0) + 1);
    if (displayedCompilationRoot === key) {
      markCompilationStale(
        compilationDiagnostics,
        compilationStatus,
        displayedCompilationFocus,
      );
    }
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(invalidate),
    watcher.onDidCreate(invalidate),
    watcher.onDidDelete(invalidate),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("sigil.compile")) return;
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const key = folder.uri.toString();
        workspaceRevisions.set(key, (workspaceRevisions.get(key) ?? 0) + 1);
      }
      if (displayedCompilationRoot) {
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
 * @sigil uses packages/cli/_module.sigil::SigilCli::DesignExport interface
 * @sigil uses packages/sigilc/report.sigil::SigilGateDiagnostics::NativeFindings interface,constraints
 */
async function compileFromEditor(
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem,
  documentUri: vscode.Uri | undefined,
  focus: CompilationFocus,
  preferredUri?: vscode.Uri,
): Promise<NativeReport | undefined> {
  const folder = await selectCompilationFolder(documentUri ?? preferredUri);
  if (!folder) {
    await vscode.window.showInformationMessage(
      "Sigil compilation requires a file-backed workspace.",
    );
    return;
  }
  const dirtyDocument = dirtyWorkspaceDocument(folder);
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
  const configuration = vscode.workspace.getConfiguration(
    "sigil.compile",
    folder.uri,
  );
  const label = compilationFocusLabel(focus);
  status.text = `$(sync~spin) Sigil ${label}…`;
  status.tooltip = "Capturing language inputs and compiling with sigilc";
  const operation = runCompilationProcess({
    executable: configuration.get<string>("executable", "sigilc"),
    languageExecutable: configuration.get<string>(
      "languageExecutable",
      "sigil",
    ),
    selection: configuration.get<string>("selection", ""),
    cwd: folder.uri.fsPath,
    focus,
    file: documentUri
      ? workspaceRelativeSigilPath(folder.uri, documentUri)
      : undefined,
    onLog: (text) => output.info(text),
  });
  activeCompilation = operation;
  try {
    const report = await operation.result;
    if (activeCompilation !== operation) return;
    output.info(JSON.stringify(report, null, 2));
    displayedCompilationRoot = folderKey;
    displayedCompilationFocus = focus;
    if ((workspaceRevisions.get(folderKey) ?? 0) !== startingRevision) {
      markCompilationStale(diagnostics, status, focus);
      return;
    }
    await projectCompilationReport(
      report,
      diagnostics,
      status,
      folder.uri,
      focus,
      documentUri ? "File and native dependency closure" : "Workspace",
      () =>
        activeCompilation === operation &&
        (workspaceRevisions.get(folderKey) ?? 0) === startingRevision,
    );
    if (activeCompilation !== operation) return;
    if ((workspaceRevisions.get(folderKey) ?? 0) !== startingRevision) {
      markCompilationStale(diagnostics, status, focus);
      return;
    }
    output.show(true);
    return report;
  } catch (error) {
    if (activeCompilation !== operation) return;
    status.text = `$(error) Sigil ${label}: failed`;
    const message = error instanceof Error ? error.message : String(error);
    status.tooltip = message;
    output.error(message);
    const action = await vscode.window.showErrorMessage(
      `Sigil compilation failed: ${message}`,
      "Open Settings",
    );
    if (action === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "sigil.compile",
      );
    }
  } finally {
    if (activeCompilation === operation) activeCompilation = undefined;
  }
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,cases
function workspaceRelativeSigilPath(
  folder: vscode.Uri,
  documentUri: vscode.Uri,
): string {
  return path
    .relative(folder.fsPath, documentUri.fsPath)
    .replaceAll("\\", "/");
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,cases
function asCompilationFocus(value: unknown): CompilationFocus | undefined {
  return value === "design" || value === "implementation" ? value : undefined;
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

function dirtyWorkspaceDocument(
  folder: vscode.WorkspaceFolder,
): vscode.TextDocument | undefined {
  const folderKey = folder.uri.toString();
  return vscode.workspace.textDocuments.find((document) =>
    document.isDirty &&
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
  status.tooltip =
    "Workspace inputs or compilation settings changed; compile again.";
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

async function projectCompilationReport(
  report: NativeReport,
  collection: vscode.DiagnosticCollection,
  status: vscode.StatusBarItem,
  root: vscode.Uri,
  focus: CompilationFocus,
  target: string,
  isCurrent: () => boolean,
): Promise<void> {
  await publishCompilationDiagnostics(report, {
    async loadSource(source) {
      const uri = vscode.Uri.joinPath(root, source);
      const bytes = await readFile(uri.fsPath);
      const document = await vscode.workspace.openTextDocument(uri);
      return { bytes, document };
    },
    isCurrent,
    publish(projected) {
      const byUri = new Map<string, vscode.Diagnostic[]>();
      for (const { source, range, finding: item } of projected) {
        const uri = vscode.Uri.joinPath(root, source);
        const severity = item.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : item.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(
            range.start.line,
            range.start.character,
            range.end.line,
            range.end.character,
          ),
          `[${item.side}] ${item.message}`,
          severity,
        );
        diagnostic.code = item.code;
        diagnostic.source = "sigilc";
        const key = uri.toString();
        byUri.set(key, [...(byUri.get(key) ?? []), diagnostic]);
      }
      collection.set(
        [...byUri].map(([uri, items]) => [vscode.Uri.parse(uri), items]),
      );
      const state = nativeState(report);
      const icon = state === "Coherent" || state === "Closed"
        ? "$(pass-filled)"
        : state === "Loose" || state === "Converged"
        ? "$(warning)"
        : state
        ? "$(error)"
        : "$(circle-slash)";
      status.text = `${icon} Sigil ${compilationFocusLabel(focus)}: ${
        state ?? "unavailable"
      }`;
      const omitted = diagnosticGroups(report).reduce(
        (n, group) => n + group.omitted,
        0,
      );
      status.tooltip = `${target}\n${
        state ?? ("reason" in report ? report.reason : "Unavailable")
      }\n${omitted} omitted findings. Native scope and witnesses are in Sigil output.`;
    },
  });
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::DocumentPreview interface,state,logic,constraints,cases
async function openPreview(previews: PreviewContentProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "sigil") {
    await vscode.window.showInformationMessage(
      "Open a Sigil document to preview it.",
    );
    return;
  }
  if (!client?.isRunning()) {
    await vscode.window.showInformationMessage(
      "The Sigil language server is not available.",
    );
    return;
  }
  const markdown = await client.sendRequest<string>(
    "workspace/executeCommand",
    {
      command: RENDER_DOCUMENT_COMMAND,
      arguments: [editor.document.uri.toString()],
    },
  );
  if (!markdown?.trim()) {
    await vscode.window.showInformationMessage(
      "No Sigil components are available to preview in this file.",
    );
    return;
  }
  const previewUri = previews.previewUri(editor.document.uri);
  previews.set(previewUri, markdown);
  await vscode.workspace.openTextDocument(previewUri);
  await vscode.commands.executeCommand(
    "markdown.showPreviewToSide",
    previewUri,
  );
}
