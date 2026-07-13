import {
  ancestorsFrom,
  collectedExpansionFor,
  componentContracts,
  dirname,
  InMemorySigilFileSystem,
  loadSigilWorkspace,
  matchesSigilFile,
  normalizePath,
  parseSigilConfig,
  parseSigilDocument,
  resolveSigilWorkspace,
  SIGIL_LANGUAGE_VERSION,
  type SigilFileSystem,
} from "../src/mod.ts";

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

Deno.test("parses language 1.0.0 and preserves semantic lines", async () => {
  const source = await Deno.readTextFile(
    "../../examples/promise/promise.sigil",
  );
  const result = parseSigilDocument("examples/promise/promise.sigil", source, {
    languageVersion: SIGIL_LANGUAGE_VERSION,
  });
  assertEquals(result.diagnostics.length, 0);
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

Deno.test("raw parsing requires a supported explicit language version", () => {
  const parsed = parseSigilDocument("future.sigil", rootModule, {
    languageVersion: "2.0.0",
  });
  assertEquals(parsed.document.components.length, 0);
  assertHasCode(parsed.diagnostics, "SIGIL_UNSUPPORTED_LANGUAGE_VERSION");
});

Deno.test("strict config accepts v1 defaults and rejects project metadata", () => {
  const valid = parseSigilConfig(configSource());
  assert(valid.config);
  assertEquals(valid.config.project.name, "test");
  assert(valid.config.files.exclude.includes("node_modules/**"));

  const invalid = parseSigilConfig(
    configSource({
      project: { name: "test", description: "duplicate metadata" },
    }),
  );
  assertEquals(invalid.config, undefined);
  assertHasCode(invalid.diagnostics, "SIGIL_CONFIG_INVALID");

  const escaping = parseSigilConfig(
    configSource({ files: { include: ["../outside/*.sigil"] } }),
  );
  assertHasCode(escaping.diagnostics, "SIGIL_CONFIG_INVALID");
});

Deno.test("config reports malformed and unsupported versions", () => {
  assertHasCode(parseSigilConfig("{").diagnostics, "SIGIL_CONFIG_PARSE");
  assertHasCode(
    parseSigilConfig(configSource({ languageVersion: "2.0.0" })).diagnostics,
    "SIGIL_UNSUPPORTED_LANGUAGE_VERSION",
  );
  assertHasCode(
    parseSigilConfig(configSource({ configVersion: "2.0.0" })).diagnostics,
    "SIGIL_UNSUPPORTED_CONFIG_VERSION",
  );
});

Deno.test("discovers the nearest excluded workspace config and resolves imports", async () => {
  const fs = workspaceFs();
  const workspace = await loadSigilWorkspace(fs, {
    startPath: "examples/slotted/auth.sigil",
  });
  const resolved = resolveSigilWorkspace(workspace);
  assertEquals(workspace.root, "examples/slotted");
  assertEquals(workspace.configPath, "examples/slotted/sigil.config");
  assertEquals(workspace.config?.project.name, "slotted");
  assertEquals(resolved.diagnostics.length, 0);
  assert(
    resolved.graph.importedComponentEdges.some((edge) =>
      edge.componentName === "UserProfile"
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
      "sigil.config": configSource(),
      "nested/sigil.config": configSource({ project: { name: "nested" } }),
      "nested/item.sigil": rootModule,
    }),
    { startPath: "nested/item.sigil" },
  );
  assertHasCode(nested.diagnostics, "SIGIL_NESTED_CONFIG");
  assertEquals(nested.files.length, 0);

  const filesOnly = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      "sigil.config": configSource({
        files: {
          include: ["**/*.sigil"],
          exclude: ["nested/**/*.sigil"],
        },
      }),
      "nested/sigil.config": configSource({ project: { name: "nested" } }),
      "nested/item.sigil": rootModule,
    }),
    { startPath: "nested/item.sigil" },
  );
  assertHasCode(filesOnly.diagnostics, "SIGIL_NESTED_CONFIG");

  const independent = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      "sigil.config": configSource({
        files: { include: ["**/*.sigil"], exclude: ["nested/**"] },
      }),
      "nested/sigil.config": configSource({ project: { name: "nested" } }),
      "nested/item.sigil": rootModule,
    }),
    { startPath: "nested/item.sigil" },
  );
  assertEquals(independent.root, "nested");
  assertEquals(independent.config?.project.name, "nested");
  assertEquals(independent.diagnostics.length, 0);
  assertEquals(independent.files.length, 1);
});

