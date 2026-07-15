import { InMemorySigilFileSystem } from "@sigil/core";
import {
  encodeLspMessage,
  fileUriToPath,
  LspMessageFramer,
  pathToFileUri,
  runLanguageServer,
  SigilLanguageServer,
} from "../src/mod.ts";
import type { JsonRpcIncoming, JsonRpcOutgoing } from "../src/types.ts";

const root = "/workspace";
const rootUri = pathToFileUri(root);
const contractPath = `${root}/contract.sigil`;
const consumerPath = `${root}/consumer.sigil`;
const contractUri = pathToFileUri(contractPath);
const consumerUri = pathToFileUri(consumerPath);

Deno.test("file URI conversion preserves Sigil paths", () => {
  assertEquals(
    fileUriToPath(pathToFileUri("/tmp/a #module.sigil")),
    "/tmp/a #module.sigil",
  );
});

Deno.test("initializes with the approved v1 capabilities and lifecycle", async () => {
  const server = makeServer();
  const before = await server.handle(request(1, "shutdown"));
  assertEquals(errorCode(before), -32002);

  const initialized = await server.handle(request(2, "initialize", {
    rootUri,
    capabilities: { general: { positionEncodings: ["utf-16"] } },
  }));
  const result = responseResult(initialized) as Record<string, unknown>;
  const capabilities = result.capabilities as Record<string, unknown>;
  assertEquals(capabilities.positionEncoding, "utf-16");
  assertEquals(capabilities.definitionProvider, true);
  assertEquals(capabilities.documentSymbolProvider, true);
  assertEquals(capabilities.hoverProvider, true);
  assert(
    JSON.stringify(capabilities.semanticTokensProvider) === JSON.stringify({
      legend: { tokenTypes: ["type"], tokenModifiers: [] },
      full: true,
    }),
  );
  assertEquals(server.state, "running");

  const shutdown = await server.handle(request(3, "shutdown"));
  assertEquals(responseResult(shutdown), null);
  await server.handle(notification("exit"));
  assertEquals(server.state, "exited");
  assertEquals(server.exitCode, 0);
});

Deno.test("publishes and clears diagnostics from open document overlays", async () => {
  const server = makeServer();
  await initialize(server);
  const malformed = "component Thing {\n  mystery {\n    broken\n  }\n}\n";
  const opened = await server.handle(notification("textDocument/didOpen", {
    textDocument: { uri: contractUri, version: 1, text: malformed },
  }));
  const openDiagnostics = diagnosticsFor(opened, contractUri);
  assert(openDiagnostics.some((item) => item.code === "SIGIL_UNKNOWN_SECTION"));
  assert(openDiagnostics.some((item) => item.code === "SIGIL_MISSING_GOAL"));

  const changed = await server.handle(notification("textDocument/didChange", {
    textDocument: { uri: contractUri, version: 2 },
    contentChanges: [{ text: contractSource }],
  }));
  assertEquals(diagnosticsFor(changed, contractUri).length, 0);

  const closed = await server.handle(notification("textDocument/didClose", {
    textDocument: { uri: contractUri },
  }));
  assertEquals(diagnosticsFor(closed, contractUri).length, 0);
});

