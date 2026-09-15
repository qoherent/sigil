import { InMemorySigilFileSystem, SIGIL_VERSION } from "@qoherent/sigil-core";
import { pathToFileUri, SigilLanguageServer } from "../src/mod.ts";
import type { JsonRpcOutgoing, Position, Range } from "../src/types.ts";
import { assert, assertEquals } from "../../core/tests/assert.ts";
const root = "/workspace",
  providerPath = `${root}/provider.sigil`,
  consumerPath = `${root}/consumer.sigil`;
const name = "café results";
const provider =
  "\uFEFFcomponent Provider {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* carries a response.\r\n}\r\nconstraints {\r\ncafé results {\r\nPreserve exact content.\r\n}\r\n}\r\n}\r\n";
const consumer =
  "@provider.sigil from Provider import { café results }\ncomponent Consumer {\ngoal {\nServe the caller.\n}\ninterface {\n😀 Use café results now.\n\nRead [café results](./notes.md).\n```text\ncafé results\n```\n}\n}\n";
function position(source: string, needle: string, occurrence = 0): Position {
  let index = -1;
  for (let i = 0; i <= occurrence; i++) {
    index = source.indexOf(needle, index + 1);
  }
  assert(index >= 0);
  const prefix = source.slice(0, index).split(/\r\n|\r|\n/);
  return { line: prefix.length - 1, character: prefix.at(-1)!.length };
}
function selected(source: string, range: Range): string {
  assertEquals(range.start.line, range.end.line);
  return source.split(/\r\n|\r|\n/)[range.start.line].slice(
    range.start.character,
    range.end.character,
  );
}
function result(messages: readonly JsonRpcOutgoing[]): unknown {
  const message = messages.find((m) => "result" in m);
  assert(message && "result" in message);
  return message.result;
}
async function setup(providerSource = provider) {
  const fs = new InMemorySigilFileSystem({
    [`${root}/.sigil/config.json`]: JSON.stringify({
      sigilVersion: SIGIL_VERSION,
      workspace: { name: "lsp-080" },
      files: { include: ["**/*.sigil"] },
    }),
    [providerPath]: providerSource,
    [consumerPath]: consumer,
  });
  const server = new SigilLanguageServer({ fs, currentDirectory: root });
  await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { rootUri: pathToFileUri(root) },
  });
  return { server, fs };
}
async function lookup(
  server: SigilLanguageServer,
  method: string,
  source: string,
  needle: string,
  occurrence = 0,
  path = consumerPath,
) {
  return result(
    await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: `textDocument/${method}`,
      params: {
        textDocument: { uri: pathToFileUri(path) },
        position: position(source, needle, occurrence),
      },
    }),
  );
}
Deno.test("0.8 multiword selections, references and headings navigate to the original inline definition", async () => {
  const { server } = await setup();
  for (
    const [source, path, occurrence] of [[consumer, consumerPath, 0], [
      consumer,
      consumerPath,
      1,
    ], [provider, providerPath, 1]] as const
  ) {
    const definition = await lookup(
      server,
      "definition",
      source,
      name,
      occurrence,
      path,
    ) as { uri: string; range: Range };
    assertEquals(definition.uri, pathToFileUri(providerPath));
    assertEquals(selected(provider, definition.range), name);
    assertEquals(definition.range.start, position(provider, name));
  }
});
Deno.test("0.8 lookup excludes link labels and payload while hover preserves consumer and provider roles", async () => {
  const { server } = await setup();
  for (const occurrence of [2, 3]) {
    assertEquals(
      await lookup(server, "definition", consumer, name, occurrence),
      null,
    );
  }
  const hover = await lookup(server, "hover", consumer, name, 1) as {
    contents: { value: string };
    range: Range;
  };
  assertEquals(selected(consumer, hover.range), name);
  assert(hover.contents.value.includes("Provider"));
  assert(hover.contents.value.includes("Consumer"));
  assert(hover.contents.value.includes("Preserve exact content."));
  assert(hover.contents.value.includes("Origin:"));
});
Deno.test("0.8 semantic token lengths select exact UTF-16 text and exclude protected content", async () => {
  const { server } = await setup();
  const tokens = result(
    await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/semanticTokens/full",
      params: { textDocument: { uri: pathToFileUri(consumerPath) } },
    }),
  ) as { data: number[] };
  let line = 0, character = 0;
  const tags: string[] = [];
  for (let i = 0; i < tokens.data.length; i += 5) {
    line += tokens.data[i];
    character = tokens.data[i] === 0
      ? character + tokens.data[i + 1]
      : tokens.data[i + 1];
    if (tokens.data[i + 3] === 1) {
      tags.push(
        selected(consumer, {
          start: { line, character },
          end: { line, character: character + tokens.data[i + 2] },
        }),
      );
    }
  }
  assertEquals(tags, [name, name]);
});
Deno.test("0.8 symbols include inline introductions and local groups at captured positions", async () => {
  const { server } = await setup();
  const symbols = result(
    await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/documentSymbol",
      params: { textDocument: { uri: pathToFileUri(providerPath) } },
    }),
  ) as {
    selectionRange: Range;
    children: { children: { name: string; selectionRange: Range }[] }[];
  }[];
  assertEquals(selected(provider, symbols[0].selectionRange), "Provider");
  const tags = symbols[0].children.flatMap((s) => s.children ?? []).filter(
    (s) => s.name === name,
  );
  assertEquals(tags.length, 2);
  for (const tag of tags) {
    assertEquals(selected(provider, tag.selectionRange), name);
  }
});

