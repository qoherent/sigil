import { AdapterFailure, compile } from "@qoherent/sigil-compiler";
import { CodexAdapter } from "../src/mod.ts";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SIGIL_VERSION } from "@qoherent/sigil-core";

async function workspace(
  source: string,
  extraFiles: Readonly<Record<string, string>> = {},
  compileConfiguration?: unknown,
): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: SIGIL_VERSION,
      workspace: { name: "test", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: compileConfiguration === undefined
        ? {}
        : { compile: compileConfiguration },
    }),
  );
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  for (const [path, contents] of Object.entries(extraFiles)) {
    await Deno.writeTextFile(`${root}/${path}`, contents);
  }
  return root;
}

// @sigil tests packages/compiler-adapter-codex/src/codex-adapter.sigil::SigilCodexCompilerAdapter::CodexAdapter interface,logic,cases
function retrievalFixture(
  purpose: "semantic" | "architecture" | "implementation" = "semantic",
) {
  return {
    schema: "sigil-purpose-retrieval/v1",
    policyVersion: 1,
    workspaceSnapshotIdentity: "sha256:test-snapshot",
    target: {
      kind: "component",
      componentName: "Example",
      pathStatus: "accepted",
      path: "main.sigil",
    },
    purpose,
    graph: { nodes: [], edges: [] },
    evidence: [],
    inclusionReasons: [],
    exclusions: [],
    context: { sections: [] },
    diagnostics: [],
    fingerprint: "sha256:test-retrieval",
  } as const;
}

function retrievalBriefFixture(
  purpose: "semantic" | "architecture" | "implementation" = "semantic",
) {
  return {
    purpose,
    componentName: "Example",
    sigilFile: "main.sigil",
    retrievalFingerprint: "sha256:test-retrieval",
    markdown: "Retrieval: sha256:test-retrieval\n\nTarget: Example (semantic)",
    allowedDirectReadPaths: ["main.sigil"],
  } as const;
}