Deno.test("returns hierarchical symbols, definitions, and component hover", async () => {
  const server = makeServer();
  await initialize(server);

  const symbols = responseResult(
    await server.handle(request(
      2,
      "textDocument/documentSymbol",
      { textDocument: { uri: contractUri } },
    )),
  ) as Array<Record<string, unknown>>;
  assertEquals(symbols[0].name, "Thing");
  assertEquals(symbols[0].detail, "component");
  assert((symbols[0].children as unknown[]).length === 2);
  assertEquals(symbols[1].detail, "expand");

  const definition = responseResult(
    await server.handle(request(
      3,
      "textDocument/definition",
      {
        textDocument: { uri: consumerUri },
        position: { line: 0, character: 26 },
      },
    )),
  ) as Record<string, unknown>;
  assertEquals(definition.uri, contractUri);
  assertEquals(
    ((definition.range as Record<string, unknown>).start as Record<
      string,
      unknown
    >).line,
    0,
  );

  const expandDefinition = responseResult(
    await server.handle(request(
      4,
      "textDocument/definition",
      {
        textDocument: { uri: contractUri },
        position: { line: 10, character: 9 },
      },
    )),
  ) as Record<string, unknown>;
  assertEquals(expandDefinition.uri, contractUri);
  assertEquals(
    ((expandDefinition.range as Record<string, unknown>).start as Record<
      string,
      unknown
    >).line,
    0,
  );

  const hover = responseResult(
    await server.handle(request(
      5,
      "textDocument/hover",
      {
        textDocument: { uri: consumerUri },
        position: { line: 0, character: 26 },
      },
    )),
  ) as Record<string, unknown>;
  const contents = hover.contents as Record<string, unknown>;
  assert(String(contents.value).includes("component Thing"));
  assert(String(contents.value).includes("Collected expansions"));

  const proseDefinition = responseResult(
    await server.handle(request(
      6,
      "textDocument/definition",
      {
        textDocument: { uri: consumerUri },
        position: { line: 4, character: 14 },
      },
    )),
  ) as Record<string, unknown>;
  assertEquals(proseDefinition.uri, contractUri);

  const proseHover = responseResult(
    await server.handle(request(
      7,
      "textDocument/hover",
      {
        textDocument: { uri: consumerUri },
        position: { line: 4, character: 14 },
      },
    )),
  ) as Record<string, unknown>;
  assert(
    String((proseHover.contents as Record<string, unknown>).value).includes(
      "component Thing",
    ),
  );

  const ordinaryProseDefinition = responseResult(
    await server.handle(request(
      8,
      "textDocument/definition",
      {
        textDocument: { uri: consumerUri },
        position: { line: 4, character: 6 },
      },
    )),
  );
  assertEquals(ordinaryProseDefinition, null);

  const ordinaryProseHover = responseResult(
    await server.handle(request(
      9,
      "textDocument/hover",
      {
        textDocument: { uri: consumerUri },
        position: { line: 4, character: 6 },
      },
    )),
  );
  assertEquals(ordinaryProseHover, null);

  const tokens = responseResult(
    await server.handle(request(
      10,
      "textDocument/semanticTokens/full",
      { textDocument: { uri: consumerUri } },
    )),
  ) as Record<string, unknown>;
  assert(
    JSON.stringify(tokens.data) === JSON.stringify([
      0,
      25,
      5,
      0,
      0,
      2,
      10,
      8,
      0,
      0,
      2,
      12,
      5,
      0,
      0,
    ]),
  );
});

Deno.test("returns protocol errors for bad requests and observes cancellation", async () => {
  const server = makeServer();
  await initialize(server);
  const badParams = await server.handle(request(2, "textDocument/hover", {}));
  assertEquals(errorCode(badParams), -32602);
  const unknown = await server.handle(request(3, "unknown/method"));
  assertEquals(errorCode(unknown), -32601);
  server.cancel(4);
  const cancelled = await server.handle(
    request(4, "textDocument/documentSymbol", {
      textDocument: { uri: contractUri },
    }),
  );
  assertEquals(errorCode(cancelled), -32800);
});

