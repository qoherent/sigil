import { runCli } from "../src/main.ts";
import {
  EXIT_DIAGNOSTICS,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
} from "../src/exit.ts";

Deno.test("parse emits JSON for the Promise example", async () => {
  const result = await runCli([
    "parse",
    "../../examples/promise/promise.sigil",
  ]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.command, "parse");
  assertEquals(json.document.components[0].name, "Promise");
});

Deno.test("check returns 0 for the repository workspace", async () => {
  const result = await runCli(["check", "../..", "--format", "json"]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.command, "check");
  assertEquals(json.workspaceRoot, "../..");
  assertEquals(json.diagnosticCounts.error, 0);
});

Deno.test("check returns 1 for error diagnostics", async () => {
  const workspaceRoot = await Deno.makeTempDir({
    prefix: "sigil-cli-bad-workspace-",
  });
  try {
    await Deno.writeTextFile(
      `${workspaceRoot}/#module.sigil`,
      [
        "component Temp {",
        "  goal {",
        "    Valid root marker for the temporary workspace.",
        "  }",
        "",
        "  interface {",
        "    Valid interface so only broken.sigil contributes errors.",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      `${workspaceRoot}/broken.sigil`,
      [
        "component Broken {",
        "  mystery {",
        "    This section should produce an unknown-section diagnostic.",
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCli(["check", workspaceRoot, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    const json = parseJson(result.stdout);
    assertHasCode(json.diagnostics, "SIGIL_UNKNOWN_SECTION");
    assertHasCode(json.diagnostics, "SIGIL_MISSING_GOAL");
    assertHasCode(json.diagnostics, "SIGIL_MISSING_INTERFACE");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("check returns 0 for warnings alone", async () => {
  const result = await runCli([
    "check",
    "tests/fixtures/valid.sigil",
    "--format",
    "json",
  ]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertHasCode(json.diagnostics, "SIGIL_INFERRED_WORKSPACE_ROOT");
});

Deno.test("graph emits file and expansion edges", async () => {
  const result = await runCli(["graph", "../..", "--format", "json"]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assert(
    json.graph.fileEdges.some((edge: { to: string }) =>
      edge.to.endsWith("examples/slotted/user-profile.sigil")
    ),
  );
  assert(
    json.graph.componentExpansionEdges.some((edge: { componentName: string }) =>
      edge.componentName === "Slotted"
    ),
  );
});

Deno.test("context emits deterministic data for component Auth", async () => {
  const result = await runCli([
    "context",
    "../../examples/slotted/auth.sigil",
    "--component",
    "Auth",
    "--format",
    "json",
  ]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.command, "context");
  assertEquals(json.selectedComponents[0].name, "Auth");
  assert(
    json.relatedFilePaths.some((path: string) =>
      path.endsWith("examples/slotted/auth.sigil")
    ),
  );
});

Deno.test("render emits Markdown for the Slotted example", async () => {
  const result = await runCli([
    "render",
    "../../examples/slotted/#module.sigil",
  ]);
  assertEquals(result.exitCode, EXIT_OK);
  assert(result.stdout.includes("# Sigil Workspace"));
  assert(result.stdout.includes("## Slotted"));
});

Deno.test("invalid arguments return usage exit code", async () => {
  const result = await runCli([
    "context",
    "--component",
    "Auth",
    "--file",
    "auth.sigil",
  ]);
  assertEquals(result.exitCode, EXIT_USAGE);
  assert(result.stderr.includes("context accepts only one"));
});

Deno.test("runtime filesystem failures return runtime exit code", async () => {
  const result = await runCli(["parse", "does-not-exist.sigil"]);
  assertEquals(result.exitCode, EXIT_RUNTIME);
  assert(result.stderr.length > 0);
});

function parseJson(source: string): any {
  return JSON.parse(source);
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
    diagnostics.some((diagnostic) => diagnostic.code === code),
    `Expected diagnostic code ${code}, got ${
      diagnostics.map((diagnostic) => diagnostic.code).join(", ")
    }`,
  );
}
