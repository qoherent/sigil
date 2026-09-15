import {
  ancestorsFrom,
  dirname,
  glossaryContextForFiles,
  InMemorySigilFileSystem,
  isSupportedImplementationSource,
  loadSigilWorkspace,
  matchesSigilFile,
  normalizePath,
  parseSigilConfig,
  parseSigilDocument,
  parseSigilGlossary,
  resolveSigilWorkspace,
  SIGIL_CORE_VERSION,
  SIGIL_VERSION,
  type SigilFileSystem,
  supportedImplementationSourceGlobPatterns,
} from "../src/mod.ts";
import { isEmbeddedFacet } from "../src/model/source.ts";
Deno.test("separates the core artifact and language contract versions", () => {
  assertEquals(SIGIL_CORE_VERSION, "0.8.0");
  assertEquals(SIGIL_VERSION, "0.8.0");
});

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

Deno.test("parses the canonical Sigil version and preserves Facets", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../examples/promise/promise.sigil", import.meta.url),
  );
  const result = parseSigilDocument("examples/promise/promise.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertNoErrors(result.diagnostics);
  assertEquals(
    result.diagnostics.filter((item) => item.severity === "warning").length,
    0,
  );
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
  assert(goal.units[0].range.start > 0);
});

Deno.test("raw parsing requires a supported explicit Sigil version", () => {
  const parsed = parseSigilDocument("future.sigil", rootModule, {
    sigilVersion: "2.0.0",
  });
  assertEquals(parsed.document.components.length, 0);
  assertHasCode(parsed.diagnostics, "SIGIL_UNSUPPORTED_VERSION");
  assertEquals(parsed.diagnostics[0].range, undefined);
});

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

Deno.test("config reports malformed and unsupported versions", () => {
  assertHasCode(parseSigilConfig("{").diagnostics, "SIGIL_CONFIG_PARSE");
  assertHasCode(
    parseSigilConfig(configSource({ sigilVersion: "2.0.0" })).diagnostics,
    "SIGIL_UNSUPPORTED_VERSION",
  );
});

Deno.test("parses strict reviewed glossary data and rejects collisions", () => {
  const valid = parseSigilGlossary(glossarySource());
  assert(valid.glossary);
  assertEquals(valid.glossary.schemaVersion, 1);
  assertEquals(valid.glossary.terms[0].term, "workspace root");
  assertEquals(valid.glossary.terms[0].agentContext, true);
  assert(valid.glossary.terms[0].declarationRange.start > 0);

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
    resolved.graph.importedTagEdges.some((edge) =>
      edge.tagIdentity.owner.componentName === "UserProfile"
    ),
  );
  assert(resolved.graph.componentNodes.some((node) => node.name === "Auth"));
});

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

Deno.test("explicit root must directly contain config", async () => {
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      "parent/.sigil/config.json": configSource(),
    }),
    { startPath: "parent/child", explicitRoot: "parent/child" },
  );
  assertHasCode(workspace.diagnostics, "SIGIL_CONFIG_NOT_FOUND");
});

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

Deno.test("preserves blank-line-separated ungrouped Interface Facets without warnings", () => {
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
  assertEquals(parsed.diagnostics.length, 0);
  const iface = parsed.document.components[0].sections.find((item) =>
    item.name === "interface"
  );
  assert(iface);
  assertEquals(iface.groups.length, 0);
  assertEquals(iface.units.length, 2);
  assertEquals(iface.units[0].prose, "first ungrouped region");
  assertEquals(iface.units[1].prose, "second ungrouped region");
  assert(iface.units.every((facet) => facet.groupingTag === undefined));
});

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
  assertEquals(parsed.diagnostics.length, 0);
  const decisions = parsed.document.components[0].sections.find((item) =>
    item.name === "decisions"
  );
  assert(decisions);
  assertEquals(decisions.groups.length, 1);
  assertEquals(decisions.groups[0].name, "PersistenceChoice");
  assertEquals(decisions.groups[0].units.length, 3);
  assertEquals(decisions.units.at(-1)?.prose, "Free-form decision note.");
  assertEquals(decisions.units.at(-1)?.groupingTag, undefined);
});

Deno.test("preserves mixed Facets and Embedded Facets in all seven contracts", () => {
  const contract = (name: string) =>
    `  ${name} {
    First contribution.

    Shared {
      Grouped contribution.
    }

    Structured contribution:
    \`\`\`json
    {
      "enabled": true

    }
    \`\`\`

    Last contribution.
  }`;
  const source = `component Mixed {
${["goal", "interface"].map(contract).join("\n\n")}

${
    ["state", "logic", "constraints", "decisions", "cases"].map(contract).join(
      "\n\n",
    )
  }
}
`;
  const parsed = parseSigilDocument("mixed.sigil", source, {
    sigilVersion: SIGIL_VERSION,
  });
  assertEquals(parsed.diagnostics.length, 0);
  const sections = parsed.document.components[0].sections;
  assertEquals(sections.length, 7);
  for (const section of sections) {
    assertEquals(section.units.length, 4);
    assertEquals(section.groups.length, 1);
    assertEquals(section.groups[0].name, "Shared");
    const [first, grouped, embedded, last] = section.units;
    assertEquals(first.prose, "First contribution.");
    assertEquals(first.groupingTag, undefined);
    assertEquals(grouped.prose, "Grouped contribution.");
    assertEquals(grouped.groupingTag, "Shared");
    assertEquals(section.groups[0].units[0], grouped);
    assert(isEmbeddedFacet(embedded));
    assertEquals(embedded.prose, "Structured contribution:");
    assertEquals(embedded.groupingTag, undefined);
    assertEquals(embedded.literalBlocks.length, 1);
    assertEquals(embedded.literalBlocks[0].type, "json");
    assert(embedded.literalBlocks[0].body.includes("\n\n"));
    assert(
      embedded.range.start < embedded.literalBlocks[0].range.start,
    );
    assertEquals(
      embedded.range.end,
      embedded.literalBlocks[0].range.end,
    );
    assertEquals(last.prose, "Last contribution.");
    assertEquals(last.groupingTag, undefined);
    assert(!isEmbeddedFacet(first));
    assert(!isEmbeddedFacet(grouped));
    assert(!isEmbeddedFacet(last));
  }
});

Deno.test("filesystem read failures propagate to the host", async () => {
  const base = new InMemorySigilFileSystem({
    ".sigil/config.json": configSource(),
    "broken.sigil": rootModule,
  });
  const fs: SigilFileSystem = {
    exists: (path) => base.exists(path),
    listFiles: (root) => base.listFiles(root),
    readSourceFile: (path) =>
      path.endsWith("broken.sigil")
        ? Promise.reject(new Error("permission denied"))
        : base.readSourceFile(path),
    readTextFile: (path) => base.readTextFile(path),
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
  `@user-profile.sigil from UserProfile import { Profile }\n\ncomponent Auth {\n  goal {\n    Authenticate users.\n  }\n\n  interface {\n    signIn(Profile)\n  }\n}\n`;
const userProfileSigil =
  `component UserProfile {\n  goal {\n    Store profile information.\n  }\n\n  interface {\n    Get a *Profile*.\n  }\n}\n`;