Deno.test("Codex adapter enforces direct-read invocation and records structured trace", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    let observedArgs: readonly string[] = [];
    let observedPrompt = "";
    const adapter = new CodexAdapter(
      undefined,
      (_command, args, input, onFrame) => {
        observedArgs = args;
        observedPrompt = input;
        onFrame({
          channel: "stdout",
          text: [
            JSON.stringify({
              type: "item.completed",
              item: {
                type: "command_execution",
                command:
                  '/bin/zsh -lc "rg -n \\"SigilCompiler|sigil compile|compile\\\\(\\" packages/compiler packages/cli\nsed -n \\"1,240p\\" packages/compiler/src/compiler.sigil"',
                status: "completed",
                exit_code: 0,
              },
            }),
            JSON.stringify({
              type: "item.completed",
              item: {
                type: "agent_message",
                text: JSON.stringify({ findings: [] }),
              },
            }),
            JSON.stringify({
              type: "turn.completed",
              usage: { input_tokens: 100, output_tokens: 5 },
            }),
          ].join("\n"),
        });
        return Promise.resolve();
      },
    );
    const result = await adapter.evaluate({
      stage: "semantic-readiness",
      purpose: "semantic",
      skill: "Inspect files.",
      allowedRules: ["SEMANTIC_AMBIGUITY"],
      implementationEvidence: "context-only",
      workspaceRoot: root,
      workspaceSnapshotIdentity: "sha256:test-snapshot",
      target: {
        componentName: "Example",
        sigilFile: "main.sigil",
        initialPaths: ["main.sigil"],
        retrieval: retrievalFixture(),
        retrievalBrief: retrievalBriefFixture(),
      },
      capabilities: {
        schemaVersion: 1,
        workspaceAccess: "read-only",
        agentToolNetwork: false,
        approvalEscalation: false,
        statePersistence: "ephemeral",
      },
      commandPolicy: {
        allowedCommands: ["sigil check"],
        forbiddenCommands: ["sigil compile"],
      },
      observability: adapter.observability,
      limits: {
        maxInitialRequestChars: 1_000_000,
        maxProviderFrameChars: 1_000_000,
        maxFinalResultChars: 1_000_000,
        maxRetainedCommandOutputChars: 10_000,
        providerCleanupMs: 5_000,
      },
      budgets: {
        elapsedTimeMs: 30_000,
        maxCommands: 10,
        maxCommandOutputChars: 10_000,
        maxInputTokens: 1_000,
        maxOutputTokens: 100,
      },
    });
    assertEquals(observedArgs.includes("--ephemeral"), true);
    assertEquals(observedArgs.includes("read-only"), true);
    assertEquals(observedArgs[observedArgs.indexOf("-C") + 1], root);
    assertEquals(observedArgs.includes("--json"), true);
    assertMatch(observedPrompt, /use selected evidence by default/);
    assertMatch(
      observedPrompt,
      /Only when that evidence is insufficient\s+because an explicit evidence gap blocks evaluation/,
    );
    assertMatch(
      observedPrompt,
      /perform targeted graph or\s+context inspection/,
    );
    assertMatch(
      observedPrompt,
      /Do not broadly rediscover the repository or redefine the authoritative scope/,
    );
    assertMatch(
      observedPrompt,
      /point into the\s+smallest exact source statement/,
    );
    assertMatch(
      observedPrompt,
      /For a conflict, anchor the primary statement/,
    );
    assertMatch(
      observedPrompt,
      /compiler owns semantic identity; do not invent\s+semantic subjects/,
    );
    assertMatch(observedPrompt, /Implementation evidence policy: context-only/);
    assertMatch(observedPrompt, /Retrieval: sha256:test-retrieval/);
    assertEquals(observedPrompt.includes("sigil-purpose-retrieval\/v1"), false);
    assertEquals(observedPrompt.includes('"inclusionReasons"'), false);
    assertMatch(
      observedPrompt,
      /do not report a finding solely because current implementation/,
    );
    const emptyFindingsExample = observedPrompt.match(/\{"findings":\[\]\}/)
      ?.[0];
    assertEquals(JSON.parse(emptyFindingsExample ?? "{}").findings, []);
    assertEquals(observedPrompt.includes('{"code":string'), false);
    assertMatch(result.commands[0].command, /rg -n/);
    assertEquals(result.usage?.inputTokens, 100);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler-adapter-codex/src/codex-adapter.sigil::SigilCodexCompilerAdapter::CodexAdapter interface,logic,cases
Deno.test("Codex classifies initial request overflow as an operational limit", async () => {
  let invoked = false;
  const adapter = new CodexAdapter(undefined, async () => {
    invoked = true;
    await Promise.resolve();
  });
  const error = await assertRejects(
    () =>
      adapter.evaluate({
        stage: "semantic-readiness",
        purpose: "semantic",
        skill: "Inspect files.",
        allowedRules: ["SEMANTIC_AMBIGUITY"],
        implementationEvidence: "context-only",
        workspaceRoot: Deno.cwd(),
        workspaceSnapshotIdentity: "sha256:test-snapshot",
        target: {
          componentName: "Example",
          sigilFile: "main.sigil",
          initialPaths: ["main.sigil"],
          retrieval: retrievalFixture(),
          retrievalBrief: retrievalBriefFixture(),
        },
        capabilities: adapter.capabilities,
        commandPolicy: { allowedCommands: [], forbiddenCommands: [] },
        observability: adapter.observability,
        limits: {
          maxInitialRequestChars: 1,
          maxProviderFrameChars: 1_000,
          maxFinalResultChars: 1_000,
          maxRetainedCommandOutputChars: 1_000,
          providerCleanupMs: 1_000,
        },
        budgets: {
          elapsedTimeMs: 1_000,
          maxCommands: 1,
          maxCommandOutputChars: 1_000,
          maxInputTokens: 1,
          maxOutputTokens: 1,
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "operational-limit");
  assertEquals(invoked, false);
});

Deno.test("Codex adapter rejects an actually invoked nested compilation", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    const adapter = new CodexAdapter(undefined, (
      _command,
      _args,
      _input,
      onFrame,
    ) => {
      onFrame({
        channel: "stdout",
        text: [
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "command_execution",
              command:
                '/bin/zsh -lc "rg -n \\"compile\\" packages/compiler\nsigil compile ."',
              status: "completed",
              exit_code: 0,
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({ findings: [] }),
            },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 100, output_tokens: 5 },
          }),
        ].join("\n"),
      });
      return Promise.resolve();
    });
    await assertRejects(
      () =>
        adapter.evaluate({
          stage: "semantic-readiness",
          purpose: "semantic",
          skill: "Inspect files.",
          allowedRules: ["SEMANTIC_AMBIGUITY"],
          implementationEvidence: "context-only",
          workspaceRoot: root,
          workspaceSnapshotIdentity: "sha256:test-snapshot",
          target: {
            componentName: "Example",
            sigilFile: "main.sigil",
            initialPaths: ["main.sigil"],
            retrieval: retrievalFixture(),
            retrievalBrief: retrievalBriefFixture(),
          },
          capabilities: {
            schemaVersion: 1,
            workspaceAccess: "read-only",
            agentToolNetwork: false,
            approvalEscalation: false,
            statePersistence: "ephemeral",
          },
          commandPolicy: {
            allowedCommands: ["rg", "sigil check"],
            forbiddenCommands: ["sigil compile"],
          },
          observability: adapter.observability,
          limits: {
            maxInitialRequestChars: 1_000_000,
            maxProviderFrameChars: 1_000_000,
            maxFinalResultChars: 1_000_000,
            maxRetainedCommandOutputChars: 10_000,
            providerCleanupMs: 5_000,
          },
          budgets: {
            elapsedTimeMs: 30_000,
            maxCommands: 10,
            maxCommandOutputChars: 10_000,
            maxInputTokens: 1_000,
            maxOutputTokens: 100,
          },
        }),
      Error,
      "violated the read-only inspection contract",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/adapter-subprocess.sigil::SigilAgentAdapterSubprocess::AdapterSubprocess logic,cases
Deno.test("Codex process failure preserves complete stderr in the compiler report", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  try {
    const stderr = "provider detail one\nprovider detail two\n";
    const adapter = new CodexAdapter(undefined, async (
      _command,
      _args,
      _input,
      onFrame,
    ) => {
      await onFrame({ channel: "stderr", text: stderr });
      throw new AdapterFailure("process", "codex exited with 1:");
    });
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter,
    });
    assertMatch(
      report.diagnostics.find((item) =>
        item.code === "COMPILER_EVALUATOR_INCOMPLETE"
      )?.message ?? "",
      /provider detail one\nprovider detail two/,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
