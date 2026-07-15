import {
  loadSigilWorkspace,
  normalizePath,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  type SigilFileSystem,
} from "@sigil/core";
import {
  definitionAt,
  diagnosticsByUri,
  documentSymbols,
  hoverAt,
  semanticTokens,
} from "./features.ts";
import {
  DenoSigilFileSystem,
  fileUriToPath,
  OverlaySigilFileSystem,
} from "./filesystem.ts";
import type {
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentSymbolParams,
  InitializeParams,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcIncoming,
  JsonRpcOutgoing,
  JsonRpcRequest,
  SemanticTokensParams,
  TextDocumentPositionParams,
} from "./types.ts";
import { isRecord, isRequest } from "./types.ts";

export const SIGIL_LSP_VERSION = "1.0.0" as const;

const ERROR_INVALID_REQUEST = -32600;
const ERROR_METHOD_NOT_FOUND = -32601;
const ERROR_INVALID_PARAMS = -32602;
const ERROR_INTERNAL = -32603;
const ERROR_SERVER_NOT_INITIALIZED = -32002;
const ERROR_REQUEST_CANCELLED = -32800;

type ServerState =
  | "uninitialized"
  | "running"
  | "shutdown-requested"
  | "exited";

export interface SigilLanguageServerOptions {
  readonly fs?: SigilFileSystem;
  readonly currentDirectory?: string;
}

export class SigilLanguageServer {
  readonly #fs: OverlaySigilFileSystem;
  readonly #currentDirectory: string;
  readonly #openDocuments = new Map<string, { uri: string; version: number }>();
  readonly #publishedUris = new Set<string>();
  readonly #cancelled = new Set<JsonRpcId>();
  #state: ServerState = "uninitialized";
  #workspaceStart: string;
  #resolved?: ResolvedSigilWorkspace;
  #exitCode: number | undefined;

