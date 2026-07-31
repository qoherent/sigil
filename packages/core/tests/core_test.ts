import {
  agentDependencyContextFor,
  agentDependentContextFor,
  ancestorsFrom,
  collectedExpansionFor,
  componentContracts,
  conceptNamespaceFor,
  dirname,
  glossaryContextForFiles,
  InMemorySigilFileSystem,
  isSupportedImplementationSource,
  loadSigilWorkspace,
  matchesSigilFile,
  normalizePath,
  ownedImplementationTargetsFor,
  parseSigilConfig,
  parseSigilDocument,
  parseSigilGlossary,
  resolveSigilWorkspace,
  SIGIL_CORE_VERSION,
  SIGIL_VERSION,
  type SigilFileSystem,
  supportedImplementationSourceGlobPatterns,
} from "../src/mod.ts";
import { buildSigilGraph } from "../src/graph.ts";
import { resolveSigilRelationships } from "../src/resolver.ts";

/*
 * @sigil tests packages/core/#module.sigil::SigilCore::PackageVersionOwnership constraints
 * @sigil tests packages/core/src/model.sigil::SigilSemanticModel::SupportedLanguageVersion interface,constraints
 */
Deno.test("separates the core artifact and language contract versions", () => {
  assertEquals(SIGIL_CORE_VERSION, "0.7.0");
  assertEquals(SIGIL_VERSION, "0.5.0");
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

// @sigil tests packages/core/#module.sigil::SigilCore::DeterministicCore constraints,cases
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

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
Deno.test("parses the canonical Sigil version and preserves semantic lines", async () => {
  const source = await Deno.readTextFile(
    "../../examples/promise/promise.sigil",
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
    goal.lines[0].text,
    "Represent a value that may resolve now, later, or fail.",
  );
  assertEquals(goal.lines[0].ownerName, "Promise");
  assertEquals(goal.lines[0].filePath, "examples/promise/promise.sigil");
  assert(goal.lines[0].range.start.line > 0);
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
Deno.test("raw parsing requires a supported explicit Sigil version", () => {
  const parsed = parseSigilDocument("future.sigil", rootModule, {
    sigilVersion: "2.0.0",
  });
  assertEquals(parsed.document.components.length, 0);
  assertHasCode(parsed.diagnostics, "SIGIL_UNSUPPORTED_VERSION");
});

// @sigil tests spec/language.sigil::SigilModuleIndex::ModuleIndexContents interface,constraints,cases
Deno.test("requires every module index to declare a local component", () => {
  const parsed = parseSigilDocument(
    "internal/#module.sigil",
    "@internal/contract.sigil import { Internal }\n",
    { sigilVersion: SIGIL_VERSION },
  );
  assertEquals(parsed.document.imports.length, 1);
  assertEquals(parsed.document.components.length, 0);
  assertHasCode(parsed.diagnostics, "SIGIL_MODULE_WITHOUT_COMPONENT");

  const valid = parseSigilDocument(
    "internal/#module.sigil",
    `@internal/contract.sigil import { Internal }\n\n${rootModule}`,
    { sigilVersion: SIGIL_VERSION },
  );
  assertNoErrors(valid.diagnostics);
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
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolution interface,logic,constraints,cases
 * @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::TermRecognition interface,logic,constraints,cases
 */
Deno.test("loads and projects longest glossary terms in bounded contexts", async () => {
  const source = `component Booking {
  goal {
    Explain workspace root and workspace while a hold is active.

    Ignore \`workspace root\` and https://example.test/workspace.

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

// @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolution interface,logic,constraints,cases
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
      "member/#module.sigil": rootModule,
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

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
Deno.test("returns partial models and stable diagnostics for malformed Sigil", () => {
  const source =
    `component Broken {\n  weird {\n    ignored\n  }\n}\n\nexpand Missing {\n  logic {\n    orphan detail\n  }\n}\n`;
  const parsed = parseSigilDocument("broken.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  const resolved = resolveSigilWorkspace({
    root: ".",
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
    "#module.sigil": rootModule,
    "internal/#module.sigil":
      `@internal/contract.sigil import { Internal }\n\n${
        rootModule.replaceAll("Sigil", "InternalModule")
      }`,
    "internal/contract.sigil": rootModule.replaceAll("Sigil", "Internal"),
    "internal/private.sigil": rootModule.replaceAll("Sigil", "Private"),
    "consumer.sigil":
      "@internal import { Internal }\n\ncomponent Consumer {\n  goal {\n    Consume.\n  }\n\n  interface {\n    run()\n  }\n}\n",
    "explicit-consumer.sigil":
      "@internal/private.sigil import { Private }\n\ncomponent ExplicitConsumer {\n  goal {\n    Consume a public component by file.\n  }\n\n  interface {\n    run()\n  }\n}\n",
    "facade/#module.sigil": `@internal import { Internal }\n\n${
      rootModule.replaceAll("Sigil", "FacadeModule")
    }`,
    "facade-consumer.sigil":
      "@facade import { Internal }\n\ncomponent FacadeConsumer {\n  goal {\n    Consume an explicitly chained index.\n  }\n\n  interface {\n    run()\n  }\n}\n",
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
      edge.from === "consumer.sigil" && edge.to === "internal/#module.sigil"
    ),
  );
});

// @sigil tests spec/language.sigil::SigilModuleIndex::ModuleIndexContents interface,constraints,cases
Deno.test("does not add unnamed component dependencies to a module index", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "internal/#module.sigil":
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

// @sigil tests packages/core/src/projections.sigil::SigilProjections::ExpansionProjection interface,logic,cases
Deno.test("collects expansion file paths and exposes projections", async () => {
  const fs = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "contract.sigil": rootModule,
    "detail-a.sigil": "expand Sigil {\n  logic {\n    A.\n  }\n}\n",
    "detail-b.sigil": "expand Sigil {\n  cases {\n    B.\n  }\n}\n",
  });
  const resolved = resolveSigilWorkspace(
    await loadSigilWorkspace(fs, { startPath: "." }),
  );
  const expansion = collectedExpansionFor(resolved, "Sigil");
  assert(expansion);
  assertEquals(expansion.expands.length, 2);
  assertEquals(
    expansion.expands.map((item) => item.filePath).sort().join(","),
    "detail-a.sigil,detail-b.sigil",
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
    "leaf-detail.sigil": `expand Leaf {
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
    "provider-detail.sigil": `expand Provider {
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
    context.dependencyDecisions[0].section.lines[0].text,
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
    "Ownership",
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
    "Ownership",
    "OwnedImplementationTargets",
  );
  assert(scoped);
  assertEquals(scoped.targets.length, 2);
  const sectionScoped = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    "Ownership",
    "OwnedImplementationTargets",
    "logic",
  );
  assert(sectionScoped);
  assertEquals(sectionScoped.sectionName, "logic");
  assertEquals(sectionScoped.targets.length, 1);
  assertEquals(sectionScoped.targets[0].symbolIdentity, "parseSigilDocument");
  assertEquals(full.targets[0].artifactKind, "markdown");
  assertEquals(full.targets[0].filePath, "packages/cli/README.md");
  assertEquals(full.diagnostics.length, 0);
  assertEquals(full.targets[1].range?.start.line, 2);
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
    "Ownership",
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
    "Ownership",
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
    "Ownership",
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
    "Ownership",
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
    "Ownership",
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
    "Ownership",
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
    "Ownership",
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

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
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
  assertEquals(iface.concepts[0].lines.length, 2);
  assertEquals(
    iface.concepts[0].lines[0].conceptIdentifier,
    "SessionLifecycle",
  );
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
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

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
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
  assertEquals(decisions.concepts[0].lines.length, 3);
  assertEquals(decisions.lines.at(-1)?.text, "Free-form decision note.");
  assertEquals(decisions.lines.at(-1)?.conceptIdentifier, undefined);
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocument interface,logic,constraints,cases
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
    Session {
      Displays the active session.
    }
  }
}

expand Dashboard {
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
    Session {
      Shows Dashboard while Session is available.
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
    "#module.sigil": rootModule,
    "examples/slotted/.sigil/config.json": configSource({
      workspace: { name: "slotted" },
    }),
    "examples/slotted/#module.sigil": slottedModule,
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

const rootModule =
  `component Sigil {\n  goal {\n    Preserve rationale.\n  }\n\n  interface {\n    provides contracts\n  }\n}\n`;
const slottedModule =
  `component Slotted {\n  goal {\n    Room booking.\n  }\n\n  interface {\n    accepts bookings\n  }\n}\n`;
const authSigil =
  `@user-profile.sigil import { UserProfile }\n\ncomponent Auth {\n  goal {\n    Authenticate users.\n  }\n\n  interface {\n    signIn()\n  }\n}\n`;
const userProfileSigil =
  `component UserProfile {\n  goal {\n    Store profile information.\n  }\n\n  interface {\n    getProfile()\n  }\n}\n`;
