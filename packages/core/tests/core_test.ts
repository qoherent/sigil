import {
  agentDependencyContextFor,
  agentDependentContextFor,
  ancestorsFrom,
  collectedExpansionFor,
  componentContracts,
  conceptNamespaceFor,
  dirname,
  formatSigilDocument,
  glossaryContextForFiles,
  InMemorySigilFileSystem,
  isSupportedImplementationSource,
  loadSigilWorkspace,
  matchesSigilFile,
  normalizePath,
  ownedImplementationTargetsFor,
  ownershipDiagnosticsFor,
  parseSigilConfig,
  parseSigilDocument,
  parseSigilGlossary,
  projectRetrieval,
  resolveSigilRelationships,
  resolveSigilWorkspace,
  retrievePurposeContext,
  selectCompilationBoundary,
  SIGIL_CORE_VERSION,
  SIGIL_VERSION,
  type SigilFileSystem,
  stronglyConnectedComponentGroups,
  supportedImplementationSourceGlobPatterns,
} from "../src/mod.ts";
import { buildSigilGraph } from "../src/graph.ts";

/*
 * @sigil tests packages/core/_module.sigil::SigilCore::PackageVersionOwnership constraints
 * @sigil tests packages/core/src/model/language.sigil::SigilLanguageModel::LanguageModel interface
 */
Deno.test("separates the core artifact and language contract versions", () => {
  assertEquals(SIGIL_CORE_VERSION, "0.7.1");
  assertEquals(SIGIL_VERSION, "0.8.0");
});

/*
 * @sigil tests packages/core/src/parser.sigil::SigilParser::SemanticUnit constraints,cases
 * @sigil tests packages/core/src/parser.sigil::SigilParser::LiteralBlock logic,constraints,cases
 * @sigil tests packages/core/src/formatter.sigil::SigilFormatter::Formatting interface,logic,cases
 * @sigil tests packages/core/src/formatter.sigil::SigilFormatter::DeterministicFormatting constraints
 */
Deno.test("parses semantic paragraphs and attached literal blocks and formats idempotently", () => {
  const source = `component Example {
  goal {
    Describe a configuration whose prose is deliberately long enough that the formatter must wrap it without counting indentation toward the content width.
    \`\`\`json
    {
      "enabled": true


      "label": "kept  "
    }
    \`\`\`
  }

  interface {
    Configuration {
      read()
    }
  }
}
`;
  const parsed = parseSigilDocument("example.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertNoErrors(parsed.diagnostics);
  const goal = parsed.document.components[0].sections[0];
  assertEquals(goal.units.length, 1);
  assertEquals(goal.units[0].literalBlocks[0].type, "json");
  assert(goal.units[0].literalBlocks[0].body.includes('"enabled": true'));
  const formatted = formatSigilDocument(parsed.document, source);
  assert(formatted.formattedSource);
  assert(formatted.changed);
  assert(
    formatted.formattedSource.includes(
      '      "enabled": true\n\n\n      "label": "kept  "',
    ),
  );
  const reparsed = parseSigilDocument(
    "example.sigil",
    formatted.formattedSource,
    { sigilVersion: SIGIL_VERSION },
  );
  const second = formatSigilDocument(
    reparsed.document,
    formatted.formattedSource,
  );
  assertEquals(second.changed, false);
  assertEquals(second.formattedSource, formatted.formattedSource);
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::ImportUse interface,logic,constraints,cases
Deno.test("rejects documentary-only imports and accepts constraint use", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "dep.sigil": `component Dep {
  goal {
    Provide a dependency.
  }

  interface {
    DepValue {
      value
    }
  }
}
`,
    "consumer.sigil": `@dep.sigil import { Dep }

component Consumer {
  goal {
    Document Dep.
  }

  interface {
    Run {
      run()
    }
  }
}

expand Consumer {
  constraints {
    DocumentaryExample {
      The dependency name appears only in this example:
      \`\`\`text
      Dep
      \`\`\`
    }
  }

  decisions {
    Dependency {
      Decision: Mention Dep only as rationale.
    }
  }
}
`,
  });
  let resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  assertHasCode(resolved.diagnostics, "SIGIL_UNUSED_IMPORT");

  const usedFs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "dep.sigil": await fs.readTextFile("dep.sigil"),
    "consumer.sigil": `${await fs.readTextFile("consumer.sigil")}

expand Consumer {
  constraints {
    Dependency {
      Consumer depends on Dep.
    }
  }
}
`,
  });
  resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(usedFs, { startPath: "." }),
  );
  assert(
    !resolved.diagnostics.some((item) => item.code === "SIGIL_UNUSED_IMPORT"),
  );
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::ImportUse interface,logic,constraints,cases
Deno.test("rejects an unused direct import from a module index", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "dep.sigil": `component Dep {
  goal {
    Provide a dependency.
  }

  interface {
    DepContract {
      value
    }
  }
}
`,
    "internal/_module.sigil": `@dep.sigil import { Dep }

component InternalIndex {
  goal {
    Provide an internal directory index.
  }

  interface {
    IndexContract {
      index()
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  assertHasCode(resolved.diagnostics, "SIGIL_UNUSED_IMPORT");
  const imported = resolved.imports.find((item) =>
    item.sourceFile === "internal/_module.sigil"
  )?.names[0];
  assert(imported);
  assertEquals(imported.used, false);
  assertEquals(imported.uses.length, 0);
});

/*
 * @sigil tests packages/core/src/parser.sigil::SigilParser::LiteralBlock constraints,cases
 * @sigil tests packages/core/src/parser.sigil::SigilParser::FormattingStyle constraints,cases
 */
Deno.test("diagnoses invalid literal attachment and prose width", () => {
  const detached = parseSigilDocument(
    "detached.sigil",
    `component Example {
  goal {
    Introduce an example.

    \`\`\`bad type
    value
    \`\`\`
  }

  interface {
    Read {
      read()
    }
  }
}
`,
    { sigilVersion: SIGIL_VERSION },
  );
  assertHasCode(detached.diagnostics, "SIGIL_DETACHED_LITERAL_BLOCK");
  assertHasCode(detached.diagnostics, "SIGIL_INVALID_LITERAL_TYPE");

  const unintroduced = parseSigilDocument(
    "unintroduced.sigil",
    `component Example {
  goal {
    \`\`\`
    value
    \`\`\`
  }

  interface {
    Read {
      read()
    }
  }
}
`,
    { sigilVersion: SIGIL_VERSION },
  );
  assertHasCode(
    unintroduced.diagnostics,
    "SIGIL_LITERAL_WITHOUT_INTRODUCTION",
  );

  const unclosed = parseSigilDocument(
    "unclosed.sigil",
    `component Example {
  goal {
    Introduce an example:
    \`\`\`text
    value
`,
    { sigilVersion: SIGIL_VERSION },
  );
  assertHasCode(unclosed.diagnostics, "SIGIL_UNCLOSED_LITERAL_BLOCK");

  const width = parseSigilDocument(
    "width.sigil",
    `component Example {
  goal {
    ${"x".repeat(80)}
  }

  interface {
    Read {
      read()
    }
  }
}
`,
    { sigilVersion: SIGIL_VERSION },
  );
  assertHasCode(width.diagnostics, "SIGIL_UNFORMATTABLE_LINE");
  const unformattable = formatSigilDocument(width.document, "unchanged");
  assertEquals(unformattable.formattedSource, undefined);
  assertEquals(unformattable.changed, false);

  const unicodeWhitespaceSource = `component Example {
  goal {
    one\u00a0two\ufeffthree
  }

  interface {
    Read {
      read()
    }
  }
}
`;
  const unicodeWhitespace = parseSigilDocument(
    "unicode-whitespace.sigil",
    unicodeWhitespaceSource,
    { sigilVersion: SIGIL_VERSION },
  );
  const unicodeFormatted = formatSigilDocument(
    unicodeWhitespace.document,
    unicodeWhitespaceSource,
  );
  assert(unicodeFormatted.formattedSource?.includes("one two three"));
});

/*
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport interface,cases
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationTargetScope constraints
 */
Deno.test("shares supported implementation-source watcher patterns", () => {
  const patterns = supportedImplementationSourceGlobPatterns();
  assert(patterns.length > 0);
  for (const pattern of patterns) {
    assert(pattern.startsWith("**/*."));
    assert(isSupportedImplementationSource(`src/file${pattern.slice(4)}`));
  }
  for (
    const path of [
      "contract.sigil",
      "config.json",
      "README.txt",
      "Makefile",
    ]
  ) {
    assertEquals(isSupportedImplementationSource(path), false);
  }
});

// @sigil tests packages/core/_module.sigil::SigilCore::DeterministicCore constraints,cases
Deno.test("normalizes and walks POSIX and Windows paths", () => {
  assertEquals(normalizePath("/work/./sigil/../project"), "/work/project");
  assertEquals(
    normalizePath("C:\\work\\sigil\\..\\project"),
    "C:/work/project",
  );
  assertEquals(dirname("C:/work"), "C:/");
  assertEquals(
    ancestorsFrom("C:/work/project/source.sigil").join(","),
    "C:/work/project,C:/work,C:/",
  );
});

/*
 * @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocumentParsing interface
 * @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
 */
Deno.test("parses the canonical Sigil version and preserves semantic units", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../examples/promise/promise.sigil", import.meta.url),
  );
  const result = parseSigilDocument("examples/promise/promise.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertHasCode(result.diagnostics, "SIGIL_MISSING_CONCEPT_IDENTIFIER");
  const goal = result.document.components[0].sections.find((section) =>
    section.name === "goal"
  );
  assert(goal);
  assertEquals(
    goal.units[0].prose,
    "Represent a value that may resolve now, later, or fail.",
  );
  assertEquals(goal.units[0].ownerName, "Promise");
  assertEquals(goal.units[0].filePath, "examples/promise/promise.sigil");
  assert(goal.units[0].range.start.line > 0);
});

/*
 * @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocumentParsing interface
 * @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
 */
