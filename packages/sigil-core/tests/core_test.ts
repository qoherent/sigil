import {
  collectedExpansionFor,
  componentContracts,
  InMemorySigilFileSystem,
  loadSigilWorkspace,
  parseSigilDocument,
  resolveSigilWorkspace,
} from "../src/mod.ts";

Deno.test("parses the Promise example and preserves semantic lines", async () => {
  const source = await Deno.readTextFile("../../examples/promise/promise.sigil");
  const result = parseSigilDocument("examples/promise/promise.sigil", source);

  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.document.components[0].name, "Promise");
  assertEquals(result.document.expands[0].name, "Promise");

  const goal = result.document.components[0].sections.find((section) => section.name === "goal");
  assert(goal);
  assertEquals(goal.lines[0].ownerKind, "component");
  assertEquals(goal.lines[0].ownerName, "Promise");
  assertEquals(goal.lines[0].sectionName, "goal");
  assertEquals(goal.lines[0].filePath, "examples/promise/promise.sigil");
  assert(goal.lines[0].range.start.line > 0);
});

Deno.test("resolves Slotted imports from the topmost workspace root", async () => {
  const fs = new InMemorySigilFileSystem({
    "#module.sigil": rootModule,
    "examples/slotted/#module.sigil": slottedModule,
    "examples/slotted/auth.sigil": authSigil,
    "examples/slotted/user-profile.sigil": userProfileSigil,
  });

  const workspace = await loadSigilWorkspace(fs, {
    startPath: "examples/slotted/auth.sigil",
  });
  const resolved = resolveSigilWorkspace(workspace);

  assertEquals(workspace.root, ".");
  assertEquals(workspace.rootModulePath, "#module.sigil");
  assertEquals(resolved.diagnostics.length, 0);
  assert(resolved.imports.some((item) => item.targetFile === "examples/slotted/user-profile.sigil"));
  assert(resolved.components.some((component) => component.name === "Auth"));
  assert(resolved.graph.fileEdges.some((edge) =>
    edge.from === "examples/slotted/auth.sigil" && edge.to === "examples/slotted/user-profile.sigil"
  ));
});

Deno.test("treats nested #module.sigil as module summary, not workspace root", async () => {
  const fs = new InMemorySigilFileSystem({
    "#module.sigil": rootModule,
    "examples/slotted/#module.sigil": slottedModule,
  });

  const workspace = await loadSigilWorkspace(fs, {
    startPath: "examples/slotted/#module.sigil",
  });

  assertEquals(workspace.root, ".");
  assertEquals(workspace.rootModulePath, "#module.sigil");
  assert(workspace.files.some((file) => file.path === "examples/slotted/#module.sigil"));
});

Deno.test("returns partial model plus diagnostics for malformed files", () => {
  const source = `component Broken {
  weird {
    ignored
  }
}

expand Missing {
  logic {
    orphan detail
  }
}
`;

  const parsed = parseSigilDocument("broken.sigil", source);
  const resolved = resolveSigilWorkspace({
    root: ".",
    rootInferred: false,
    rootModulePath: undefined,
    files: [{ path: "broken.sigil", document: parsed.document }],
    diagnostics: parsed.diagnostics,
  });

  assert(parsed.document.components.some((component) => component.name === "Broken"));
  assertHasCode(resolved.diagnostics, "SIGIL_UNKNOWN_SECTION");
  assertHasCode(resolved.diagnostics, "SIGIL_MISSING_GOAL");
  assertHasCode(resolved.diagnostics, "SIGIL_MISSING_INTERFACE");
  assertHasCode(resolved.diagnostics, "SIGIL_EXPAND_WITHOUT_COMPONENT");
});

Deno.test("emits stable diagnostics for unresolved imports and inferred roots", async () => {
  const fs = new InMemorySigilFileSystem({
    "feature/auth.sigil": `@missing/user.sigil import { User }

component Auth {
  goal {
    Authenticate users.
  }

  interface {
    signIn()
  }
}
`,
  });

  const workspace = await loadSigilWorkspace(fs, {
    startPath: "feature/auth.sigil",
    currentDirectory: "feature",
  });
  const resolved = resolveSigilWorkspace(workspace);

  assertEquals(workspace.root, "feature");
  assertHasCode(resolved.diagnostics, "SIGIL_INFERRED_WORKSPACE_ROOT");
  assertHasCode(resolved.diagnostics, "SIGIL_UNRESOLVED_IMPORT_PATH");
});

Deno.test("detects duplicate components and import cycles", async () => {
  const fs = new InMemorySigilFileSystem({
    "#module.sigil": rootModule,
    "a.sigil": `@b.sigil import { B }

component A {
  goal {
    A.
  }

  interface {
    a()
  }
}
`,
    "b.sigil": `@a.sigil import { A }

component B {
  goal {
    B.
  }

  interface {
    b()
  }
}

component A {
  goal {
    Duplicate A.
  }

  interface {
    duplicate()
  }
}
`,
  });

  const workspace = await loadSigilWorkspace(fs, { startPath: "a.sigil" });
  const resolved = resolveSigilWorkspace(workspace);

  assertHasCode(resolved.diagnostics, "SIGIL_DUPLICATE_COMPONENT");
  assertHasCode(resolved.diagnostics, "SIGIL_IMPORT_CYCLE");
});

Deno.test("exposes primitive projections over resolved models", async () => {
  const fs = new InMemorySigilFileSystem({
    "#module.sigil": rootModule,
    "examples/slotted/#module.sigil": slottedModule,
  });

  const workspace = await loadSigilWorkspace(fs, { startPath: "examples/slotted/#module.sigil" });
  const resolved = resolveSigilWorkspace(workspace);

  const contracts = componentContracts(resolved);
  assert(contracts.some((contract) => contract.name === "Slotted" && contract.goalLines.length > 0));

  const expansion = collectedExpansionFor(resolved, "Slotted");
  assert(expansion);
  assertEquals(expansion.expands.length, 1);
});

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertHasCode(
  diagnostics: readonly { readonly code: string }[],
  code: string,
): void {
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === code),
    `Expected diagnostic code ${code}, got ${diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`,
  );
}

const rootModule = `component Sigil {
  goal {
    Preserve software rationale.
  }

  interface {
    provides packages
  }
}
`;

const slottedModule = `component Slotted {
  goal {
    A room booking platform.
  }

  interface {
    accepts booking requests
  }
}

expand Slotted {
  logic {
    Booking checks conflicts.
  }
}
`;

const authSigil = `@examples/slotted/user-profile.sigil import { UserProfile }

component Auth {
  goal {
    Manages identity and access.
  }

  interface {
    signIn(credentials) returns JWT
    uses UserProfile for display profile information
  }
}
`;

const userProfileSigil = `component UserProfile {
  goal {
    Stores editable profile information.
  }

  interface {
    getUserProfile(userId) returns UserProfile
  }
}
`;