Deno.test("explicit root must directly contain config", async () => {
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({ "parent/sigil.config": configSource() }),
    { startPath: "parent/child", explicitRoot: "parent/child" },
  );
  assertHasCode(workspace.diagnostics, "SIGIL_CONFIG_NOT_FOUND");
});

Deno.test("nested config below selected root is diagnosed and its subtree skipped", async () => {
  const workspace = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      "sigil.config": configSource(),
      "root.sigil": rootModule,
      "nested/sigil.config": configSource({ project: { name: "nested" } }),
      "nested/hidden.sigil": rootModule.replaceAll("Sigil", "Hidden"),
    }),
    { startPath: ".", explicitRoot: "." },
  );
  assertHasCode(workspace.diagnostics, "SIGIL_NESTED_CONFIG");
  assert(workspace.files.some((file) => file.path === "root.sigil"));
  assert(!workspace.files.some((file) => file.path.includes("hidden")));

  const excluded = await loadSigilWorkspace(
    new InMemorySigilFileSystem({
      "sigil.config": configSource({
        files: { include: ["**/*.sigil"], exclude: ["nested/**"] },
      }),
      "root.sigil": rootModule,
      "nested/sigil.config": configSource({ project: { name: "nested" } }),
      "nested/hidden.sigil": rootModule.replaceAll("Sigil", "Hidden"),
    }),
    { startPath: ".", explicitRoot: "." },
  );
  assertEquals(excluded.diagnostics.length, 0);
  assertEquals(excluded.files.length, 1);
  assertEquals(excluded.files[0].path, "root.sigil");
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
      "sigil.config": configSource({
        files: { include: ["**/*.sigil"], exclude: ["generated/**"] },
      }),
      "root.sigil": rootModule,
      "generated/ignored.sigil": rootModule,
    }),
    { startPath: "." },
  );
  assertEquals(workspace.files.length, 1);
});

Deno.test("returns partial models and stable diagnostics for malformed Sigil", () => {
  const source =
    `component Broken {\n  weird {\n    ignored\n  }\n}\n\nexpand Missing {\n  logic {\n    orphan detail\n  }\n}\n`;
  const parsed = parseSigilDocument("broken.sigil", source, {
    languageVersion: SIGIL_LANGUAGE_VERSION,
  });
  const resolved = resolveSigilWorkspace({
    root: ".",
    configPath: "sigil.config",
    config: parseSigilConfig(configSource()).config,
    files: [{ path: "broken.sigil", document: parsed.document }],
    diagnostics: parsed.diagnostics,
  });
  assertHasCode(resolved.diagnostics, "SIGIL_UNKNOWN_SECTION");
  assertHasCode(resolved.diagnostics, "SIGIL_MISSING_GOAL");
  assertHasCode(resolved.diagnostics, "SIGIL_MISSING_INTERFACE");
  assertHasCode(resolved.diagnostics, "SIGIL_EXPAND_WITHOUT_COMPONENT");
});

Deno.test("collects expansion file paths and exposes projections", async () => {
  const fs = new InMemorySigilFileSystem({
    "sigil.config": configSource(),
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

Deno.test("filesystem read failures propagate to the host", async () => {
  const base = new InMemorySigilFileSystem({
    "sigil.config": configSource(),
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
    "sigil.config": configSource({
      files: { include: ["**/*.sigil"], exclude: ["examples/**"] },
    }),
    "#module.sigil": rootModule,
    "examples/slotted/sigil.config": configSource({
      project: { name: "slotted" },
    }),
    "examples/slotted/#module.sigil": slottedModule,
    "examples/slotted/auth.sigil": authSigil,
    "examples/slotted/user-profile.sigil": userProfileSigil,
  });
}

function configSource(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    configVersion: "1.0.0",
    languageVersion: "1.0.0",
    project: { name: "test" },
    files: { include: ["**/*.sigil"] },
    tools: {},
  };
  return JSON.stringify({ ...base, ...overrides });
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

const rootModule =
  `component Sigil {\n  goal {\n    Preserve rationale.\n  }\n\n  interface {\n    provides contracts\n  }\n}\n`;
const slottedModule =
  `component Slotted {\n  goal {\n    Room booking.\n  }\n\n  interface {\n    accepts bookings\n  }\n}\n`;
const authSigil =
  `@user-profile.sigil import { UserProfile }\n\ncomponent Auth {\n  goal {\n    Authenticate users.\n  }\n\n  interface {\n    signIn()\n  }\n}\n`;
const userProfileSigil =
  `component UserProfile {\n  goal {\n    Store profile information.\n  }\n\n  interface {\n    getProfile()\n  }\n}\n`;