Deno.test("raw parsing requires a supported explicit Sigil version", () => {
  const parsed = parseSigilDocument("future.sigil", rootModule, {
    sigilVersion: "2.0.0",
  });
  assertEquals(parsed.document.components.length, 0);
  assertHasCode(parsed.diagnostics, "SIGIL_UNSUPPORTED_VERSION");
  assertEquals(
    JSON.stringify(parsed.diagnostics[0].range),
    JSON.stringify({
      start: { line: 1, column: 1 },
      end: { line: 1, column: 1 },
    }),
  );
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
Deno.test("uses one-based UTF-16 source columns across CRLF input", () => {
  const source =
    "component Emoji {\r\n  goal {\r\n    😀 state\r\n  }\r\n\r\n  interface {\r\n    Read {\r\n      read()\r\n    }\r\n  }\r\n}\r\n";
  const parsed = parseSigilDocument("emoji.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertNoErrors(parsed.diagnostics);
  const unit = parsed.document.components[0].sections[0].units[0];
  assertEquals(unit.range.start.column, 5);
  assertEquals(unit.range.end.column, "    😀 state".length + 1);
});

// @sigil tests spec/language.sigil::SigilModuleIndex::ModuleIndexContents interface,constraints,cases
Deno.test("requires every module index to declare a local component", () => {
  const parsed = parseSigilDocument(
    "internal/_module.sigil",
    "@internal/contract.sigil import { Internal }\n",
    { sigilVersion: SIGIL_VERSION },
  );
  assertEquals(parsed.document.imports.length, 1);
  assertEquals(parsed.document.components.length, 0);
  assertHasCode(parsed.diagnostics, "SIGIL_MODULE_WITHOUT_COMPONENT");

  const valid = parseSigilDocument(
    "internal/_module.sigil",
    `@internal/contract.sigil import { Internal }\n\n${rootModule}`,
    { sigilVersion: SIGIL_VERSION },
  );
  assertNoErrors(valid.diagnostics);

  const legacy = parseSigilDocument(
    "internal/#module.sigil",
    "@internal/contract.sigil import { Internal }\n",
    { sigilVersion: SIGIL_VERSION },
  );
  assert(
    !legacy.diagnostics.some((diagnostic) =>
      diagnostic.code === "SIGIL_MODULE_WITHOUT_COMPONENT"
    ),
  );
});

/*
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::ConfigValidation logic,constraints,cases
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::WorkspaceBoundary interface,logic,constraints,cases
 */
Deno.test("strict config accepts workspace defaults and rejects invalid members", () => {
  const valid = parseSigilConfig(configSource());
  assert(valid.config);
  assertEquals(valid.config.workspace.name, "test");
  assertEquals(valid.config.workspace.members.length, 0);
  assert(valid.config.files.exclude.includes("node_modules/**"));

  const invalid = parseSigilConfig(
    configSource({
      workspace: { name: "test", description: "duplicate metadata" },
    }),
  );
  assertEquals(invalid.config, undefined);
  assertHasCode(invalid.diagnostics, "SIGIL_CONFIG_INVALID");

  const escaping = parseSigilConfig(
    configSource({ files: { include: ["../outside/*.sigil"] } }),
  );
  assertHasCode(escaping.diagnostics, "SIGIL_CONFIG_INVALID");

  for (
    const members of [
      ["."],
      ["../outside"],
      ["packages/core", "packages/core"],
      ["packages", "packages/core"],
    ]
  ) {
    assertHasCode(
      parseSigilConfig(configSource({
        workspace: { name: "test", members },
      })).diagnostics,
      "SIGIL_CONFIG_INVALID",
    );
  }
});

/*
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::ConfigValidation logic,constraints,cases
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::ConfiguredLanguageVersion interface,state,constraints,cases
 */
Deno.test("config reports malformed and unsupported versions", () => {
  assertHasCode(parseSigilConfig("{").diagnostics, "SIGIL_CONFIG_PARSE");
  assertHasCode(
    parseSigilConfig(configSource({ sigilVersion: "2.0.0" })).diagnostics,
    "SIGIL_UNSUPPORTED_VERSION",
  );
});

// @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::GlossaryInterpretation interface,logic,constraints,cases
Deno.test("parses strict reviewed glossary data and rejects collisions", () => {
  const valid = parseSigilGlossary(glossarySource());
  assert(valid.glossary);
  assertEquals(valid.glossary.schemaVersion, 1);
  assertEquals(valid.glossary.terms[0].term, "workspace root");
  assertEquals(valid.glossary.terms[0].agentContext, true);
  assert(valid.glossary.terms[0].declarationRange.start.line > 0);

  const excluded = parseSigilGlossary(glossarySource({
    terms: [
      {
        term: "Decision:",
        definition: "A reviewed rationale-writing convention.",
        agentContext: false,
      },
    ],
  }));
  assertEquals(excluded.glossary?.terms[0].agentContext, false);

  assertHasCode(
    parseSigilGlossary("{").diagnostics,
    "SIGIL_GLOSSARY_PARSE",
  );
  assertHasCode(
    parseSigilGlossary(glossarySource({
      terms: [
        { term: "Booking", definition: "One booking." },
        {
          term: "Reservation",
          definition: "Another booking.",
          aliases: ["booking"],
        },
      ],
    })).diagnostics,
    "SIGIL_GLOSSARY_TERM_COLLISION",
  );
  assertHasCode(
    parseSigilGlossary(glossarySource({
      contexts: [
        {
          id: "booking",
          include: ["booking/**/*.sigil", "booking/**/*.sigil"],
          exclude: [],
          terms: [],
        },
      ],
    })).diagnostics,
    "SIGIL_GLOSSARY_INVALID",
  );
  assertHasCode(
    parseSigilGlossary(glossarySource({
      terms: [
        {
          term: "invalid visibility",
          definition: "An invalid entry.",
          agentContext: "no",
        },
      ],
    })).diagnostics,
    "SIGIL_GLOSSARY_INVALID",
  );
});

/*
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolutionEngine interface
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolution logic,constraints,cases
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::TermRecognitionEngine interface
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::TermRecognition logic,constraints,cases
 */
Deno.test("loads and projects longest glossary terms in bounded contexts", async () => {
  const source = `component Booking {
  goal {
    Explain workspace root and workspace while a hold is active.

    Ignore \`workspace root\` and https://example.test/workspace:
    \`\`\`
    workspace root
    \`\`\`
  }

  interface {
    BookingTerm {
      A temporary reservation creates a hold.
    }
  }
}
`;
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource(),
      ".sigil/glossary.json": glossarySource(),
      "booking/booking.sigil": source,
    }),
    { startPath: "." },
  );
  const resolved = resolveSigilWorkspace(workspace);
  assertNoErrors(resolved.diagnostics);
  assertEquals(resolved.glossary.schemaVersion, 1);
  assertEquals(resolved.glossary.resolvedContexts[0].contextId, "booking");
  const matched = resolved.glossary.occurrences.map((item) =>
    `${item.term.term}:${item.matchedSpelling}`
  );
  assert(matched.includes("workspace root:workspace root"));
  assert(matched.includes("workspace:workspace"));
  assert(matched.includes("hold:temporary reservation"));
  assertEquals(
    matched.filter((item) => item === "workspace root:workspace root").length,
    1,
  );
  const hold = resolved.glossary.occurrences.find((item) =>
    item.matchedSpelling === "hold"
  );
  assert(hold);
  assertEquals(hold.term.definition, "Booking capacity before confirmation.");
});

// @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::GlossaryInspection interface,logic,constraints,cases
Deno.test("projects only glossary terms occurring in selected files", async () => {
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        ".sigil/config.json": configSource(),
        ".sigil/glossary.json": glossarySource({
          terms: [
            {
              term: "workspace root",
              definition: "The directory containing .sigil/config.json.",
            },
            {
              term: "workspace",
              definition: "Sources governed by one Sigil configuration.",
            },
            { term: "hold", definition: "A general temporary claim." },
            {
              term: "capacity",
              definition: "Available workspace capacity.",
              aliases: ["slot"],
            },
            { term: "queue", definition: "Work awaiting processing." },
            {
              term: "Decision:",
              definition: "A reviewed rationale-writing convention.",
              agentContext: false,
            },
          ],
          contexts: [
            {
              id: "booking",
              include: ["booking/**/*.sigil"],
              exclude: [],
              terms: [
                {
                  term: "hold",
                  definition: "Booking capacity before confirmation.",
                  aliases: ["temporary reservation"],
                },
                {
                  term: "slot",
                  definition: "A bookable unit of time.",
                },
              ],
            },
          ],
        }),
        "booking/booking.sigil": `component Booking {
  goal {
    Decision: Explain the workspace root and capacity.
  }

  interface {
    Reservation {
      A temporary reservation creates a hold.
    }
  }
}
`,
        "operations/queue.sigil": `component Queue {
  goal {
    Process the queue.
  }

  interface {
    Work {
      Returns queued work.
    }
  }
}
`,
      }),
      { startPath: "." },
    ),
  );
  assertNoErrors(resolved.diagnostics);

  const context = glossaryContextForFiles(
    resolved.glossary,
    ["booking/booking.sigil"],
  );
  assertEquals(
    context.terms.map((term) => term.term).join(","),
    "workspace root,capacity,hold",
  );
  assertEquals(context.resolvedContexts.length, 1);
  assertEquals(context.resolvedContexts[0].contextId, "booking");
  assertEquals(
    context.resolvedContexts[0].entries.map((term) => term.term).join(","),
    "workspace root,capacity,hold",
  );
  assert(
    context.occurrences.every((occurrence) =>
      occurrence.filePath === "booking/booking.sigil"
    ),
  );
  assert(
    resolved.glossary.occurrences.some((occurrence) =>
      occurrence.term.term === "Decision:"
    ),
  );
  assert(
    !context.terms.some((term) => term.term === "Decision:"),
  );
  assert(
    !context.occurrences.some((occurrence) =>
      occurrence.term.term === "Decision:"
    ),
  );
});

/*
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolutionEngine interface
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolution logic,constraints,cases
 */
Deno.test("reports glossary context overlap through ordinary workspace checks", async () => {
  const overlapping = glossarySource({
    contexts: [
      {
        id: "booking",
        include: ["booking/**/*.sigil"],
        exclude: [],
        terms: [],
      },
      {
        id: "all",
        include: ["**/*.sigil"],
        exclude: [],
        terms: [],
      },
    ],
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        ".sigil/config.json": configSource(),
        ".sigil/glossary.json": overlapping,
        "booking/item.sigil": rootModule,
      }),
      { startPath: "." },
    ),
  );
  assertHasCode(
    resolved.diagnostics,
    "SIGIL_GLOSSARY_CONTEXT_OVERLAP",
  );
  assertEquals(resolved.glossary.occurrences.length, 0);
});

/*
 * @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery interface,logic,cases
 * @sigil tests packages/core/src/resolver.sigil::SigilResolver::RelationshipResolution interface,logic,constraints,cases
 */
Deno.test("discovers the nearest excluded workspace config and resolves imports", async () => {
  const fs = workspaceFs();
  const workspace = await loadSigilWorkspace(fs, {
    startPath: "examples/slotted/auth.sigil",
  });
  const resolved = resolveSigilWorkspace(workspace);
  assertEquals(workspace.root, "examples/slotted");
  assertEquals(workspace.configPath, "examples/slotted/.sigil/config.json");
  assertEquals(workspace.config?.workspace.name, "slotted");
  assertNoErrors(resolved.diagnostics);
  assert(
    resolved.graph.importedComponentEdges.some((edge) =>
      edge.componentName === "UserProfile"
    ),
  );
  assert(resolved.graph.componentNodes.some((node) => node.name === "Auth"));
});

// @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery interface,logic,cases
Deno.test("requires config and rejects an unexcluded nearer config", async () => {
  const missing = await loadSigilWorkspace(
    new InMemorySigilFileSystem({ "feature/auth.sigil": rootModule }),
    { startPath: "feature/auth.sigil", currentDirectory: "feature" },
  );
  assertHasCode(missing.diagnostics, "SIGIL_CONFIG_NOT_FOUND");
  assertEquals(missing.files.length, 0);

  const nested = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource(),
      "nested/.sigil/config.json": configSource({
        workspace: { name: "nested" },
      }),
      "nested/item.sigil": rootModule,
    }),
    { startPath: "nested/item.sigil" },
  );
  assertHasCode(nested.diagnostics, "SIGIL_NESTED_CONFIG");
  assertEquals(nested.files.length, 0);

  const filesOnly = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource({
        files: {
          include: ["**/*.sigil"],
          exclude: ["nested/**/*.sigil"],
        },
      }),
      "nested/.sigil/config.json": configSource({
        workspace: { name: "nested" },
      }),
      "nested/item.sigil": rootModule,
    }),
    { startPath: "nested/item.sigil" },
  );
  assertHasCode(filesOnly.diagnostics, "SIGIL_NESTED_CONFIG");

  const independent = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource({
        files: { include: ["**/*.sigil"], exclude: ["nested/**"] },
      }),
      "nested/.sigil/config.json": configSource({
        workspace: { name: "nested" },
      }),
      "nested/item.sigil": rootModule,
    }),
    { startPath: "nested/item.sigil" },
  );
  assertEquals(independent.root, "nested");
  assertEquals(independent.config?.workspace.name, "nested");
  assertNoErrors(independent.diagnostics);
  assertEquals(independent.files.length, 1);
});

// @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery interface,logic,cases
Deno.test("explicit root must directly contain config", async () => {
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      "parent/.sigil/config.json": configSource(),
    }),
    { startPath: "parent/child", explicitRoot: "parent/child" },
  );
  assertHasCode(workspace.diagnostics, "SIGIL_CONFIG_NOT_FOUND");
});

// @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceLoading interface,logic,cases
Deno.test("nested config below selected root is diagnosed and its subtree skipped", async () => {
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource(),
      "root.sigil": rootModule,
      "nested/.sigil/config.json": configSource({
        workspace: { name: "nested" },
      }),
      "nested/hidden.sigil": rootModule.replaceAll("Sigil", "Hidden"),
    }),
    { startPath: ".", explicitRoot: "." },
  );
  assertHasCode(workspace.diagnostics, "SIGIL_NESTED_CONFIG");
  assert(workspace.files.some((file) => file.path === "root.sigil"));
  assert(!workspace.files.some((file) => file.path.includes("hidden")));

  const excluded = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource({
        files: { include: ["**/*.sigil"], exclude: ["nested/**"] },
      }),
      "root.sigil": rootModule,
      "nested/.sigil/config.json": configSource({
        workspace: { name: "nested" },
      }),
      "nested/hidden.sigil": rootModule.replaceAll("Sigil", "Hidden"),
    }),
    { startPath: ".", explicitRoot: "." },
  );
  assertNoErrors(excluded.diagnostics);
  assertEquals(excluded.files.length, 1);
  assertEquals(excluded.files[0].path, "root.sigil");

  const memberWithConfig = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource({
        workspace: { name: "test", members: ["member"] },
        files: { include: ["**/*.sigil"], exclude: ["member/**"] },
      }),
      "member/.sigil/config.json": configSource({
        workspace: { name: "member" },
      }),
      "member/_module.sigil": rootModule,
    }),
    { startPath: ".", explicitRoot: "." },
  );
  assertHasCode(memberWithConfig.diagnostics, "SIGIL_NESTED_CONFIG");
});

// @sigil tests spec/language.sigil::SigilWorkspaceConfig::SourceSelection interface,state,logic,constraints,cases
Deno.test("glob includes root files and exclusion wins", async () => {
  const parsed = parseSigilConfig(configSource({
    files: { include: ["**/*.sigil"], exclude: ["generated/**"] },
  }));
  assert(parsed.config);
  assert(matchesSigilFile("root.sigil", parsed.config));
  assert(matchesSigilFile("src/feature.sigil", parsed.config));
  assert(!matchesSigilFile("generated/feature.sigil", parsed.config));

  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      ".sigil/config.json": configSource({
        files: { include: ["**/*.sigil"], exclude: ["generated/**"] },
      }),
      "root.sigil": rootModule,
      "generated/ignored.sigil": rootModule,
    }),
    { startPath: "." },
  );
  assertEquals(workspace.files.length, 1);
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
Deno.test("returns partial models and stable diagnostics for malformed Sigil", () => {
  const source =
    `component Broken {\n  weird {\n    ignored\n  }\n}\n\nexpand Missing {\n  logic {\n    orphan detail\n  }\n}\n`;
  const parsed = parseSigilDocument("broken.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  const resolved = resolveSigilWorkspace({
    root: ".",
    workspaceSnapshotIdentity: "sha256:test-fixture",
    configPath: ".sigil/config.json",
    config: parseSigilConfig(configSource()).config,
    memberRoots: [],
    files: [{ path: "broken.sigil", document: parsed.document }],
    diagnostics: parsed.diagnostics,
  });
  assertHasCode(resolved.diagnostics, "SIGIL_UNKNOWN_SECTION");
  assertHasCode(resolved.diagnostics, "SIGIL_MISSING_GOAL");
  assertHasCode(resolved.diagnostics, "SIGIL_MISSING_INTERFACE");
  assertHasCode(resolved.diagnostics, "SIGIL_EXPAND_WITHOUT_COMPONENT");
});

