import {
  normalizePath,
  type RetrievalProjection,
  SIGIL_CORE_VERSION,
  SIGIL_VERSION,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import { CoreAdapter } from "../src/core-adapter.ts";
import metadata from "../deno.json" with { type: "json" };
import { DenoSigilFileSystem } from "../src/fs-adapter.ts";
import { resolveInstalledSkillsDirectory } from "../src/installer.ts";
import { runCli } from "../src/main.ts";
import { validateFoundation } from "../../../scripts/validate-skill.ts";
import type { CheckRequest } from "../src/args.ts";
import { formatResult } from "../src/formatters.ts";
import { renderRetrieveMarkdown } from "../src/markdown.ts";
import type { CheckCommandResult } from "../src/output-model.ts";
import {
  EXIT_DIAGNOSTICS,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
} from "../src/exit.ts";

// @sigil tests packages/cli/src/retrieval-markdown.sigil::SigilRetrievalMarkdown::RetrievalMarkdownProjection interface,constraints,cases
Deno.test("retrieve Markdown renders provider context and escaped ownership links", () => {
  const projection: RetrievalProjection = {
    schema: "sigil-retrieval-projection/v2",
    purpose: "semantic",
    target: {
      kind: "component",
      componentName: "Feature",
      pathStatus: "accepted",
      path: "feature.sigil",
    },
    components: [{
      id: "feature.sigil::Feature",
      name: "Feature",
      path: "feature.sigil",
      role: "selected",
      goal: [{ text: "Use *safe* Markdown.", path: "feature.sigil" }],
      interface: [],
      state: [],
      logic: [],
      constraints: [],
      decisions: [],
      cases: [],
      ownership: [{
        relation: "implements",
        tagName: "shared value",
        tagIdentity: {
          id: "provider:shared",
          name: "shared value",
          owner: { componentName: "Provider", declarationPath: "dep.sigil" },
        },
        path: "src/feature.ts",
        location: { line: 8, column: 3 },
        symbol: "renderFeature",
        sections: ["interface"],
        facetIds: [],
      }],
      links: [],
    }, {
      id: "_module.sigil::Workspace",
      name: "Workspace",
      path: "_module.sigil",
      role: "dependency",
      goal: [{ text: "Assemble the workspace.", path: "_module.sigil" }],
      interface: [],
      state: [],
      logic: [],
      constraints: [],
      decisions: [],
      cases: [],
      ownership: [],
      links: [],
    }, {
      id: "dep.sigil::Provider",
      name: "Provider",
      path: "dep.sigil",
      role: "dependency",
      goal: [{ text: "Provide a contract.", path: "dep.sigil" }],
      interface: [{
        name: "ProviderApi",
        items: [{ text: "run()", path: "dep.sigil" }],
        ownership: [],
      }],
      state: [],
      logic: [],
      constraints: [],
      decisions: [],
      cases: [],
      ownership: [],
      links: [],
    }],
    glossary: [{
      term: "component",
      definition: "A coherent system part.",
    }],
    diagnostics: [],
    fingerprint: "sha256:test",
  };
  const markdown = renderRetrieveMarkdown(projection);
  assert(markdown.includes("Use \\*safe\\* Markdown."));
  assert(markdown.includes("[src/feature.ts:8:3](src/feature.ts#L8)"));
  assert(markdown.includes("; Tag: shared value; Origin: dep.sigil::Provider"));
  assert(!markdown.includes("#### shared value"));
  assert(markdown.includes("## Dependencies"));
  assert(markdown.includes("#### ProviderApi"));
  assert(markdown.includes("run()"));
  assert(!markdown.includes("Goal: Provide"));
  assert(!markdown.includes("## Module Context"));
  assert(markdown.includes("### Workspace"));
  assert(markdown.includes("- **component** — A coherent system part."));
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
 */
Deno.test("parse discovers config and emits workspace metadata", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli(["parse", `${root}/consumer.sigil`]);
    assertEquals(result.exitCode, 0);
    const output = parseJson(result.stdout);
    assertEquals(output.sigilVersion, SIGIL_VERSION);
    assertEquals(output.document.components[0].name, "Consumer");
    assertEquals(output.document.imports[0].provider, "Base");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("check resolves config from a nested working directory", async () => {
  const root = await providerWorkspace();
  try {
    await Deno.mkdir(`${root}/nested`);
    const result = await runCli(["check", "--format", "json"], {
      core: new CoreAdapter({ currentDirectory: `${root}/nested` }),
    });
    assertEquals(result.exitCode, 0, result.stdout);
    assertEquals(parseJson(result.stdout).diagnosticCounts.error, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::CliOwnershipDiagnostics interface,logic,cases
 */
Deno.test("check reports ownership diagnostics from implementation sources", async () => {
  const root = await makeWorkspace("ownership-check");
  try {
    await Deno.writeTextFile(
      `${root}/contract.sigil`,
      validSigil("Feature"),
    );
    await Deno.writeTextFile(
      `${root}/implementation.ts`,
      "// @sigil implements contract.sigil::Feature::Missing interface\n" +
        "export function runFeature() {}\n",
    );

    const result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    const output = parseJson(result.stdout);
    assertHasCode(output.diagnostics, "SIGIL_IMPLEMENTATION_ANNOTATION");
    assertEquals(output.diagnosticCounts.error, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::CliOwnershipDiagnostics cases
Deno.test("check skips ownership diagnostics from config-excluded sources", async () => {
  const root = await makeWorkspace("excluded-ownership-check");
  try {
    await Deno.writeTextFile(
      `${root}/contract.sigil`,
      validSigil("Feature"),
    );
    await Deno.writeTextFile(
      `${root}/.sigil/config.json`,
      JSON.stringify({
        sigilVersion: SIGIL_VERSION,
        workspace: { name: "excluded-ownership-check", members: [] },
        files: {
          include: ["**/*.sigil"],
          exclude: ["implementation.ts"],
        },
        tools: {},
      }),
    );
    await Deno.writeTextFile(
      `${root}/implementation.ts`,
      "// @sigil implements contract.sigil::Feature::Missing interface\n" +
        "export function runFeature() {}\n",
    );

    const result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_OK);
    const output = parseJson(result.stdout);
    assertEquals(output.diagnosticCounts.error, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
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
    assertEquals(JSON.stringify(config.tools), "{}");
    assertEquals(config.workspace.members.length, 0);
    assertEquals(config.sigilVersion, SIGIL_VERSION);
    assert(config.files.include.includes("**/*.sigil"));
    const glossary = JSON.parse(
      await Deno.readTextFile(`${root}/.sigil/glossary.json`),
    );
    assertEquals(glossary.schemaVersion, 1);
    assertEquals(glossary.contexts.length, 0);
    assertEquals(glossary.terms.length, 8);
    assertEquals(
      glossary.terms.map((term: { term: string }) => term.term).join(","),
      "Decision:,Scope:,Assumptions:,Trade-offs:,Design issues addressed:,Discarded alternatives:,Consequences:,Revisit when:",
    );
    assert(
      glossary.terms.every(
        (term: { agentContext: boolean }) => term.agentContext === false,
      ),
    );

    const second = await runCli(["init", root, "--format", "json"]);
    assertEquals(second.exitCode, EXIT_DIAGNOSTICS);
    assertHasCode(parseJson(second.stdout).diagnostics, "SIGIL_CONFIG_EXISTS");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
Deno.test("init preserves an existing glossary", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-init-glossary-" });
  const glossaryPath = `${root}/.sigil/glossary.json`;
  const existing = JSON.stringify(
    {
      schemaVersion: 1,
      terms: [{ term: "project term", definition: "Project vocabulary." }],
      contexts: [],
    },
    null,
    2,
  );
  try {
    await Deno.mkdir(`${root}/.sigil`, { recursive: true });
    await Deno.writeTextFile(glossaryPath, existing);
    const result = await runCli(["init", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_OK);
    assertEquals(await Deno.readTextFile(glossaryPath), existing);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
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

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::ArtifactVersionOwnership constraints
 */
Deno.test("version reports tool and resolved contract versions", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli(["version", root, "--format", "json"]);
    assertEquals(result.exitCode, 0);
    const output = parseJson(result.stdout);
    assertEquals(output.cliVersion, metadata.version);
    assertEquals(output.coreVersion, SIGIL_CORE_VERSION);
    assertEquals(output.sigilVersion, SIGIL_VERSION);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 */
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

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 */
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

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 */
Deno.test("check accepts ungrouped and mixed Interface Facets without warnings", async () => {
  const root = await makeWorkspace("optional-concepts");
  try {
    const sources = [
      validSigil("Feature"),
      `component Feature {
  goal {
    Read and update records.
  }

  interface {
    Record is a stored value.

    Reading {
      read() returns Record.
    }

    Writing {
      write(Record) updates the stored value.
    }

    Operations complete synchronously.
  }
}
`,
    ];
    for (const source of sources) {
      await Deno.writeTextFile(`${root}/contract.sigil`, source);
      const result = await runCli(["check", root, "--format", "json"]);
      assertEquals(result.exitCode, EXIT_OK);
      const output = parseJson(result.stdout);
      assertEquals(output.diagnosticCounts.error, 0);
      assertEquals(output.diagnosticCounts.warning, 0);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::CheckSourceLocations interface,logic,constraints,cases
Deno.test("check --show-locations adds file, line, and column to text diagnostics", async () => {
  const root = await makeWorkspace("show-locations");
  try {
    await Deno.writeTextFile(
      `${root}/broken.sigil`,
      "component Broken {\n  mystery {\n    bad\n  }\n}\n",
    );

    const withFlag = await runCli([
      "check",
      root,
      "--format",
      "text",
      "--show-locations",
    ]);
    assertEquals(withFlag.exitCode, EXIT_DIAGNOSTICS);
    assert(
      /SIGIL_UNKNOWN_SECTION .*broken\.sigil:\d+:\d+: /.test(withFlag.stdout),
      `expected a file:line:column location, got:\n${withFlag.stdout}`,
    );

    const withoutFlag = await runCli(["check", root, "--format", "text"]);
    assert(
      !withoutFlag.stdout.includes("broken.sigil"),
      "default text output must not include source locations",
    );
    assert(
      withoutFlag.stdout.includes("error SIGIL_UNKNOWN_SECTION:"),
      "default text output keeps the severity code: message form",
    );

    // The flag never affects JSON output.
    const jsonPlain = await runCli(["check", root, "--format", "json"]);
    const jsonFlagged = await runCli([
      "check",
      root,
      "--format",
      "json",
      "--show-locations",
    ]);
    assertEquals(jsonFlagged.stdout, jsonPlain.stdout);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("check reports exact Tag collisions in module files and ordinary consumers", async () => {
  const root = await providerWorkspace();
  try {
    const exported = parseJson(
      (await runCli(["export", "design", root])).stdout,
    );
    const consumer = exported.sources.find((s: { path: string }) =>
      s.path === "consumer.sigil"
    ).text;
    for (const path of ["consumer.sigil", "_module.sigil"]) {
      await Deno.writeTextFile(
        `${root}/${path}`,
        consumer.replace(
          "component Consumer",
          path === "consumer.sigil" ? "component Consumer" : "component Module",
        ).replace(
          "interface {",
          "interface {\nresult {\nA local collision.\n}\n",
        ),
      );
    }
    const result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, 1);
    const diagnostics = parseJson(result.stdout).diagnostics;
    assertEquals(
      new Set(
        diagnostics.filter((d: { code: string }) =>
          d.code === "SIGIL_TAG_NAME_COLLISION"
        ).map((d: { filePath: string }) =>
          d.filePath
        ),
      ).size,
      2,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::CheckSourceLocations logic
Deno.test("--show-locations is rejected outside check", async () => {
  const result = await runCli(["graph", "--show-locations"]);
  assertEquals(result.exitCode, EXIT_USAGE);
  assert(
    result.stderr.includes("does not accept --show-locations"),
    result.stderr,
  );
});

Deno.test("--max-evidence-bytes is rejected outside retrieve", async () => {
  for (const command of ["version", "check", "graph"]) {
    const result = await runCli([command, "--max-evidence-bytes", "0"]);
    assertEquals(result.exitCode, EXIT_USAGE);
    assert(
      result.stderr.includes("does not accept --max-evidence-bytes"),
      result.stderr,
    );
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::CheckSourceLocations logic,constraints,cases
Deno.test("check location rendering handles ranges, missing ranges, and path styles", async () => {
  const base = {
    command: "check",
    pretty: false,
    quiet: false,
    showLocations: true,
  } as const;

  // Explicit absolute root preserves absolute paths (Windows drive style).
  const winRoot = "C:/repo";
  const winResult: CheckCommandResult = {
    command: "check",
    workspaceRoot: winRoot,
    configPath: `${winRoot}/.sigil/config.json`,
    sigilVersion: SIGIL_VERSION,
    workspaceName: "repo",
    diagnosticCounts: { error: 1, warning: 1, info: 1 },
    diagnostics: [
      {
        stage: "structure",
        related: [],
        severity: "error",
        code: "SIGIL_UNKNOWN_SECTION",
        message: "Unknown section.",
        filePath: `${winRoot}/pkg/a.sigil`,
        range: { start: 80, end: 86 },
        sourceLocation: { line: 8, column: 3 },
      },
      {
        stage: "resolution",
        related: [],
        severity: "warning",
        code: "SIGIL_UNUSED_TAG_IMPORT",
        message: "Unused import.",
        filePath: `${winRoot}/pkg/b.sigil`,
      },
      {
        stage: "workspace",
        related: [],
        severity: "info",
        code: "SIGIL_UNSUPPORTED_VERSION",
        message: "No location here.",
      },
    ],
  };
  const winRequest: CheckRequest = { ...base, format: "text", root: winRoot };
  const winText = await formatResult(winResult, winRequest);
  assert(
    winText.includes(
      "error SIGIL_UNKNOWN_SECTION C:/repo/pkg/a.sigil:8:3: Unknown section.",
    ),
    winText,
  );
  assert(
    winText.includes(
      "warning SIGIL_UNUSED_TAG_IMPORT C:/repo/pkg/b.sigil: Unused import.",
    ),
    winText,
  );
  assert(
    winText.includes("info SIGIL_UNSUPPORTED_VERSION: No location here."),
    winText,
  );
  assert(!winText.includes("\\"), "paths must render with forward slashes");

  // A relative invocation normalizes absolute workspace paths to relative POSIX.
  const cwd = normalizePath(Deno.cwd());
  const posixRoot = `${cwd}/demo`;
  const posixResult: CheckCommandResult = {
    command: "check",
    workspaceRoot: posixRoot,
    configPath: `${posixRoot}/.sigil/config.json`,
    sigilVersion: SIGIL_VERSION,
    workspaceName: "demo",
    diagnosticCounts: { error: 1, warning: 0, info: 0 },
    diagnostics: [
      {
        stage: "structure",
        related: [],
        severity: "error",
        code: "SIGIL_UNKNOWN_SECTION",
        message: "Unknown section.",
        filePath: `${posixRoot}/pkg/a.sigil`,
        range: { start: 40, end: 43 },
        sourceLocation: { line: 4, column: 2 },
      },
    ],
  };
  const posixRequest: CheckRequest = { ...base, format: "text" };
  const posixText = await formatResult(posixResult, posixRequest);
  assert(
    posixText.includes(
      "error SIGIL_UNKNOWN_SECTION demo/pkg/a.sigil:4:2: Unknown section.",
    ),
    posixText,
  );
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::GlossaryInspectionCommand interface
 * @sigil tests packages/cli/_module.sigil::SigilCli::CliGlossaryInspection logic,cases
 */
Deno.test("glossary reports reviewed terms, contexts, and occurrences", async () => {
  const root = await makeWorkspace("glossary");
  try {
    await Deno.mkdir(`${root}/booking`);
    await Deno.writeTextFile(
      `${root}/.sigil/glossary.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          terms: [
            {
              term: "workspace root",
              definition: "The configured workspace directory.",
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
        },
        null,
        2,
      ),
    );
    await Deno.writeTextFile(
      `${root}/booking/contract.sigil`,
      `component Booking {
  goal {
    Use the workspace root for each temporary reservation.
  }

  interface {
    Hold {
      A hold is visible.
    }
  }
}
`,
    );
    const result = await runCli([
      "glossary",
      root,
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, EXIT_OK);
    const output = parseJson(result.stdout);
    assertEquals(output.command, "glossary");
    assertEquals(output.schemaVersion, 1);
    assertEquals(output.contexts[0].id, "booking");
    assertEquals(output.resolvedContexts[0].contextId, "booking");
    assert(
      output.occurrences.some((
        item: { matchedSpelling: string; term: { term: string } },
      ) =>
        item.matchedSpelling === "temporary reservation" &&
        item.term.term === "hold"
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::CliGlossaryInspection logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 */
Deno.test("glossary is absent without error and invalid data exits 1", async () => {
  const root = await makeWorkspace("glossary-errors");
  try {
    let result = await runCli(["glossary", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_OK);
    assertEquals(parseJson(result.stdout).glossaryPath, null);

    await Deno.writeTextFile(`${root}/.sigil/glossary.json`, "{");
    result = await runCli(["glossary", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    assertHasCode(
      parseJson(result.stdout).diagnostics,
      "SIGIL_GLOSSARY_PARSE",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context exposes owner-qualified Tags and collective introductions", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli(["context", root, "--component", "Base"]);
    assertEquals(result.exitCode, 0, result.stdout);
    const output = parseJson(result.stdout);
    assertEquals(output.tagNamespaces[0].tags.length, 2);
    assertEquals(
      output.tagNamespaces[0].tags.reduce(
        (n: number, t: { introductions: unknown[] }) =>
          n + t.introductions.length,
        0,
      ),
      3,
    );
    assert(
      output.componentContracts[0].declaration.sections.some((
        section: { groups: unknown[] },
      ) => section.groups.length > 0),
    );
    assertEquals(output.conceptNamespaces, undefined);
    assertEquals(output.collectedExpansions, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
Deno.test("context includes owned implementation targets and diagnostics", async () => {
  const root = await makeWorkspace("ownership-context");
  try {
    await Deno.writeTextFile(
      `${root}/contract.sigil`,
      validSigil("Feature"),
    );
    await Deno.writeTextFile(
      `${root}/implementation.ts`,
      `// @sigil implements contract.sigil::Feature interface
export function runFeature() {}

// @sigil tests contract.sigil::Feature interface
const detached = 1;
`,
    );

    const result = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    const output = parseJson(result.stdout);
    const projection = output.ownedImplementationProjections[0];
    assertEquals(projection.owningComponent.name, "Feature");
    assertEquals(projection.targets.length, 1);
    assertEquals(projection.targets[0].relation, "implements");
    assertEquals(projection.targets[0].sections.join(","), "interface");
    assertEquals(projection.targets[0].filePath, "implementation.ts");
    assertEquals(projection.targets[0].symbolIdentity, "runFeature");
    assertHasCode(projection.diagnostics, "SIGIL_IMPLEMENTATION_ANNOTATION");
    assertHasCode(output.diagnostics, "SIGIL_IMPLEMENTATION_ANNOTATION");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
Deno.test("context omits unreadable implementation sources without aborting", async () => {
  const root = await makeWorkspace("unreadable-ownership-source");
  const unreadablePath = `${root}/unreadable.ts`;
  try {
    await Deno.writeTextFile(
      `${root}/contract.sigil`,
      validSigil("Feature"),
    );
    await Deno.writeTextFile(
      `${root}/readable.ts`,
      `// @sigil implements contract.sigil::Feature interface
export function runFeature() {}

// @sigil tests contract.sigil::Feature interface
const detached = 1;
`,
    );
    await Deno.writeTextFile(
      unreadablePath,
      `// @sigil implements contract.sigil::Feature interface
export function hiddenFeature() {}
`,
    );

    const result = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "json",
    ], {
      core: new CoreAdapter({
        currentDirectory: root,
        fs: new UnreadableImplementationFileSystem(unreadablePath),
      }),
    });

    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    const output = parseJson(result.stdout);
    const projection = output.ownedImplementationProjections[0];
    assertEquals(projection.targets.length, 1);
    assertEquals(projection.targets[0].symbolIdentity, "runFeature");
    assert(
      !projection.targets.some(
        (target: { symbolIdentity?: string }) =>
          target.symbolIdentity === "hiddenFeature",
      ),
    );
    assertHasCode(projection.diagnostics, "SIGIL_IMPLEMENTATION_ANNOTATION");
    assertHasCode(output.diagnostics, "SIGIL_IMPLEMENTATION_ANNOTATION");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
Deno.test("context recovers a failed optional ownership-source enumeration", async () => {
  const root = await makeWorkspace("failed-ownership-source-enumeration");
  try {
    await Deno.writeTextFile(
      `${root}/contract.sigil`,
      validSigil("Feature"),
    );
    await Deno.writeTextFile(
      `${root}/implementation.ts`,
      `// @sigil implements contract.sigil::Feature interface
export function runFeature() {}
`,
    );

    const recovered = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "json",
    ], {
      core: new CoreAdapter({
        currentDirectory: root,
        fs: new FailingListFileSystem(2),
      }),
    });

    assertEquals(recovered.exitCode, EXIT_OK);
    assertEquals(recovered.stderr, "");
    const output = parseJson(recovered.stdout);
    assertEquals(output.selectedComponents[0].name, "Feature");
    assertEquals(output.componentContracts[0].name, "Feature");
    assertEquals(output.ownedImplementationProjections.length, 1);
    assertEquals(output.ownedImplementationProjections[0].targets.length, 0);
    const diagnostic = output.diagnostics.find(
      (item: { code: string }) =>
        item.code === "SIGIL_IMPLEMENTATION_SOURCE_DISCOVERY",
    );
    assert(diagnostic);
    assertEquals(diagnostic.severity, "warning");
    assertEquals(diagnostic.filePath, normalizePath(root));
    assert(diagnostic.message.includes("Enumeration failed"));

    const requiredFailure = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "json",
    ], {
      core: new CoreAdapter({
        currentDirectory: root,
        fs: new FailingListFileSystem(1),
      }),
    });
    assertEquals(requiredFailure.exitCode, EXIT_RUNTIME);
    assertEquals(requiredFailure.stdout, "");
    assert(requiredFailure.stderr.includes("Enumeration failed"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context includes full provider contracts, selected Tags and consumer use evidence", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli(["context", root, "--component", "Consumer"]);
    assertEquals(result.exitCode, 0, result.stdout);
    const context = parseJson(result.stdout).agentDependencyContexts[0];
    assertEquals(context.providers[0].component.name, "Base");
    assertEquals(context.providers[0].selections.length, 2);
    assertEquals(context.providers[0].uses.length, 2);
    assert(
      context.dependencyContracts[0].declaration.sections.some((
        section: { name: string },
      ) => section.name === "constraints"),
    );
    assertEquals(context.selectedComponent.name, "Consumer");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context Markdown preserves consumer and provider contracts, payload and empty selection", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli([
      "context",
      root,
      "--component",
      "Consumer",
      "--format",
      "markdown",
    ]);
    assertEquals(result.exitCode, 0, result.stdout);
    assert(result.stdout.includes("### Direct Dependencies"));
    assert(result.stdout.includes("Selected Tags:"));
    assert(result.stdout.includes("Consumer uses: 2"));
    const exported = parseJson(
      (await runCli(["export", "design", root])).stdout,
    );
    const payload = exported.units.find((u: { payload: unknown }) => u.payload)
      ?.payload;
    assert(result.stdout.includes(payload.rawBody));
    assert(!result.stdout.includes("undefined"));
    const empty = await runCli([
      "context",
      root,
      "--component",
      "Missing",
      "--format",
      "markdown",
    ]);
    assert(empty.stdout.includes("No context matched"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::MarkdownOutput interface,logic,constraints
 */
Deno.test("context Markdown retains duplicate physical owners without merged contracts", async () => {
  const root = await providerWorkspace();
  try {
    await Deno.writeTextFile(
      `${root}/duplicate.sigil`,
      validSigil("Base").replace("Test Base.", "Independent duplicate owner."),
    );
    const result = await runCli([
      "context",
      root,
      "--component",
      "Base",
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, 1);
    const output = parseJson(result.stdout);
    assertEquals(output.selectedComponents.length, 2);
    assertEquals(output.agentDependencyContexts.length, 0);
    assertHasCode(output.diagnostics, "SIGIL_DUPLICATE_COMPONENT");
    const consumer = parseJson(
      (await runCli(["context", root, "--component", "Consumer"])).stdout,
    );
    assertEquals(consumer.agentDependencyContexts[0].providers.length, 0);
    const markdown = await runCli([
      "context",
      root,
      "--component",
      "Base",
      "--format",
      "markdown",
    ]);
    assertEquals(
      countOccurrences(markdown.stdout, "Independent duplicate owner."),
      1,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::MarkdownOutput interface,logic,constraints
 */
Deno.test("context leaves duplicate provider names unresolved", async () => {
  const root = await providerWorkspace();
  try {
    await Deno.writeTextFile(
      `${root}/duplicate.sigil`,
      validSigil("Base").replace("Test Base.", "Independent duplicate owner."),
    );
    const result = await runCli([
      "context",
      root,
      "--component",
      "Base",
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, 1);
    const output = parseJson(result.stdout);
    assertEquals(output.selectedComponents.length, 2);
    assertEquals(output.agentDependencyContexts.length, 0);
    assertHasCode(output.diagnostics, "SIGIL_DUPLICATE_COMPONENT");
    const consumer = parseJson(
      (await runCli(["context", root, "--component", "Consumer"])).stdout,
    );
    assertEquals(consumer.agentDependencyContexts[0].providers.length, 0);
    const markdown = await runCli([
      "context",
      root,
      "--component",
      "Base",
      "--format",
      "markdown",
    ]);
    assertEquals(
      countOccurrences(markdown.stdout, "Independent duplicate owner."),
      1,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::MarkdownOutput interface,logic,constraints
 */
Deno.test("context does not assign resolved provider context to duplicate selected names", async () => {
  const root = await providerWorkspace();
  try {
    await Deno.writeTextFile(
      `${root}/duplicate.sigil`,
      validSigil("Base").replace("Test Base.", "Independent duplicate owner."),
    );
    const result = await runCli([
      "context",
      root,
      "--component",
      "Base",
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, 1);
    const output = parseJson(result.stdout);
    assertEquals(output.selectedComponents.length, 2);
    assertEquals(output.agentDependencyContexts.length, 0);
    assertHasCode(output.diagnostics, "SIGIL_DUPLICATE_COMPONENT");
    const consumer = parseJson(
      (await runCli(["context", root, "--component", "Consumer"])).stdout,
    );
    assertEquals(consumer.agentDependencyContexts[0].providers.length, 0);
    const markdown = await runCli([
      "context",
      root,
      "--component",
      "Base",
      "--format",
      "markdown",
    ]);
    assertEquals(
      countOccurrences(markdown.stdout, "Independent duplicate owner."),
      1,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::MarkdownOutput interface,logic,constraints
 */
Deno.test("context renders file Markdown for multiple components and normalizes paths", async () => {
  const root = await makeWorkspace("context-markdown-file");
  const normalizedRoot = normalizePath(root);
  try {
    await Deno.writeTextFile(
      `${root}/multi.sigil`,
      `component First {
  goal {
    First component.
  }

  interface {
    FirstApi {
      first()
    }
  }
}

component Second {
  goal {
    Second component.
  }

  interface {
    SecondApi {
      second()
    }
  }
}
`,
    );

    const absolute = await runCli([
      "context",
      root,
      "--file",
      `${root}/multi.sigil`,
      "--format",
      "markdown",
    ]);
    assertEquals(absolute.exitCode, EXIT_OK);
    assert(absolute.stdout.includes(`Workspace root: ${normalizedRoot}`));
    assert(absolute.stdout.includes("## First"));
    assert(absolute.stdout.includes("## Second"));
    assert(
      absolute.stdout.indexOf("## First") <
        absolute.stdout.indexOf("## Second"),
    );

    const relative = await runCli([
      "context",
      ".",
      "--file",
      "multi.sigil",
      "--format",
      "markdown",
    ], {
      core: new CoreAdapter({ currentDirectory: root }),
    });
    assertEquals(relative.exitCode, EXIT_OK);
    assert(!relative.stdout.includes(`Workspace root: ${normalizedRoot}`));
    assert(
      !relative.stdout.includes(`Source: ${normalizedRoot}/multi.sigil`),
    );
    assert(relative.stdout.includes("multi.sigil"));
    assert(relative.stdout.includes("## First"));
    assert(relative.stdout.includes("## Second"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("context optionally includes consumers selecting provider Tags", async () => {
  const root = await providerWorkspace();
  try {
    const plain = parseJson(
      (await runCli(["context", root, "--component", "Base"])).stdout,
    );
    assertEquals(plain.agentDependentContexts, undefined);
    const result = await runCli([
      "context",
      root,
      "--component",
      "Base",
      "--include-dependents",
    ]);
    assertEquals(result.exitCode, 0, result.stdout);
    const importer =
      parseJson(result.stdout).agentDependentContexts[0].importingFiles[0];
    assertEquals(importer.provider.name, "Base");
    assertEquals(importer.importEdges.length, 2);
    assertEquals(importer.contextualContracts[0].name, "Consumer");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("context dependent flag requires component selection", async () => {
  const root = await makeWorkspace("dependent-usage");
  try {
    await Deno.writeTextFile(`${root}/provider.sigil`, validSigil("Provider"));
    const usage = await runCli([
      "context",
      root,
      "--file",
      `${root}/provider.sigil`,
      "--include-dependents",
    ]);
    assertEquals(usage.exitCode, EXIT_USAGE);
    assertEquals(usage.stdout, "");
    assert(
      usage.stderr.includes(
        "context accepts --include-dependents only with --component",
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::PurposeContextRetrieval interface,logic
Deno.test("retrieve returns one deterministic purpose result", async () => {
  const root = await makeWorkspace("retrieve-purpose");
  try {
    await Deno.writeTextFile(`${root}/feature.sigil`, validSigil("Feature"));
    const argv = [
      "retrieve",
      root,
      "--component",
      "Feature",
      "--purpose",
      "architecture",
      "--format",
      "json",
    ];
    const first = await runCli(argv);
    const second = await runCli(argv);
    assertEquals(first.exitCode, EXIT_OK);
    const result = parseJson(first.stdout);
    assertEquals(result.command, "retrieve");
    assertEquals(result.schema, "sigil-purpose-retrieval/v2");
    assertEquals(result.purpose, "architecture");
    assert(
      result.graph.nodes.some((node: { kind: string }) =>
        node.kind === "component-declaration"
      ),
    );
    assert(result.context.sections.length > 0);
    assertEquals(result.fingerprint, parseJson(second.stdout).fingerprint);

    const invalid = await runCli(["retrieve", root, "--component", "Feature"]);
    assertEquals(invalid.exitCode, EXIT_USAGE);
    assert(invalid.stderr.includes("requires --purpose"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("check treats an imports-only module file as ordinary source", async () => {
  const root = await providerWorkspace();
  try {
    await Deno.mkdir(`${root}/internal`);
    await Deno.writeTextFile(
      `${root}/internal/_module.sigil`,
      "@base.sigil from Base import { result }\n",
    );
    const result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, 1);
    const diagnostics = parseJson(result.stdout).diagnostics;
    assertHasCode(diagnostics, "SIGIL_UNUSED_TAG_IMPORT");
    assert(
      !diagnostics.some((d: { code: string }) =>
        d.code === "SIGIL_MODULE_WITHOUT_COMPONENT"
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("graph preserves selected Tag edges and actual reference uses", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli(["graph", root]);
    assertEquals(result.exitCode, 0, result.stdout);
    const graph = parseJson(result.stdout).graph;
    assertEquals(graph.componentNodes.length, 2);
    assertEquals(graph.importedTagEdges.length, 2);
    assertEquals(graph.fileEdges.length, 1);
    assert(
      graph.importedTagEdges.every((e: { uses: unknown[] }) =>
        e.uses.length === 1
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context exposes consolidated owner contributions across contract sections", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli([
      "context",
      root,
      "--file",
      `${root}/base.sigil`,
    ]);
    assertEquals(result.exitCode, 0, result.stdout);
    const output = parseJson(result.stdout);
    assertEquals(output.selectedComponents.length, 1);
    assertEquals(output.selectedComponents[0].name, "Base");
    assert(output.componentContracts[0].declaration.sections.length >= 3);
    assertEquals(output.collectedExpansions, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context rejects removed expands and retains valid independent components", async () => {
  const root = await providerWorkspace();
  try {
    await Deno.writeTextFile(
      `${root}/details.sigil`,
      "expand Base {\n  logic {\n    Old contribution.\n  }\n}\n",
    );
    const result = await runCli([
      "context",
      root,
      "--file",
      `${root}/details.sigil`,
    ]);
    assertEquals(result.exitCode, 1);
    assertEquals(parseJson(result.stdout).selectedComponents.length, 0);
    const valid = parseJson(
      (await runCli(["context", root, "--component", "Base"])).stdout,
    );
    assertEquals(valid.selectedComponents[0].name, "Base");
    assertHasCode(valid.diagnostics, "SIGIL_PARSE_STRUCTURE");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::CliGlossaryInspection logic,cases
 */
Deno.test("context includes glossary evidence only from selected and provider files", async () => {
  const root = await providerWorkspace();
  try {
    await Deno.writeTextFile(
      `${root}/unrelated.sigil`,
      validSigil("Unrelated"),
    );
    await Deno.writeTextFile(
      `${root}/.sigil/glossary.json`,
      JSON.stringify({
        schemaVersion: 1,
        terms: [{
          term: "Preserve",
          definition: "Retain source.",
          agentContext: true,
        }, {
          term: "Unrelated",
          definition: "Outside scope.",
          agentContext: true,
        }],
        contexts: [],
      }),
    );
    const result = await runCli(["context", root, "--component", "Consumer"]);
    assertEquals(result.exitCode, 0, result.stdout);
    const output = parseJson(result.stdout);
    assert(
      output.relatedFilePaths.every((p: string) =>
        !p.endsWith("unrelated.sigil")
      ),
    );
    assert(
      !output.glossaryContext.terms.some((t: { term: string }) =>
        t.term === "Unrelated"
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
 */
Deno.test("render JSON includes workspace metadata and all contract sections", async () => {
  const root = await providerWorkspace();
  try {
    const result = await runCli(["render", root, "--format", "json"]);
    assertEquals(result.exitCode, 0, result.stdout);
    const output = parseJson(result.stdout);
    assert(output.markdown.includes("# Sigil Workspace"));
    assert(output.markdown.includes("### Constraints"));
    assert(output.markdown.includes("### Interface"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::MarkdownOutput interface,constraints
 */
Deno.test("render Markdown diagnostics keep stable text formatting", async () => {
  const root = await makeWorkspace("render-markdown-diagnostics");
  try {
    await Deno.writeTextFile(
      `${root}/broken.sigil`,
      `component Broken {
  goal {
    Render diagnostics.
  }
}
`,
    );
    const result = await runCli([
      "render",
      root,
      "--format",
      "markdown",
    ]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    assert(
      result.stdout.includes(
        "- error SIGIL_MISSING_INTERFACE: A nonempty interface section is required.",
      ),
    );
    assert(
      !result.stdout.includes(`SIGIL_MISSING_INTERFACE ${root}/broken.sigil:`),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 */
Deno.test("invalid usage and runtime failures keep stable exit codes", async () => {
  const usage = await runCli([
    "context",
    "--component",
    "Auth",
    "--file",
    "auth.sigil",
  ]);
  assertEquals(usage.exitCode, EXIT_USAGE);
  assertEquals(usage.stdout, "");
  assert(usage.stderr.includes("Error: context accepts only one"));
  assert(usage.stderr.includes("Usage: sigil context"));
  const root = await makeWorkspace("missing-file");
  try {
    const runtime = await runCli(["parse", `${root}/does-not-exist.sigil`]);
    assertEquals(runtime.exitCode, EXIT_RUNTIME);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
Deno.test("help is scoped to every recognized command path", async () => {
  const help = await runCli(["--help"]);
  assertEquals(help.exitCode, EXIT_OK);
  assert(help.stdout.startsWith("Usage: sigil"));
  assert(help.stdout.includes("parse"));
  assertEquals(help.stderr, "");

  const commandPaths = [
    ["skill"],
    ["skill", "list"],
    ["skill", "install"],
    ["init"],
    ["version"],
    ["parse"],
    ["check"],
    ["glossary"],
    ["graph"],
    ["context"],
    ["render"],
  ];
  for (const commandPath of commandPaths) {
    const result = await runCli([...commandPath, "--help"]);
    assertEquals(result.exitCode, EXIT_OK);
    assert(
      result.stdout.startsWith(`Usage: sigil ${commandPath.join(" ")}`),
    );
    assertEquals(result.stderr, "");
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
Deno.test("usage errors include help for the longest recognized command path", async () => {
  const cases = [
    {
      argv: [] as string[],
      problem: "Expected command",
      usage: "Usage: sigil <command>",
    },
    {
      argv: ["unknown"],
      problem: 'Unknown command "unknown"',
      usage: "Usage: sigil <command>",
    },
    {
      argv: ["skill"],
      problem: "skill requires exactly one subcommand",
      usage: "Usage: sigil skill <subcommand>",
    },
    {
      argv: ["skill", "unknown"],
      problem: 'Unknown skill subcommand "unknown"',
      usage: "Usage: sigil skill <subcommand>",
    },
    {
      argv: ["skill", "list", "extra"],
      problem: "skill list does not accept positional arguments",
      usage: "Usage: sigil skill list",
    },
    {
      argv: ["parse"],
      problem: "parse requires exactly one file",
      usage: "Usage: sigil parse <file>",
    },
    {
      argv: ["check", "--unknown"],
      problem: "Unsupported option --unknown",
      usage: "Usage: sigil check",
    },
  ];

  for (const testCase of cases) {
    const result = await runCli(testCase.argv);
    assertEquals(result.exitCode, EXIT_USAGE);
    assertEquals(result.stdout, "");
    assert(result.stderr.includes(`Error: ${testCase.problem}`));
    assert(result.stderr.includes(testCase.usage));
  }
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::ArtifactVersionOwnership constraints
 */
Deno.test("version flag reports CLI information", async () => {
  const version = await runCli(["--version"]);
  assertEquals(version.exitCode, EXIT_OK);
  assertEquals(version.stdout, `${metadata.version}\n`);
  assertEquals(version.stderr, "");
});

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::CliSkillInstallation logic,constraints,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::SkillInstallationCommand interface
 * @sigil tests packages/cli/src/installer.sigil::SkillInstaller::SkillInstallation interface,state,logic,constraints,cases
 */
Deno.test("skill install defaults global and supports project agent targets", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-install-" });
  const source = `${root}/installation/integrations/skills`;
  const target = `${root}/project`;
  const home = `${root}/home`;
  try {
    await Deno.mkdir(`${source}/sigil`, { recursive: true });
    await Deno.mkdir(`${source}/sigil-anchor-indexer`, { recursive: true });
    await Deno.mkdir(`${source}/future-skill`, { recursive: true });
    await Deno.writeTextFile(`${source}/sigil/SKILL.md`, "# Sigil\n");
    await Deno.writeTextFile(`${source}/future-skill/SKILL.md`, "# Future\n");
    await Deno.writeTextFile(
      `${source}/sigil/_module.sigil`,
      validSigil("InstalledSkill"),
    );
    await Deno.writeTextFile(
      `${source}/sigil-anchor-indexer/spec.md`,
      "# Anchor indexer\n",
    );

    const listed = await runCli(["skill", "list", "--pretty"], {
      install: { sourceDirectory: source },
    });
    assertEquals(listed.exitCode, EXIT_OK);
    assertEquals(
      parseJson(listed.stdout).skills.join(","),
      "future-skill,sigil",
    );

    const first = await runCli(["skill", "install", "--pretty"], {
      install: { sourceDirectory: source, userHome: home },
    });
    assertEquals(first.exitCode, EXIT_OK);
    const firstOutput = parseJson(first.stdout);
    assertEquals(firstOutput.command, "skill-install");
    assertEquals(firstOutput.scope, "global");
    assert(
      firstOutput.skills.every((skill: { status: string }) =>
        skill.status === "installed"
      ),
    );
    assert((await Deno.lstat(`${home}/.agents/skills/sigil`)).isSymlink);
    assert((await Deno.lstat(`${home}/.claude/skills/sigil`)).isSymlink);
    assertEquals(
      await Deno.realPath(`${home}/.agents/skills/sigil`),
      await Deno.realPath(`${source}/sigil`),
    );

    const second = await runCli([
      "skill",
      "install",
      "--project",
      "--agent",
      "claude",
    ], {
      install: { sourceDirectory: source, targetRoot: target },
    });
    assertEquals(second.exitCode, EXIT_OK);
    assert((await Deno.lstat(`${target}/.claude/skills/sigil`)).isSymlink);
    const gitignore = await Deno.readTextFile(
      `${target}/.claude/skills/.gitignore`,
    );
    assert(gitignore.includes("/.sigil-managed.json\n"));
    assert(gitignore.includes("/sigil\n"));
    assert(!gitignore.includes("sigil-anchor-indexer"));

    const repeated = await runCli(["skill", "install"], {
      install: { sourceDirectory: source, userHome: home },
    });
    assertEquals(repeated.exitCode, EXIT_OK);
    assert(
      parseJson(repeated.stdout).skills.every((skill: { status: string }) =>
        skill.status === "existing"
      ),
    );

    await writeWorkspaceConfig(target, "installed-skills");
    const check = await runCli(["check", target, "--format", "json"]);
    assertEquals(check.exitCode, EXIT_OK);
    assertEquals(parseJson(check.stdout).diagnosticCounts.error, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/src/installer.sigil::SkillInstaller::SkillCatalog interface,state,logic,constraints,cases
Deno.test("skill discovery resolves valid skills from the source installation", async () => {
  const source = await resolveInstalledSkillsDirectory();
  const names: string[] = [];
  for await (const entry of Deno.readDir(source)) {
    if (entry.isDirectory) names.push(entry.name);
  }
  assert(names.includes("sigil"));
  assert(names.includes("sigil-anchor-indexer"));
  const listed = await runCli(["skill", "list"], {
    install: { sourceDirectory: source },
  });
  assertEquals(listed.exitCode, EXIT_OK);
  assertEquals(
    parseJson(listed.stdout).skills.join(","),
    "sigil,sigil-evaluate,sigil-understand,sigil-write",
  );
  const legacy = parseJson(listed.stdout).catalog.find((s: { name: string }) =>
    s.name === "sigil"
  );
  assertEquals(legacy.compatibility.requirements.sigilVersion, "0.7.0");
  assertEquals(legacy.compatibility.requirements.cliVersion, "^0.8.0");
  assertEquals(legacy.compatibility.requirements.coreVersion, "^0.7.0");
  assertEquals(legacy.compatibility.requirements.sigilcVersion, "^0.1.0");
  assertEquals(legacy.compatibility.languageCompatible, false);
  assertEquals(legacy.compatibility.runtimeValidation, "not-run");
});

Deno.test("skill real bundle retains sibling references in global and project links and relocated copies", async () => {
  // macOS /var aliases /private/var; use the physical parent for relative links
  // crossing from this temporary installation to the repository's real catalog.
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "sigil real catalog 空 " }),
  );
  const sourceDirectory = await resolveInstalledSkillsDirectory();
  try {
    for (const scope of ["global", "project"]) {
      for (const forceCopy of [false, true]) {
        const destination = `${root}/${scope}-${forceCopy ? "copy" : "link"}`;
        const result = await runCli([
          "skill",
          "install",
          "--agent",
          "codex",
          ...(scope === "project" ? ["--project"] : []),
        ], {
          install: {
            sourceDirectory,
            userHome: destination,
            targetRoot: destination,
            forceCopy,
          },
        });
        assertEquals(result.exitCode, EXIT_OK);
        assertEquals(parseJson(result.stdout).skills.length, 4);
        const catalog = `${destination}/.agents/skills`;
        assertEquals(
          (await Deno.lstat(`${catalog}/sigil-write`)).isSymlink,
          !forceCopy,
        );
        await validateFoundation(catalog);
        if (forceCopy) {
          const relocated = `${destination} relocated Ω`;
          await Deno.rename(destination, relocated);
          await validateFoundation(`${relocated}/.agents/skills`);
        }
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/src/installer.sigil::SkillInstaller::SkillSourceDiscovery interface,logic,cases
Deno.test("skill install resolves skills beside a selected versioned binary", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-versioned-install-" });
  const installation = `${root}/0.6.0`;
  const skills = `${installation}/integrations/skills`;
  try {
    await Deno.mkdir(`${skills}/sigil`, { recursive: true });
    const resolved = await resolveInstalledSkillsDirectory(
      "https://jsr.io/@qoherent/sigil/0.6.0/src/main.ts",
      `${installation}/bin/sigil`,
    );
    assertEquals(await Deno.realPath(resolved), await Deno.realPath(skills));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/src/installer.sigil::SkillInstaller::SkillInstallation interface,state,logic,constraints,cases
Deno.test("skill install copies when links are unavailable and updates managed copies", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-copy-install-" });
  const source = `${root}/v1/integrations/skills`;
  const source2 = `${root}/v2/integrations/skills`;
  const home = `${root}/home`;
  try {
    for (const directory of [source, source2]) {
      await Deno.mkdir(`${directory}/sigil`, { recursive: true });
    }
    await Deno.writeTextFile(`${source}/sigil/SKILL.md`, "version one\n");
    await Deno.writeTextFile(`${source2}/sigil/SKILL.md`, "version two\n");
    let result = await runCli(["skill", "install", "--agent", "codex"], {
      install: { sourceDirectory: source, userHome: home, forceCopy: true },
    });
    assertEquals(parseJson(result.stdout).skills[0].status, "copied");
    result = await runCli(["skill", "install", "--agent", "codex"], {
      install: { sourceDirectory: source2, userHome: home, forceCopy: true },
    });
    assertEquals(parseJson(result.stdout).skills[0].status, "updated");
    assertEquals(
      await Deno.readTextFile(`${home}/.agents/skills/sigil/SKILL.md`),
      "version two\n",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/src/installer.sigil::SkillInstaller::SkillInstallation interface,state,logic,constraints,cases
Deno.test("skill install refuses unmanaged destinations before changing others", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-conflict-install-" });
  const source = `${root}/skills`;
  const home = `${root}/home`;
  try {
    await Deno.mkdir(`${source}/sigil`, { recursive: true });
    await Deno.writeTextFile(`${source}/sigil/SKILL.md`, "skill\n");
    await Deno.mkdir(`${home}/.claude/skills/sigil`, { recursive: true });
    const result = await runCli(["skill", "install"], {
      install: { sourceDirectory: source, userHome: home },
    });
    assertEquals(result.exitCode, EXIT_RUNTIME);
    assert(result.stderr.includes("unmanaged skill path"));
    assert(!(await exists(`${home}/.agents/skills/sigil`)));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
Deno.test("executable subprocess returns version JSON", async () => {
  const root = await providerWorkspace();
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "src/main.ts",
        "version",
        root,
        "--format",
        "json",
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0);
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)).cliVersion,
      metadata.version,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
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
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ??
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

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

class UnreadableImplementationFileSystem implements SigilFileSystem {
  readSourceFile(path: string): Promise<Uint8Array> {
    return Deno.readFile(path);
  }

  readonly #base = new DenoSigilFileSystem();
  readonly #unreadablePath: string;

  constructor(unreadablePath: string) {
    this.#unreadablePath = normalizePath(unreadablePath);
  }

  readTextFile(path: string): Promise<string> {
    if (normalizePath(path) === this.#unreadablePath) {
      return Promise.reject(new Error(`File not found: ${path}`));
    }
    return this.#base.readTextFile(path);
  }

  exists(path: string): Promise<boolean> {
    return this.#base.exists(path);
  }

  listFiles(root: string): Promise<readonly string[]> {
    return this.#base.listFiles(root);
  }
}

/*
 * @sigil tests packages/cli/_module.sigil::SigilCli::SourceFormatting logic,constraints,cases
 * @sigil tests packages/cli/_module.sigil::SigilCli::SourceFormattingCommand interface
 * @sigil tests packages/cli/_module.sigil::SigilCli::WorkspaceMutationBoundary constraints
 */
Deno.test("fmt check is read-only and fmt writes canonical Sigil", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-fmt-" });
  try {
    const initialized = await runCli(["init", root, "--quiet"]);
    assertEquals(initialized.exitCode, EXIT_OK);
    const sourcePath = `${root}/main.sigil`;
    const source = `component Example {
  goal {
    This prose is intentionally long enough that deterministic formatting must wrap it while excluding structural indentation from its width calculation.
  }

  interface {
    Read {
      read()
    }
  }
}
`;
    await Deno.writeTextFile(sourcePath, source);

    const checked = await runCli(["fmt", root, "--check", "--format", "json"]);
    assertEquals(checked.exitCode, EXIT_DIAGNOSTICS);
    assertEquals(await Deno.readTextFile(sourcePath), source);
    assertEquals(parseJson(checked.stdout).files[0].status, "noncanonical");

    const formatted = await runCli(["fmt", root, "--format", "json"]);
    assertEquals(formatted.exitCode, EXIT_OK);
    assertEquals(parseJson(formatted.stdout).files[0].status, "formatted");
    const result = await Deno.readTextFile(sourcePath);
    assert(result !== source);

    const canonical = await runCli(["fmt", root, "--check", "--quiet"]);
    assertEquals(canonical.exitCode, EXIT_OK);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/_module.sigil::SigilCli::SourceFormatting constraints,cases
Deno.test("fmt writes nothing when a selected source has an error", async () => {
  const root = await Deno.makeTempDir({ prefix: "sigil-fmt-invalid-" });
  try {
    assertEquals((await runCli(["init", root, "--quiet"])).exitCode, EXIT_OK);
    const validPath = `${root}/valid.sigil`;
    const invalidPath = `${root}/invalid.sigil`;
    const noncanonical = `component Valid {
  goal {
    This prose is deliberately long enough to require canonical wrapping before it can be written safely by the formatter.
  }

  interface {
    Read {
      read()
    }
  }
}
`;
    await Deno.writeTextFile(validPath, noncanonical);
    await Deno.writeTextFile(
      invalidPath,
      validSigil("Invalid").replace(
        "Test Invalid.",
        "x".repeat(80),
      ),
    );

    const result = await runCli(["fmt", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    assertEquals(await Deno.readTextFile(validPath), noncanonical);
    assert(
      parseJson(result.stdout).files.every(
        (file: { status: string }) => file.status === "failed",
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

class FailingListFileSystem implements SigilFileSystem {
  readSourceFile(path: string): Promise<Uint8Array> {
    return Deno.readFile(path);
  }

  readonly #base = new DenoSigilFileSystem();
  readonly #failureCall: number;
  #listCalls = 0;

  constructor(failureCall: number) {
    this.#failureCall = failureCall;
  }

  readTextFile(path: string): Promise<string> {
    return this.#base.readTextFile(path);
  }

  exists(path: string): Promise<boolean> {
    return this.#base.exists(path);
  }

  listFiles(root: string): Promise<readonly string[]> {
    this.#listCalls++;
    if (this.#listCalls === this.#failureCall) {
      return Promise.reject(new Error(`Enumeration failed: ${root}`));
    }
    return this.#base.listFiles(root);
  }
}

async function providerWorkspace(): Promise<string> {
  const root = await makeWorkspace("provider-context");
  const fixture = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../core/tests/fixtures/design-input-080.json",
        import.meta.url,
      ),
    ),
  );
  for (const source of fixture.sources) {
    await Deno.writeTextFile(`${root}/${source.path}`, source.text);
  }
  return root;
}
