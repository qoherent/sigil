import { SigilLanguageServer } from "./server.ts";
import type {
  JsonRpcFailure,
  JsonRpcIncoming,
  JsonRpcOutgoing,
} from "./types.ts";
import { isRecord } from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FRAME_PARSE_ERROR = Symbol("FRAME_PARSE_ERROR");

export class LspMessageFramer {
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();

  feed(chunk: Uint8Array): readonly unknown[] {
    this.#buffer = concatenate(this.#buffer, chunk);
    const messages: unknown[] = [];
    while (true) {
      const headerEnd = findHeaderEnd(this.#buffer);
      if (headerEnd < 0) break;
      const header = decoder.decode(this.#buffer.slice(0, headerEnd));
      const length = contentLength(header);
      const bodyStart = headerEnd + 4;
      if (this.#buffer.length < bodyStart + length) break;
      const body = this.#buffer.slice(bodyStart, bodyStart + length);
      this.#buffer = this.#buffer.slice(bodyStart + length);
      try {
        messages.push(JSON.parse(decoder.decode(body)));
      } catch {
        messages.push(FRAME_PARSE_ERROR);
      }
    }
    return messages;
  }
}

export function encodeLspMessage(
  message: JsonRpcIncoming | JsonRpcOutgoing,
): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  return concatenate(header, body);
}

export function parseIncoming(
  value: unknown,
): JsonRpcIncoming | JsonRpcFailure {
  if (
    !isRecord(value) || value.jsonrpc !== "2.0" ||
    typeof value.method !== "string"
  ) {
    return protocolFailure(null, -32600, "Invalid Request");
  }
  if (
    "id" in value && typeof value.id !== "string" &&
    typeof value.id !== "number"
  ) return protocolFailure(null, -32600, "Invalid Request");
  return value as unknown as JsonRpcIncoming;
}

export async function runLanguageServer(
  input: ReadableStream<Uint8Array>,
  output: WritableStream<Uint8Array>,
  server: SigilLanguageServer = new SigilLanguageServer(),
): Promise<number> {
  const framer = new LspMessageFramer();
  const writer = output.getWriter();
  let queue = Promise.resolve();
  let exitSeen = false;
  try {
    for await (const chunk of input) {
      let values: readonly unknown[];
      try {
        values = framer.feed(chunk);
      } catch {
        values = [protocolFailure(null, -32700, "Parse error")];
      }
      for (const value of values) {
        if (value === FRAME_PARSE_ERROR) {
          const parseError = protocolFailure(null, -32700, "Parse error");
          queue = queue.then(() => writer.write(encodeLspMessage(parseError)));
          continue;
        }
        if (isFailure(value)) {
          queue = queue.then(() => writer.write(encodeLspMessage(value)));
          continue;
        }
        const parsed = parseIncoming(value);
        if (isFailure(parsed)) {
          queue = queue.then(() => writer.write(encodeLspMessage(parsed)));
          continue;
        }
        if (parsed.method === "$/cancelRequest") {
          await server.handle(parsed);
          continue;
        }
        queue = queue.then(async () => {
          const outgoing = await server.handle(parsed);
          for (const message of outgoing) {
            await writer.write(encodeLspMessage(message));
          }
        });
        if (parsed.method === "exit") {
          exitSeen = true;
          break;
        }
      }
      if (exitSeen) break;
    }
    await queue;
    return server.exitCode ?? 0;
  } finally {
    writer.releaseLock();
  }
}

function contentLength(header: string): number {
  const line = header.split("\r\n").find((item) =>
    item.toLowerCase().startsWith("content-length:")
  );
  const value = line?.slice(line.indexOf(":") + 1).trim();
  const length = value === undefined ? NaN : Number(value);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error("Invalid or missing Content-Length header.");
  }
  return length;
}

function findHeaderEnd(buffer: Uint8Array): number {
  for (let index = 0; index <= buffer.length - 4; index++) {
    if (
      buffer[index] === 13 && buffer[index + 1] === 10 &&
      buffer[index + 2] === 13 && buffer[index + 3] === 10
    ) return index;
  }
  return -1;
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}

function protocolFailure(
  id: null,
  code: number,
  message: string,
): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isFailure(value: unknown): value is JsonRpcFailure {
  return isRecord(value) && isRecord(value.error) &&
    typeof value.error.code === "number" &&
    typeof value.error.message === "string";
}