// @sigil tests spec/language.sigil::SigilModuleIndex::DirectoryImportSurface interface,logic,constraints,cases
Deno.test("resolves directory indexes independently of workspace members", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "_module.sigil": rootModule,
    "internal/_module.sigil":
      `@internal/contract.sigil import { Internal }\n\n${
        rootModule.replaceAll("Sigil", "InternalModule").replace(
          "    provides contracts",
          "    Internal remains available through its imported owning contract\n\n    provides contracts",
        )
      }`,
    "internal/contract.sigil": rootModule.replaceAll("Sigil", "Internal"),
    "internal/private.sigil": rootModule.replaceAll("Sigil", "Private"),
    "consumer.sigil":
      "@internal import { Internal }\n\ncomponent Consumer {\n  goal {\n    Consume.\n  }\n\n  interface {\n    run(Internal)\n  }\n}\n",
    "explicit-consumer.sigil":
      "@internal/private.sigil import { Private }\n\ncomponent ExplicitConsumer {\n  goal {\n    Consume a public component by file.\n  }\n\n  interface {\n    run(Private)\n  }\n}\n",
    "facade/_module.sigil": `@internal import { Internal }\n\n${
      rootModule.replaceAll("Sigil", "FacadeModule").replace(
        "    provides contracts",
        "    Internal remains available through its imported owning contract\n\n    provides contracts",
      )
    }`,
    "facade-consumer.sigil":
      "@facade import { Internal }\n\ncomponent FacadeConsumer {\n  goal {\n    Consume an explicitly chained index.\n  }\n\n  interface {\n    run(Internal)\n  }\n}\n",
  });
  const workspace = await loadSigilWorkspace(fs, { startPath: "." });
  const resolved = resolveSigilWorkspace(workspace);

  assertNoErrors(resolved.diagnostics);
  assert(
    resolved.graph.importedComponentEdges.some((edge) =>
      edge.sourceFile === "consumer.sigil" &&
      edge.targetFile === "internal/contract.sigil" &&
      edge.componentName === "Internal"
    ),
  );
  assert(
    resolved.graph.importedComponentEdges.some((edge) =>
      edge.sourceFile === "facade-consumer.sigil" &&
      edge.targetFile === "internal/contract.sigil" &&
      edge.componentName === "Internal"
    ),
  );
  assert(
    resolved.graph.importedComponentEdges.some((edge) =>
      edge.sourceFile === "explicit-consumer.sigil" &&
      edge.targetFile === "internal/private.sigil" &&
      edge.componentName === "Private"
    ),
  );
  assert(
    resolved.graph.fileEdges.some((edge) =>
      edge.from === "consumer.sigil" && edge.to === "internal/_module.sigil"
    ),
  );
});

// @sigil tests spec/language.sigil::SigilModuleIndex::ModuleIndexFile interface,constraints
Deno.test("treats the legacy hash-prefixed module filename as an ordinary source", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "legacy/#module.sigil": rootModule.replaceAll("Sigil", "Legacy"),
    "directory-consumer.sigil":
      "@legacy import { Legacy }\n\ncomponent DirectoryConsumer {\n  goal {\n    Verify the legacy filename is not a directory index.\n  }\n\n  interface {\n    run(Legacy)\n  }\n}\n",
    "explicit-consumer.sigil":
      "@legacy/#module.sigil import { Legacy }\n\ncomponent ExplicitConsumer {\n  goal {\n    Import an ordinary legacy-named source explicitly.\n  }\n\n  interface {\n    run(Legacy)\n  }\n}\n",
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );

  assertHasCode(resolved.diagnostics, "SIGIL_UNRESOLVED_IMPORT_PATH");
  assert(
    resolved.graph.importedComponentEdges.some((edge) =>
      edge.sourceFile === "explicit-consumer.sigil" &&
      edge.targetFile === "legacy/#module.sigil" &&
      edge.componentName === "Legacy"
    ),
  );
  assert(
    !resolved.graph.importedComponentEdges.some((edge) =>
      edge.sourceFile === "directory-consumer.sigil" &&
      edge.componentName === "Legacy"
    ),
  );
});

// @sigil tests spec/language.sigil::SigilModuleIndex::ModuleIndexFile interface
Deno.test("does not resolve a module index excluded by source selection", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource({
      files: { include: ["**/*.sigil"], exclude: ["auth/_module.sigil"] },
    }),
    "auth/_module.sigil": rootModule.replaceAll("Sigil", "Session"),
    "consumer.sigil":
      "@auth import { Session }\n\ncomponent Consumer {\n  goal {\n    Verify excluded indexes remain unavailable.\n  }\n\n  interface {\n    run(Session)\n  }\n}\n",
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );

  assertHasCode(resolved.diagnostics, "SIGIL_UNRESOLVED_IMPORT_PATH");
  assert(
    !resolved.graph.importedComponentEdges.some((edge) =>
      edge.sourceFile === "consumer.sigil" && edge.componentName === "Session"
    ),
  );
});

// @sigil tests spec/language.sigil::SigilModuleIndex::ModuleIndexContents interface,constraints,cases
Deno.test("does not add unnamed component dependencies to a module index", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "internal/_module.sigil":
      `@internal/contract.sigil import { Internal }\n\n${
        rootModule.replaceAll("Sigil", "InternalModule")
      }`,
    "internal/contract.sigil": rootModule.replaceAll("Sigil", "Internal"),
    "internal/private.sigil": rootModule.replaceAll("Sigil", "Private"),
    "consumer.sigil":
      "@internal import { Private }\n\ncomponent Consumer {\n  goal {\n    Consume.\n  }\n\n  interface {\n    run()\n  }\n}\n",
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );

  assertHasCode(resolved.diagnostics, "SIGIL_UNRESOLVED_IMPORTED_COMPONENT");
  assert(
    !resolved.graph.importedComponentEdges.some((edge) =>
      edge.sourceFile === "consumer.sigil" && edge.componentName === "Private"
    ),
  );
});

/*
 * @sigil tests packages/core/src/resolver.sigil::SigilResolver::ImportUse interface,logic,constraints,cases
 * @sigil tests packages/core/src/resolver.sigil::SigilResolver::CollectiveExpansions interface,logic,cases
 * @sigil tests packages/core/src/projections.sigil::SigilProjections::ExpansionProjection interface,logic,cases
 */
Deno.test("requires cross-file expands to import their component", async () => {
  const unimportedFs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "contract.sigil": rootModule,
    "detail-a.sigil": "expand Sigil {\n  logic {\n    A.\n  }\n}\n",
  });
  let resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(unimportedFs, { startPath: "." }),
  );
  assertHasCode(resolved.diagnostics, "SIGIL_EXPAND_WITHOUT_COMPONENT");
  assertEquals(collectedExpansionFor(resolved, "Sigil")?.expands.length, 0);

  const importedFs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "contract.sigil": `${rootModule}\n${
      rootModule.replaceAll("Sigil", "Other")
    }`,
    "detail-a.sigil":
      "@contract.sigil import { Sigil, Other }\n\nexpand Sigil {\n  logic {\n    A.\n  }\n}\n",
    "detail-b.sigil": "expand Sigil {\n  cases {\n    B.\n  }\n}\n",
  });
  resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(importedFs, { startPath: "." }),
  );
  assertHasCode(resolved.diagnostics, "SIGIL_EXPAND_WITHOUT_COMPONENT");
  const expansion = collectedExpansionFor(resolved, "Sigil");
  assert(expansion);
  assertEquals(expansion.expands.length, 1);
  assertEquals(
    expansion.expands.map((item) => item.filePath).sort().join(","),
    "detail-a.sigil",
  );
  const importedName = resolved.imports[0].names[0];
  assert(importedName.used);
  assert(importedName.uses.some((use) => use.kind === "structural-expand"));
  assertEquals(resolved.imports[0].names[1].used, false);
  assertEquals(
    resolved.diagnostics.filter((item) => item.code === "SIGIL_UNUSED_IMPORT")
      .length,
    1,
  );
  assert(
    componentContracts(resolved).some((contract) => contract.name === "Sigil"),
  );
});

