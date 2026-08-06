import {
  InMemorySigilFileSystem,
  SIGIL_VERSION,
  type SigilFileSystem,
  supportedImplementationSourceGlobPatterns,
} from "@qoherent/sigil-core";
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

// @sigil tests packages/lsp/_module.sigil::SigilLsp::WorkspaceSupport interface,state,constraints,cases
Deno.test("file URI conversion preserves Sigil paths", () => {
  assertEquals(
    fileUriToPath(pathToFileUri("/tmp/a #module.sigil")),
    "/tmp/a #module.sigil",
  );
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::ProtocolSession interface,state,logic,constraints,cases
Deno.test("initializes with the approved 0.7 capabilities and lifecycle", async () => {
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
      legend: {
        tokenTypes: ["type", "concept", "term"],
        tokenModifiers: [],
      },
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

/*
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::DocumentSynchronization interface,state,logic,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::OwnershipSourceWatching constraints,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::ProtocolSession interface,state,logic,constraints,cases
 */
Deno.test("dynamically registers ownership-source workspace watchers", async () => {
  const server = makeServer();
  const initialized = await server.handle(request(1, "initialize", {
    rootUri,
    capabilities: {
      workspace: {
        didChangeWatchedFiles: { dynamicRegistration: true },
      },
    },
  }));
  assertEquals(errorCode(initialized), undefined);

  const outgoing = await server.handle(notification("initialized"));
  const registration = outgoing.find((message) =>
    "method" in message && message.method === "client/registerCapability"
  ) as Record<string, unknown> | undefined;
  assert(registration);
  assertEquals(registration.id, "sigil/ownership-watch/request");
  const params = registration.params as Record<string, unknown>;
  const registrations = params.registrations as Array<Record<string, unknown>>;
  assertEquals(registrations.length, 1);
  assertEquals(registrations[0].id, "sigil/ownership-watch");
  assertEquals(
    registrations[0].method,
    "workspace/didChangeWatchedFiles",
  );
  const options = registrations[0].registerOptions as Record<string, unknown>;
  const watchers = options.watchers as Array<Record<string, unknown>>;
  assert(
    JSON.stringify(watchers.map((watcher) => watcher.globPattern)) ===
      JSON.stringify(supportedImplementationSourceGlobPatterns()),
  );
  assert(watchers.every((watcher) => watcher.kind === 7));

  const registrationResponse = await server.handle(
    response("sigil/ownership-watch/request", null),
  );
  assertEquals(registrationResponse.length, 0);
  const repeated = await server.handle(notification("initialized"));
  assert(
    !repeated.some((message) =>
      "method" in message && message.method === "client/registerCapability"
    ),
  );
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::OwnershipSourceWatching constraints,cases
Deno.test("does not register watched files without client support", async () => {
  const server = makeServer();
  const initialized = await server.handle(
    request(1, "initialize", { rootUri }),
  );
  assertEquals(errorCode(initialized), undefined);
  const outgoing = await server.handle(notification("initialized"));
  assert(
    !outgoing.some((message) =>
      "method" in message && message.method === "client/registerCapability"
    ),
  );
  assertEquals(server.state, "running");
});

/*
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::DocumentSynchronization interface,state,logic,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::DiagnosticPublishing interface
 */
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

// @sigil tests packages/lsp/_module.sigil::SigilLsp::DiagnosticPublishing interface
Deno.test("publishes concept ambiguity for module indexes and ordinary files", async () => {
  const modulePath = `${root}/_module.sigil`;
  const workspacePath = `${root}/workspace.sigil`;
  const providerPath = `${root}/glossary.sigil`;
  const consumer = (name: string) =>
    `@glossary.sigil import { SigilGlossaryEngine }

component ${name} {
  goal {
    Present glossary inspection.
  }

  interface {
    GlossaryInspection {
      A local facade for SigilGlossaryEngine GlossaryInspection.
    }
  }
}
`;
  const moduleSource = consumer("SigilCore");
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-concept-ambiguity", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [providerPath]: `component SigilGlossaryEngine {
  goal {
    Inspect glossary data.
  }

  interface {
    GlossaryInspection {
      Inspect reviewed glossary terms.
    }
  }
}
`,
      [modulePath]: moduleSource,
      [workspacePath]: consumer("SigilWorkspace"),
    }),
  });
  await initialize(server);
  const published = await server.handle(notification("textDocument/didOpen", {
    textDocument: {
      uri: pathToFileUri(modulePath),
      version: 1,
      text: moduleSource,
    },
  }));
  for (const path of [modulePath, workspacePath]) {
    const diagnostics = diagnosticsFor(published, pathToFileUri(path));
    assert(
      diagnostics.some((item) =>
        item.code === "SIGIL_AMBIGUOUS_CONCEPT_IDENTIFIER"
      ),
    );
  }
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
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
  const interfaceSymbol =
    (symbols[0].children as Array<Record<string, unknown>>)
      .find((item) => item.name === "interface");
  assert(interfaceSymbol);
  assertEquals(
    (interfaceSymbol.children as Array<Record<string, unknown>>)[0].name,
    "Execution",
  );
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

  const importLine = "@contract.sigil import { Thing }";
  const afterImportedName = responseResult(
    await server.handle(request(
      31,
      "textDocument/definition",
      {
        textDocument: { uri: consumerUri },
        position: {
          line: 0,
          character: importLine.indexOf("Thing") + "Thing".length,
        },
      },
    )),
  );
  assertEquals(afterImportedName, null);

  const expandDefinition = responseResult(
    await server.handle(request(
      4,
      "textDocument/definition",
      {
        textDocument: { uri: contractUri },
        position: { line: 12, character: 9 },
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
  assert(
    String(contents.value).includes(
      "component [Thing](file:///workspace/contract.sigil#L1,11)",
    ),
  );
  assert(!String(contents.value).includes("Collected expansions"));

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
      "component [Thing](file:///workspace/contract.sigil#L1,11)",
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
  const decoded = decodeSemanticTokens(tokens.data as number[]);
  assert(decoded.some((item) => item.tokenType === 0));
  assert(decoded.some((item) => item.tokenType === 1));
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
Deno.test("component hover includes clickable owned implementation links", async () => {
  const source = `component Thing {
  goal {
    Own the implementation targets.
  }

  interface {
    OwnedTargets {
      Own code, tests, and workflow instructions.
    }
  }
}

expand Thing {
  cases {
    OwnedTargets {
      Ownership links remain visible after collected expansions.
    }
  }
}
`;
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-owned-implementation-hover", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [contractPath]: source,
      [`${root}/packages/core/src/config.ts`]:
        "// @sigil implements contract.sigil::Thing::OwnedTargets interface\nexport function parseSigilConfig() {}\n",
      [`${root}/packages/core/tests/core_test.ts`]:
        "// @sigil tests contract.sigil::Thing::OwnedTargets cases\nfunction implementationTargets() {}\n",
      [`${root}/packages/core/src/workspace.ts`]:
        "// @sigil implements contract.sigil::Thing interface,cases\nexport function loadWorkspace() {}\n",
      [`${root}/packages/cli/README.md`]:
        "<!-- @sigil uses contract.sigil::Thing::OwnedTargets interface -->\n# CLI\n",
    }),
  });
  await initialize(server);

  const hover = responseResult(
    await server.handle(request(2, "textDocument/hover", {
      textDocument: { uri: contractUri },
      position: { line: 0, character: 11 },
    })),
  ) as Record<string, unknown>;
  const markdown = String(
    (hover.contents as Record<string, unknown>).value,
  );
  assert(markdown.includes("**Owned implementations**"));
  assert(
    markdown.includes(
      "implements [parseSigilConfig · packages/core/src/config.ts](file:///workspace/packages/core/src/config.ts#L2,17) (interface)",
    ),
  );
  assert(
    markdown.includes(
      "tests [implementationTargets · packages/core/tests/core_test.ts](file:///workspace/packages/core/tests/core_test.ts#L2,10) (cases)",
    ),
  );
  assert(
    markdown.includes(
      "uses [packages/cli/README.md](file:///workspace/packages/cli/README.md#L1,1) (interface)",
    ),
  );
  assert(
    markdown.includes(
      "implements [loadWorkspace · packages/core/src/workspace.ts](file:///workspace/packages/core/src/workspace.ts#L2,17) (interface, cases)",
    ),
  );
  assert(!markdown.includes("(code)"));
  assert(!markdown.includes("(test)"));
  assert(!markdown.includes("(markdown)"));
  assert(
    markdown.indexOf("**Owned implementations**") >
      markdown.indexOf("**Collected expansions**"),
  );

  const conceptHover = responseResult(
    await server.handle(request(3, "textDocument/hover", {
      textDocument: { uri: contractUri },
      position: { line: 6, character: 8 },
    })),
  ) as Record<string, unknown>;
  const conceptMarkdown = String(
    (conceptHover.contents as Record<string, unknown>).value,
  );
  assert(conceptMarkdown.includes("**Owned implementations**"));
  assert(conceptMarkdown.includes("parseSigilConfig"));
  assert(conceptMarkdown.includes("packages/cli/README.md"));
  assert(!conceptMarkdown.includes("implementationTargets"));
  assert(!conceptMarkdown.includes("loadWorkspace"));

  const casesHover = responseResult(
    await server.handle(request(4, "textDocument/hover", {
      textDocument: { uri: contractUri },
      position: { line: 14, character: 8 },
    })),
  ) as Record<string, unknown>;
  const casesMarkdown = String(
    (casesHover.contents as Record<string, unknown>).value,
  );
  assert(casesMarkdown.includes("implementationTargets"));
  assert(!casesMarkdown.includes("parseSigilConfig"));
  assert(!casesMarkdown.includes("packages/cli/README.md"));
});

/*
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::OwnershipSourceIndex state,logic,constraints
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::OwnershipHoverCache state,logic,constraints,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::OwnershipSourceWatching logic,constraints,cases
 */
Deno.test("ownership hover cache shares scans and invalidates on watched changes", async () => {
  const fs = new CountingSigilFileSystem(
    new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-ownership-hover-cache", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [contractPath]: contractSource,
      [`${root}/src/worker.ts`]:
        "// @sigil implements contract.sigil::Thing::Execution interface\nexport function run() {}\n",
    }),
  );
  const server = new SigilLanguageServer({ currentDirectory: root, fs });
  await initialize(server);

  const hoverRequest = (id: number) =>
    server.handle(request(id, "textDocument/hover", {
      textDocument: { uri: contractUri },
      position: { line: 0, character: 11 },
    }));
  await Promise.all([hoverRequest(2), hoverRequest(3)]);
  const readsAfterConcurrentHovers = fs.implementationReads;
  assertEquals(readsAfterConcurrentHovers, 1);

  await hoverRequest(4);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers);

  await server.handle(notification("textDocument/didOpen", {
    textDocument: {
      uri: contractUri,
      version: 1,
      text: contractSource,
    },
  }));
  await hoverRequest(5);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers);

  await server.handle(notification("textDocument/didChange", {
    textDocument: { uri: contractUri, version: 2 },
    contentChanges: [{ text: contractSource }],
  }));
  await hoverRequest(6);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers);

  await server.handle(notification("textDocument/didClose", {
    textDocument: { uri: contractUri },
  }));
  await hoverRequest(7);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers);

  await server.handle(notification("workspace/didChangeWatchedFiles", {
    changes: [{ uri: pathToFileUri(`${root}/config.json`), type: 2 }],
  }));
  await hoverRequest(8);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers);

  await server.handle(notification("workspace/didChangeWatchedFiles", {
    changes: [{ uri: pathToFileUri(`${root}/src/worker.ts`), type: 2 }],
  }));
  await hoverRequest(9);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers + 1);

  await server.handle(notification("workspace/didChangeWatchedFiles", {
    changes: [{ uri: pathToFileUri(`${root}/src/created.ts`), type: 1 }],
  }));
  await hoverRequest(10);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers + 2);

  await server.handle(notification("workspace/didChangeWatchedFiles", {
    changes: [{ uri: pathToFileUri(`${root}/src/created.ts`), type: 3 }],
  }));
  await hoverRequest(11);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers + 3);

  await server.handle(notification("workspace/didChangeWatchedFiles", {
    changes: [
      { uri: pathToFileUri(`${root}/src/worker.ts`), type: 3 },
      { uri: pathToFileUri(`${root}/src/renamed.ts`), type: 1 },
    ],
  }));
  await hoverRequest(12);
  assertEquals(fs.implementationReads, readsAfterConcurrentHovers + 4);
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::ConceptLanguageFeatures interface,logic,constraints,cases
Deno.test("navigates and hovers contextual imported concepts", async () => {
  const server = makeServer();
  await initialize(server);

  const definition = responseResult(
    await server.handle(request(
      2,
      "textDocument/definition",
      {
        textDocument: { uri: consumerUri },
        position: { line: 9, character: 19 },
      },
    )),
  ) as Record<string, unknown>;
  assertEquals(definition.uri, contractUri);
  assertEquals(
    ((definition.range as Record<string, unknown>).start as Record<
      string,
      unknown
    >).line,
    6,
  );

  const hover = responseResult(
    await server.handle(request(
      3,
      "textDocument/hover",
      {
        textDocument: { uri: consumerUri },
        position: { line: 9, character: 19 },
      },
    )),
  ) as Record<string, unknown>;
  const markdown = String(
    (hover.contents as Record<string, unknown>).value,
  );
  assert(
    markdown.includes(
      "concept [Execution](file:///workspace/contract.sigil#L7,5)",
    ),
  );
  assert(
    markdown.includes(
      "Origin: [Thing](file:///workspace/contract.sigil#L1,11)",
    ),
  );
  assert(
    markdown.includes(
      "**interface** — [Thing](file:///workspace/contract.sigil#L1,11) in `contract.sigil`",
    ),
  );
  assert(markdown.includes("run()"));
  assert(
    markdown.includes(
      "**interface** — [Consumer](file:///workspace/consumer.sigil#L3,11) in `consumer.sigil`",
    ),
  );
  assert(markdown.includes("Re-expose "));
  assert(!markdown.includes("Running succeeds."));
  assert(!markdown.includes("Consumer retries are private."));

  const declarationHover = responseResult(
    await server.handle(request(
      31,
      "textDocument/hover",
      {
        textDocument: { uri: consumerUri },
        position: { line: 19, character: 6 },
      },
    )),
  ) as Record<string, unknown>;
  const declarationMarkdown = String(
    (declarationHover.contents as Record<string, unknown>).value,
  );
  assert(
    declarationMarkdown.includes(
      "concept [Execution](file:///workspace/contract.sigil#L7,5)",
    ),
  );
  assert(declarationMarkdown.includes("run()"));
  assert(declarationMarkdown.includes("Re-expose "));
  assert(!declarationMarkdown.includes("Running succeeds."));
  assert(!declarationMarkdown.includes("Consumer retries are private."));

  const componentHover = responseResult(
    await server.handle(request(
      32,
      "textDocument/hover",
      {
        textDocument: { uri: consumerUri },
        position: { line: 2, character: 11 },
      },
    )),
  ) as Record<string, unknown>;
  const componentMarkdown = String(
    (componentHover.contents as Record<string, unknown>).value,
  );
  assert(
    componentMarkdown.includes(
      "component [Consumer](file:///workspace/consumer.sigil#L3,11)",
    ),
  );
  assert(
    componentMarkdown.includes(
      "Consume [Thing](file:///workspace/contract.sigil#L1,11).",
    ),
  );

  const caseMismatch = responseResult(
    await server.handle(request(
      4,
      "textDocument/definition",
      {
        textDocument: { uri: consumerUri },
        position: { line: 10, character: 8 },
      },
    )),
  );
  assertEquals(caseMismatch, null);

  const substring = responseResult(
    await server.handle(request(
      5,
      "textDocument/definition",
      {
        textDocument: { uri: consumerUri },
        position: { line: 10, character: 22 },
      },
    )),
  );
  assertEquals(substring, null);

  const tokens = responseResult(
    await server.handle(request(
      6,
      "textDocument/semanticTokens/full",
      { textDocument: { uri: consumerUri } },
    )),
  ) as Record<string, unknown>;
  assert(
    !decodeSemanticTokens(tokens.data as number[]).some((item) =>
      item.line === 10 && item.tokenType === 1
    ),
  );
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::GlossaryLanguageFeatures interface,logic,constraints,cases
Deno.test("highlights, explains, and navigates reviewed glossary terms", async () => {
  const glossaryPath = `${root}/.sigil/glossary.json`;
  const glossaryUri = pathToFileUri(glossaryPath);
  const source = `component Booking {
  goal {
    A temporary reservation creates a hold.

    Ignore \`temporary reservation\`.
  }

  interface {
    BookingTerm {
      The hold remains visible.
    }
  }
}
`;
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-glossary-test", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [glossaryPath]: JSON.stringify(
        {
          schemaVersion: 1,
          terms: [],
          contexts: [
            {
              id: "booking",
              include: ["**/*.sigil"],
              exclude: [],
              terms: [
                {
                  term: "hold",
                  definition: "Booking capacity before confirmation.",
                  aliases: ["temporary reservation"],
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
      [contractPath]: source,
    }),
  });
  await initialize(server);

  const hover = responseResult(
    await server.handle(request(2, "textDocument/hover", {
      textDocument: { uri: contractUri },
      position: { line: 2, character: 10 },
    })),
  ) as Record<string, unknown>;
  const markdown = String(
    (hover.contents as Record<string, unknown>).value,
  );
  assert(markdown.includes("term hold"));
  assert(markdown.includes("Booking capacity before confirmation."));
  assert(markdown.includes("Matched alias: `temporary reservation`"));
  assert(markdown.includes("Bounded context: `booking`"));

  const definition = responseResult(
    await server.handle(request(3, "textDocument/definition", {
      textDocument: { uri: contractUri },
      position: { line: 2, character: 10 },
    })),
  ) as Record<string, unknown>;
  assertEquals(definition.uri, glossaryUri);

  const tokens = responseResult(
    await server.handle(request(
      4,
      "textDocument/semanticTokens/full",
      { textDocument: { uri: contractUri } },
    )),
  ) as Record<string, unknown>;
  const termTokens = decodeSemanticTokens(tokens.data as number[])
    .filter((item) => item.tokenType === 2);
  assert(termTokens.some((item) => item.line === 2));
  assert(termTokens.some((item) => item.line === 9));
  assert(!termTokens.some((item) => item.line === 4));
});

/*
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::ConceptLanguageFeatures interface,logic,constraints,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::GlossaryLanguageFeatures interface,logic,constraints,cases
 */
Deno.test("combines concept and glossary hover while preserving concept navigation", async () => {
  const glossaryPath = `${root}/.sigil/glossary.json`;
  const source = `component Thing {
  goal {
    Run Execution.
  }

  interface {
    Execution {
      run()
    }
  }
}
`;
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-concept-glossary-test", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [glossaryPath]: JSON.stringify({
        schemaVersion: 1,
        terms: [],
        contexts: [{
          id: "runtime",
          include: ["**/*.sigil"],
          exclude: [],
          terms: [{
            term: "execution model",
            definition: "Reviewed execution meaning.",
            aliases: ["Execution"],
          }],
        }],
      }),
      [contractPath]: source,
      [`${root}/src/execution.ts`]:
        "// @sigil implements contract.sigil::Thing::Execution interface\nexport function execute() {}\n",
    }),
  });
  await initialize(server);

  const hover = responseResult(
    await server.handle(request(2, "textDocument/hover", {
      textDocument: { uri: contractUri },
      position: { line: 6, character: 8 },
    })),
  ) as Record<string, unknown>;
  const markdown = String(
    (hover.contents as Record<string, unknown>).value,
  );
  const conceptHeading = markdown.indexOf(
    "### concept [Execution](file:///workspace/contract.sigil#L7,5)",
  );
  const termHeading = markdown.indexOf("### term execution model");
  const ownershipHeading = markdown.indexOf("**Owned implementations**");
  assert(conceptHeading >= 0);
  assert(termHeading > conceptHeading);
  assert(ownershipHeading > termHeading);
  assert(markdown.includes("execute · src/execution.ts"));
  assert(markdown.includes("Reviewed execution meaning."));
  assert(markdown.includes("Matched alias: `Execution`"));
  assert(markdown.includes("Bounded context: `runtime`"));

  const definition = responseResult(
    await server.handle(request(3, "textDocument/definition", {
      textDocument: { uri: contractUri },
      position: { line: 2, character: 9 },
    })),
  ) as Record<string, unknown>;
  assertEquals(definition.uri, contractUri);
  assertEquals(
    ((definition.range as Record<string, unknown>).start as Record<
      string,
      unknown
    >).line,
    6,
  );

  const declarationHover = responseResult(
    await server.handle(request(4, "textDocument/hover", {
      textDocument: { uri: contractUri },
      position: { line: 6, character: 6 },
    })),
  ) as Record<string, unknown>;
  const declarationMarkdown = String(
    (declarationHover.contents as Record<string, unknown>).value,
  );
  assert(
    declarationMarkdown.includes(
      "### concept [Execution](file:///workspace/contract.sigil#L7,5)",
    ),
  );
  assert(declarationMarkdown.includes("### term execution model"));
  assert(declarationMarkdown.includes("Reviewed execution meaning."));
  assert(declarationMarkdown.includes("Matched alias: `Execution`"));

  const tokens = responseResult(
    await server.handle(request(
      5,
      "textDocument/semanticTokens/full",
      { textDocument: { uri: contractUri } },
    )),
  ) as Record<string, unknown>;
  const overlapTokens = decodeSemanticTokens(tokens.data as number[])
    .filter((item) => item.line === 2);
  assert(overlapTokens.some((item) => item.tokenType === 1));
  assert(!overlapTokens.some((item) => item.tokenType === 2));
});

/*
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::GlossaryLanguageFeatures interface,logic,constraints,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::DiagnosticPublishing interface
 */
Deno.test("publishes invalid glossary diagnostics without crashing", async () => {
  const glossaryPath = `${root}/.sigil/glossary.json`;
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-glossary-error", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [glossaryPath]: "{",
      [contractPath]: contractSource,
    }),
  });
  await server.handle(request(1, "initialize", { rootUri }));
  const notifications = await server.handle(notification("initialized"));
  assert(
    diagnosticsFor(notifications, pathToFileUri(glossaryPath)).some(
      (item) => item.code === "SIGIL_GLOSSARY_PARSE",
    ),
  );
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::DiagnosticPublishing interface
Deno.test("publishes concept style information as an LSP hint", async () => {
  const source = contractSource.replaceAll("Execution", "session-lifecycle");
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-style-test", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [contractPath]: source,
    }),
  });
  await server.handle(request(1, "initialize", { rootUri }));
  const notifications = await server.handle(notification("initialized"));
  const hint = diagnosticsFor(notifications, contractUri).find((item) =>
    item.code === "SIGIL_CONCEPT_IDENTIFIER_STYLE"
  );
  assert(hint);
  assertEquals(hint.severity, 4);
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
Deno.test("directory-index definitions navigate to the original declaration", async () => {
  const modulePath = `${root}/module/_module.sigil`;
  const indexedContractPath = `${root}/module/contract.sigil`;
  const indexedConsumerPath = `${root}/indexed-consumer.sigil`;
  const indexedConsumerUri = pathToFileUri(indexedConsumerPath);
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-index-test", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [modulePath]: "@module/contract.sigil import { Thing }\n",
      [indexedContractPath]: contractSource,
      [indexedConsumerPath]:
        "@module import { Thing }\n\ncomponent Consumer {\n  goal {\n    Consume Thing.\n  }\n\n  interface {\n    run()\n  }\n}\n",
    }),
  });
  await initialize(server);

  const definition = responseResult(
    await server.handle(request(
      2,
      "textDocument/definition",
      {
        textDocument: { uri: indexedConsumerUri },
        position: { line: 0, character: 18 },
      },
    )),
  ) as Record<string, unknown>;
  assertEquals(definition.uri, pathToFileUri(indexedContractPath));

  const hover = responseResult(
    await server.handle(request(
      3,
      "textDocument/hover",
      {
        textDocument: { uri: indexedConsumerUri },
        position: { line: 0, character: 18 },
      },
    )),
  ) as Record<string, unknown>;
  const indexedHoverValue = String(
    (hover.contents as Record<string, unknown>).value,
  );
  assert(
    indexedHoverValue.includes(
      "component [Thing](file:///workspace/module/contract.sigil#L1,11)",
    ),
  );
  assert(indexedHoverValue.includes("Source: `module/contract.sigil`"));
  assert(!indexedHoverValue.includes("Source: `/workspace"));
});

