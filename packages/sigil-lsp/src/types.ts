export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export type JsonRpcIncoming = JsonRpcRequest | JsonRpcNotification;

export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface JsonRpcOutgoingNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export type JsonRpcOutgoing =
  | JsonRpcSuccess
  | JsonRpcFailure
  | JsonRpcOutgoingNotification;

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export interface Location {
  readonly uri: string;
  readonly range: Range;
}

export interface TextDocumentIdentifier {
  readonly uri: string;
}

export interface TextDocumentPositionParams {
  readonly textDocument: TextDocumentIdentifier;
  readonly position: Position;
}

export interface InitializeParams {
  readonly rootUri?: string | null;
  readonly workspaceFolders?: readonly { readonly uri: string }[] | null;
  readonly capabilities?: {
    readonly general?: {
      readonly positionEncodings?: readonly string[];
    };
  };
}

export interface DidOpenTextDocumentParams {
  readonly textDocument: {
    readonly uri: string;
    readonly version: number;
    readonly text: string;
  };
}

export interface DidChangeTextDocumentParams {
  readonly textDocument: {
    readonly uri: string;
    readonly version: number;
  };
  readonly contentChanges: readonly { readonly text: string }[];
}

export interface DidCloseTextDocumentParams {
  readonly textDocument: TextDocumentIdentifier;
}

export interface DocumentSymbolParams {
  readonly textDocument: TextDocumentIdentifier;
}

export interface DocumentSymbol {
  readonly name: string;
  readonly detail?: string;
  readonly kind: number;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly children?: readonly DocumentSymbol[];
}

export interface Hover {
  readonly contents: {
    readonly kind: "markdown";
    readonly value: string;
  };
  readonly range?: Range;
}

export interface PublishDiagnosticsParams {
  readonly uri: string;
  readonly diagnostics: readonly {
    readonly range: Range;
    readonly severity: number;
    readonly code: string;
    readonly source: "sigil";
    readonly message: string;
  }[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRequest(message: JsonRpcIncoming): message is JsonRpcRequest {
  return "id" in message;
}