Deno.test("0.8 provider overlays invalidate references and close restores captured disk", async () => {
  const { server } = await setup();
  const uri = pathToFileUri(providerPath);
  await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri,
        version: 1,
        text: provider.replaceAll(name, "changed results"),
      },
    },
  });
  assertEquals(await lookup(server, "definition", consumer, name, 1), null);
  await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: provider }],
    },
  });
  const restored = await lookup(server, "definition", consumer, name, 1) as {
    range: Range;
  };
  assertEquals(selected(provider, restored.range), name);
  await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 1 },
      contentChanges: [{ text: provider.replaceAll(name, "old results") }],
    },
  });
  assert(await lookup(server, "definition", consumer, name, 1));
  await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didClose",
    params: { textDocument: { uri } },
  });
  assert(await lookup(server, "definition", consumer, name, 1));
});

Deno.test("0.8 diagnostics preserve related source locations and strict overlay errors", async () => {
  const { server } = await setup();
  const text = consumer.replace(
    "interface {",
    "interface {\ncafé results {\nA local collision.\n}\n",
  );
  const messages = await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: { uri: pathToFileUri(consumerPath), version: 1, text },
    },
  });
  const notification = messages.find((m) =>
    "method" in m && m.method === "textDocument/publishDiagnostics" &&
    (m.params as { uri: string }).uri === pathToFileUri(consumerPath)
  );
  assert(notification && "params" in notification);
  const diagnostics = (notification.params as {
    diagnostics: {
      code: string;
      range: Range;
      relatedInformation: { location: { uri: string; range: Range } }[];
      data: { stage: string };
    }[];
  }).diagnostics;
  const collision = diagnostics.find((d) =>
    d.code === "SIGIL_TAG_NAME_COLLISION"
  );
  assert(collision);
  assert(selectedSpan(text, collision.range).includes(name));
  assertEquals(collision.data.stage, "resolution");
  assert(collision.relatedInformation.length > 0);
  for (const related of collision.relatedInformation) {
    const captured = related.location.uri === pathToFileUri(providerPath)
      ? provider
      : text;
    assert(selectedSpan(captured, related.location.range).includes(name));
  }
  const invalid = await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: pathToFileUri(consumerPath), version: 2 },
      contentChanges: [{ text: "\ud800" }],
    },
  });
  assert(JSON.stringify(invalid).includes("SIGIL_INVALID_CHARACTER"));
});

class MutableFileSystem extends InMemorySigilFileSystem {
  providerText = provider;
  sourceReads = 0;
  delayNext = false;
  entered = Promise.withResolvers<void>();
  released = Promise.withResolvers<void>();
  constructor() {
    super({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "mutable" },
        files: { include: ["**/*.sigil"] },
      }),
      [providerPath]: provider,
      [consumerPath]: consumer,
    });
  }
  override async readSourceFile(path: string): Promise<string | Uint8Array> {
    this.sourceReads++;
    if (path !== providerPath) return await super.readSourceFile(path);
    const captured = this.providerText;
    if (this.delayNext) {
      this.delayNext = false;
      this.entered.resolve();
      await this.released.promise;
    }
    return captured;
  }
}