// @sigil tests packages/core/src/projections.sigil::SigilProjections::AgentDependencyContext interface,logic,constraints,cases
Deno.test("projects direct dependency contracts and decisions for agents", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "leaf.sigil": `component Leaf {
  goal {
    Remain transitive.
  }

  interface {
    LeafApi {
      leaf()
    }
  }
}
`,
    "leaf-detail.sigil": `@leaf.sigil import { Leaf }

expand Leaf {
  decisions {
    LeafChoice {
      Decision: Keep this transitive rationale private by default.
    }
  }
}
`,
    "provider.sigil": `@leaf.sigil import { Leaf }

component Provider {
  goal {
    Serve consumers.
  }

  interface {
    ProviderApi {
      provide()
    }
  }
}
`,
    "provider-detail.sigil": `@provider.sigil import { Provider }

expand Provider {
  state {
    PrivateState {
      Hidden state.
    }
  }

  logic {
    PrivateLogic {
      Hidden logic.
    }
  }

  constraints {
    PrivateConstraint {
      Hidden constraint.
    }
  }

  decisions {
    ProviderChoice {
      Decision: Preserve the provider rationale.
    }
  }

  cases {
    PrivateCase {
      Hidden case.
    }
  }
}
`,
    "consumer.sigil": `@provider.sigil import { Provider }
@provider.sigil import { Provider }

component Consumer {
  goal {
    Use the provider.
  }

  interface {
    ConsumerApi {
      consume()
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const context = agentDependencyContextFor(resolved, "Consumer");

  assert(context);
  assertEquals(context.selectedComponent.name, "Consumer");
  assertEquals(
    context.dependencyContracts.map((item) => item.name).join(","),
    "Provider",
  );
  assertEquals(context.dependencyDecisions.length, 1);
  assertEquals(context.dependencyDecisions[0].componentName, "Provider");
  assertEquals(
    context.dependencyDecisions[0].filePath,
    "provider-detail.sigil",
  );
  assertEquals(context.dependencyDecisions[0].section.name, "decisions");
  assertEquals(
    context.dependencyDecisions[0].section.units[0].prose,
    "Decision: Preserve the provider rationale.",
  );
  assertEquals(
    context.relatedFilePaths.join(","),
    "consumer.sigil,provider-detail.sigil,provider.sigil",
  );
  assert(!JSON.stringify(context.dependencyDecisions).includes("Hidden state"));
  assert(
    !context.dependencyContracts.some((contract) => contract.name === "Leaf"),
  );
  assertEquals(agentDependencyContextFor(resolved, "Missing"), undefined);
});

Deno.test("projects direct importing-file context from graph edges", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "provider.sigil": `@consumer-a.sigil import { ConsumerA }

component Provider {
  goal {
    Serve importing files.
  }

  interface {
    ProviderApi {
      provide()
    }
  }
}
`,
    "consumer-a.sigil": `@provider.sigil import { Provider }
@provider.sigil import { Provider }

component ConsumerA {
  goal {
    Import provider.
  }

  interface {
    ConsumerAApi {
      consumeA()
    }
  }
}

component ConsumerB {
  goal {
    Share an importing file.
  }

  interface {
    ConsumerBApi {
      consumeB()
    }
  }
}
`,
    "consumer-b.sigil": `@provider.sigil import { Provider }

component ConsumerC {
  goal {
    Import provider separately.
  }

  interface {
    ConsumerCApi {
      consumeC()
    }
  }
}
`,
    "orphan-import.sigil": `@provider.sigil import { Provider }
`,
    "unused.sigil": `component Unused {
  goal {
    Import nothing.
  }

  interface {
    UnusedApi {
      unused()
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const context = agentDependentContextFor(resolved, "Provider");

  assert(context);
  assertEquals(context.selectedComponent.name, "Provider");
  assertEquals(context.selectedComponent.filePath, "provider.sigil");
  assertEquals(
    context.importingFiles.map((item) => item.filePath).join(","),
    "consumer-a.sigil,consumer-b.sigil,orphan-import.sigil",
  );
  assertEquals(context.importingFiles.length, 3);
  assertEquals(
    context.importingFiles[0].contextualContracts.map((item) => item.name)
      .join(","),
    "ConsumerA,ConsumerB",
  );
  assertEquals(context.importingFiles[0].importEdges.length, 1);
  assertEquals(
    context.importingFiles[0].importEdges[0].sourceFile,
    "consumer-a.sigil",
  );
  assertEquals(
    context.importingFiles[0].importEdges[0].targetFile,
    "provider.sigil",
  );
  assertEquals(
    context.importingFiles[0].importEdges[0].componentName,
    "Provider",
  );
  assertEquals(
    context.importingFiles[0].importEdges[0].importPath,
    "provider.sigil",
  );
  assertEquals(context.importingFiles[0].importedComponent.name, "Provider");
  assertEquals(
    context.importingFiles[0].importedComponent.filePath,
    "provider.sigil",
  );
  assertEquals(
    context.importingFiles[1].contextualContracts.map((item) => item.name)
      .join(","),
    "ConsumerC",
  );
  assertEquals(context.importingFiles[1].importEdges.length, 1);
  assertEquals(
    context.importingFiles[1].importEdges[0].sourceFile,
    "consumer-b.sigil",
  );
  assertEquals(context.importingFiles[2].contextualContracts.length, 0);
  assertEquals(context.importingFiles[2].importEdges.length, 1);
  assertEquals(
    context.importingFiles[2].importEdges[0].sourceFile,
    "orphan-import.sigil",
  );
  assert(
    !context.importingFiles.some((item) => item.filePath === "provider.sigil"),
  );
  assert(
    !context.importingFiles.some((item) => item.filePath === "unused.sigil"),
  );
  assertEquals(
    context.relatedFilePaths.join(","),
    "consumer-a.sigil,consumer-b.sigil,orphan-import.sigil",
  );

  const unused = agentDependentContextFor(resolved, "Unused");
  assert(unused);
  assertEquals(unused.importingFiles.length, 0);
  assertEquals(agentDependentContextFor(resolved, "Missing"), undefined);
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::OwnedImplementationLookup interface,cases
Deno.test("projects implementation targets from entrypoint comments", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    OwnedImplementationTargets {
      Own source and test entrypoints.
    }

    OtherTargets {
      Own an agent-facing workflow.
    }
  }

  logic {
    OwnedImplementationTargets {
      Resolve ownership annotations.
    }
  }

  constraints {
    Ownership annotations remain deterministic.
  }
}

expand Ownership {
  cases {
    OwnedImplementationTargets {
      A test entrypoint links to this behavior.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const implementationSources = [
    {
      filePath: "packages/core/src/parser.ts",
      text:
        "// @sigil implements ownership.sigil::Ownership::OwnedImplementationTargets interface,logic\nexport function parseSigilDocument() {}\n",
    },
    {
      filePath: "packages/core/tests/core_test.ts",
      text:
        "// @sigil tests ownership.sigil::Ownership::OwnedImplementationTargets cases\nfunction implementationTargets() {}\n",
    },
    {
      filePath: "packages/core/src/config.ts",
      text:
        "// @sigil uses ownership.sigil::Ownership logic,constraints\nexport function parseSigilConfig() {}\n",
    },
    {
      filePath: "packages/cli/README.md",
      text: "<!-- @sigil uses ownership.sigil::Ownership cases -->\n# CLI\n",
    },
    {
      filePath: "packages/core/tests/ignored.json",
      text:
        '{"annotation":"@sigil tests ownership.sigil::Ownership::OwnedImplementationTargets interface"}\n',
    },
  ];
  const full = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(full);
  assertEquals(full.owningComponent.name, "Ownership");
  assertEquals(full.targets.length, 4);
  assertEquals(full.sectionName, undefined);
  assertEquals(
    full.targets.map((item) => item.artifactKind).join(","),
    "markdown,code,code,test",
  );
  assertEquals(
    full.targets.map((item) => item.sections.join("+")).join(","),
    "cases,logic+constraints,interface+logic,cases",
  );
  assertEquals(
    full.targets.map((item) => `${item.filePath}:${item.symbolIdentity ?? ""}`)
      .join(","),
    "packages/cli/README.md:,packages/core/src/config.ts:parseSigilConfig,packages/core/src/parser.ts:parseSigilDocument,packages/core/tests/core_test.ts:implementationTargets",
  );
  const scoped = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "OwnedImplementationTargets",
  );
  assert(scoped);
  assertEquals(scoped.targets.length, 2);
  const sectionScoped = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "OwnedImplementationTargets",
    "logic",
  );
  assert(sectionScoped);
  assertEquals(sectionScoped.sectionName, "logic");
  assertEquals(sectionScoped.targets.length, 1);
  assertEquals(sectionScoped.targets[0].symbolIdentity, "parseSigilDocument");
  assertEquals(
    ownedImplementationTargetsFor(
      resolved,
      implementationSources,
      { componentName: "Ownership", declarationPath: "other.sigil" },
    ),
    undefined,
  );
  assertEquals(full.targets[0].artifactKind, "markdown");
  assertEquals(full.targets[0].filePath, "packages/cli/README.md");
  assertEquals(full.diagnostics.length, 0);
  assertEquals(full.targets[1].location?.line, 2);

  const diagnostics = ownershipDiagnosticsFor(resolved, [
    ...implementationSources,
    {
      filePath: "packages/core/src/invalid.ts",
      text:
        "// @sigil implements ownership.sigil::Ownership::Missing interface\n" +
        "export function invalid() {}\n",
    },
  ]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "SIGIL_PARSE_STRUCTURE");
  assert(diagnostics[0].message.includes("unknown concept Missing"));
});

/*
 * @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::ImplementationPurposeSelection logic,cases
 * @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::EvidenceUnitConstruction logic
 */
Deno.test("implementation retrieval emits advisory ownership locations without source slices", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "feature.sigil": validComponent("Feature", "run()"),
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, {
      startPath: "feature.sigil",
      currentDirectory: ".",
    }),
  );
  const result = await retrievePurposeContext(
    resolved,
    { kind: "component", componentName: "Feature", path: "feature.sigil" },
    "implementation",
    resolved.glossary,
    {
      workspaceSnapshotIdentity: resolved.workspace.workspaceSnapshotIdentity,
      discoveryState: "complete",
      sources: [{
        filePath: "feature.ts",
        text:
          "// @sigil implements feature.sigil::Feature interface\nexport function run() {}\n",
      }],
      diagnostics: [],
    },
  );
  const ownership = result.evidence.find((item) =>
    item.kind === "ownership-projection"
  );
  assert(ownership);
  assertEquals(
    JSON.stringify(ownership.location),
    JSON.stringify({ line: 2, column: 17 }),
  );
  assertEquals(ownership.range, undefined);
  const ownershipEdge = result.graph.edges.find((item) =>
    item.relation === "owned-implementation"
  );
  assertEquals(ownershipEdge?.originRange?.start.line, 1);
  assert(
    !result.evidence.some((item) =>
      item.path === "feature.ts" && item.text.includes("run() {}")
    ),
  );
  const projection = await projectRetrieval(result);
  assertEquals(
    JSON.stringify(projection.components[0].ownership[0].location),
    JSON.stringify({ line: 2, column: 17 }),
  );
});

// @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::ImplementationPurposeSelection logic,cases
Deno.test("implementation retrieval falls back to annotation range for file-scoped ownership", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "feature.sigil": validComponent("Feature", "run()"),
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, {
      startPath: "feature.sigil",
      currentDirectory: ".",
    }),
  );
  const result = await retrievePurposeContext(
    resolved,
    { kind: "component", componentName: "Feature", path: "feature.sigil" },
    "implementation",
    resolved.glossary,
    {
      workspaceSnapshotIdentity: resolved.workspace.workspaceSnapshotIdentity,
      discoveryState: "complete",
      sources: [{
        filePath: "feature.css",
        text:
          "/* @sigil implements feature.sigil::Feature interface */\n.feature {}\n",
      }],
      diagnostics: [],
    },
  );
  const ownership = result.evidence.find((item) =>
    item.kind === "ownership-projection"
  );
  assert(ownership);
  assertEquals(ownership.location, undefined);
  assertEquals(ownership.range?.start.line, 1);
  const target = result.graph.nodes.find((item) =>
    item.kind === "implementation-target"
  );
  assertEquals(target?.location, undefined);
  assertEquals(target?.range?.start.line, 1);
});

/*
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ComponentFileRegions logic,constraints,cases
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport cases
 */
Deno.test("projects implementation targets from frontend surfaces", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "screen.sigil": `component ScreenSurface {
  goal {
    Own one screen surface.
  }

  interface {
    ScreenContract {
      Expose props, emitted events, and visible regions.
    }
  }

  state {
    ScreenContract {
      Track loading, empty, and error modes.
    }
  }

  logic {
    ScreenContract {
      Transition between presentation modes.
    }
  }

  constraints {
    ScreenContract {
      Keyboard operation remains available in every mode.
    }
  }
}

expand ScreenSurface {
  cases {
    ScreenContract {
      A screen renders its empty mode.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const identity = {
    componentName: "ScreenSurface",
    declarationPath: "screen.sigil",
  };
  const implementationSources = [
    {
      filePath: "src/Bare.vue",
      text: [
        "<script setup>",
        "// @sigil uses screen.sigil::ScreenSurface::ScreenContract logic",
        "import { ref } from 'vue'",
        "</script>",
        "",
      ].join("\n"),
    },
    {
      filePath: "src/Screen.svelte",
      text:
        "<!-- @sigil tests screen.sigil::ScreenSurface::ScreenContract cases -->\n<div></div>\n",
    },
    {
      filePath: "src/pages/index.astro",
      text: [
        "---",
        "// @sigil implements screen.sigil::ScreenSurface::ScreenContract state",
        "function load() {}",
        "---",
        "<div />",
        "",
      ].join("\n"),
    },
    {
      filePath: "web_src/components/Screen.vue",
      text: [
        "<template>",
        "  <!-- @sigil implements screen.sigil::ScreenSurface::ScreenContract interface -->",
        '  <div class="screen" />',
        "</template>",
        "",
        '<script setup lang="ts">',
        "// @sigil implements screen.sigil::ScreenSurface::ScreenContract logic",
        "function toggleMode() {}",
        "</script>",
        "",
        "<style scoped>",
        "/* @sigil implements screen.sigil::ScreenSurface::ScreenContract constraints */",
        ".screen { color: red; }",
        "</style>",
        "",
      ].join("\n"),
    },
    {
      filePath: "web_src/css/screen.css",
      text:
        "/* @sigil implements screen.sigil::ScreenSurface::ScreenContract state */\n" +
        '.screen { background: url(https://example.test/a.png); content: "//"; }\n',
    },
    {
      filePath: "web_src/templates/screen.html",
      text:
        "<!-- @sigil uses screen.sigil::ScreenSurface::ScreenContract interface -->\n<div></div>\n",
    },
  ];

  const projection = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    identity,
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) =>
      `${item.filePath}:${item.symbolIdentity ?? ""}`
    ).join(","),
    [
      "src/Bare.vue:",
      "src/pages/index.astro:load",
      "src/Screen.svelte:",
      "web_src/components/Screen.vue:",
      "web_src/components/Screen.vue:",
      "web_src/components/Screen.vue:toggleMode",
      "web_src/css/screen.css:",
      "web_src/templates/screen.html:",
    ].join(","),
  );

  // A single-file component contributes one target per region: template markup
  // and scoped style bind to the file, while the script block resolves a symbol.
  const singleFileComponent = projection.targets.filter((item) =>
    item.filePath === "web_src/components/Screen.vue"
  );
  assertEquals(singleFileComponent.length, 3);
  assertEquals(
    singleFileComponent.flatMap((item) => item.sections).sort().join(","),
    "constraints,interface,logic",
  );
  assertEquals(
    singleFileComponent.every((item) => item.artifactKind === "code"),
    true,
  );
  assertEquals(
    projection.targets.find((item) => item.filePath === "src/Screen.svelte")
      ?.artifactKind,
    "test",
  );

  // A `<script setup>` block has no exported definition, so its annotation
  // falls back to the file instead of reporting a detached annotation.
  const bare = projection.targets.find((item) =>
    item.filePath === "src/Bare.vue"
  );
  assertEquals(bare?.symbolIdentity, undefined);
  assertEquals(bare?.relation, "uses");

  // Plain CSS has no line-comment form, so one annotation in a block comment is
  // valid rather than a comment-form violation.
  assertEquals(
    ownershipDiagnosticsFor(resolved, implementationSources).length,
    0,
  );

  const scoped = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    identity,
    "ScreenContract",
    "state",
  );
  assert(scoped);
  assertEquals(
    scoped.targets.map((item) => item.filePath).join(","),
    "src/pages/index.astro,web_src/css/screen.css",
  );
});

/*
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ComponentFileRegions logic,constraints,cases
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport cases
 */
Deno.test("projects implementation targets from markup and template sources", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "page.sigil": `component PageSurface {
  goal {
    Own one server-rendered page surface.
  }

  interface {
    PageContract {
      Expose the rendered regions and their actions.
    }
  }

  logic {
    PageContract {
      Wire the rendered regions to their handlers.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const identity = {
    componentName: "PageSurface",
    declarationPath: "page.sigil",
  };
  const annotation =
    "@sigil implements page.sigil::PageSurface::PageContract logic";
  const implementationSources = [
    // An embedded script block in a markup source is a code region, so its
    // annotation resolves to the following definition instead of being dropped.
    {
      filePath: "templates/inline.html",
      text: [
        '<div id="root"></div>',
        "<script>",
        `// ${annotation}`,
        "function inlineHandler() {}",
        "</script>",
        "",
      ].join("\n"),
    },
    // A Go template comment is stripped server-side, so it carries an annotation
    // without emitting it to the rendered page.
    {
      filePath: "templates/screens/list.tmpl",
      text: `{{/* ${annotation} */}}\n<div>{{.Title}}</div>\n`,
    },
    // Trim markers surround the same comment form.
    {
      filePath: "templates/screens/trim.gohtml",
      text: `{{- /* ${annotation} */ -}}\n<div></div>\n`,
    },
    // An HTML comment remains valid in both families.
    {
      filePath: "templates/plain.html",
      text: `<!-- ${annotation} -->\n<div></div>\n`,
    },
  ];

  const projection = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    identity,
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) =>
      `${item.filePath}:${item.symbolIdentity ?? ""}`
    ).join(","),
    [
      "templates/inline.html:inlineHandler",
      "templates/plain.html:",
      "templates/screens/list.tmpl:",
      "templates/screens/trim.gohtml:",
    ].join(","),
  );
  assertEquals(
    ownershipDiagnosticsFor(resolved, implementationSources).length,
    0,
  );

  // Server-rendered template families are supported sources.
  for (const path of ["a.tmpl", "a.gohtml", "a.html", "a.htm"]) {
    assertEquals(isSupportedImplementationSource(path), true);
  }

  // The template comment form belongs to the family that defines it. The same
  // text in any other markup or component source is ordinary content, not
  // ownership metadata: `{{ }}` is interpolation syntax in several of them.
  const templateComment = `{{/* ${annotation} */}}`;
  for (
    const [path, text] of [
      ["a.html", `${templateComment}\n<div></div>\n`],
      ["a.htm", `${templateComment}\n<div></div>\n`],
      ["a.vue", `<template>\n  ${templateComment}\n  <div/>\n</template>\n`],
      ["a.svelte", `${templateComment}\n<div></div>\n`],
      ["a.astro", `${templateComment}\n<div></div>\n`],
    ] as [string, string][]
  ) {
    const foreign = ownedImplementationTargetsFor(
      resolved,
      [{ filePath: path, text }],
      identity,
    );
    assert(foreign);
    assertEquals(foreign.targets.length, 0);
    assertEquals(
      ownershipDiagnosticsFor(resolved, [{ filePath: path, text }]).length,
      0,
    );
  }
});

