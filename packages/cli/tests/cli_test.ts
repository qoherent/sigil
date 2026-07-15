import { SIGIL_VERSION } from "@qoherent/sigil-core";
import { resolveInstalledSkillsDirectory } from "../src/installer.ts";
import { runCli } from "../src/main.ts";
import {
  EXIT_DIAGNOSTICS,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
} from "../src/exit.ts";

Deno.test("parse discovers config and emits workspace metadata", async () => {
  const result = await runCli([
    "parse",
    "../../examples/promise/promise.sigil",
    "--format",
    "json",
  ]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.command, "parse");
  assertEquals(json.sigilVersion, SIGIL_VERSION);
  assertEquals(json.workspaceName, "promise");
  assertEquals(json.document.components[0].name, "Promise");
});

Deno.test("check resolves repository config from a nested working directory", async () => {
  const result = await runCli(["check", "--format", "json"]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.workspaceRoot, "../..");
  assertEquals(json.configPath, "../../.sigil/config.json");
  assertEquals(json.diagnosticCounts.error, 0);
});

Deno.test("init creates defaults, accepts a custom name, and refuses overwrite", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-init-" });
  try {
    const first = await runCli([
      "init",
      root,
      "--name",
      "example",
      "--format",
      "json",
    ]);
    assertEquals(first.exitCode, EXIT_OK);
    const output = parseJson(first.stdout);
    assertEquals(output.sigilVersion, SIGIL_VERSION);
    assertEquals(output.workspaceName, "example");
    const config = JSON.parse(
      await Deno.readTextFile(`${root}/.sigil/config.json`),
    );
    assertEquals(config.workspace.name, "example");
    assertEquals(config.workspace.members.length, 0);
    assertEquals(config.sigilVersion, SIGIL_VERSION);
    assert(config.files.include.includes("**/*.sigil"));

    const second = await runCli(["init", root, "--format", "json"]);
    assertEquals(second.exitCode, EXIT_DIAGNOSTICS);
    assertHasCode(parseJson(second.stdout).diagnostics, "SIGIL_CONFIG_EXISTS");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("init defaults workspace name to directory basename", async () => {
  const parent = await Deno.makeTempDir({ prefix: "sigil-parent-" });
  const root = `${parent}/sample-project`;
  await Deno.mkdir(root);
  try {
    assertEquals((await runCli(["init", root])).exitCode, EXIT_OK);
    const config = JSON.parse(
      await Deno.readTextFile(`${root}/.sigil/config.json`),
    );
    assertEquals(config.workspace.name, "sample-project");
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("version reports tool and resolved contract versions", async () => {
  const result = await runCli([
    "version",
    "../..",
    "--format",
    "json",
    "--pretty",
  ]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.cliVersion, "0.1.0");
  assertEquals(json.coreVersion, "0.1.0");
  assertEquals(json.sigilVersion, SIGIL_VERSION);
});

Deno.test("configuration failure returns document null and exit 1", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-bad-config-" });
  try {
    await Deno.mkdir(`${root}/.sigil`);
    await Deno.writeTextFile(`${root}/.sigil/config.json`, "{");
    await Deno.writeTextFile(`${root}/item.sigil`, validSigil("Item"));
    const result = await runCli([
      "parse",
      `${root}/item.sigil`,
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    const json = parseJson(result.stdout);
    assertEquals(json.document, null);
    assertHasCode(json.diagnostics, "SIGIL_CONFIG_PARSE");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("check returns 1 for Sigil diagnostics and 0 for a valid empty workspace", async () => {
  const root = await makeWorkspace("diagnostics");
  try {
    let result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_OK);
    await Deno.writeTextFile(
      `${root}/broken.sigil`,
      "component Broken {\n  mystery {\n    bad\n  }\n}\n",
    );
    result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    assertHasCode(
      parseJson(result.stdout).diagnostics,
      "SIGIL_UNKNOWN_SECTION",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("check rejects RootSigil in an undeclared internal directory", async () => {
  const root = await makeWorkspace("invalid-root-sigil");
  try {
    await Deno.mkdir(`${root}/internal`);
    await Deno.writeTextFile(
      `${root}/internal/#module.sigil`,
      validSigil("Internal"),
    );
    await Deno.writeTextFile(
      `${root}/consumer.sigil`,
      `@internal import { Internal }\n\n${validSigil("Consumer")}`,
    );
    const result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    const diagnostics = parseJson(result.stdout).diagnostics;
    assertHasCode(diagnostics, "SIGIL_INVALID_ROOT_MODULE");
    assertHasCode(diagnostics, "SIGIL_INVALID_DIRECTORY_IMPORT");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("graph includes component nodes and imported-component edges", async () => {
  const repository = await runCli(["graph", "../..", "--format", "json"]);
  assertEquals(repository.exitCode, EXIT_OK);
  assert(
    !parseJson(repository.stdout).graph.componentNodes.some(
      (node: { name: string }) =>
        node.name === "Promise" || node.name === "Slotted",
    ),
  );

  const result = await runCli([
    "graph",
    "../../examples/slotted",
    "--format",
    "json",
  ]);
  assertEquals(result.exitCode, EXIT_OK);
  const output = parseJson(result.stdout);
  assertEquals(output.workspaceName, "slotted");
  const graph = output.graph;
  assert(
    graph.componentNodes.some((node: { name: string }) => node.name === "Auth"),
  );
  assert(
    graph.importedComponentEdges.some((edge: { componentName: string }) =>
      edge.componentName === "UserProfile"
    ),
  );
});

Deno.test("context reports every collected expansion file", async () => {
  const root = await makeWorkspace("multi-expand");
  try {
    await Deno.writeTextFile(`${root}/contract.sigil`, validSigil("Feature"));
    await Deno.writeTextFile(
      `${root}/one.sigil`,
      "expand Feature {\n  logic {\n    One.\n  }\n}\n",
    );
    await Deno.writeTextFile(
      `${root}/two.sigil`,
      "expand Feature {\n  cases {\n    Two.\n  }\n}\n",
    );
    const result = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, EXIT_OK);
    const paths = parseJson(result.stdout).relatedFilePaths;
    assert(paths.some((path: string) => path.endsWith("/one.sigil")));
    assert(paths.some((path: string) => path.endsWith("/two.sigil")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("render JSON includes workspace metadata and Markdown", async () => {
  const result = await runCli(["render", "../..", "--format", "json"]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.workspaceName, "sigil");
  assert(json.markdown.includes("# Sigil Workspace"));
});

Deno.test("invalid usage and runtime failures keep stable exit codes", async () => {
  const usage = await runCli([
    "context",
    "--component",
    "Auth",
    "--file",
    "auth.sigil",
  ]);
  assertEquals(usage.exitCode, EXIT_USAGE);
  const runtime = await runCli(["parse", "does-not-exist.sigil"]);
  assertEquals(runtime.exitCode, EXIT_RUNTIME);
});

Deno.test("top-level help and version report CLI information", async () => {
  const help = await runCli(["--help"]);
  assertEquals(help.exitCode, EXIT_OK);
  assert(help.stdout.startsWith("Usage: sigil"));
  assert(help.stdout.includes("parse <file>"));
  assertEquals(help.stderr, "");

  const version = await runCli(["--version"]);
  assertEquals(version.exitCode, EXIT_OK);
  assertEquals(version.stdout, "0.1.0\n");
  assertEquals(version.stderr, "");
});

Deno.test("install links bundled skills and ignores them idempotently", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-install-" });
  const source = `${root}/installation/integrations/skills`;
  const target = `${root}/project`;
  try {
    await Deno.mkdir(`${source}/sigil`, { recursive: true });
    await Deno.mkdir(`${source}/sigil-anchor-indexer`, { recursive: true });
    await Deno.mkdir(`${source}/future-skill`, { recursive: true });
    await Deno.writeTextFile(`${source}/sigil/SKILL.md`, "# Sigil\n");
    await Deno.writeTextFile(
      `${source}/sigil/#module.sigil`,
      validSigil("InstalledSkill"),
    );
    await Deno.writeTextFile(
      `${source}/sigil-anchor-indexer/spec.md`,
      "# Anchor indexer\n",
    );

    const first = await runCli(["install", "--pretty"], {
      install: { sourceDirectory: source, targetRoot: target },
    });
    assertEquals(first.exitCode, EXIT_OK);
    const firstOutput = parseJson(first.stdout);
    assertEquals(firstOutput.command, "install");
    assert(
      firstOutput.skills.every((skill: { status: string }) =>
        skill.status === "created"
      ),
    );
    assert((await Deno.lstat(`${target}/.agents/skills/sigil`)).isSymlink);
    assertEquals(
      await Deno.realPath(`${target}/.agents/skills/sigil`),
      await Deno.realPath(`${source}/sigil`),
    );
    const gitignore = await Deno.readTextFile(
      `${target}/.agents/skills/.gitignore`,
    );
    assert(gitignore.includes("/sigil\n"));
    assert(gitignore.includes("/sigil-anchor-indexer\n"));
    assert(gitignore.includes("/future-skill\n"));

    const second = await runCli(["install"], {
      install: { sourceDirectory: source, targetRoot: target },
    });
    assertEquals(second.exitCode, EXIT_OK);
    assert(
      parseJson(second.stdout).skills.every((skill: { status: string }) =>
        skill.status === "existing"
      ),
    );
    assertEquals(
      await Deno.readTextFile(`${target}/.agents/skills/.gitignore`),
      gitignore,
    );

    await writeWorkspaceConfig(target, "installed-skills");
    const check = await runCli(["check", target, "--format", "json"]);
    assertEquals(check.exitCode, EXIT_OK);
    assertEquals(parseJson(check.stdout).diagnosticCounts.error, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("install resolves skills from the selected source installation", async () => {
  const source = await resolveInstalledSkillsDirectory();
  const names: string[] = [];
  for await (const entry of Deno.readDir(source)) {
    if (entry.isDirectory) names.push(entry.name);
  }
  assert(names.includes("sigil"));
  assert(names.includes("sigil-anchor-indexer"));
});

Deno.test("install resolves skills beside a selected versioned binary", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-versioned-install-" });
  const installation = `${root}/0.1.0`;
  const skills = `${installation}/integrations/skills`;
  try {
    await Deno.mkdir(`${skills}/sigil`, { recursive: true });
    const resolved = await resolveInstalledSkillsDirectory(
      "https://jsr.io/@qoherent/sigil/0.1.0/src/main.ts",
      `${installation}/bin/sigil`,
    );
    assertEquals(await Deno.realPath(resolved), await Deno.realPath(skills));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("executable subprocess returns version JSON", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "src/main.ts",
      "version",
      "../..",
      "--format",
      "json",
    ],
    cwd: ".",
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assertEquals(output.code, EXIT_OK);
  assertEquals(
    JSON.parse(new TextDecoder().decode(output.stdout)).cliVersion,
    "0.1.0",
  );
});

async function makeWorkspace(name: string): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "sigil-cli-" });
  await writeWorkspaceConfig(root, name);
  return root;
}

async function writeWorkspaceConfig(root: string, name: string): Promise<void> {
  await Deno.mkdir(`${root}/.sigil`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: SIGIL_VERSION,
      workspace: { name, members: [] },
      files: { include: ["**/*.sigil"] },
      tools: {},
    }),
  );
}

function validSigil(name: string): string {
  return `component ${name} {\n  goal {\n    Test ${name}.\n  }\n\n  interface {\n    run()\n  }\n}\n`;
}
// deno-lint-ignore no-explicit-any
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
    diagnostics.some((item) => item.code === code),
    `Expected ${code}, got ${diagnostics.map((item) => item.code).join(", ")}`,
  );
}