class RecoveringFileSystem extends MutableFileSystem {
  failNext = false;
  failReads = false;
  reloads = 0;
  override listFiles(root: string): Promise<readonly string[]> {
    this.reloads++;
    return super.listFiles(root);
  }
  override async readSourceFile(path: string): Promise<string | Uint8Array> {
    if ((this.failNext || this.failReads) && path === providerPath) {
      this.failNext = false;
      throw new Error("transient provider read failure");
    }
    return await super.readSourceFile(path);
  }
}
async function mutableServer(fs: MutableFileSystem) {
  const server = new SigilLanguageServer({ fs, currentDirectory: root });
  await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { rootUri: pathToFileUri(root) },
  });
  return server;
}
Deno.test("0.8 requests use captured sources until a watched provider change", async () => {
  const fs = new MutableFileSystem(), server = await mutableServer(fs);
  const reads = fs.sourceReads;
  fs.providerText = provider.replaceAll(name, "changed results");
  assert(await lookup(server, "definition", consumer, name, 1));
  assertEquals(fs.sourceReads, reads);
  await server.handle({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: pathToFileUri(providerPath), type: 2 }] },
  });
  assertEquals(await lookup(server, "definition", consumer, name, 1), null);
});
Deno.test("0.8 request during a healthy reload does not start another reload", async () => {
  const fs = new RecoveringFileSystem(), server = await mutableServer(fs);
  fs.delayNext = true;
  const pending = server.handle({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: pathToFileUri(providerPath), type: 2 }] },
  });
  await fs.entered.promise;
  const reloads = fs.reloads;
  const blocked = await server.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "textDocument/definition",
    params: {
      textDocument: { uri: pathToFileUri(consumerPath) },
      position: position(consumer, name, 1),
    },
  });
  assert(blocked.some((m) => "error" in m && m.error.code === -32801));
  assertEquals(fs.reloads, reloads);
  fs.released.resolve();
  await pending;
});
Deno.test("0.8 late reloads cannot replace newer overlay diagnostics or occurrences", async () => {
  const fs = new MutableFileSystem(),
    server = await mutableServer(fs),
    uri = pathToFileUri(consumerPath);
  await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, version: 1, text: consumer } },
  });
  fs.delayNext = true;
  const old = server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: consumer.replace(name, "missing results") }],
    },
  });
  await fs.entered.promise;
  const latest = await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: consumer }],
    },
  });
  assert(!JSON.stringify(latest).includes("SIGIL_UNRESOLVED_IMPORTED_TAG"));
  fs.released.resolve();
  assertEquals(await old, []);
  assert(await lookup(server, "definition", consumer, name, 1));
});
Deno.test("0.8 failed reload clears diagnostics and one shared request reload recovers", async () => {
  const fs = new RecoveringFileSystem(), server = await mutableServer(fs);
  fs.providerText = provider.replaceAll(name, "changed results");
  await server.handle({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: pathToFileUri(providerPath), type: 2 }] },
  });
  fs.providerText = provider;
  fs.failNext = true;
  const failed = await server.handle({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: pathToFileUri(providerPath), type: 2 }] },
  });
  assert(
    failed.some((message) =>
      "method" in message && message.method === "window/showMessage" &&
      JSON.stringify(message.params).includes("transient provider read failure")
    ),
  );
  assert(
    failed.some((message) =>
      "method" in message &&
      message.method === "textDocument/publishDiagnostics" &&
      JSON.stringify(message.params).includes('"diagnostics":[]')
    ),
  );

  const reloads = fs.reloads;
  fs.delayNext = true;
  fs.entered = Promise.withResolvers<void>();
  fs.released = Promise.withResolvers<void>();
  const first = lookup(server, "definition", consumer, name, 1);
  const second = lookup(server, "definition", consumer, name, 1);
  await fs.entered.promise;
  assertEquals(fs.reloads, reloads + 1);
  fs.released.resolve();
  assert(await first);
  assert(await second);

  fs.failNext = true;
  await server.handle({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: pathToFileUri(providerPath), type: 2 }] },
  });
  fs.failReads = true;
  const beforePersistentRetry = fs.reloads;
  const rejected = await server.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "textDocument/definition",
    params: {
      textDocument: { uri: pathToFileUri(consumerPath) },
      position: position(consumer, name, 1),
    },
  });
  assert(JSON.stringify(rejected).includes("transient provider read failure"));
  assertEquals(fs.reloads, beforePersistentRetry + 1);
  await server.handle({
    jsonrpc: "2.0",
    id: 4,
    method: "textDocument/definition",
    params: {
      textDocument: { uri: pathToFileUri(consumerPath) },
      position: position(consumer, name, 1),
    },
  });
  assertEquals(fs.reloads, beforePersistentRetry + 1);
});
Deno.test("0.8 earliest grouping is the destination without an inline definition across CR sources", async () => {
  const fs = new MutableFileSystem();
  fs.providerText = provider.replace(
    "😀 A *café results* carries a response.",
    "café results {\r\nOffer a response.\r\n}",
  ).replaceAll("\r\n", "\r");
  const server = await mutableServer(fs);
  const destination = await lookup(server, "definition", consumer, name, 1) as {
    range: Range;
  };
  assertEquals(destination.range.start, position(fs.providerText, name));
  assertEquals(selected(fs.providerText, destination.range), name);
});