/*
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationAnnotation interface
 * @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::TargetResolution constraints,cases
 */
Deno.test("resolves expand-path ownership to its parent component", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }
}

component Unrelated {
  goal {
    Remain unrelated to the expand path.
  }

  interface {
    EntryPoint {
      Own another entrypoint.
    }
  }
}
`,
    "ownership-details.sigil": `@ownership.sigil import { Ownership }

expand Ownership {
  logic {
    Resolve ownership through this expand.
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const projection = ownedImplementationTargetsFor(
    resolved,
    [
      {
        filePath: "src/ownership.ts",
        text:
          "// @sigil implements ownership-details.sigil::Ownership logic\nexport function resolveOwnership() {}\n",
      },
      {
        filePath: "src/unrelated.ts",
        text:
          "// @sigil implements ownership-details.sigil::Unrelated interface\nexport function unrelated() {}\n",
      },
    ],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 1);
  assertEquals(projection.targets[0].symbolIdentity, "resolveOwnership");
  assertEquals(projection.targets[0].sections.join(","), "logic");
  assertEquals(projection.diagnostics.length, 1);
  assert(
    projection.diagnostics[0].message.includes(
      "unknown Sigil component Unrelated in ownership-details.sigil",
    ),
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::SectionSelection constraints
Deno.test("diagnoses invalid implementation relations and section selectors", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }

  logic {
    Resolve ownership.
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const invalidAnnotations = [
    "@sigil follows ownership.sigil::Ownership logic",
    "@sigil validates ownership.sigil::Ownership logic",
    "@sigil related ownership.sigil::Ownership logic",
    "@sigil implements ownership.sigil::Ownership",
    "@sigil implements ownership.sigil::Ownership logic,",
    "@sigil implements ownership.sigil::Ownership logic, constraints",
    "@sigil implements ownership.sigil::Ownership logic,logic",
    "@sigil implements ownership.sigil::Ownership goal",
    "@sigil implements ownership.sigil::Ownership decisions",
    "@sigil implements ownership.sigil::Ownership unknown",
    "@sigil implements ownership.sigil::Ownership::EntryPoint logic",
  ];
  const projection = ownedImplementationTargetsFor(
    resolved,
    invalidAnnotations.map((annotation, index) => ({
      filePath: `src/invalid-${index}.ts`,
      text: `// ${annotation}\nexport function invalid${index}() {}\n`,
    })),
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 0);
  assertEquals(projection.diagnostics.length, invalidAnnotations.length);
  assert(
    projection.diagnostics.some((item) =>
      item.message.includes("repeats section selector logic")
    ),
  );
  assert(
    projection.diagnostics.some((item) =>
      item.message.includes("unsupported section selector goal")
    ),
  );
  assert(
    projection.diagnostics.some((item) =>
      item.message.includes(
        "section logic without a matching occurrence on concept EntryPoint",
      )
    ),
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("requires multiline comments for multiple ownership annotations", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const projection = ownedImplementationTargetsFor(
    resolved,
    [{
      filePath: "src/entrypoint.ts",
      text: `/*
 * @sigil implements ownership.sigil::Ownership::EntryPoint interface
 * @sigil tests ownership.sigil::Ownership::EntryPoint interface
 */
export class EntryPoint {}
`,
    }],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 2);
  assertEquals(projection.targets[0].symbolIdentity, "EntryPoint");
  assertEquals(projection.diagnostics.length, 0);
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("diagnoses detached implementation ownership comments", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const projection = ownedImplementationTargetsFor(
    resolved,
    [{
      filePath: "src/detached.ts",
      text:
        "// @sigil implements ownership.sigil::Ownership::EntryPoint interface\nconst value = 1;\n",
    }],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 0);
  assertEquals(projection.diagnostics.length, 1);
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("resolves entrypoints using each language's declaration syntax", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own language entrypoints.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const sources = [
    {
      filePath: "src/worker.py",
      text: `# @sigil implements ${target}\ndef process_job():\n    pass\n`,
    },
    {
      filePath: "src/worker.rs",
      text: `// @sigil implements ${target}\npub struct Worker {}\n`,
    },
    {
      filePath: "src/worker.go",
      text: `// @sigil implements ${target}\nfunc Run() {}\n`,
    },
    {
      filePath: "src/Worker.java",
      text: `// @sigil implements ${target}\npublic void execute() {}\n`,
    },
    {
      filePath: "src/Worker.swift",
      text: `// @sigil implements ${target}\npublic func start() {}\n`,
    },
    {
      filePath: "src/Worker.kt",
      text: `// @sigil implements ${target}\nsuspend fun dispatch() {}\n`,
    },
  ];
  const projection = ownedImplementationTargetsFor(
    resolved,
    sources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "EntryPoint",
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) => item.symbolIdentity).join(","),
    "Run,execute,dispatch,process_job,Worker,start",
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("resolves nested and constrained C++ template entrypoints", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own language entrypoints.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const projection = ownedImplementationTargetsFor(
    resolved,
    [
      {
        filePath: "src/repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <\n  typename T\n>\nclass Repository {};\n`,
      },
      {
        filePath: "src/repository.cpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nT makeRepository() {}\n`,
      },
      {
        filePath: "src/default-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T = std::vector<int>>\nclass DefaultRepository {};\n`,
      },
      {
        filePath: "src/deep-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T = std::map<int, std::vector<std::pair<int, int>>>>\nclass DeepRepository {};\n`,
      },
      {
        filePath: "src/constrained-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nrequires std::default_initializable<T>\nclass ConstrainedRepository {};\n`,
      },
      {
        filePath: "src/sized-repository.hpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nrequires (\n  sizeof(T) > 0\n)\nclass SizedRepository {};\n`,
      },
      {
        filePath: "src/constrained-repository.cpp",
        text:
          `// @sigil implements ${target}\ntemplate <typename T>\nrequires std::copyable<T>\nT makeConstrainedRepository() {}\n`,
      },
    ],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "EntryPoint",
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) => item.symbolIdentity).sort().join(","),
    "ConstrainedRepository,DeepRepository,DefaultRepository,Repository,SizedRepository,makeConstrainedRepository,makeRepository",
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("resolves Go and Node test entrypoints", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own language entrypoints.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const sources = [
    {
      filePath: "src/worker_test.go",
      text: `// @sigil tests ${target}\nfunc TestWorker(t *testing.T) {}\n`,
    },
    {
      filePath: "src/worker.test.ts",
      text: `// @sigil tests ${target}\ntest("runs worker", () => {});\n`,
    },
    {
      filePath: "src/worker.test.cjs",
      text: `// @sigil tests ${target}\nit.skip("skips worker", () => {});\n`,
    },
    {
      filePath: "src/worker.test.mts",
      text:
        `// @sigil tests ${target}\ndescribe.only("worker suite", () => {});\n`,
    },
  ];
  const projection = ownedImplementationTargetsFor(
    resolved,
    sources,
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
    "EntryPoint",
  );
  assert(projection);
  assertEquals(projection.diagnostics.length, 0);
  assertEquals(
    projection.targets.map((item) => item.symbolIdentity).sort().join(","),
    "TestWorker,runs worker,skips worker,worker suite",
  );
});

// @sigil tests packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
Deno.test("ignores annotation examples inside strings and Markdown fences", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "ownership.sigil": `component Ownership {
  goal {
    Own implementation targets.
  }

  interface {
    EntryPoint {
      Own one entrypoint.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = "ownership.sigil::Ownership::EntryPoint interface";
  const projection = ownedImplementationTargetsFor(
    resolved,
    [
      {
        filePath: "src/examples.ts",
        text:
          `const example = \`// @sigil implements ${target}\nfunction fake() {}\`;\n`,
      },
      {
        filePath: "workflow.md",
        text: `\`\`\`md\n<!-- @sigil uses ${target} -->\n\`\`\`\n`,
      },
    ],
    { componentName: "Ownership", declarationPath: "ownership.sigil" },
  );
  assert(projection);
  assertEquals(projection.targets.length, 0);
  assertEquals(projection.diagnostics.length, 0);
});

/*
 * @sigil tests packages/core/src/resolver.sigil::SigilResolver::RelationshipResolution interface,logic,constraints,cases
 * @sigil tests packages/core/src/graph.sigil::SigilGraphBuilder::GraphConstruction interface,logic,constraints
 */
Deno.test("separates relationship resolution from graph construction", async () => {
  const workspace = await loadSigilWorkspace(workspaceFs(), {
    startPath: "examples/slotted/auth.sigil",
  });
  const resolution = resolveSigilRelationships(workspace);
  assert(!("graph" in resolution));
  assert(
    resolution.components.some((component) => component.name === "Auth"),
  );

  const graph = buildSigilGraph(resolution);
  assert(graph.componentNodes.some((node) => node.name === "Auth"));
  assert(
    graph.importedComponentEdges.some((edge) =>
      edge.componentName === "UserProfile"
    ),
  );

  const composed = resolveSigilWorkspace(workspace);
  assertEquals(JSON.stringify(composed.graph), JSON.stringify(graph));
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::RelationshipResolution interface,logic,constraints,cases
Deno.test("duplicate component names bind no imports or expands", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "first.sigil": validComponentSource("Shared"),
    "second.sigil": validComponentSource("Shared"),
    "consumer.sigil": `@first.sigil import { Shared }

component Consumer {
  goal {
    Consume Shared.
  }

  interface {
    ConsumerRun {
      run(Shared)
    }
  }
}

expand Shared {
  logic {
    SharedLogic {
      Must not attach to either duplicate declaration.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  assertEquals(
    resolved.diagnostics.filter((item) =>
      item.code === "SIGIL_DUPLICATE_COMPONENT"
    ).length,
    2,
  );
  assertHasCode(resolved.diagnostics, "SIGIL_UNRESOLVED_IMPORTED_COMPONENT");
  assertHasCode(resolved.diagnostics, "SIGIL_EXPAND_WITHOUT_COMPONENT");
  assertEquals(
    JSON.stringify(
      resolved.components.filter((item) => item.name === "Shared").map(
        (item) => item.expansions.expands.length,
      ),
    ),
    JSON.stringify([0, 0]),
  );
  assert(
    resolved.components.filter((item) => item.name === "Shared").every(
      (item) => item.conceptNamespace.accessibleConcepts.length === 0,
    ),
  );
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::RelationshipResolution interface,logic,constraints,cases
Deno.test("normalizes root imports, rejects outside traversal, and ranges cycle edges", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "provider.sigil": `@cycle.sigil import { Cycle }

component Provider {
  goal {
    Provide Cycle integration.
  }

  interface {
    ProviderRun {
      run(Cycle)
    }
  }
}
`,
    "cycle.sigil": `@provider.sigil import { Provider }

component Cycle {
  goal {
    Exercise Provider cycles.
  }

  interface {
    CycleRun {
      run(Provider)
    }
  }
}
`,
    "consumer.sigil": `@folder/../provider.sigil import { Provider, Provider }
@../outside.sigil import { Outside }

component Consumer {
  goal {
    Consume normalized imports.
  }

  interface {
    ConsumerRun {
      run(Provider)
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const repeated = resolved.imports.find((item) =>
    item.sourceFile === "consumer.sigil" && item.declaration.names.length === 2
  );
  assert(repeated);
  assertEquals(repeated.targetFile, "provider.sigil");
  assertEquals(
    JSON.stringify(repeated.names.map((item) => item.used)),
    JSON.stringify([true, true]),
  );
  assertHasCode(resolved.diagnostics, "SIGIL_UNRESOLVED_IMPORT_PATH");
  const cycles = resolved.diagnostics.filter((item) =>
    item.code === "SIGIL_IMPORT_CYCLE"
  );
  assertEquals(cycles.length, 1);
  assert(cycles[0].range);
  assertEquals(cycles[0].range.start.line, 1);
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
Deno.test("parses flat concept blocks and diagnoses interface authoring gaps", () => {
  const source = `component Account {
  goal {
    Authenticate users.
  }

  interface {
    ungrouped first

    SessionLifecycle {
      open(credentials) returns Session.

      close(sessionId).
    }

    ungrouped second
  }
}

expand Account {
  state {
    Session {
      Active
    }

    free state detail
  }

  logic {
    retry-policy {
      retry transient failures
    }
  }
}
`;
  const parsed = parseSigilDocument("account.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertEquals(
    parsed.diagnostics.filter((item) =>
      item.code === "SIGIL_MISSING_CONCEPT_IDENTIFIER"
    ).length,
    2,
  );
  assertHasCode(parsed.diagnostics, "SIGIL_CONCEPT_IDENTIFIER_STYLE");
  assertNoErrors(parsed.diagnostics);
  const iface = parsed.document.components[0].sections.find((item) =>
    item.name === "interface"
  );
  assert(iface);
  assertEquals(iface.concepts.length, 1);
  assertEquals(iface.concepts[0].identifier, "SessionLifecycle");
  assertEquals(iface.concepts[0].units.length, 2);
  assertEquals(
    iface.concepts[0].units[0].conceptIdentifier,
    "SessionLifecycle",
  );
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
Deno.test("reports each blank-line-separated ungrouped interface region", () => {
  const source = `component Account {
  goal {
    Authenticate users.
  }

  interface {
    first ungrouped region

    second ungrouped region
  }
}
`;
  const parsed = parseSigilDocument("account.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertEquals(
    parsed.diagnostics.filter((item) =>
      item.code === "SIGIL_MISSING_CONCEPT_IDENTIFIER"
    ).length,
    2,
  );
  assertNoErrors(parsed.diagnostics);
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
Deno.test("parses optional grouped and ungrouped decision rationale", () => {
  const source = `component Payments {
  goal {
    Process payments.
  }

  interface {
    PersistenceChoice {
      Stores payment records.
    }
  }
}

expand Payments {
  decisions {
    PersistenceChoice {
      Decision: Use PostgreSQL.

      Context: Concurrent writers require transactional consistency.

      Scope: Governs payment persistence and transaction handling.
    }

    Free-form decision note.
  }
}
`;
  const parsed = parseSigilDocument("payments.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertNoErrors(parsed.diagnostics);
  assertEquals(
    parsed.diagnostics.filter((item) =>
      item.code === "SIGIL_MISSING_CONCEPT_IDENTIFIER"
    ).length,
    0,
  );
  const decisions = parsed.document.expands[0].sections.find((item) =>
    item.name === "decisions"
  );
  assert(decisions);
  assertEquals(decisions.concepts.length, 1);
  assertEquals(decisions.concepts[0].identifier, "PersistenceChoice");
  assertEquals(decisions.concepts[0].units.length, 3);
  assertEquals(decisions.units.at(-1)?.prose, "Free-form decision note.");
  assertEquals(decisions.units.at(-1)?.conceptIdentifier, undefined);
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
Deno.test("rejects empty, nested, and invalid concept blocks", () => {
  const source = `component BrokenConcepts {
  goal {
    Exercise concept diagnostics.
  }

  interface {
    Empty {
    }

    Outer {
      Inner {
        nested content
      }
    }

    Invalid Name {
      content
    }
  }
}
`;
  const parsed = parseSigilDocument("broken-concepts.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertHasCode(parsed.diagnostics, "SIGIL_EMPTY_CONCEPT_BLOCK");
  assertHasCode(parsed.diagnostics, "SIGIL_NESTED_CONCEPT_BLOCK");
  assertHasCode(parsed.diagnostics, "SIGIL_INVALID_CONCEPT_IDENTIFIER");
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::ConceptResolution interface,logic,constraints,cases
Deno.test("resolves collective and contextual concept identities", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "account.sigil": `component Account {
  goal {
    Authenticate users.
  }

  interface {
    Session {
      Represents authenticated access.
    }
  }
}

expand Account {
  state {
    Session {
      Active
    }

    SessionCache {
      Warm
    }
  }
}
`,
    "dashboard.sigil": `@account.sigil import { Account }

component Dashboard {
  goal {
    Show authenticated information.
  }

  interface {
    DashboardView {
      Displays the active Session.
    }
  }
}

expand Dashboard {
  interface {
    Session {
      Exposes the authenticated Session to Dashboard consumers.
    }
  }

  logic {
    Session {
      Refresh the view when Session changes.
    }
  }

  decisions {
    Session {
      Decision: Reuse the authenticated Session identity.

      Context: Dashboard presents Account session state.

      Scope: Governs Dashboard presentation only.
    }
  }
}
`,
    "app.sigil": `@dashboard.sigil import { Dashboard }

component App {
  goal {
    Present the application.
  }

  interface {
    AppView {
      Shows Dashboard while Session is available.
    }
  }
}

expand App {
  interface {
    Session {
      Re-exposes Dashboard Session to application consumers.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  assertNoErrors(resolved.diagnostics);
  const account = conceptNamespaceFor(resolved, "Account");
  const dashboard = conceptNamespaceFor(resolved, "Dashboard");
  const app = conceptNamespaceFor(resolved, "App");
  assert(account && dashboard && app);
  const accountSession = account.publicConcepts.find((item) =>
    item.identifier === "Session"
  );
  const dashboardSession = dashboard.publicConcepts.find((item) =>
    item.identifier === "Session"
  );
  const appSession = app.publicConcepts.find((item) =>
    item.identifier === "Session"
  );
  assert(accountSession && dashboardSession && appSession);
  assertEquals(
    JSON.stringify(dashboardSession.identity),
    JSON.stringify(accountSession.identity),
  );
  assertEquals(
    JSON.stringify(appSession.identity),
    JSON.stringify(accountSession.identity),
  );
  assertEquals(accountSession.occurrences.length, 1);
  assertEquals(dashboardSession.occurrences.length, 2);
  assertEquals(appSession.occurrences.length, 3);
  assert(
    !dashboard.accessibleConcepts.some((item) =>
      item.identifier === "SessionCache"
    ),
  );
  assert(
    !dashboardSession.occurrences.some((item) => item.sectionName === "state"),
  );
  const dashboardAccessibleSession = dashboard.accessibleConcepts.find((item) =>
    item.identifier === "Session"
  );
  const accountAccessibleSession = account.accessibleConcepts.find((item) =>
    item.identifier === "Session"
  );
  assert(dashboardAccessibleSession && accountAccessibleSession);
  assert(
    dashboardAccessibleSession.occurrences.some((item) =>
      item.componentName === "Dashboard" && item.sectionName === "decisions"
    ),
  );
  assert(
    !accountAccessibleSession.occurrences.some((item) =>
      item.componentName === "Dashboard" && item.sectionName === "decisions"
    ),
  );
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::ConceptResolution interface,logic,constraints,cases
Deno.test("keeps component concepts local when an imported name matches", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "account.sigil": `component Account {
  goal {
    Authenticate users.
  }

  interface {
    Session {
      Represents authenticated access.
    }
  }
}
`,
    "dashboard.sigil": `@account.sigil import { Account }

component Dashboard {
  goal {
    Present account information.
  }

  interface {
    Session {
      A local presentation session that adapts Account Session.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const ambiguities = resolved.diagnostics.filter((item) =>
    item.code === "SIGIL_AMBIGUOUS_CONCEPT_IDENTIFIER"
  );
  assertEquals(ambiguities.length, 1);
  assertEquals(ambiguities[0].filePath, "dashboard.sigil");
  const dashboard = conceptNamespaceFor(resolved, "Dashboard");
  assert(dashboard);
  const sessions = dashboard.accessibleConcepts.filter((item) =>
    item.identifier === "Session"
  );
  assertEquals(sessions.length, 2);
  assertEquals(
    JSON.stringify(
      sessions.map((item) => item.identity.componentName).sort(),
    ),
    JSON.stringify(["Account", "Dashboard"]),
  );
  assertEquals(dashboard.references.length, 0);
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::ConceptResolution interface,logic,constraints,cases
Deno.test("resolves contextual whole-word concept references in source order", async () => {
  const consumerSource = `@account.sigil import { Account }

component Consumer {
  goal {
    Session, session, SessionCache, and Session.
  }

  interface {
    View {
      Session works.
    }
  }
}

expand Consumer {
  logic {
    View {
      Session then Session.
    }
  }
}
`;
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        ".sigil/config.json": configSource(),
        "account.sigil": `component Account {
  goal {
    Provide authenticated sessions.
  }

  interface {
    Session {
      Represents authenticated access.
    }
  }
}
`,
        "consumer.sigil": consumerSource,
      }),
      { startPath: "." },
    ),
  );

  assertNoErrors(resolved.diagnostics);
  const account = conceptNamespaceFor(resolved, "Account");
  const consumer = conceptNamespaceFor(resolved, "Consumer");
  assert(account && consumer);
  assertEquals(account.references.length, 0);
  assertEquals(consumer.references.length, 5);
  assertEquals(
    consumer.references.map((reference) => reference.range.start.line).join(
      ",",
    ),
    "5,5,10,18,18",
  );
  assertEquals(
    consumer.references.map((reference) => reference.ownerKind).join(","),
    "component,component,component,expand,expand",
  );
  for (const reference of consumer.references) {
    assertEquals(reference.componentName, "Consumer");
    assertEquals(reference.filePath, "consumer.sigil");
    assertEquals(reference.ownerName, "Consumer");
    assertEquals(reference.conceptIdentity.componentName, "Account");
    assertEquals(reference.conceptIdentity.identifier, "Session");
    const line = consumerSource.split("\n")[reference.range.start.line - 1];
    assertEquals(
      line.slice(
        reference.range.start.column - 1,
        reference.range.end.column - 1,
      ),
      "Session",
    );
  }
});

// @sigil tests packages/core/src/resolver.sigil::SigilResolver::ConceptResolution interface,logic,constraints,cases
Deno.test("rejects case-insensitive concept ambiguity across imports", async () => {
  const provider = (component: string, concept: string) =>
    `component ${component} {\n  goal {\n    Provide ${component}.\n  }\n\n  interface {\n    ${concept} {\n      Public ${concept}.\n    }\n  }\n}\n`;
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "account.sigil": provider("Account", "Session"),
    "chat.sigil": provider("Chat", "session"),
    "consumer.sigil": `@account.sigil import { Account }
@chat.sigil import { Chat }

component Consumer {
  goal {
    Consume both.
  }

  interface {
    Workspace {
      Shows Session and session from both providers.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  assertHasCode(
    resolved.diagnostics,
    "SIGIL_AMBIGUOUS_CONCEPT_IDENTIFIER",
  );
  const consumer = conceptNamespaceFor(resolved, "Consumer");
  assert(consumer);
  assertEquals(consumer.references.length, 0);
});

// @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceLoading interface,logic,cases
Deno.test("filesystem read failures propagate to the host", async () => {
  const base = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "broken.sigil": rootModule,
  });
  const fs: SigilFileSystem = {
    exists: (path) => base.exists(path),
    listFiles: (root) => base.listFiles(root),
    readTextFile: (path) =>
      path.endsWith("broken.sigil")
        ? Promise.reject(new Error("permission denied"))
        : base.readTextFile(path),
  };
  let failed = false;
  try {
    await loadSigilWorkspace(fs, { startPath: "." });
  } catch (error) {
    failed = error instanceof Error && error.message === "permission denied";
  }
  assert(failed);
});

function workspaceFs(): InMemorySigilFileSystem {
  return new InMemorySigilFileSystem({
    ".sigil/config.json": configSource({
      files: { include: ["**/*.sigil"], exclude: ["examples/**"] },
    }),
    "_module.sigil": rootModule,
    "examples/slotted/.sigil/config.json": configSource({
      workspace: { name: "slotted" },
    }),
    "examples/slotted/_module.sigil": slottedModule,
    "examples/slotted/auth.sigil": authSigil,
    "examples/slotted/user-profile.sigil": userProfileSigil,
  });
}

function configSource(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    sigilVersion: SIGIL_VERSION,
    workspace: { name: "test" },
    files: { include: ["**/*.sigil"] },
    tools: {},
  };
  return JSON.stringify({ ...base, ...overrides });
}

function validComponentSource(name: string): string {
  return `component ${name} {
  goal {
    Describe ${name}.
  }

  interface {
    ${name}Run {
      run()
    }
  }
}
`;
}

function glossarySource(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    terms: [
      {
        term: "workspace root",
        definition: "The directory containing .sigil/config.json.",
      },
      {
        term: "workspace",
        definition: "Sources governed by one Sigil configuration.",
      },
      {
        term: "hold",
        definition: "A general temporary claim.",
      },
    ],
    contexts: [
      {
        id: "booking",
        include: ["booking/**/*.sigil"],
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
  };
  return JSON.stringify({ ...base, ...overrides }, null, 2);
}

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertHasCode(
  diagnostics: readonly { readonly code: string }[],
  code: string,
): void {
  assert(
    diagnostics.some((item) => item.code === code),
    `Expected ${code}, got ${diagnostics.map((item) => item.code).join(", ")}`,
  );
}

function assertNoErrors(
  diagnostics: readonly { readonly severity: string; readonly code: string }[],
): void {
  const errors = diagnostics.filter((item) => item.severity === "error");
  assert(
    errors.length === 0,
    `Expected no errors, got ${errors.map((item) => item.code).join(", ")}`,
  );
}

// @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::PurposeRetrievalRequest interface,cases
Deno.test("purpose retrieval is deterministic and stops at direct dependencies", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "leaf.sigil": validComponent("Leaf", "leaf()"),
    "provider.sigil": `@leaf.sigil import { Leaf }\n\n${
      validComponent("Provider", "provide(Leaf)")
    }`,
    "consumer.sigil": `@provider.sigil import { Provider }\n\n${
      validComponent("Consumer", "consume(Provider)")
    }`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, {
      startPath: "consumer.sigil",
      currentDirectory: ".",
    }),
  );
  const request = {
    kind: "component" as const,
    componentName: "Consumer",
    path: "consumer.sigil",
  };
  const first = await retrievePurposeContext(
    resolved,
    request,
    "semantic",
    resolved.glossary,
  );
  const second = await retrievePurposeContext(
    resolved,
    request,
    "semantic",
    resolved.glossary,
  );
  assertEquals(first.fingerprint, second.fingerprint);
  assertEquals(JSON.stringify(first), JSON.stringify(second));
  assert(first.graph.nodes.some((node) => node.componentName === "Provider"));
  assert(!first.graph.nodes.some((node) => node.componentName === "Leaf"));
  assert(first.evidence.some((unit) => unit.kind === "dependency-contract"));
  assert(first.inclusionReasons.length > 0);
  assert(first.fingerprint.startsWith("sha256:"));
});

// @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::EvidenceUnitConstruction logic
Deno.test("purpose retrieval emits one evidence unit per SemanticUnit", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "feature.sigil": `component Feature {
  goal {
    First goal sentence.

    Second goal sentence.
  }

  interface {
    FeatureApi {
      first()

      second()
    }

    ungrouped interface unit
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, {
      startPath: "feature.sigil",
      currentDirectory: ".",
    }),
  );
  const result = await retrievePurposeContext(
    resolved,
    {
      kind: "component",
      componentName: "Feature",
      path: "feature.sigil",
    },
    "semantic",
    resolved.glossary,
  );
  const selected = result.evidence.filter((unit) =>
    unit.kind === "selected-contract"
  );
  assertEquals(
    JSON.stringify(selected.map((unit) => ({
      sectionName: unit.sectionName,
      conceptIdentity: unit.conceptIdentity ?? null,
      text: unit.text,
    }))),
    JSON.stringify([
      {
        sectionName: "goal",
        conceptIdentity: null,
        text: "First goal sentence.",
      },
      {
        sectionName: "goal",
        conceptIdentity: null,
        text: "Second goal sentence.",
      },
      {
        sectionName: "interface",
        conceptIdentity: "FeatureApi",
        text: "first()",
      },
      {
        sectionName: "interface",
        conceptIdentity: "FeatureApi",
        text: "second()",
      },
      {
        sectionName: "interface",
        conceptIdentity: null,
        text: "ungrouped interface unit",
      },
    ]),
  );
  assert(selected.every((unit) => !unit.text.includes("\n")));
});

// @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::RetrievalProjectionDerivation interface
Deno.test("retrieval projection retains one module-context summary", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "features/_module.sigil": validComponent("Workspace", "assemble()"),
    "features/feature.sigil": validComponent("Feature", "run()"),
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, {
      startPath: "features/feature.sigil",
      currentDirectory: ".",
    }),
  );
  const result = await retrievePurposeContext(
    resolved,
    {
      kind: "component",
      componentName: "Feature",
      path: "features/feature.sigil",
    },
    "architecture",
    resolved.glossary,
  );
  const projection = await projectRetrieval(result);
  const moduleContexts = projection.components.filter((component) =>
    component.role === "module-context"
  );
  assertEquals(moduleContexts.length, 1);
  assertEquals(moduleContexts[0].name, "Workspace");
  assert(moduleContexts[0].goal.length > 0);
  assert(projection.glossary.length >= 0);
  assert(
    !projection.components.some((component) =>
      component.role === "selected" && component.name !== "Feature"
    ),
  );
});

// @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::PurposeRetrievalRequest interface,cases
Deno.test("architecture retrieval preserves imported-component cycle edges", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "a.sigil": `@b.sigil import { B }\n\n${validComponent("A", "use(B)")}`,
    "b.sigil": `@a.sigil import { A }\n\n${validComponent("B", "use(A)")}`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, {
      startPath: "a.sigil",
      currentDirectory: ".",
    }),
  );
  const result = await retrievePurposeContext(
    resolved,
    {
      kind: "component",
      componentName: "A",
      path: "a.sigil",
    },
    "architecture",
    resolved.glossary,
  );
  const cycleEdges = result.graph.edges.filter((edge) =>
    edge.relation === "cycle-member"
  );
  assertEquals(cycleEdges.length, 2);
  const describeEdge = (edge: (typeof cycleEdges)[number]) => ({
    source: result.graph.nodes.find((node) =>
      node.identity === edge.sourceIdentity
    ),
    target: result.graph.nodes.find((node) =>
      node.identity === edge.targetIdentity
    ),
    originPath: edge.originPath,
    originLine: edge.originRange?.start.line,
  });
  const aToB = cycleEdges.find((edge) => edge.originPath === "a.sigil");
  const bToA = cycleEdges.find((edge) => edge.originPath === "b.sigil");
  assert(aToB && bToA);
  assertEquals(describeEdge(aToB).source?.kind, "component-declaration");
  assertEquals(describeEdge(aToB).source?.componentName, "A");
  assertEquals(describeEdge(aToB).target?.componentName, "B");
  assertEquals(describeEdge(aToB).originLine, 1);
  assertEquals(describeEdge(bToA).source?.componentName, "B");
  assertEquals(describeEdge(bToA).target?.componentName, "A");
  assertEquals(describeEdge(bToA).originLine, 1);
});

// @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::PurposeRetrievalRequest interface,cases
Deno.test("successful retrieval preserves scoped diagnostics as evidence", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "a.sigil": validComponent("A", "use()"),
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, {
      startPath: "a.sigil",
      currentDirectory: ".",
    }),
  );
  const diagnostic = {
    code: "SIGIL_LINE_TOO_LONG" as const,
    severity: "info" as const,
    message: "selected source diagnostic",
    filePath: "a.sigil",
    range: {
      start: { line: 1, column: 1 },
      end: { line: 1, column: 2 },
    },
  };
  const result = await retrievePurposeContext(
    { ...resolved, diagnostics: [...resolved.diagnostics, diagnostic] },
    {
      kind: "component",
      componentName: "A",
      path: "a.sigil",
    },
    "semantic",
    resolved.glossary,
  );
  assert(
    result.diagnostics.some((item) => item.message === diagnostic.message),
  );
  assert(
    result.evidence.some((item) =>
      item.kind === "diagnostic" && item.text.includes(diagnostic.message)
    ),
  );
});

// @sigil tests packages/core/src/graph.sigil::SigilGraphBuilder::StronglyConnectedGroups logic,constraints,cases
Deno.test("component SCC groups are stable and exact", () => {
  const groups = stronglyConnectedComponentGroups({
    componentNodes: [
      { name: "B", filePath: "b.sigil" },
      { name: "A", filePath: "a.sigil" },
    ],
    fileEdges: [],
    componentExpansionEdges: [],
    importedComponentEdges: [
      {
        sourceFile: "a.sigil",
        targetFile: "b.sigil",
        componentName: "B",
        importPath: "b.sigil",
        sourceComponents: [{ componentName: "A", declarationPath: "a.sigil" }],
        originRange: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 10 },
        },
      },
      {
        sourceFile: "b.sigil",
        targetFile: "a.sigil",
        componentName: "A",
        importPath: "a.sigil",
        sourceComponents: [{ componentName: "B", declarationPath: "b.sigil" }],
        originRange: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 10 },
        },
      },
    ],
  });
  assertEquals(groups.length, 1);
  assertEquals(groups[0].map((item) => item.componentName).join(","), "B,A");
});

function validComponent(name: string, operation: string): string {
  return `component ${name} {\n  goal {\n    Describe ${name}.\n  }\n\n  interface {\n    ${name}Api {\n      ${operation}\n    }\n  }\n}\n`;
}

const rootModule =
  `component Sigil {\n  goal {\n    Preserve rationale.\n  }\n\n  interface {\n    provides contracts\n  }\n}\n`;
const slottedModule =
  `component Slotted {\n  goal {\n    Room booking.\n  }\n\n  interface {\n    accepts bookings\n  }\n}\n`;
const authSigil =
  `@user-profile.sigil import { UserProfile }\n\ncomponent Auth {\n  goal {\n    Authenticate users.\n  }\n\n  interface {\n    signIn(UserProfile)\n  }\n}\n`;
const userProfileSigil =
  `component UserProfile {\n  goal {\n    Store profile information.\n  }\n\n  interface {\n    getProfile()\n  }\n}\n`;

function boundaryWorkspace(): InMemorySigilFileSystem {
  const component = (name: string, body: string) =>
    `component ${name} {
  goal {
    Own the ${name} responsibility.
  }

  interface {
    ${name}Contract {
      Expose the ${name} operations.
    }
  }
${body}}
`;
  return new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "_module.sigil":
      `@pkg-a/_module.sigil import { PkgAIndex }\n@pkg-b/_module.sigil import { PkgBIndex }\n\n` +
      component(
        "RootIndex",
        `
  logic {
    RootIndexContract {
      Assemble PkgAIndex and PkgBIndex into one namespace.
    }
  }
`,
      ),
    "pkg-a/_module.sigil":
      `@pkg-a/src/alpha.sigil import { Alpha }\n@pkg-a/src/beta.sigil import { Beta }\n\n` +
      component(
        "PkgAIndex",
        `
  logic {
    PkgAIndexContract {
      Assemble Alpha and Beta into one namespace.
    }
  }
`,
      ),
    "pkg-a/src/alpha.sigil": component("Alpha", ""),
    // An expand-only file that declares no component of its own.
    "pkg-a/src/alpha-detail.sigil": `@pkg-a/src/alpha.sigil import { Alpha }

expand Alpha {
  logic {
    AlphaContract {
      Apply the alpha algorithm.
    }
  }
}
`,
    "pkg-a/src/beta.sigil": component("Beta", ""),
    "pkg-b/_module.sigil": `@pkg-b/src/gamma.sigil import { Gamma }\n\n` +
      component(
        "PkgBIndex",
        `
  logic {
    PkgBIndexContract {
      Assemble Gamma into one namespace.
    }
  }
`,
      ),
    "pkg-b/src/gamma.sigil": component("Gamma", ""),
  });
}

/*
 * @sigil tests packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::BoundarySelection interface,logic,constraints,cases
 * @sigil tests packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::AffectedScope interface,logic,constraints,cases
 */
Deno.test("resolves a compilation seed into a covering boundary", async () => {
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(boundaryWorkspace(), { startPath: "." }),
  );
  assertEquals(
    resolved.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );

  const describe = (
    seed: Parameters<typeof selectCompilationBoundary>[1],
    exact?: boolean,
  ) => {
    const result = selectCompilationBoundary(resolved, seed, {
      exactTarget: exact,
    });
    const target = result.resolvedTarget;
    const shown = target.kind === "workspace"
      ? "workspace"
      : target.kind === "file"
      ? `file:${target.filePath}`
      : `component:${target.name}`;
    return `${shown}|${result.selection.strategy}`;
  };

  // A leaf component escalates to the module index that covers it.
  assertEquals(
    describe({ kind: "component", componentName: "Alpha" }),
    "file:pkg-a/_module.sigil|nearest-covering-module-index",
  );

  // The exact-target opt-out preserves the selector.
  assertEquals(
    describe({ kind: "component", componentName: "Alpha" }, true),
    "component:Alpha|exact-target",
  );

  // A file seed and a location seed reach the same boundary.
  assertEquals(
    describe({ kind: "file", filePath: "pkg-a/src/alpha.sigil" }),
    "file:pkg-a/_module.sigil|nearest-covering-module-index",
  );
  assertEquals(
    describe({
      kind: "location",
      filePath: "pkg-a/src/alpha.sigil",
      line: 2,
      column: 1,
    }),
    "file:pkg-a/_module.sigil|nearest-covering-module-index",
  );

  // An expand-only file resolves through its parent component.
  assertEquals(
    describe({ kind: "file", filePath: "pkg-a/src/alpha-detail.sigil" }),
    "file:pkg-a/_module.sigil|nearest-covering-module-index",
  );

  // A directory of related contracts resolves to one nested boundary.
  assertEquals(
    describe({ kind: "directory", directoryPath: "pkg-a/src" }),
    "file:pkg-a/_module.sigil|nearest-covering-module-index",
  );
  // A trailing separator does not change the meaning.
  assertEquals(
    describe({ kind: "directory", directoryPath: "pkg-a/src/" }),
    "file:pkg-a/_module.sigil|nearest-covering-module-index",
  );

  // A directory is not a compilable unit, so an exact request over one is
  // rejected rather than silently widened to the whole workspace.
  const exactDirectory = selectCompilationBoundary(resolved, {
    kind: "directory",
    directoryPath: "pkg-a/src",
  }, { exactTarget: true });
  assertEquals(exactDirectory.selection.strategy, "workspace-fallback");
  assertEquals(
    exactDirectory.diagnostics.map((item) => item.code).join(","),
    "SIGIL_BOUNDARY_EXACT_TARGET_UNSUPPORTED",
  );

  // Spanning both packages escalates to the nested-then-root module index.
  assertEquals(
    describe({ kind: "directory", directoryPath: "." }),
    "file:_module.sigil|nearest-covering-module-index",
  );

  // A selector matching no loaded unit falls back to the workspace.
  const missing = selectCompilationBoundary(resolved, {
    kind: "component",
    componentName: "NotDeclared",
  });
  assertEquals(missing.resolvedTarget.kind, "workspace");
  assertEquals(missing.selection.strategy, "workspace-fallback");
  assert(missing.selection.reason);

  // The requested scope stays distinct from the resolved target.
  const escalated = selectCompilationBoundary(resolved, {
    kind: "component",
    componentName: "Alpha",
  });
  assertEquals(escalated.requestedScope.kind, "component");
  assertEquals(escalated.resolvedTarget.kind, "file");
  assertEquals(escalated.selection.uncoveredSemanticUnits.length, 0);
  assert(
    escalated.selection.affectedSemanticUnits.includes(
      "file:pkg-a/src/alpha-detail.sigil",
    ),
  );

  // Selection does not depend on component discovery order.
  const shuffled = {
    ...resolved,
    components: [...resolved.components].reverse(),
  };
  assertEquals(
    JSON.stringify(
      selectCompilationBoundary(shuffled, {
        kind: "component",
        componentName: "Alpha",
      }).resolvedTarget,
    ),
    JSON.stringify(escalated.resolvedTarget),
  );
});

/*
 * @sigil tests packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::BoundaryClosure interface,logic,constraints
 * @sigil tests packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::WorkspaceFallback logic,cases
 */
Deno.test("compilation boundary tolerates cycles and unrelated scopes", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    // A mutual import cycle must terminate rather than loop.
    "left/_module.sigil": `@right/_module.sigil import { RightIndex }

component LeftIndex {
  goal {
    Own the left boundary.
  }

  interface {
    LeftContract {
      Expose left operations.
    }
  }

  logic {
    LeftContract {
      Assemble RightIndex into the left namespace.
    }
  }
}
`,
    "right/_module.sigil": `@left/_module.sigil import { LeftIndex }

component RightIndex {
  goal {
    Own the right boundary.
  }

  interface {
    RightContract {
      Expose right operations.
    }
  }

  logic {
    RightContract {
      Assemble LeftIndex into the right namespace.
    }
  }
}
`,
    // An unrelated contract that no module index imports.
    "solo/detached.sigil": `component Detached {
  goal {
    Own an unimported responsibility.
  }

  interface {
    DetachedContract {
      Expose detached operations.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );

  // Terminates and selects a covering module index.
  const cyclic = selectCompilationBoundary(resolved, {
    kind: "component",
    componentName: "LeftIndex",
  });
  assertEquals(cyclic.resolvedTarget.kind, "file");
  assertEquals(cyclic.selection.uncoveredSemanticUnits.length, 0);

  // A component no module index covers resolves to itself as the smallest
  // complete boundary.
  const detached = selectCompilationBoundary(resolved, {
    kind: "component",
    componentName: "Detached",
  });
  assertEquals(detached.resolvedTarget.kind, "component");
  assertEquals(detached.selection.strategy, "covering-component");

  // Unrelated directories with no common covering boundary fall back.
  const unrelated = selectCompilationBoundary(resolved, {
    kind: "directory",
    directoryPath: ".",
  });
  assertEquals(unrelated.resolvedTarget.kind, "workspace");
  assertEquals(unrelated.selection.strategy, "workspace-fallback");
  assert(unrelated.selection.reason?.includes("covers the complete"));
});

// @sigil tests packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::SeedValidation interface,logic,constraints,cases
Deno.test("compilation boundary rejects unresolvable and invalid seeds", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "a/alpha.sigil": `component Alpha {
  goal {
    Own the alpha responsibility.
  }

  interface {
    AlphaContract {
      Expose the alpha operations.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );

  const codesFor = (seed: Parameters<typeof selectCompilationBoundary>[1]) =>
    selectCompilationBoundary(resolved, seed).diagnostics.map((item) =>
      item.code
    ).join(",");

  // A misspelled name must not silently widen to the whole workspace.
  assertEquals(
    codesFor({ kind: "component", componentName: "Alhpa" }),
    "SIGIL_BOUNDARY_SEED_NOT_FOUND",
  );
  assertEquals(
    codesFor({ kind: "file", filePath: "a/missing.sigil" }),
    "SIGIL_BOUNDARY_SEED_NOT_FOUND",
  );
  assertEquals(
    codesFor({ kind: "directory", directoryPath: "unloaded" }),
    "SIGIL_BOUNDARY_SEED_NOT_FOUND",
  );
  // Escaping, absolute, and empty selectors are invalid rather than unresolved.
  for (
    const path of ["../elsewhere", "/absolute/dir", "", "   ", "a/../../out"]
  ) {
    assertEquals(
      codesFor({ kind: "directory", directoryPath: path }),
      "SIGIL_BOUNDARY_SEED_PATH_INVALID",
    );
  }
  assertEquals(
    codesFor({
      kind: "component",
      componentName: "Alpha",
      declarationPath: "/abs.sigil",
    }),
    "SIGIL_BOUNDARY_SEED_PATH_INVALID",
  );

  // A resolvable seed reports no diagnostics.
  assertEquals(codesFor({ kind: "component", componentName: "Alpha" }), "");
  assertEquals(codesFor({ kind: "file", filePath: "a/alpha.sigil" }), "");
  assertEquals(codesFor({ kind: "workspace" }), "");

  // A rejected seed carries no inferred scope, so a caller cannot mistake the
  // reported workspace target for a real selection.
  const rejected = selectCompilationBoundary(resolved, {
    kind: "component",
    componentName: "Alhpa",
  });
  assertEquals(rejected.selection.affectedSemanticUnits.length, 0);
  assert(rejected.diagnostics[0].message.includes("Alhpa"));

  // A path containing a space survives the semantic-unit representation.
  const spaced = resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({
        ".sigil/config.json": configSource(),
        "my dir/alpha.sigil": `component Alpha {
  goal {
    Own the alpha responsibility.
  }

  interface {
    AlphaContract {
      Expose the alpha operations.
    }
  }
}
`,
      }),
      { startPath: "." },
    ),
  );
  assertEquals(
    selectCompilationBoundary(spaced, {
      kind: "component",
      componentName: "Alpha",
    }).selection.affectedSemanticUnits.join("|"),
    "component:Alpha@my dir/alpha.sigil|file:my dir/alpha.sigil",
  );
});

// @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::EvidenceBudget interface,constraints
Deno.test("a retrieval budget keeps the closest evidence and reports the rest", async () => {
  const component = (name: string, extra = "") =>
    `component ${name} {
  goal {
    Own the ${name} responsibility for this workspace fixture.
  }

  interface {
    ${name}Contract {
      Expose the ${name} operations used by its dependents and collaborators.
    }
  }
${extra}}
`;
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "seed.sigil": `@one.sigil import { One }\n@two.sigil import { Two }\n\n` +
      component(
        "Seed",
        `
  logic {
    SeedContract {
      Assemble One and Two into one namespace for downstream consumers.
    }
  }
`,
      ),
    // Multibyte text in a retrieved section makes encoded bytes exceed UTF-16
    // code units, so a budget measured in the wrong unit overshoots.
    "one.sigil": component("One").replace(
      "Own the One",
      `Own \u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680} the One`,
    ),
    "two.sigil": component("Two").replace(
      "Own the Two",
      `Own \u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680} the Two`,
    ),
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const target = {
    kind: "component" as const,
    componentName: "Seed",
    path: "seed.sigil",
  };

  const full = await retrievePurposeContext(resolved, target, "architecture");
  assertEquals(full.budget, undefined);
  assert(full.evidence.length > 1);

  // A budget of zero still returns the selected contract: a boundary without
  // its own contract would be useless.
  const minimal = await retrievePurposeContext(
    resolved,
    target,
    "architecture",
    resolved.glossary,
    null,
    { maxEvidenceBytes: 0 },
  );
  assert(minimal.evidence.length >= 1);
  assert(
    minimal.evidence.every((item) =>
      item.kind === "selected-contract" || item.kind === "selected-expansion"
    ),
  );
  assert(minimal.evidence.length < full.evidence.length);

  // The withheld evidence is summarized, not itemized, and the summary adds up.
  const budget = minimal.budget!;
  assert(budget);
  assertEquals(budget.maxEvidenceBytes, 0);
  assertEquals(
    budget.withheldCount,
    full.evidence.length - minimal.evidence.length,
  );
  assert(budget.withheldBytes > 0);
  assert(budget.withheldByKind.length > 0);
  assertEquals(
    budget.withheldByKind.reduce((sum, item) => sum + item.count, 0),
    budget.withheldCount,
  );

  // A reason explains an included unit, so no reason may outlive its evidence.
  const kept = new Set(minimal.evidence.map((item) => item.identity));
  assert(minimal.inclusionReasons.length < full.inclusionReasons.length);
  assert(
    minimal.inclusionReasons.every((reason) =>
      kept.has(reason.selectedIdentity)
    ),
  );

  // A generous budget is indistinguishable from no budget.
  const generous = await retrievePurposeContext(
    resolved,
    target,
    "architecture",
    resolved.glossary,
    null,
    { maxEvidenceBytes: 10_000_000 },
  );
  assertEquals(generous.evidence.length, full.evidence.length);
  assertEquals(generous.budget?.withheldCount, 0);

  // The budget is a byte budget, so multibyte text spends its encoded length
  // rather than its UTF-16 code-unit count.
  const encoded = (text: string) => new TextEncoder().encode(text).length;
  const bounded = await retrievePurposeContext(
    resolved,
    target,
    "architecture",
    resolved.glossary,
    null,
    { maxEvidenceBytes: 200 },
  );
  const spent = bounded.evidence.reduce(
    (sum, item) => sum + encoded(item.text),
    0,
  );
  assertEquals(bounded.budget!.includedBytes, spent);
  assertEquals(
    bounded.budget!.withheldBytes,
    full.evidence.filter((item) =>
      !bounded.evidence.some((kept) => kept.identity === item.identity)
    ).reduce((sum, item) => sum + encoded(item.text), 0),
  );

  // Optional selection stops at the first unit that does not fit, so a later
  // smaller unit never displaces closer evidence.
  const ordered = full.evidence.map((item) => item.identity);
  assertEquals(
    bounded.evidence.map((item) => item.identity).join(","),
    ordered.slice(0, bounded.evidence.length).join(","),
  );

  // An unusable budget is rejected rather than silently withholding.
  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let rejected = false;
    try {
      await retrievePurposeContext(
        resolved,
        target,
        "architecture",
        resolved.glossary,
        null,
        { maxEvidenceBytes: invalid },
      );
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
});

/*
 * @sigil tests packages/core/src/parser.sigil::SigilParser::SemanticUnit constraints,cases
 * @sigil tests packages/core/src/context-retrieval.sigil::SigilContextRetrieval::PurposeRetrievalResult interface
 */
Deno.test("declared scope parses and reaches retrieval as public evidence", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "project.sigil": `component Project {
  goal {
    Own the ingest slice of the platform.
  }

  interface {
    Ingest {
      Accept and store incoming recordings.
    }
  }

  scope {
    Billing {
      Excluded: Payment capture belongs to the finance service.
    }

    Reporting {
      Deferred: Usage reporting is not modelled yet.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  assertEquals(
    resolved.diagnostics.filter((item) => item.severity === "error").length,
    0,
  );

  const project = resolved.components.find((item) => item.name === "Project")!;
  const scope = project.declaration.sections.find((item) =>
    item.name === "scope"
  );
  assert(scope, "component should carry a scope section");
  assertEquals(
    scope.units.map((unit) => unit.conceptIdentifier).join(","),
    "Billing,Reporting",
  );

  // Both kinds are distinguishable by their leading label.
  const text = scope.units.map((unit) => unit.prose).join(" ");
  assert(text.includes("Excluded:"));
  assert(text.includes("Deferred:"));

  // Scope is public boundary information, so retrieval must carry it to
  // evaluators; otherwise a declared exclusion cannot suppress a gap finding.
  const retrieval = await retrievePurposeContext(
    resolved,
    { kind: "component", componentName: "Project", path: "project.sigil" },
    "semantic",
  );
  const rendered = JSON.stringify(retrieval);
  assert(
    rendered.includes("Payment capture belongs to the finance service"),
    "retrieval should carry the declared exclusion",
  );
  assert(
    rendered.includes("Usage reporting is not modelled yet"),
    "retrieval should carry the declared deferral",
  );
});

// @sigil tests spec/language.sigil::SigilLanguage::SectionSemantics constraints,cases
Deno.test("scope is a component section and an expand cannot declare one", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "project.sigil": `component Project {
  goal {
    Own the ingest slice.
  }

  interface {
    Ingest {
      Accept incoming recordings.
    }
  }
}

expand Project {
  scope {
    Reporting {
      Deferred: Usage reporting is not modelled yet.
    }
  }

  logic {
    Ingest {
      Validate, then store.
    }
  }
}
`,
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  assertHasCode(resolved.diagnostics, "SIGIL_SECTION_NOT_ALLOWED");
  // The misplaced section reports once rather than derailing the rest of the
  // declaration, so the legitimate expansion still resolves.
  assertEquals(
    resolved.diagnostics.filter((item) => item.severity === "error").length,
    1,
  );
  // The legitimate expansion still resolves; only the misplaced section is lost.
  const expansion = collectedExpansionFor(resolved, "Project");
  assert(expansion, "the expand should still resolve");
  assertEquals(expansion.expands.length, 1);
  assertEquals(
    expansion.expands[0].declaration.sections.map((item) => item.name).join(
      ",",
    ),
    "logic",
  );
});