Deno.test("surfaces workspace configuration failures without crashing", async () => {
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/sigil.config`]: "{",
      [contractPath]: contractSource,
    }),
  });
  const initialized = await server.handle(
    request(1, "initialize", { rootUri }),
  );
  assertEquals(errorCode(initialized), undefined);
  const notifications = await server.handle(notification("initialized"));
  assert(
    diagnosticsFor(notifications, pathToFileUri(`${root}/sigil.config`)).some(
      (item) => item.code === "SIGIL_CONFIG_PARSE",
    ),
  );
  assertEquals(server.state, "running");
});

Deno.test("exit without shutdown reports an unsuccessful process status", async () => {
  const server = makeServer();
  await initialize(server);
  await server.handle(notification("exit"));
  assertEquals(server.exitCode, 1);
});

Deno.test("frames split messages and runs an ordered in-memory protocol session", async () => {
  const initializeMessage = encodeLspMessage(
    request(1, "initialize", { rootUri }),
  );
  const framer = new LspMessageFramer();
  assertEquals(framer.feed(initializeMessage.slice(0, 12)).length, 0);
  assertEquals(framer.feed(initializeMessage.slice(12)).length, 1);

  const inputBytes = joinBytes([
    initializeMessage,
    encodeLspMessage(notification("initialized")),
    encodeLspMessage(request(2, "shutdown")),
    encodeLspMessage(notification("exit")),
  ]);
  const output: Uint8Array[] = [];
  const code = await runLanguageServer(
    new ReadableStream({
      start(controller) {
        controller.enqueue(inputBytes);
        controller.close();
      },
    }),
    new WritableStream({
      write(chunk) {
        output.push(chunk);
      },
    }),
    makeServer(),
  );
  assertEquals(code, 0);
  const messages = new LspMessageFramer().feed(joinBytes(output)) as Array<
    Record<string, unknown>
  >;
  assertEquals(messages.length, 2);
  assertEquals(messages[0].id, 1);
  assertEquals(messages[1].id, 2);
});

Deno.test("malformed JSON returns a parse error without dropping adjacent frames", async () => {
  const inputBytes = joinBytes([
    rawFrame("{"),
    encodeLspMessage(request(1, "initialize", { rootUri })),
    encodeLspMessage(request(2, "shutdown")),
    encodeLspMessage(notification("exit")),
  ]);
  const output: Uint8Array[] = [];
  const code = await runLanguageServer(
    new ReadableStream({
      start(controller) {
        controller.enqueue(inputBytes);
        controller.close();
      },
    }),
    new WritableStream({
      write(chunk) {
        output.push(chunk);
      },
    }),
    makeServer(),
  );
  assertEquals(code, 0);
  const messages = new LspMessageFramer().feed(joinBytes(output)) as Array<
    Record<string, unknown>
  >;
  assertEquals(messages.length, 3);
  assertEquals((messages[0].error as Record<string, unknown>).code, -32700);
  assertEquals(messages[1].id, 1);
  assertEquals(messages[2].id, 2);
});

Deno.test("stdio executable completes initialize, shutdown, and exit", async () => {
  const input = joinBytes([
    encodeLspMessage(request(1, "initialize", { rootUri })),
    encodeLspMessage(request(2, "shutdown")),
    encodeLspMessage(notification("exit")),
  ]);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "src/main.ts"],
    cwd: ".",
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = command.stdin.getWriter();
  await writer.write(input);
  await writer.close();
  const output = await command.output();
  assertEquals(output.code, 0);
  assertEquals(new TextDecoder().decode(output.stderr), "");
  const messages = new LspMessageFramer().feed(output.stdout) as Array<
    Record<string, unknown>
  >;
  assertEquals(messages.length, 2);
  assertEquals(messages[0].id, 1);
  assertEquals(messages[1].id, 2);
});

const contractSource = `component Thing {
  goal {
    Represent one useful thing.
  }

  interface {
    run()
  }
}

expand Thing {
  cases {
    Running succeeds.
  }
}
`;

const consumerSource = `@contract.sigil import { Thing }

component Consumer {
  goal {
    Consume Thing.
  }

  interface {
    run()
  }
}
`;

function makeServer(): SigilLanguageServer {
  return new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/sigil.config`]: JSON.stringify({
        configVersion: "1.0.0",
        languageVersion: "1.0.0",
        workspace: { name: "lsp-test", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [contractPath]: contractSource,
      [consumerPath]: consumerSource,
    }),
  });
}

async function initialize(server: SigilLanguageServer): Promise<void> {
  const output = await server.handle(request(1, "initialize", { rootUri }));
  assertEquals(errorCode(output), undefined);
  await server.handle(notification("initialized"));
}

function request(
  id: number,
  method: string,
  params?: unknown,
): JsonRpcIncoming {
  return { jsonrpc: "2.0", id, method, params };
}

function notification(
  method: string,
  params?: unknown,
): JsonRpcIncoming {
  return { jsonrpc: "2.0", method, params };
}

function responseResult(messages: readonly JsonRpcOutgoing[]): unknown {
  const response = messages[0] as unknown as
    | Record<string, unknown>
    | undefined;
  if (!response || !("result" in response)) {
    throw new Error("Expected success response.");
  }
  return response.result;
}

function errorCode(messages: readonly JsonRpcOutgoing[]): number | undefined {
  const response = messages[0] as unknown as
    | Record<string, unknown>
    | undefined;
  const error = response?.error as Record<string, unknown> | undefined;
  return error?.code as number | undefined;
}

function diagnosticsFor(
  messages: readonly JsonRpcOutgoing[],
  uri: string,
): Array<Record<string, unknown>> {
  const message = messages.find((item) =>
    "method" in item && item.method === "textDocument/publishDiagnostics" &&
    (item.params as Record<string, unknown>).uri === uri
  ) as Record<string, unknown> | undefined;
  return ((message?.params as Record<string, unknown> | undefined)
    ?.diagnostics ?? []) as Array<Record<string, unknown>>;
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function rawFrame(body: string): Uint8Array {
  const bytes = new TextEncoder().encode(body);
  return joinBytes([
    new TextEncoder().encode(`Content-Length: ${bytes.length}\r\n\r\n`),
    bytes,
  ]);
}

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