  constructor(options: SigilLanguageServerOptions = {}) {
    this.#fs = new OverlaySigilFileSystem(
      options.fs ?? new DenoSigilFileSystem(),
    );
    this.#currentDirectory = normalizePath(
      options.currentDirectory ?? Deno.cwd(),
    );
    this.#workspaceStart = this.#currentDirectory;
  }

  get state(): ServerState {
    return this.#state;
  }

  get exitCode(): number | undefined {
    return this.#exitCode;
  }

  cancel(id: JsonRpcId): void {
    this.#cancelled.add(id);
  }

  async handle(message: JsonRpcIncoming): Promise<readonly JsonRpcOutgoing[]> {
    if (message.method === "$/cancelRequest") {
      const id = cancellationId(message.params);
      if (id !== undefined) this.cancel(id);
      return [];
    }
    if (message.method === "exit") {
      this.#exitCode = this.#state === "shutdown-requested" ? 0 : 1;
      this.#state = "exited";
      return [];
    }
    if (!isRequest(message)) {
      return await this.#notification(message.method, message.params);
    }
    return [await this.#request(message)];
  }

  async #request(request: JsonRpcRequest): Promise<JsonRpcOutgoing> {
    if (this.#cancelled.delete(request.id)) return cancelled(request.id);
    if (this.#state === "uninitialized" && request.method !== "initialize") {
      return failure(
        request.id,
        ERROR_SERVER_NOT_INITIALIZED,
        "Server is not initialized.",
      );
    }
    if (this.#state === "shutdown-requested" || this.#state === "exited") {
      return failure(
        request.id,
        ERROR_INVALID_REQUEST,
        "Server is shutting down.",
      );
    }
    try {
      let result: unknown;
      switch (request.method) {
        case "initialize":
          result = await this.#initialize(request.params);
          break;
        case "shutdown":
          this.#state = "shutdown-requested";
          result = null;
          break;
        case "textDocument/documentSymbol":
          result = await this.#documentSymbol(request.params);
          break;
        case "textDocument/definition":
          result = await this.#definition(request.params);
          break;
        case "textDocument/hover":
          result = await this.#hover(request.params);
          break;
        case "textDocument/semanticTokens/full":
          result = await this.#semanticTokens(request.params);
          break;
        default:
          return failure(
            request.id,
            ERROR_METHOD_NOT_FOUND,
            `Method not found: ${request.method}`,
          );
      }
      if (this.#cancelled.delete(request.id)) return cancelled(request.id);
      return { jsonrpc: "2.0", id: request.id, result };
    } catch (error) {
      if (error instanceof InvalidParamsError) {
        return failure(request.id, ERROR_INVALID_PARAMS, error.message);
      }
      return failure(
        request.id,
        ERROR_INTERNAL,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async #notification(
    method: string,
    params: unknown,
  ): Promise<readonly JsonRpcOutgoing[]> {
    if (this.#state !== "running") return [];
    try {
      switch (method) {
        case "initialized":
          return this.#diagnosticNotifications();
        case "textDocument/didOpen":
          return await this.#didOpen(params);
        case "textDocument/didChange":
          return await this.#didChange(params);
        case "textDocument/didClose":
          return await this.#didClose(params);
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  async #initialize(params: unknown): Promise<unknown> {
    if (this.#state !== "uninitialized") {
      throw new InvalidParamsError("initialize may only be sent once.");
    }
    const value = initializeParams(params);
    const uri = value.workspaceFolders?.[0]?.uri ?? value.rootUri ?? undefined;
    this.#workspaceStart = uri ? fileUriToPath(uri) : this.#currentDirectory;
    await this.#reload();
    this.#state = "running";
    return {
      capabilities: {
        positionEncoding: "utf-16",
        textDocumentSync: { openClose: true, change: 1 },
        definitionProvider: true,
        documentSymbolProvider: true,
        hoverProvider: true,
        semanticTokensProvider: {
          legend: { tokenTypes: ["type"], tokenModifiers: [] },
          full: true,
        },
      },
      serverInfo: { name: "sigil-lsp", version: SIGIL_LSP_VERSION },
    };
  }

  async #didOpen(params: unknown): Promise<readonly JsonRpcOutgoing[]> {
    const value = didOpenParams(params);
    const path = fileUriToPath(value.textDocument.uri);
    this.#fs.set(path, value.textDocument.text);
    this.#openDocuments.set(path, {
      uri: value.textDocument.uri,
      version: value.textDocument.version,
    });
    await this.#reload();
    return this.#diagnosticNotifications();
  }

  async #didChange(params: unknown): Promise<readonly JsonRpcOutgoing[]> {
    const value = didChangeParams(params);
    const path = fileUriToPath(value.textDocument.uri);
    if (!this.#openDocuments.has(path)) return [];
    const change = value.contentChanges.at(-1);
    if (!change) return [];
    this.#fs.set(path, change.text);
    this.#openDocuments.set(path, {
      uri: value.textDocument.uri,
      version: value.textDocument.version,
    });
    await this.#reload();
    return this.#diagnosticNotifications();
  }

  async #didClose(params: unknown): Promise<readonly JsonRpcOutgoing[]> {
    const value = didCloseParams(params);
    const path = fileUriToPath(value.textDocument.uri);
    this.#fs.delete(path);
    this.#openDocuments.delete(path);
    await this.#reload();
    return this.#diagnosticNotifications([value.textDocument.uri]);
  }

  async #documentSymbol(params: unknown): Promise<unknown> {
    const value = documentSymbolParams(params);
    const path = fileUriToPath(value.textDocument.uri);
    const document = this.#resolved?.workspace.files.find((item) =>
      normalizePath(item.path) === path
    )?.document;
    if (!document) return [];
    return documentSymbols(document, await this.#fs.readTextFile(path));
  }

  async #definition(params: unknown): Promise<unknown> {
    const value = textDocumentPositionParams(params);
    if (!this.#resolved) return null;
    return await definitionAt(
      this.#resolved,
      this.#fs,
      fileUriToPath(value.textDocument.uri),
      value.position,
    );
  }

  async #hover(params: unknown): Promise<unknown> {
    const value = textDocumentPositionParams(params);
    if (!this.#resolved) return null;
    return await hoverAt(
      this.#resolved,
      this.#fs,
      fileUriToPath(value.textDocument.uri),
      value.position,
    );
  }

  async #semanticTokens(params: unknown): Promise<unknown> {
    const value = semanticTokensParams(params);
    if (!this.#resolved) return { data: [] };
    const path = fileUriToPath(value.textDocument.uri);
    return semanticTokens(
      this.#resolved,
      path,
      await this.#fs.readTextFile(path),
    );
  }

  async #reload(): Promise<void> {
    const workspace = await loadSigilWorkspace(this.#fs, {
      startPath: this.#workspaceStart,
      currentDirectory: this.#currentDirectory,
    });
    this.#resolved = resolveSigilWorkspace(workspace);
  }

  #diagnosticNotifications(
    extraUris: readonly string[] = [],
  ): readonly JsonRpcOutgoing[] {
    const grouped = diagnosticsByUri(this.#resolved?.diagnostics ?? []);
    const currentUris = new Set<string>([
      ...grouped.keys(),
      ...[...this.#openDocuments.values()].map((item) => item.uri),
      ...extraUris,
    ]);
    for (const uri of this.#publishedUris) currentUris.add(uri);
    const notifications: JsonRpcOutgoing[] = [];
    for (const uri of [...currentUris].sort()) {
      const diagnostics = grouped.get(uri) ?? [];
      notifications.push({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics },
      });
      if (diagnostics.length) this.#publishedUris.add(uri);
      else this.#publishedUris.delete(uri);
    }
    return notifications;
  }
}

class InvalidParamsError extends Error {}

function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function cancelled(id: JsonRpcId): JsonRpcFailure {
  return failure(id, ERROR_REQUEST_CANCELLED, "Request cancelled.");
}

function cancellationId(params: unknown): JsonRpcId | undefined {
  if (!isRecord(params)) return undefined;
  return typeof params.id === "string" || typeof params.id === "number"
    ? params.id
    : undefined;
}

function initializeParams(params: unknown): InitializeParams {
  const value = optionalRecord(params);
  const rootUri = value.rootUri;
  if (
    rootUri !== undefined && rootUri !== null && typeof rootUri !== "string"
  ) {
    throw new InvalidParamsError(
      "initialize rootUri must be a string or null.",
    );
  }
  let workspaceFolders: { uri: string }[] | null | undefined;
  if (value.workspaceFolders === null) workspaceFolders = null;
  else if (value.workspaceFolders !== undefined) {
    if (!Array.isArray(value.workspaceFolders)) {
      throw new InvalidParamsError(
        "initialize workspaceFolders must be an array or null.",
      );
    }
    workspaceFolders = value.workspaceFolders.map((folder) => {
      if (!isRecord(folder) || typeof folder.uri !== "string") {
        throw new InvalidParamsError("Each workspace folder requires a URI.");
      }
      return { uri: folder.uri };
    });
  }
  return { rootUri: rootUri as string | null | undefined, workspaceFolders };
}

function didOpenParams(params: unknown): DidOpenTextDocumentParams {
  const value = requiredRecord(params, "didOpen params");
  const document = requiredRecord(value.textDocument, "didOpen textDocument");
  if (
    typeof document.uri !== "string" || typeof document.version !== "number" ||
    typeof document.text !== "string"
  ) throw new InvalidParamsError("didOpen requires uri, version, and text.");
  return {
    textDocument: {
      uri: document.uri,
      version: document.version,
      text: document.text,
    },
  };
}

function didChangeParams(params: unknown): DidChangeTextDocumentParams {
  const value = requiredRecord(params, "didChange params");
  const document = requiredRecord(value.textDocument, "didChange textDocument");
  if (
    typeof document.uri !== "string" || typeof document.version !== "number" ||
    !Array.isArray(value.contentChanges) ||
    !value.contentChanges.every((change) =>
      isRecord(change) && typeof change.text === "string"
    )
  ) {
    throw new InvalidParamsError(
      "didChange requires uri, version, and full text changes.",
    );
  }
  return {
    textDocument: { uri: document.uri, version: document.version },
    contentChanges: value.contentChanges.map((change) => ({
      text: change.text as string,
    })),
  };
}

function didCloseParams(params: unknown): DidCloseTextDocumentParams {
  const value = requiredRecord(params, "didClose params");
  return { textDocument: textDocumentIdentifier(value.textDocument) };
}

function documentSymbolParams(params: unknown): DocumentSymbolParams {
  const value = requiredRecord(params, "documentSymbol params");
  return { textDocument: textDocumentIdentifier(value.textDocument) };
}

function semanticTokensParams(params: unknown): SemanticTokensParams {
  const value = requiredRecord(params, "semanticTokens params");
  return { textDocument: textDocumentIdentifier(value.textDocument) };
}

function textDocumentPositionParams(
  params: unknown,
): TextDocumentPositionParams {
  const value = requiredRecord(params, "text document position params");
  const position = requiredRecord(value.position, "position");
  if (
    typeof position.line !== "number" ||
    typeof position.character !== "number" ||
    position.line < 0 || position.character < 0
  ) {
    throw new InvalidParamsError(
      "Position requires non-negative line and character values.",
    );
  }
  return {
    textDocument: textDocumentIdentifier(value.textDocument),
    position: { line: position.line, character: position.character },
  };
}

function textDocumentIdentifier(value: unknown): { uri: string } {
  const document = requiredRecord(value, "textDocument");
  if (typeof document.uri !== "string") {
    throw new InvalidParamsError("textDocument requires a URI.");
  }
  return { uri: document.uri };
}

function requiredRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidParamsError(`${label} must be an object.`);
  }
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return requiredRecord(value, "params");
}
