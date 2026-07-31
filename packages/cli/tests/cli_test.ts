import {
  SIGIL_CORE_VERSION,
  SIGIL_VERSION,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import { CoreAdapter } from "../src/core-adapter.ts";
import { DenoSigilFileSystem, normalizePath } from "../src/fs-adapter.ts";
import { resolveInstalledSkillsDirectory } from "../src/installer.ts";
import { runCli } from "../src/main.ts";
import {
  EXIT_DIAGNOSTICS,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
} from "../src/exit.ts";

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::StructuredOutput interface,constraints
 */
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

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("check resolves repository config from a nested working directory", async () => {
  const result = await runCli(["check", "--format", "json"]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.workspaceRoot, "../..");
  assertEquals(json.configPath, "../../.sigil/config.json");
  assertEquals(json.diagnosticCounts.error, 0);
});

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
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

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
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

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
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
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::ArtifactVersionOwnership constraints
 */
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
  assertEquals(json.cliVersion, "0.7.0");
  assertEquals(json.coreVersion, SIGIL_CORE_VERSION);
  assertEquals(json.sigilVersion, SIGIL_VERSION);
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::ExitStatus constraints,cases
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
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::ExitStatus constraints,cases
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
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::ExitStatus constraints,cases
 */
Deno.test("check reports missing interface concepts as warning-only", async () => {
  const root = await makeWorkspace("concept-warning");
  try {
    await Deno.writeTextFile(`${root}/contract.sigil`, validSigil("Feature"));
    const result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_OK);
    const output = parseJson(result.stdout);
    assertEquals(output.diagnosticCounts.error, 0);
    assertEquals(output.diagnosticCounts.warning, 1);
    assertHasCode(
      output.diagnostics,
      "SIGIL_MISSING_CONCEPT_IDENTIFIER",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/#module.sigil::SigilCli::GlossaryInspection interface,logic,cases
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
 * @sigil tests packages/cli/#module.sigil::SigilCli::GlossaryInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::ExitStatus constraints,cases
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

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context exposes concept blocks and resolved namespaces", async () => {
  const root = await makeWorkspace("concept-context");
  try {
    await Deno.writeTextFile(
      `${root}/contract.sigil`,
      `component Feature {
  goal {
    Test concepts.
  }

  interface {
    Execution {
      run()
    }
  }
}
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
    assertEquals(result.exitCode, EXIT_OK);
    const output = parseJson(result.stdout);
    assertEquals(
      output.componentContracts[0].interfaceConcepts[0].identifier,
      "Execution",
    );
    assertEquals(
      output.conceptNamespaces[0].publicConcepts[0].identifier,
      "Execution",
    );

    const markdown = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "markdown",
    ]);
    assertEquals(markdown.exitCode, EXIT_OK);
    assert(markdown.stdout.includes("### Concept Namespace"));
    assert(markdown.stdout.includes("#### Public Concepts"));
    assert(markdown.stdout.includes("#### Accessible Concepts"));
    assert(markdown.stdout.includes("#### Declared Concepts"));
    assert(markdown.stdout.includes("- Execution (Feature,"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/#module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
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
    assertHasCode(projection.diagnostics, "SIGIL_PARSE_STRUCTURE");
    assertHasCode(output.diagnostics, "SIGIL_PARSE_STRUCTURE");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/#module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
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
    assertHasCode(projection.diagnostics, "SIGIL_PARSE_STRUCTURE");
    assertHasCode(output.diagnostics, "SIGIL_PARSE_STRUCTURE");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/#module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
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

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context includes direct dependency contracts and decision rationale", async () => {
  const root = await makeWorkspace("agent-dependency-context");
  try {
    await Deno.writeTextFile(
      `${root}/leaf.sigil`,
      validSigil("Leaf"),
    );
    await Deno.writeTextFile(
      `${root}/leaf-detail.sigil`,
      `expand Leaf {
  decisions {
    LeafChoice {
      Decision: Exclude transitive rationale.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/provider.sigil`,
      `@leaf.sigil import { Leaf }

${validSigil("Provider")}`,
    );
    await Deno.writeTextFile(
      `${root}/provider-detail.sigil`,
      `expand Provider {
  logic {
    ProviderLogic {
      Keep private mechanics hidden.
    }
  }

  decisions {
    ProviderChoice {
      Decision: Include direct rationale.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/consumer.sigil`,
      `@provider.sigil import { Provider }

${validSigil("Consumer")}`,
    );

    const result = await runCli([
      "context",
      root,
      "--component",
      "Consumer",
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, EXIT_OK);
    const output = parseJson(result.stdout);
    const context = output.agentDependencyContexts[0];
    assertEquals(context.selectedComponent.name, "Consumer");
    assertEquals(
      context.dependencyContracts.map((item: {
        name: string;
      }) => item.name).join(","),
      "Provider",
    );
    assertEquals(context.dependencyDecisions.length, 1);
    assertEquals(
      context.dependencyDecisions[0].section.lines[0].text,
      "Decision: Include direct rationale.",
    );
    assert(
      !JSON.stringify(context.dependencyDecisions).includes(
        "Keep private mechanics hidden.",
      ),
    );
    assert(
      !context.dependencyContracts.some((item: { name: string }) =>
        item.name === "Leaf"
      ),
    );
    assertEquals(
      output.relatedFilePaths.map((path: string) =>
        path.slice(path.lastIndexOf("/") + 1)
      ).join(","),
      "consumer.sigil,provider-detail.sigil,provider.sigil",
    );

    const markdown = await runCli([
      "context",
      root,
      "--component",
      "Consumer",
      "--format",
      "markdown",
    ]);
    assertEquals(markdown.exitCode, EXIT_OK);
    assert(markdown.stdout.includes("### Direct Dependencies"));
    assert(markdown.stdout.includes("#### Provider"));
    assert(markdown.stdout.includes("##### Goal"));
    assert(markdown.stdout.includes("- Test Provider."));
    assert(markdown.stdout.includes("##### Interface"));
    assert(markdown.stdout.includes("- run()"));
    assert(markdown.stdout.includes("##### Dependency Decisions"));
    assert(markdown.stdout.includes("provider-detail.sigil"));
    assert(markdown.stdout.includes("Decision: Include direct rationale."));
    assert(
      !markdown.stdout.includes("Keep private mechanics hidden."),
    );
    assert(
      markdown.stdout.indexOf("#### Provider") <
        markdown.stdout.indexOf("Decision: Include direct rationale."),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("context renders component Markdown for contracts, expansions, diagnostics, and no matches", async () => {
  const root = await makeWorkspace("context-markdown-component");
  try {
    await Deno.writeTextFile(
      `${root}/plain.sigil`,
      `component Plain {
  goal {
    Render without expansions.
  }

  interface {
    PlainApi {
      run plain.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/feature.sigil`,
      `component Feature {
  goal {
    Render punctuation: <angle> & pipes | stars * safely.
  }

  interface {
    FeatureApi {
      run(value: "quoted") -> result?
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/one.sigil`,
      `expand Feature {
  logic {
    FeatureApi {
      One expansion.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/two.sigil`,
      `expand Feature {
  cases {
    FeatureApi {
      Second expansion.
    }
  }
}
`,
    );
    const plain = await runCli([
      "context",
      root,
      "--component",
      "Plain",
      "--format",
      "markdown",
    ]);
    assertEquals(plain.exitCode, EXIT_OK);
    assert(plain.stdout.startsWith("# Sigil Context\n"));
    assert(plain.stdout.includes("## Plain"));
    assert(!plain.stdout.includes("### Expansions"));

    const feature = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "markdown",
    ]);
    assertEquals(feature.exitCode, EXIT_OK);
    assert(feature.stdout.includes("## Feature"));
    assert(
      feature.stdout.includes(
        "- Render punctuation: <angle> & pipes | stars * safely.",
      ),
    );
    assert(feature.stdout.includes('- run(value: "quoted") -> result?'));
    assert(
      feature.stdout.indexOf("Source:") <
        feature.stdout.indexOf("One expansion."),
    );
    assert(feature.stdout.includes("Source:"));
    assert(feature.stdout.includes("One expansion."));
    assert(feature.stdout.includes("Second expansion."));
    assert(feature.stdout.includes("## Related Files"));

    const missing = await runCli([
      "context",
      root,
      "--component",
      "Missing",
      "--format",
      "markdown",
    ]);
    assertEquals(missing.exitCode, EXIT_OK);
    assert(missing.stdout.includes("No context matched"));

    const defaultJson = await runCli([
      "context",
      root,
      "--component",
      "Feature",
    ]);
    const explicitJson = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "json",
    ]);
    assertEquals(defaultJson.exitCode, EXIT_OK);
    assertEquals(explicitJson.exitCode, EXIT_OK);
    assertEquals(defaultJson.stdout, explicitJson.stdout);

    await Deno.writeTextFile(
      `${root}/broken.sigil`,
      `component Broken {
  goal {
    Recover partial context.
  }
}
`,
    );

    const broken = await runCli([
      "context",
      root,
      "--component",
      "Broken",
      "--format",
      "markdown",
    ]);
    assertEquals(broken.exitCode, EXIT_DIAGNOSTICS);
    assert(broken.stdout.includes("## Broken"));
    assert(broken.stdout.includes("SIGIL_MISSING_INTERFACE"));

    const json = await runCli([
      "context",
      root,
      "--component",
      "Feature",
      "--format",
      "json",
    ]);
    assertEquals(json.exitCode, EXIT_DIAGNOSTICS);
    assertEquals(parseJson(json.stdout).command, "context");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::MarkdownOutput interface,logic,constraints,cases
 */
Deno.test("context Markdown prefers file identity for duplicate component names", async () => {
  const root = await makeWorkspace("context-markdown-duplicate-name");
  try {
    await Deno.writeTextFile(
      `${root}/first.sigil`,
      `component Duplicate {
  goal {
    First duplicate.
  }

  interface {
    FirstApi {
      first()
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/second.sigil`,
      `component Duplicate {
  goal {
    Second duplicate.
  }

  interface {
    SecondApi {
      second()
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/first-detail.sigil`,
      `expand Duplicate {
  logic {
    FirstApi {
      first expansion.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/second-detail.sigil`,
      `expand Duplicate {
  logic {
    SecondApi {
      second expansion.
    }
  }
}
`,
    );

    const result = await runCli([
      "context",
      root,
      "--file",
      `${root}/second.sigil`,
      "--format",
      "markdown",
    ]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    assert(result.stdout.includes("## Duplicate"));
    assert(result.stdout.includes("- Second duplicate."));
    assert(result.stdout.includes("#### SecondApi"));
    assert(!result.stdout.includes("- First duplicate."));
    assert(!result.stdout.includes("#### FirstApi"));
    assert(result.stdout.includes("second expansion."));
    assert(result.stdout.includes("SIGIL_DUPLICATE_COMPONENT"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::MarkdownOutput interface,logic,constraints,cases
 */
Deno.test("context Markdown preserves duplicate dependency identity by import path", async () => {
  const root = await makeWorkspace("context-markdown-duplicate-dependencies");
  try {
    await Deno.mkdir(`${root}/first`);
    await Deno.mkdir(`${root}/second`);
    await Deno.writeTextFile(
      `${root}/first/provider.sigil`,
      `component Provider {
  goal {
    First provider.
  }

  interface {
    FirstProviderApi {
      first()
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/first/provider-detail.sigil`,
      `expand Provider {
  decisions {
    FirstProviderChoice {
      Decision: Use the first provider.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/second/provider.sigil`,
      `component Provider {
  goal {
    Second provider.
  }

  interface {
    SecondProviderApi {
      second()
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/second/provider-detail.sigil`,
      `expand Provider {
  decisions {
    SecondProviderChoice {
      Decision: Use the second provider.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/consumer.sigil`,
      `@first/provider.sigil import { Provider }
@second/provider.sigil import { Provider }

component Consumer {
  goal {
    Consume both providers.
  }

  interface {
    ConsumerApi {
      consume()
    }
  }
}
`,
    );

    const result = await runCli([
      "context",
      root,
      "--component",
      "Consumer",
      "--format",
      "markdown",
    ]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    assert(result.stdout.includes("first/provider.sigil"));
    assert(result.stdout.includes("second/provider.sigil"));
    assert(result.stdout.includes("#### Other Dependency Decisions"));
    assertEquals(
      countOccurrences(result.stdout, "Decision: Use the first provider."),
      1,
    );
    assertEquals(
      countOccurrences(result.stdout, "Decision: Use the second provider."),
      1,
    );
    assert(result.stdout.includes("SIGIL_DUPLICATE_COMPONENT"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::MarkdownOutput interface,logic,constraints,cases
 */
Deno.test("context Markdown preserves dependency identity for duplicate selected components", async () => {
  const root = await makeWorkspace("context-markdown-duplicate-selected");
  try {
    await Deno.mkdir(`${root}/first`);
    await Deno.mkdir(`${root}/second`);
    await Deno.writeTextFile(
      `${root}/first/provider.sigil`,
      `component FirstProvider {
  goal {
    First dependency.
  }

  interface {
    FirstDependencyApi {
      first()
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/first/provider-detail.sigil`,
      `expand FirstProvider {
  decisions {
    FirstDependencyChoice {
      Decision: Use the first dependency.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/second/provider.sigil`,
      `component SecondProvider {
  goal {
    Second dependency.
  }

  interface {
    SecondDependencyApi {
      second()
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/second/provider-detail.sigil`,
      `expand SecondProvider {
  decisions {
    SecondDependencyChoice {
      Decision: Use the second dependency.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/first/consumer.sigil`,
      `@first/provider.sigil import { FirstProvider }

component Consumer {
  goal {
    First consumer.
  }

  interface {
    ConsumerApi {
      consume first.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/second/consumer.sigil`,
      `@second/provider.sigil import { SecondProvider }

component Consumer {
  goal {
    Second consumer.
  }

  interface {
    ConsumerApi {
      consume second.
    }
  }
}
`,
    );

    const result = await runCli([
      "context",
      root,
      "--component",
      "Consumer",
      "--format",
      "markdown",
    ]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    const firstConsumer = result.stdout.indexOf("first/consumer.sigil");
    const secondConsumer = result.stdout.indexOf(
      "second/consumer.sigil",
    );
    const firstDependency = result.stdout.indexOf(
      "first/provider.sigil",
    );
    const secondDependency = result.stdout.indexOf(
      "second/provider.sigil",
    );
    assert(firstConsumer >= 0);
    assert(secondConsumer > firstConsumer);
    assert(firstDependency > firstConsumer && firstDependency < secondConsumer);
    assert(secondDependency > secondConsumer);
    assertEquals(
      countOccurrences(result.stdout, "Decision: Use the first dependency."),
      1,
    );
    assertEquals(
      countOccurrences(result.stdout, "Decision: Use the second dependency."),
      1,
    );
    assert(result.stdout.includes("SIGIL_DUPLICATE_COMPONENT"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::MarkdownOutput interface,logic,constraints,cases
 */
Deno.test("context renders file Markdown for multiple components and normalizes paths", async () => {
  const root = await makeWorkspace("context-markdown-file");
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
    assert(absolute.stdout.includes(`Workspace root: ${root}`));
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
    assert(!relative.stdout.includes(`Workspace root: ${root}`));
    assert(!relative.stdout.includes(`Source: ${root}/multi.sigil`));
    assert(relative.stdout.includes("multi.sigil"));
    assert(relative.stdout.includes("## First"));
    assert(relative.stdout.includes("## Second"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("context optionally includes direct importing-file context", async () => {
  const root = await makeWorkspace("agent-dependent-context");
  try {
    await Deno.writeTextFile(
      `${root}/provider.sigil`,
      validSigil("Provider"),
    );
    await Deno.writeTextFile(
      `${root}/consumer.sigil`,
      `@provider.sigil import { Provider }

component ConsumerA {
  goal {
    Import provider.
  }

  interface {
    runA()
  }
}

component ConsumerB {
  goal {
    Share an importing file.
  }

  interface {
    runB()
  }
}
`,
    );

    const defaultResult = await runCli([
      "context",
      root,
      "--component",
      "Provider",
      "--format",
      "json",
    ]);
    assertEquals(defaultResult.exitCode, EXIT_OK);
    assert(!("agentDependentContexts" in parseJson(defaultResult.stdout)));

    const result = await runCli([
      "context",
      root,
      "--component",
      "Provider",
      "--include-dependents",
      "--format",
      "json",
    ]);
    assertEquals(result.exitCode, EXIT_OK);
    const output = parseJson(result.stdout);
    const context = output.agentDependentContexts[0];
    assertEquals(context.selectedComponent.name, "Provider");
    assertEquals(
      context.importingFiles.map((item: { filePath: string }) =>
        item.filePath.slice(item.filePath.lastIndexOf("/") + 1)
      ).join(","),
      "consumer.sigil",
    );
    assertEquals(context.importingFiles[0].importedComponent.name, "Provider");
    assertEquals(
      context.importingFiles[0].contextualContracts.map((
        item: { name: string },
      ) => item.name).join(","),
      "ConsumerA,ConsumerB",
    );
    assertEquals(context.importingFiles[0].importEdges.length, 1);

    const markdown = await runCli([
      "context",
      root,
      "--component",
      "Provider",
      "--include-dependents",
      "--format",
      "markdown",
    ]);
    assertEquals(markdown.exitCode, EXIT_OK);
    assert(markdown.stdout.includes("### Direct Dependents"));
    assert(markdown.stdout.includes("consumer.sigil"));
    assert(markdown.stdout.includes("##### Contextual Contracts"));
    assert(markdown.stdout.includes("###### ConsumerA"));
    assert(markdown.stdout.includes("###### ConsumerB"));

    const markdownWithoutDependents = await runCli([
      "context",
      root,
      "--component",
      "Provider",
      "--format",
      "markdown",
    ]);
    assertEquals(markdownWithoutDependents.exitCode, EXIT_OK);
    assert(!markdownWithoutDependents.stdout.includes("### Direct Dependents"));
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

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
Deno.test("check rejects an imports-only module index in an internal directory", async () => {
  const root = await makeWorkspace("internal-module-index");
  try {
    await Deno.mkdir(`${root}/internal`);
    await Deno.writeTextFile(
      `${root}/internal/#module.sigil`,
      "@internal/contract.sigil import { Internal }\n",
    );
    await Deno.writeTextFile(
      `${root}/internal/contract.sigil`,
      validSigil("Internal"),
    );
    await Deno.writeTextFile(
      `${root}/consumer.sigil`,
      `@internal import { Internal }\n\n${validSigil("Consumer")}`,
    );
    const result = await runCli(["check", root, "--format", "json"]);
    assertEquals(result.exitCode, EXIT_DIAGNOSTICS);
    assertHasCode(
      parseJson(result.stdout).diagnostics,
      "SIGIL_MODULE_WITHOUT_COMPONENT",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
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

// @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
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
    assertEquals(parseJson(result.stdout).glossaryContext, null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::GlossaryInspection interface,logic,cases
 */
Deno.test("context includes only glossary terms from related Sigil files", async () => {
  const root = await makeWorkspace("glossary-context");
  try {
    await Deno.mkdir(`${root}/.sigil`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.sigil/glossary.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          terms: [
            {
              term: "workspace root",
              definition: "The directory containing .sigil/config.json.",
            },
            {
              term: "unused term",
              definition: "Vocabulary unrelated to the selected component.",
            },
            {
              term: "Decision:",
              definition: "A reviewed rationale-writing convention.",
              agentContext: false,
            },
          ],
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
    );
    await Deno.writeTextFile(
      `${root}/contract.sigil`,
      `component Feature {
  goal {
    Decision: Operate from the workspace root.
  }

  interface {
    Reservation {
      Creates a hold.
    }
  }
}
`,
    );
    await Deno.writeTextFile(
      `${root}/expand.sigil`,
      `expand Feature {
  cases {
    Reservation {
      A temporary reservation remains temporary.
    }
  }
}
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
    assertEquals(result.exitCode, EXIT_OK);
    const context = parseJson(result.stdout).glossaryContext;
    assert(context.glossaryPath.endsWith("/.sigil/glossary.json"));
    assertEquals(
      context.terms.map((term: { term: string }) => term.term).join(","),
      "workspace root,hold",
    );
    assertEquals(context.resolvedContexts.length, 2);
    assert(
      context.occurrences.some(
        (occurrence: { matchedSpelling: string }) =>
          occurrence.matchedSpelling === "temporary reservation",
      ),
    );
    assert(
      !context.terms.some(
        (term: { term: string }) => term.term === "unused term",
      ),
    );
    assert(
      !context.terms.some(
        (term: { term: string }) => term.term === "Decision:",
      ),
    );
    const glossaryResult = await runCli([
      "glossary",
      root,
      "--format",
      "json",
    ]);
    assertEquals(glossaryResult.exitCode, EXIT_OK);
    assert(
      parseJson(glossaryResult.stdout).occurrences.some(
        (occurrence: { term: { term: string } }) =>
          occurrence.term.term === "Decision:",
      ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::StructuredOutput interface,constraints
 */
Deno.test("render JSON includes workspace metadata and Markdown", async () => {
  const result = await runCli(["render", "../..", "--format", "json"]);
  assertEquals(result.exitCode, EXIT_OK);
  const json = parseJson(result.stdout);
  assertEquals(json.workspaceName, "sigil");
  assert(json.markdown.includes("# Sigil Workspace"));
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::MarkdownOutput interface,constraints,cases
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
        "- error SIGIL_MISSING_INTERFACE: component Broken is missing required interface section.",
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
 * @sigil tests packages/cli/#module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::ExitStatus constraints,cases
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
  const runtime = await runCli(["parse", "does-not-exist.sigil"]);
  assertEquals(runtime.exitCode, EXIT_RUNTIME);
});

// @sigil tests packages/cli/#module.sigil::SigilCli::CliInvocation interface,logic,cases
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

// @sigil tests packages/cli/#module.sigil::SigilCli::CliInvocation interface,logic,cases
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
 * @sigil tests packages/cli/#module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil tests packages/cli/#module.sigil::SigilCli::ArtifactVersionOwnership constraints
 */
Deno.test("version flag reports CLI information", async () => {
  const version = await runCli(["--version"]);
  assertEquals(version.exitCode, EXIT_OK);
  assertEquals(version.stdout, "0.7.0\n");
  assertEquals(version.stderr, "");
});

/*
 * @sigil tests packages/cli/#module.sigil::SigilCli::SkillInstallation interface,logic,constraints,cases
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
      `${source}/sigil/#module.sigil`,
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

// @sigil tests packages/cli/#module.sigil::SigilCli::CliInvocation interface,logic,cases
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
    "0.7.0",
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

class FailingListFileSystem implements SigilFileSystem {
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
