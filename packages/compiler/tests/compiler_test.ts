import {
  AdapterFailure,
  compilationColor,
  type CompilationEvent,
  type CompilationHistoryStore,
  type CompilationReport,
  compile,
  CompilerFailure,
  createAdapterSubprocessHandle,
  deriveBudgetOutcome,
  FileCompilationHistoryStore,
  loadEvaluationSkill,
  loadEvaluationSkills,
  MockAdapter,
  openCompilationEventWriter,
  renderCompilationReportMarkdown,
  resolveAdapterRegistration,
  runAdapterSubprocess,
  validateAgentEvaluationResult,
  validateCompilationEventStream,
} from "../src/mod.ts";
import { deriveEvaluatorRetrievalBrief } from "../src/evaluator-retrieval.ts";
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";

async function workspace(
  source: string,
  extraFiles: Readonly<Record<string, string>> = {},
  compileConfiguration?: unknown,
  exclude: readonly string[] = [],
): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.8.0",
      workspace: { name: "test", members: [] },
      files: { include: ["**/*.sigil"], exclude },
      tools: compileConfiguration === undefined
        ? {}
        : { compile: compileConfiguration },
    }),
  );
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  for (const [path, contents] of Object.entries(extraFiles)) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) {
      await Deno.mkdir(`${root}/${path.slice(0, slash)}`, { recursive: true });
    }
    await Deno.writeTextFile(`${root}/${path}`, contents);
  }
  return root;
}

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

// @sigil tests packages/compiler/src/evaluator-retrieval.sigil::SigilEvaluatorRetrievalBrief::EvaluatorRetrievalBrief logic,constraints,cases
Deno.test("evaluator retrieval brief projects a readable graph without raw JSON", async () => {
  const retrieval = {
    ...retrievalFixture(),
    graph: {
      nodes: [
        {
          identity: "n:example",
          kind: "component-declaration" as const,
          path: "main.sigil",
          componentName: "Example",
        },
        {
          identity: "n:dependency",
          kind: "component-declaration" as const,
          path: "dependency.sigil",
          componentName: "Dependency",
        },
      ],
      edges: [{
        identity: "e:dependency",
        relation: "direct-dependency" as const,
        sourceIdentity: "n:example",
        targetIdentity: "n:dependency",
        originPath: "main.sigil",
      }],
    },
  };
  const brief = await deriveEvaluatorRetrievalBrief(retrieval, ".");
  assertMatch(
    brief.markdown,
    /Dependency graph\n- Example \(main\.sigil\) --direct-dependency--> Dependency \(dependency\.sigil\)/,
  );
  assertEquals(brief.markdown.includes('"identity"'), false);
  assertEquals(brief.markdown.includes('"evidence"'), false);
  assertEquals(brief.allowedDirectReadPaths, ["main.sigil"]);
});

Deno.test("terminal findings require nullable location fields", () => {
  const request = {
    budgets: {
      elapsedTimeMs: 1_000,
      maxCommands: 1,
      maxCommandOutputChars: 1_000,
      maxInputTokens: 1,
      maxOutputTokens: 1,
    },
    observability: {
      usage: "unavailable",
      cost: "unavailable",
      tokenBudgetEnforcement: "unavailable",
      costBudgetEnforcement: "unavailable",
    },
  } as never;
  const finding = {
    code: "SEMANTIC_AMBIGUITY",
    severity: "warning" as const,
    message: "Location-independent finding.",
    filePath: null,
    line: null,
    column: null,
    evidence: "No physical workspace evidence is available.",
    impact: "The contract remains ambiguous.",
    correction: "Supply the missing contract evidence.",
  };
  assertEquals(
    validateAgentEvaluationResult(request, {
      findings: [finding],
      commands: [],
    })
      .findings[0].filePath,
    null,
  );
  const { filePath: _filePath, ...missingLocation } = finding;
  assertThrows(() =>
    validateAgentEvaluationResult(request, {
      findings: [missingLocation],
      commands: [],
    } as never)
  );
});

Deno.test("subprocess execution declares owned inputs before an attempted launch", async () => {
  const observations: string[] = [];
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.adapter@1",
        command: "/definitely-not-a-provider-command",
        args: [],
        cwd: Deno.cwd(),
        input: "{}",
        signal: new AbortController().signal,
        maxInitialRequestChars: 10,
        maxProviderFrameChars: 10,
        handle: createAdapterSubprocessHandle("test.adapter@1"),
        resources: {
          declareResource: (identity) =>
            observations.push(`resource:${identity}`),
          declareResultInput: (identity) =>
            observations.push(`input:${identity}`),
          observeResource() {},
          observeResultInput() {},
          reportResourceObservation() {},
          reportResultInputObservation() {},
          cleanupAttempt() {},
        },
        terminationControl: { requestPreventiveBudgetTermination() {} },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "process");
  assertEquals(observations, [
    "resource:process:test.adapter@1",
    "input:result-input:stdout",
    "input:result-input:stderr",
  ]);
});