Deno.test("renders component and collected-expansion source paths relative to the workspace root", async () => {
  const server = makeServer();
  await initialize(server);

  const hover = responseResult(
    await server.handle(request(
      2,
      "textDocument/hover",
      {
        textDocument: { uri: contractUri },
        position: { line: 0, character: 12 },
      },
    )),
  ) as Record<string, unknown>;
  const value = String((hover.contents as Record<string, unknown>).value);

  assert(value.includes("Source: `contract.sigil`"));
  assert(value.includes("**Collected expansions**"));
  // The collected-expansion path is displayed relative, not as `/workspace/...`.
  assert(value.includes("\n`contract.sigil`"));
  assert(!value.includes("Source: `/workspace"));
  assert(!value.includes("`/workspace/contract.sigil`"));
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::ProtocolSession interface,state,logic,constraints,cases
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

/*
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::WorkspaceSupport interface,state,constraints,cases
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::DiagnosticPublishing interface
 */
Deno.test("surfaces workspace configuration failures without crashing", async () => {
  const server = new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: "{",
      [contractPath]: contractSource,
    }),
  });
  const initialized = await server.handle(
    request(1, "initialize", { rootUri }),
  );
  assertEquals(errorCode(initialized), undefined);
  const notifications = await server.handle(notification("initialized"));
  assert(
    diagnosticsFor(notifications, pathToFileUri(`${root}/.sigil/config.json`))
      .some(
        (item) => item.code === "SIGIL_CONFIG_PARSE",
      ),
  );
  assertEquals(server.state, "running");
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::ProtocolSession interface,state,logic,constraints,cases
Deno.test("exit without shutdown reports an unsuccessful process status", async () => {
  const server = makeServer();
  await initialize(server);
  await server.handle(notification("exit"));
  assertEquals(server.exitCode, 1);
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::ProtocolSession interface,state,logic,constraints,cases
Deno.test("frames split messages and runs an ordered in-memory protocol session", async () => {
  const initializeMessage = encodeLspMessage(
    request(1, "initialize", {
      rootUri,
      capabilities: {
        workspace: {
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
    }),
  );
  const framer = new LspMessageFramer();
  assertEquals(framer.feed(initializeMessage.slice(0, 12)).length, 0);
  assertEquals(framer.feed(initializeMessage.slice(12)).length, 1);

  const inputBytes = joinBytes([
    initializeMessage,
    encodeLspMessage(notification("initialized")),
    encodeLspMessage(response("sigil/ownership-watch/request", null)),
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
  assertEquals(messages[0].id, 1);
  assertEquals(messages[1].method, "client/registerCapability");
  assertEquals(messages[2].id, 2);
});

// @sigil tests packages/lsp/_module.sigil::SigilLsp::ProtocolSession interface,state,logic,constraints,cases
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

/*
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::LspPackage interface
 * @sigil tests packages/lsp/_module.sigil::SigilLsp::ProtocolSession interface,state,logic,constraints,cases
 */
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
    Execution {
      run()
    }
  }
}

expand Thing {
  cases {
    Execution {
      Running succeeds.
    }
  }
}
`;

const consumerSource = `@contract.sigil import { Thing }

component Consumer {
  goal {
    Consume Thing.
  }

  interface {
    ConsumerSurface {
      run() uses Execution.

      execution and ExecutionCache remain prose.
    }
  }

}

expand Consumer {
  interface {
    Execution {
      Re-expose Execution to Consumer dependents.
    }
  }

  constraints {
    Execution {
      Consumer retries are private.
    }
  }
}
`;

function makeServer(): SigilLanguageServer {
  return new SigilLanguageServer({
    currentDirectory: root,
    fs: new InMemorySigilFileSystem({
      [`${root}/.sigil/config.json`]: JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "lsp-test", members: [] },
        files: { include: ["**/*.sigil"], exclude: [] },
        tools: {},
      }),
      [contractPath]: contractSource,
      [consumerPath]: consumerSource,
    }),
  });
}

class CountingSigilFileSystem implements SigilFileSystem {
  readonly #base: SigilFileSystem;
  implementationReads = 0;

  constructor(base: SigilFileSystem) {
    this.#base = base;
  }

  async readTextFile(path: string): Promise<string> {
    if (path.endsWith(".ts")) this.implementationReads++;
    return await this.#base.readTextFile(path);
  }

  exists(path: string): Promise<boolean> {
    return this.#base.exists(path);
  }

  listFiles(root: string): Promise<readonly string[]> {
    return this.#base.listFiles(root);
  }
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

function response(
  id: number | string,
  result: unknown,
): JsonRpcIncoming {
  return { jsonrpc: "2.0", id, result };
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

function decodeSemanticTokens(data: readonly number[]): Array<{
  line: number;
  character: number;
  length: number;
  tokenType: number;
}> {
  const result = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < data.length; index += 5) {
    line += data[index];
    character = data[index] === 0
      ? character + data[index + 1]
      : data[index + 1];
    result.push({
      line,
      character,
      length: data[index + 2],
      tokenType: data[index + 3],
    });
  }
  return result;
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