function selectedSpan(source: string, range: Range): string {
  const lines = source.split(/\r\n|\r|\n/);
  if (range.start.line === range.end.line) {
    return lines[range.start.line].slice(
      range.start.character,
      range.end.character,
    );
  }
  return [
    lines[range.start.line].slice(range.start.character),
    ...lines.slice(range.start.line + 1, range.end.line),
    lines[range.end.line].slice(0, range.end.character),
  ].join("\n");
}
Deno.test("0.8 implementation watcher cannot discard a pending language reload", async () => {
  const fs = new MutableFileSystem(),
    server = await mutableServer(fs),
    uri = pathToFileUri(consumerPath);
  await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, version: 1, text: consumer } },
  });
  fs.delayNext = true;
  const changed = consumer.replace(
    "😀 Use café results now.",
    "😀 Nothing here now.",
  );
  const old = server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: changed }],
    },
  });
  await fs.entered.promise;
  await server.handle({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: {
      changes: [{ uri: pathToFileUri(`${root}/implementation.ts`), type: 2 }],
    },
  });
  fs.released.resolve();
  await old;
  assertEquals(await lookup(server, "definition", consumer, name, 1), null);
});

class DelayedOwnershipFileSystem extends MutableFileSystem {
  override async listFiles(path: string): Promise<readonly string[]> {
    return [...await super.listFiles(path), `${root}/implementation.ts`];
  }
  override async readTextFile(path: string): Promise<string> {
    if (!path.endsWith("implementation.ts")) {
      return await super.readTextFile(path);
    }
    this.entered.resolve();
    await this.released.promise;
    return '// @sigil implements consumer.sigil::Consumer::"café results" interface\nexport function consume() {}\n';
  }
}
Deno.test("0.8 pending ownership hover rejects a changed workspace generation", async () => {
  const fs = new DelayedOwnershipFileSystem(), server = await mutableServer(fs);
  await fs.entered.promise;
  const pending = server.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/hover",
    params: {
      textDocument: { uri: pathToFileUri(consumerPath) },
      position: position(consumer, name, 1),
    },
  });
  await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri: pathToFileUri(consumerPath),
        version: 1,
        text: consumer + "\n",
      },
    },
  });
  fs.released.resolve();
  const rejected = await pending;
  assert(rejected.some((m) => "error" in m && m.error.code === -32801));
  const current = await lookup(server, "hover", consumer, name, 1) as {
    contents: { value: string };
  };
  assert(current.contents.value.includes("consume · implementation.ts"));
  assert(current.contents.value.includes("Tag: café results"));
  assert(current.contents.value.includes("Provider"));
});

Deno.test("0.8 provider hover resolves authored links against their source", async () => {
  const linkedProvider = provider.replace(
    "Own vocabulary.",
    'Own [notes](<./notes (v2).md> "Provider notes") and ![image](./image.svg).',
  );
  const { server, fs } = await setup(linkedProvider);
  const hover = await lookup(server, "hover", consumer, name, 1) as {
    contents: { value: string };
  };
  assert(
    hover.contents.value.includes(
      '[notes](<file:///workspace/notes%20%28v2%29.md> "Provider notes")',
    ),
  );
  assert(
    hover.contents.value.includes("![image](<file:///workspace/image.svg>)"),
  );
  assertEquals(await fs.readTextFile(providerPath), linkedProvider);
});