// @sigil tests packages/compiler/src/adapter-subprocess.sigil::SigilAgentAdapterSubprocess::AdapterSubprocess logic,cases
Deno.test("subprocess process failures retain stderr verbatim", async () => {
  const stderr = "  provider detail\n";
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.adapter@1",
        command: Deno.execPath(),
        args: [
          "eval",
          `await Deno.stderr.write(new TextEncoder().encode(${
            JSON.stringify(stderr)
          })); Deno.exit(7);`,
        ],
        cwd: Deno.cwd(),
        input: "{}",
        signal: new AbortController().signal,
        maxInitialRequestChars: 10,
        maxProviderFrameChars: 100,
        handle: createAdapterSubprocessHandle("test.adapter@1"),
        resources: {
          declareResource() {},
          declareResultInput() {},
          observeResource() {},
          observeResultInput() {},
          reportResourceObservation() {},
          reportResultInputObservation() {},
          cleanupAttempt() {},
        },
        terminationControl: { requestPreventiveBudgetTermination() {} },
      }),
    AdapterFailure,
  );
  assertEquals(error.message.endsWith(stderr), true);
});

// @sigil tests packages/compiler/src/evaluation-registry.sigil::SigilEvaluationSkillRegistry::EvaluationSkillPackage interface,logic,constraints,cases
Deno.test("evaluation skills declare implementation evidence authority and modularity rules", async () => {
  const skills = await loadEvaluationSkills();
  assertEquals(
    skills.get("semantic-readiness")?.manifest.implementationEvidence,
    "context-only",
  );
  assertEquals(
    skills.get("architecture-design")?.manifest.implementationEvidence,
    "context-only",
  );
  assertEquals(
    skills.get("current-code-compatibility")?.manifest.implementationEvidence,
    "compare",
  );
  assertEquals(
    skills.get("standards-risk")?.manifest.implementationEvidence,
    "context-only",
  );
  const architectureRules = skills.get("architecture-design")?.manifest.rules ??
    [];
  for (
    const rule of [
      "COMPONENT_DECOMPOSITION",
      "OWNERSHIP_BOUNDARY",
      "INTERFACE_BOUNDARY",
      "COUPLING",
      "DEPENDENCY_CYCLE",
      "MODULE_INDEX_SCOPE",
      "IMPORTED_NAMESPACE_REUSE",
      "PRESENTATION_BOUNDARY",
      "UI_STATE_OWNERSHIP",
    ]
  ) {
    assertEquals(architectureRules.includes(rule), true);
  }
  for (const skill of skills.values()) {
    const guidance = skill.guidance.replaceAll(/\s+/g, " ");
    assertMatch(guidance, /Use selected downstream evidence by default/);
    assertMatch(
      guidance,
      /Only when that evidence is insufficient/,
    );
    assertMatch(guidance, /explicit evidence gap blocks evaluation/);
    assertMatch(guidance, /perform targeted graph or context inspection/);
    assertMatch(
      guidance,
      /Do not broadly rediscover the repository/,
    );
    assertMatch(guidance, /downstream dependency closure/);
  }
});

// @sigil tests packages/compiler/src/evaluation-registry.sigil::SigilEvaluationSkillRegistry::EvaluationSkillPackage interface,constraints,cases
Deno.test("evaluation skill loading returns closed tagged outcomes", async () => {
  assertEquals((await loadEvaluationSkill("unknown", "1")).kind, "unavailable");
  assertEquals(
    (await loadEvaluationSkill("semantic-readiness", "missing")).kind,
    "unavailable",
  );
  assertEquals(
    (await loadEvaluationSkill("semantic-readiness", "1.2.0")).kind,
    "ready",
  );
});

// @sigil tests packages/compiler/src/adapters.sigil::SigilAgentAdapter::AgentAdapter logic,cases
Deno.test("provider identities and exact adapter registrations are closed", () => {
  const adapter = new MockAdapter([], "first");
  assertEquals(
    resolveAdapterRegistration([adapter], {
      provider: "mock",
      implementationId: "test.mock.first",
      implementationVersion: "1.0.0",
    }),
    adapter,
  );
  assertRejects(
    () =>
      Promise.resolve().then(() =>
        resolveAdapterRegistration([], {
          provider: "mock",
          implementationId: "test.mock.first",
          implementationVersion: "1.0.0",
        })
      ),
    Error,
    "found 0",
  );
});

// @sigil tests packages/compiler/src/evaluation-execution.sigil::SigilAgentExecutionPolicy::AgentBudgetOutcome interface,cases
Deno.test("budget outcomes preserve unavailable telemetry", () => {
  assertEquals(
    deriveBudgetOutcome(
      {
        elapsedTimeMs: 1,
        maxCommands: 1,
        maxCommandOutputChars: 1,
        maxInputTokens: 10,
      },
      new MockAdapter().observability,
      undefined,
      "unavailable",
      undefined,
      "unavailable",
    ),
    { token: "indeterminate", cost: "not-configured" },
  );
});

Deno.test("malformed adapter result envelopes fail compilation", async () => {
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
    const report = await compile(root, { kind: "workspace" }, "standard", {
      adapter: new MockAdapter({
        findings: "not-an-array",
        commands: [],
      } as never),
    });
    assertEquals(report.status, "red");
    assertEquals(
      report.stages.find((stage) => stage.id === "semantic-readiness")?.state,
      "failed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::DeterministicFoundationGating logic,constraints,cases
Deno.test("structural diagnostics skip dependent evaluator stages", async () => {
  const root = await workspace(`component Example {
  unsupported {
    content
  }
}
`);
  try {
    let calls = 0;
    const events: CompilationEvent[] = [];
    const report = await compile(root, { kind: "workspace" }, "standard", {
      adapter: new MockAdapter(() => {
        calls++;
        return [];
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });
    assertEquals(report.status, "red");
    assertEquals(calls, 0);
    assertEquals(
      report.stages.find((stage) => stage.id === "deterministic-foundation")
        ?.state,
      "failed",
    );
    assertEquals(
      report.stages.find((stage) => stage.id === "semantic-readiness")?.state,
      "skipped-by-dependency",
    );
    assertEquals(
      report.stages.find((stage) => stage.id === "current-code-compatibility")
        ?.state,
      "skipped-by-dependency",
    );
    assertEquals(events.at(-1)?.type, "completed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/event-writer.sigil::SigilCompilationEventWriter::CompilationEventWriterProtocol interface,constraints,cases
 * @sigil tests packages/compiler/src/event-reader.sigil::SigilCompilationEventReader::CompilationEventReaderProtocol interface,constraints,cases
 */
Deno.test("event writer suppresses progress and preserves one terminal", async () => {
  const frames: Uint8Array[] = [];
  let calls = 0;
  const opened = await openCompilationEventWriter((bytes) => {
    calls++;
    if (calls === 2) return Promise.resolve("rejected-zero-compatible");
    frames.push(bytes);
    return Promise.resolve("delivered-all");
  }, {
    operation: "one-shot-compilation",
    stageIdentities: ["semantic-readiness"],
  });
  if (opened.kind !== "ready") throw new Error("writer did not open");
  assertEquals(
    await opened.writer.stageStarted("semantic-readiness"),
    "suppressed",
  );
  assertEquals(
    await opened.writer.failed("COMPILER_FAILED", "failed"),
    "delivered",
  );
  const result = await validateCompilationEventStream(
    (async function* () {
      for (const frame of frames) yield frame;
    })(),
    {
      operation: "one-shot-compilation",
      stageIdentities: ["semantic-readiness"],
    },
    new AbortController().signal,
  );
  assertEquals(result.kind, "terminal");
  if (result.kind === "terminal") assertEquals(result.event.type, "failed");
});

/*
 * @sigil tests packages/compiler/src/compiler.sigil::SigilOneShotCompilation::CompilationInvocation logic,cases
 * @sigil tests packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceDiscovery logic,cases
 */
Deno.test("compile discovers workspace config from a Sigil file path", async () => {
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
    const report = await compile(
      `${root}/main.sigil`,
      { kind: "workspace" },
      "standard",
      { adapter: new MockAdapter() },
    );
    assertEquals(report.workspaceRoot, root.replaceAll("\\", "/"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/status.sigil::SigilCompilationStatus::CompilationStatus logic,cases
Deno.test("standard profile becomes green only with complete warning-free evaluation", async () => {
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
    const events: CompilationEvent[] = [];
    const report = await compile(root, { kind: "workspace" }, "standard", {
      adapter: new MockAdapter(),
      eventSink: async (bytes) => {
        events.push(JSON.parse(new TextDecoder().decode(bytes)));
        await Promise.resolve();
        return "delivered-all";
      },
    });
    assertEquals(report.status, "green");
    assertEquals(
      report.stages.every((item) => item.state === "completed"),
      true,
    );
    assertEquals(events.at(-1)?.type, "completed");
    assertEquals(
      events.map((event) => event.sequence),
      events.map((_, i) => i + 1),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/status.sigil::SigilCompilationStatus::CompilationStatus logic,cases
Deno.test("warnings produce yellow and errors produce red", async () => {
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
    const warning = {
      code: "SEMANTIC_AMBIGUITY",
      severity: "warning" as const,
      message: "Boundary is unclear.",
      filePath: null,
      line: null,
      column: null,
      evidence: "The interface omits its result.",
      impact: "Consumers cannot rely on the operation.",
      correction: "Define the result.",
    };
    const yellow = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([warning]),
    });
    assertEquals(yellow.status, "yellow");
    const red = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([{ ...warning, severity: "error" }]),
    });
    assertEquals(red.status, "red");
    assertMatch(red.diagnostics[0].fingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/status.sigil::SigilCompilationStatus::CompilationStatus logic,cases
Deno.test("failed optional stages remain visible without preventing green", () => {
  assertEquals(
    compilationColor([], [{
      id: "optional-stage",
      required: false,
      state: "failed",
      evaluator: "test",
      diagnosticCount: 1,
    }]),
    "green",
  );
});

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::StageConfiguration logic,constraints,cases
Deno.test("stage bindings resolve the default evaluator binding instead of adapter instance ID", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      adapter: {
        provider: "mock",
        implementationId: "test.mock.default",
        implementationVersion: "1.0.0",
      },
      profiles: {
        standard: { main: ["default"] },
      },
    },
  );
  try {
    const report = await compile(
      root,
      { kind: "workspace" },
      "standard",
      {
        requestedStage: "semantic-readiness",
        adapters: [new MockAdapter([], "mock", "test.mock.default")],
      },
    );
    assertEquals(report.status, "green");
    assertEquals(
      report.stages.find((stage) => stage.id === "semantic-readiness")?.state,
      "completed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::StageConfiguration constraints,cases
Deno.test("critical-system adds risk evaluation without implementation stages", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        first: {
          provider: "mock",
          implementationId: "test.mock.first",
          implementationVersion: "1.0.0",
        },
        second: {
          provider: "mock",
          implementationId: "test.mock.second",
          implementationVersion: "1.0.0",
        },
      },
      profiles: {
        "critical-system": { evaluatorIds: ["first", "second"] },
      },
    },
  );
  try {
    const report = await compile(
      root,
      { kind: "workspace" },
      "critical-system",
      {
        adapters: [
          new MockAdapter([], "first"),
          new MockAdapter([], "second"),
        ],
      },
    );
    assertEquals(
      report.stages.find((item) => item.id === "standards-risk")?.state,
      "completed",
    );
    assertEquals(
      report.stages.some((item) =>
        item.id.includes("implementation") ||
        item.id.includes("code-generation")
      ),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::StageConfiguration constraints,cases
Deno.test("critical-system configuration is optional until the profile is selected", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        unused: { provider: "unsupported" },
      },
    },
  );
  try {
    const standard = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    assertEquals(standard.status, "green");

    const events: CompilationEvent[] = [];
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "critical-system", {
          adapter: new MockAdapter(),
          onEvent: (event) => {
            events.push(event);
          },
        }),
      Error,
      "requires at least two distinct",
    );
    assertEquals(events, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("invalid targets reject before binding an event writer", async () => {
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
    const events: CompilationEvent[] = [];
    await assertRejects(
      () =>
        compile(
          root,
          { kind: "component", componentName: "Missing" },
          "standard",
          {
            adapter: new MockAdapter(),
            onEvent: (event) => {
              events.push(event);
            },
          },
        ),
      Error,
      "No loaded component is named",
    );
    assertEquals(events, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("unknown profiles and stages use invalid-invocation failures", async () => {
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
    const unknownProfile = await assertRejects(
      () => compile(root, { kind: "workspace" }, "missing-profile"),
      CompilerFailure,
    );
    assertEquals(unknownProfile.code, "COMPILER_INVALID_INVOCATION");

    const unknownStage = await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          requestedStage: "missing-stage",
        }),
      CompilerFailure,
    );
    assertEquals(unknownStage.code, "COMPILER_INVALID_INVOCATION");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("standard evaluator binding failures use profile-evaluator failures", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      adapter: {
        provider: "mock",
        implementationId: "configured.adapter",
        implementationVersion: "1.0.0",
      },
    },
  );
  try {
    const error = await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          adapter: new MockAdapter([], "different"),
        }),
      CompilerFailure,
    );
    assertEquals(error.code, "COMPILER_PROFILE_EVALUATORS_REQUIRED");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/status.sigil::SigilCompilationStatus::CompilationStatus cases
Deno.test("critical-system evaluator failure ends the run with the profile error", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        first: {
          provider: "mock",
          implementationId: "test.mock.first",
          implementationVersion: "1.0.0",
        },
        second: {
          provider: "mock",
          implementationId: "test.mock.second",
          implementationVersion: "1.0.0",
        },
      },
      profiles: {
        "critical-system": { evaluatorIds: ["first", "second"] },
      },
    },
  );
  try {
    const events: CompilationEvent[] = [];
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "critical-system", {
          requestedStage: "semantic-readiness",
          adapters: [
            new MockAdapter(() => {
              throw new Error("evaluator executable is unavailable");
            }, "first"),
            new MockAdapter([], "second"),
          ],
          onEvent: (event) => {
            events.push(event);
          },
        }),
      Error,
      "required critical-system evaluator",
    );
    assertEquals(events.at(-1)?.type, "failed");
    assertEquals(
      events.at(-1)?.payload.code,
      "COMPILER_PROFILE_EVALUATORS_REQUIRED",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/compilation-target.sigil::SigilCompilationTarget::CompilationTarget logic,cases
Deno.test("location targets select enclosing components through expand files", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {
      "details.sigil": `@main.sigil import { Example }

expand Example {
  logic {
    The selected expansion belongs to Example.
  }
}
`,
    },
  );
  try {
    const report = await compile(
      root,
      {
        kind: "location",
        filePath: "details.sigil",
        line: 5,
        column: 8,
      },
      "standard",
      {
        requestedStage: "semantic-readiness",
        adapter: new MockAdapter(),
      },
    );
    assertEquals(report.componentNames, ["Example"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/status.sigil::SigilCompilationStatus::CompilationStatus logic,cases
Deno.test("independent evaluator disagreement is explicit", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`,
    {},
    {
      evaluators: {
        first: {
          provider: "mock",
          implementationId: "test.mock.first",
          implementationVersion: "1.0.0",
        },
        second: {
          provider: "mock",
          implementationId: "test.mock.second",
          implementationVersion: "1.0.0",
        },
      },
      profiles: {
        critical: {
          extends: "critical-system",
          evaluatorIds: ["first", "second"],
        },
      },
    },
  );
  try {
    const finding = {
      code: "SEMANTIC_AMBIGUITY",
      severity: "warning" as const,
      message: "The goal is ambiguous.",
      filePath: "main.sigil",
      line: 3,
      column: 5,
      evidence: "The goal lacks a measurable result.",
      impact: "Implementations may diverge.",
      correction: "State the expected result.",
    };
    const report = await compile(root, { kind: "workspace" }, "critical", {
      requestedStage: "semantic-readiness",
      adapters: [
        new MockAdapter([finding], "first"),
        new MockAdapter([], "second"),
      ],
    });
    assertEquals(
      report.diagnostics.some((item) =>
        item.code === "COMPILER_EVALUATOR_DISAGREEMENT"
      ),
      true,
    );
    assertEquals(report.status, "yellow");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::AgentFindingIdentityCollapse logic,constraints,cases
Deno.test("duplicate findings in one evaluator payload emit once and complete", async () => {
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
    const events: CompilationEvent[] = [];
    const first = {
      code: "SEMANTIC_AMBIGUITY",
      severity: "warning" as const,
      message: "The goal is ambiguous.",
      filePath: "main.sigil",
      line: 3,
      column: 5,
      evidence: "The goal lacks a measurable result.",
      impact: "Implementations may diverge.",
      correction: "State the expected result.",
    };
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([
        first,
        { ...first, message: "Equivalent finding with different wording." },
      ]),
      onEvent: (event) => {
        events.push(event);
      },
    });
    assertEquals(
      report.diagnostics.filter((item) => item.code === first.code).length,
      1,
    );
    assertEquals(
      events.filter((event) => event.type === "diagnostic").length,
      1,
    );
    assertEquals(events.at(-1)?.type, "completed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/history-store.sigil::SigilCompilationHistoryStore::CompilationHistoryStore logic,cases
Deno.test("history derives unchanged, resolved, and regressed lifecycle", async () => {
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
  const reports = new Map<string, Awaited<ReturnType<typeof compile>>>();
  const history = {
    read: (key: string) => Promise.resolve(reports.get(key)),
    write: (key: string, report: Awaited<ReturnType<typeof compile>>) => {
      reports.set(key, report);
      return Promise.resolve();
    },
  };
  const finding = {
    code: "SEMANTIC_AMBIGUITY",
    severity: "warning" as const,
    message: "The goal is ambiguous.",
    filePath: null,
    line: null,
    column: null,
    evidence: "The goal lacks a result.",
    impact: "Implementations may diverge.",
    correction: "State the result.",
  };
  try {
    const first = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      first.diagnostics.find((item) => item.code === finding.code)?.lifecycle,
      "new",
    );
    const unchanged = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      unchanged.diagnostics.find((item) => item.code === finding.code)
        ?.lifecycle,
      "unchanged",
    );
    const resolved = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
      history,
    });
    assertEquals(
      resolved.diagnostics.find((item) => item.code === finding.code)
        ?.lifecycle,
      "resolved",
    );
    assertEquals(resolved.status, "green");
    const regressed = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      regressed.diagnostics.find((item) => item.code === finding.code)
        ?.lifecycle,
      "regressed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/history-store.sigil::SigilCompilationHistoryStore::CompilationHistoryStore constraints,cases
Deno.test("corrupt compilation history is ignored", async () => {
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
  const historyDirectory = await Deno.makeTempDir();
  try {
    const key = "corrupt";
    await Deno.writeTextFile(
      `${historyDirectory}/${key}.json`,
      JSON.stringify({
        reportVersion: 3,
        runId: "prior",
        workspaceRoot: root,
        target: { kind: "workspace" },
        componentNames: ["Example"],
        status: "yellow",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        sourceFingerprint: "source",
        profile: { fingerprint: "profile" },
        stages: [],
        diagnostics: [null],
      }),
    );
    assertEquals(
      await new FileCompilationHistoryStore(historyDirectory).read(key),
      undefined,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(historyDirectory, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/compilation-target.sigil::SigilCompilationTarget::CompilationTarget logic,cases
 * @sigil tests packages/compiler/src/adapter.sigil::SigilAgentAdapter::AgentAdapter logic,cases
 */
Deno.test("workspace evaluation sends minimal direct-read targets in dependency order", async () => {
  const source = `@z-dependency.sigil import { Dependency }

component Consumer {
  goal {
    Consume the dependency.
  }

  interface {
    ConsumerOperation {
      run(input: Dependency)
    }
  }
}
`;
  const dependency = `component Dependency {
  goal {
    Provide a dependency.
  }

  interface {
    DependencyValue {
      value: string
    }
  }
}
`;
  const implementation = `// @sigil implements main.sigil::Consumer interface
export function consume(): void {}
${"// SECRET_SOURCE_MARKER_72D9\n".repeat(45_000)}`;
  const root = await workspace(source, {
    "z-dependency.sigil": dependency,
    "consumer.ts": implementation,
  });
  try {
    const observed: {
      stage: string;
      component: string;
      length: number;
      sigilFile: string;
      serialized: string;
      skill: string;
    }[] = [];
    const report = await compile(root, { kind: "workspace" }, "standard", {
      adapter: new MockAdapter((request) => {
        const serialized = JSON.stringify(request);
        observed.push({
          stage: request.stage,
          component: request.target.componentName,
          length: serialized.length,
          sigilFile: request.target.sigilFile,
          serialized,
          skill: request.skill,
        });
        return [];
      }),
    });

    assertEquals(report.status, "green");
    assertEquals(observed.length, 6);
    assertEquals(
      observed.map((item) => `${item.stage}:${item.component}`),
      [
        "semantic-readiness:Dependency",
        "semantic-readiness:Consumer",
        "architecture-design:Dependency",
        "architecture-design:Consumer",
        "current-code-compatibility:Dependency",
        "current-code-compatibility:Consumer",
      ],
    );
    assertEquals(
      observed.every((item) => item.length <= 900_000),
      true,
    );
    assertEquals(
      observed.every((item) => !item.serialized.includes("function consume")),
      true,
    );
    assertEquals(
      observed.every((item) =>
        !item.serialized.includes("SECRET_SOURCE_MARKER_72D9")
      ),
      true,
    );
    assertEquals(
      observed.find((item) => item.component === "Consumer")?.sigilFile,
      "main.sigil",
    );
    assertMatch(observed[0].skill, /Determine whether the selected component/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile interface,logic
 * @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::StageConfiguration constraints,cases
 */
Deno.test("stage selection runs the exact dependency closure", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    assertEquals(report.requestedStage, "semantic-readiness");
    assertEquals(
      report.stages.map((stage) => stage.id),
      ["deterministic-foundation", "semantic-readiness"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile logic
 * @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::StageConfiguration constraints,cases
 */
Deno.test("implementation focus excludes design evaluation stages", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      focus: "implementation",
      adapter: new MockAdapter(),
    });
    assertEquals(report.focus, "implementation");
    assertEquals(
      report.stages.map((stage) => stage.id),
      ["deterministic-foundation", "current-code-compatibility"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::DiagnosticSemanticSubject interface
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationDiagnostic logic
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationReport cases
 */
Deno.test("diagnostics resolve direct units with concept and section fallbacks", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    Read {
      read()
    }
  }
}
`,
    {
      "README.md": "Unowned documentation.\n",
    },
  );
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([
        finding("unit", "main.sigil", 8),
        finding("section", "main.sigil", 6),
        finding("empty", "README.md", 1),
      ]),
    });
    assertEquals(report.reportVersion, 3);
    const unit = report.diagnostics.find((item) => item.message === "unit")!;
    assertEquals(unit.semanticSubjects.length, 1);
    assertEquals(unit.semanticSubjects[0].relation, "direct");
    assertEquals(unit.semanticSubjects[0].componentName, "Example");
    assertEquals(unit.semanticSubjects[0].sectionName, "interface");
    assertEquals(unit.semanticSubjects[0].conceptIdentifier, "Read");
    assertEquals(unit.semanticSubjects[0].semanticUnit?.range.start.line, 8);
    assertMatch(
      unit.semanticSubjects[0].semanticUnit?.fingerprint ?? "",
      /^[a-f0-9]{64}$/,
    );

    const section = report.diagnostics.find((item) =>
      item.message === "section"
    )!;
    assertEquals(section.semanticSubjects[0].sectionName, "interface");
    assertEquals(section.semanticSubjects[0].conceptIdentifier, undefined);
    assertEquals(section.semanticSubjects[0].semanticUnit, undefined);

    const empty = report.diagnostics.find((item) => item.message === "empty")!;
    assertEquals(empty.semanticSubjects, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::DiagnosticSemanticSubject interface
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationDiagnostic logic
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationReport cases
 */
Deno.test("implementation findings resolve every governing ownership target", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    Read {
      read()
    }
  }

  logic {
    Reading {
      Read the value.
    }
  }
}
`,
    {
      "implementation.ts": `/*
 * @sigil implements main.sigil::Example::Read interface
 * @sigil implements main.sigil::Example logic
 */
export function read(): void {}
`,
    },
  );
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([
        finding("governing", "implementation.ts", 5),
      ]),
    });
    const subjects = report.diagnostics.find((item) =>
      item.message === "governing"
    )!.semanticSubjects;
    assertEquals(
      subjects.map((subject) => ({
        relation: subject.relation,
        section: subject.sectionName,
        concept: subject.conceptIdentifier,
      })),
      [
        { relation: "governing", section: "interface", concept: "Read" },
        { relation: "governing", section: "logic", concept: undefined },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationDiagnostic logic
 * @sigil tests packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationReport cases
 */
Deno.test("semantic-unit fingerprints survive formatting-only wrapping", async () => {
  const compact = await workspace(`component Example {
  goal {
    Explain the same normalized semantic unit.
  }

  interface {
    Read {
      read()
    }
  }
}
`);
  const wrapped = await workspace(`component Example {
  goal {
    Explain the same normalized
    semantic unit.
  }

  interface {
    Read {
      read()
    }
  }
}
`);
  try {
    const first = await compile(compact, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding("compact", "main.sigil", 3)]),
    });
    const second = await compile(wrapped, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding("wrapped", "main.sigil", 3)]),
    });
    assertEquals(
      first.diagnostics.find((item) => item.message === "compact")
        ?.semanticSubjects[0].semanticUnit?.fingerprint,
      second.diagnostics.find((item) => item.message === "wrapped")
        ?.semanticSubjects[0].semanticUnit?.fingerprint,
    );
  } finally {
    await Deno.remove(compact, { recursive: true });
    await Deno.remove(wrapped, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext constraints,cases
 * @sigil tests packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::CompilationEvaluation interface
 */
Deno.test("a complete retrieval result is not bounded by the request limit", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleContract {
      Provide the example contract.
    }
  }
}
`,
    {},
    {
      // Far smaller than any real retrieval-bearing request. Previously this
      // failed the whole run; the declared limit belongs to the adapter, where
      // exceeding it leaves one evaluator incomplete instead.
      limits: {
        maxCompilationRequestChars: 1,
        maxAgentInputChars: 1_250_000,
        sessionTtlMs: 172_800_000,
        providerCleanupMs: 5_000,
      },
    },
  );
  try {
    let requestChars = 0;
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter((request) => {
        requestChars = JSON.stringify(request, (_key, value) =>
          value instanceof AbortSignal ? undefined : value).length;
        return [];
      }),
    });
    assertEquals(report.status, "green");
    assertEquals(requestChars > 1, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile interface,logic
Deno.test("workspace configuration overrides compiler execution budgets", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleContract {
      Provide the example contract.
    }
  }
}
`,
    {},
    {
      budgets: { maxCommandOutputChars: 3_000_000 },
      limits: {
        maxCompilationRequestChars: 1_500_000,
        maxAgentInputChars: 1_250_000,
        sessionTtlMs: 172_800_000,
        providerCleanupMs: 5_000,
      },
    },
  );
  try {
    let observedBudget = 0;
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter((request) => {
        observedBudget = request.budgets.maxCommandOutputChars;
        return [];
      }),
    });
    assertEquals(observedBudget, 3_000_000);
    assertEquals(
      report.profile.executionBudgets.maxCommandOutputChars,
      3_000_000,
    );
    assertEquals(report.profile.executionBudgets.maxCommands, 512);
    assertEquals(report.profile.contextBudgetChars, 1_500_000);
    assertEquals(report.profile.agentInputBudgetChars, 1_250_000);
    assertEquals(report.profile.limits.sessionTtlMs, 172_800_000);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::ProfileConfiguration constraints
Deno.test("invalid compiler execution budgets fail before evaluation", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
  }
}
`,
    {},
    {
      budgets: { maxCommandOutputChars: 0 },
    },
  );
  try {
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          requestedStage: "semantic-readiness",
          adapter: new MockAdapter(),
        }),
      Error,
      "must be a positive safe integer",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/evaluation-registry.sigil::SigilEvaluationSkillRegistry::EvaluationSkillPackage constraints,cases
Deno.test("undeclared evaluator rules fail the stage without affecting color directly", async () => {
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
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([{
        code: "INVENTED_RULE",
        severity: "error",
        message: "Unsupported.",
        filePath: null,
        line: null,
        column: null,
        evidence: "None.",
        impact: "None.",
        correction: "None.",
      }]),
    });
    assertEquals(report.status, "red");
    assertEquals(
      report.diagnostics.some((item) => item.code === "INVENTED_RULE"),
      false,
    );
    assertEquals(
      report.diagnostics.some((item) =>
        item.code === "COMPILER_EVALUATOR_INCOMPLETE"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/history-store.sigil::SigilCompilationHistoryStore::CompilationHistoryWarning interface
 * @sigil tests packages/compiler/src/history-store.sigil::SigilCompilationHistoryStore::CompilationHistoryStore logic,constraints,cases
 */
Deno.test("history replacement follows completed settlement and warns without failing", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    Run {
      run()
    }
  }
}
`);
  const order: string[] = [];
  const history: CompilationHistoryStore = {
    read() {
      order.push("read");
      return Promise.resolve(undefined);
    },
    write(_key: string, _report: CompilationReport) {
      order.push("write");
      return Promise.reject(new Error("history unavailable"));
    },
  };
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "deterministic-foundation",
      history,
      onEvent: (event) => {
        if (event.type === "completed") order.push("completed");
      },
      hostWarningSink: (warning) => {
        order.push(warning.code);
      },
    });
    assertEquals(report.status, "green");
    assertEquals(order, [
      "read",
      "completed",
      "write",
      "COMPILER_HISTORY_WRITE_FAILED",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/report-export.sigil::SigilCompilationReportExporter::CompilationReportExport interface,logic,constraints,cases
Deno.test("report export is atomic and remains outside the selected workspace", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    Run {
      run()
    }
  }
}
`);
  const destination = await Deno.makeTempFile();
  try {
    const report = await compile(root, { kind: "workspace" }, "standard", {
      requestedStage: "deterministic-foundation",
      reportExport: destination,
    });
    assertEquals(
      JSON.parse(await Deno.readTextFile(destination)).runId,
      report.runId,
    );
    const markdownReport = await compile(
      root,
      { kind: "workspace" },
      "standard",
      {
        requestedStage: "deterministic-foundation",
        reportExport: destination,
        reportExportRepresentation: "markdown",
      },
    );
    assertEquals(
      await Deno.readTextFile(destination),
      renderCompilationReportMarkdown(markdownReport),
    );
    assertEquals(
      (await Deno.readTextFile(destination)).includes("## Findings"),
      false,
    );
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, "standard", {
          requestedStage: "deterministic-foundation",
          reportExport: `${root}/report.json`,
        }),
      CompilerFailure,
      "outside the selected workspace",
    );
  } finally {
    await Deno.remove(destination).catch(() => {});
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/report-markdown.sigil::SigilCompilationReportMarkdown::CompilationReportMarkdown interface,logic,constraints,cases
Deno.test("compilation report Markdown is compact, grouped, and deterministic", () => {
  const report: CompilationReport = {
    reportVersion: 3,
    runId: "run-markdown",
    workspaceRoot: "/workspace",
    target: { kind: "component", name: "Example" },
    requestedScope: { kind: "component", componentName: "Example" },
    selection: {
      strategy: "exact-target",
      affectedSemanticUnits: [],
      coveredSemanticUnits: [],
      uncoveredSemanticUnits: [],
    },
    componentNames: ["Example"],
    status: "yellow",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    sourceFingerprint: "source",
    profile: {
      name: "standard",
      criticalSystem: false,
      contextBudgetChars: 1,
      agentInputBudgetChars: 1,
      limits: {
        maxCompilationRequestChars: 1,
        maxAgentInputChars: 1,
        sessionTtlMs: 1,
        providerCleanupMs: 1,
      },
      executionBudgets: {
        elapsedTimeMs: 1,
        maxCommands: 1,
        maxCommandOutputChars: 1,
        maxInputTokens: 1,
        maxOutputTokens: 1,
      },
      stages: [],
      evaluators: [],
      fingerprint: "profile",
    },
    stages: [{
      id: "semantic-readiness",
      required: true,
      state: "completed",
      evaluator: "mock",
      diagnosticCount: 1,
    }],
    diagnostics: [{
      code: "SEMANTIC_AMBIGUITY",
      fingerprint: "finding",
      severity: "warning",
      stage: "semantic-readiness",
      skill: "semantic-readiness@1",
      message: "Clarify | behavior.",
      filePath: "main.sigil",
      range: {
        start: { line: 4, column: 3 },
        end: { line: 4, column: 12 },
      },
      semanticSubjects: [{
        relation: "direct",
        sigilPath: "main.sigil",
        componentName: "Example",
        ownerKind: "component",
        ownerName: "Example",
        sectionName: "interface",
        conceptIdentifier: "Run",
      }],
      evidence: "The contract has two meanings.",
      impact: "Callers cannot choose safely.",
      correction: "Choose one meaning.",
      evaluator: "mock",
      lifecycle: "new",
    }],
  };
  const markdown = renderCompilationReportMarkdown(report);
  assertEquals(
    markdown,
    renderCompilationReportMarkdown(structuredClone(report)),
  );
  assertMatch(
    markdown,
    /^# Sigil Compilation Report\n\nStatus: \*\*YELLOW\*\*/,
  );
  assertMatch(markdown, /## Stage execution/);
  assertMatch(markdown, /### semantic-readiness/);
  assertMatch(markdown, /SEMANTIC_AMBIGUITY/);
  assertMatch(markdown, /Clarify \| behavior\./);
  assertEquals((markdown.match(/Evidence:/g) ?? []).length, 1);
  assertEquals((markdown.match(/Impact:/g) ?? []).length, 1);
  assertEquals((markdown.match(/Suggested correction:/g) ?? []).length, 1);
});

function finding(
  message: string,
  filePath: string,
  line: number,
) {
  return {
    code: "SEMANTIC_AMBIGUITY",
    severity: "warning" as const,
    message,
    filePath,
    line,
    column: null,
    evidence: `${filePath}:${line}`,
    impact: "The contract is ambiguous.",
    correction: "Clarify the contract.",
  };
}

// @sigil tests packages/compiler/src/compiler.sigil::SigilOneShotCompilation::OneShotCompilation logic
Deno.test("excluded workspace paths are not implementation evidence", async () => {
  const source = `component Example {
  goal {
    Explain the example.
  }

  interface {
    Runner {
      run()
    }
  }
}
`;
  // One workspace throughout, so only the edited file can move the fingerprint.
  const check = async (exclude: readonly string[]) => {
    const root = await workspace(
      source,
      { "vendored/dep.ts": "export const a = 1;\n" },
      undefined,
      exclude,
    );
    try {
      const fingerprint = async () => {
        const report = await compile(root, { kind: "workspace" }, "standard", {
          requestedStage: "deterministic-foundation",
          disableHistory: true,
        });
        return report.sourceFingerprint;
      };
      const before = await fingerprint();
      await Deno.writeTextFile(
        `${root}/vendored/dep.ts`,
        "export const a = 2;\n",
      );
      return { before, after: await fingerprint() };
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  };
  // Without the exclusion the vendored file is evidence, so editing it counts.
  const included = await check([]);
  assertNotEquals(included.before, included.after);
  // With it, the same edit cannot reach the fingerprint at all.
  const excluded = await check(["vendored/**"]);
  assertEquals(excluded.before, excluded.after);
});
