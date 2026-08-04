import {
  type AgentEvaluationRequest,
  CodexAdapter,
  type CompilationEvent,
  type CompilationHistoryStore,
  type CompilationReport,
  compile,
  COMPILER_AGENT_CAPABILITIES,
  CompilerFailure,
  FileCompilationHistoryStore,
  loadEvaluationSkills,
  MockAdapter,
  SigilCompilationSession,
  SigilCompilationSessionFactory,
  SigilProposalWorkspace,
} from "../src/mod.ts";
import type { PurposeRetrievalResult } from "@qoherent/sigil-core";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";

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
      sigilVersion: "0.7.0",
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

function adapterRequest(root: string): AgentEvaluationRequest {
  const retrieval = {
    schema: "sigil-purpose-retrieval/v1",
    policyVersion: 1,
    workspaceSnapshotIdentity: "snapshot",
    target: {
      kind: "component",
      componentName: "Example",
      pathStatus: "accepted",
      path: "main.sigil",
    },
    purpose: "semantic",
    graph: { nodes: [], edges: [] },
    evidence: [],
    inclusionReasons: [],
    exclusions: [],
    context: { sections: [] },
    diagnostics: [],
    fingerprint: "sha256:test",
  } satisfies PurposeRetrievalResult;
  return {
    stage: "semantic-readiness",
    skill: "Inspect files.",
    allowedRules: ["SEMANTIC_AMBIGUITY"],
    implementationEvidence: "context-only",
    workspaceAccess: {
      kind: "snapshot-read-only",
      agentRoot: root,
      workspaceSnapshotIdentity: "snapshot",
    },
    target: {
      componentName: "Example",
      sigilFile: "main.sigil",
      initialPaths: ["main.sigil"],
    },
    retrieval,
    outputSchema: {},
    capabilities: COMPILER_AGENT_CAPABILITIES,
    maxInputChars: 1_000_000,
    budgets: {
      elapsedTimeMs: 30_000,
      maxCommands: 10,
      maxCommandOutputChars: 10_000,
      maxInputTokens: 1_000,
      maxOutputTokens: 100,
    },
  };
}

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
    ]
  ) {
    assertEquals(architectureRules.includes(rule), true);
  }
});

/*
 * @sigil tests packages/compiler/_module.sigil::SigilCompiler::CompilationInvocation interface
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
    const report = await compile(root, { kind: "workspace" }, {
      adapter: new MockAdapter(),
      onEvent: (event) => {
        events.push(event);
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
      evidence: "The interface omits its result.",
      impact: "Consumers cannot rely on the operation.",
      correction: "Define the result.",
    };
    const yellow = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([warning]),
    });
    assertEquals(yellow.status, "yellow");
    const red = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([{ ...warning, severity: "error" }]),
    });
    assertEquals(red.status, "red");
    assertMatch(red.diagnostics[0].fingerprint, /^[a-f0-9]{64}$/);
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
        first: { provider: "codex" },
        second: { provider: "codex" },
      },
      profiles: {
        "critical-system": { evaluatorIds: ["first", "second"] },
      },
    },
  );
  try {
    const report = await compile(root, { kind: "workspace" }, {
      profile: "critical-system",
      adapters: [
        new MockAdapter([], "first"),
        new MockAdapter([], "second"),
      ],
    });
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
    const standard = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    assertEquals(standard.status, "green");

    const events: CompilationEvent[] = [];
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, {
          profile: "critical-system",
          adapter: new MockAdapter(),
          onEvent: (event) => {
            events.push(event);
          },
        }),
      Error,
      "requires at least two distinct",
    );
    assertEquals(events.at(-1)?.type, "failed");
    assertEquals(
      events.at(-1)?.payload.code,
      "COMPILER_PROFILE_EVALUATORS_REQUIRED",
    );
    assertEquals(
      events.filter((event) =>
        ["completed", "failed", "cancelled"].includes(event.type)
      ).length,
      1,
    );
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
        first: { provider: "codex" },
        second: { provider: "codex" },
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
        compile(root, { kind: "workspace" }, {
          profile: "critical-system",
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

// @sigil tests packages/compiler/src/compiler.sigil::SigilCompiler::CompilationTarget logic,cases
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
    const report = await compile(root, {
      kind: "location",
      filePath: "details.sigil",
      line: 5,
      column: 8,
    }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
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
        first: { provider: "codex" },
        second: { provider: "codex" },
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
    const report = await compile(root, { kind: "workspace" }, {
      profile: "critical",
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
    evidence: "The goal lacks a result.",
    impact: "Implementations may diverge.",
    correction: "State the result.",
  };
  try {
    const first = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      first.diagnostics.find((item) => item.code === finding.code)?.lifecycle,
      "new",
    );
    const unchanged = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding]),
      history,
    });
    assertEquals(
      unchanged.diagnostics.find((item) => item.code === finding.code)
        ?.lifecycle,
      "unchanged",
    );
    const resolved = await compile(root, { kind: "workspace" }, {
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
    const regressed = await compile(root, { kind: "workspace" }, {
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
        reportVersion: 2,
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
 * @sigil tests packages/compiler/_module.sigil::SigilCompiler::CompilationTarget logic,cases
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
    const report = await compile(root, { kind: "workspace" }, {
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
    const report = await compile(root, { kind: "workspace" }, {
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
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([
        finding("unit", "main.sigil", 8),
        finding("section", "main.sigil", 6),
        finding("empty", "README.md", 1),
      ]),
    });
    assertEquals(report.reportVersion, 2);
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
    const report = await compile(root, { kind: "workspace" }, {
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
    const first = await compile(compact, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([finding("compact", "main.sigil", 3)]),
    });
    const second = await compile(wrapped, { kind: "workspace" }, {
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

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile interface,logic
Deno.test("workspace configuration overrides compiler execution budgets", async () => {
  const root = await workspace(
    `component Example {
  goal {
    Explain the example.
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
      },
    },
  );
  try {
    let observedBudget = 0;
    const report = await compile(root, { kind: "workspace" }, {
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

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::ProviderModelSelection cases
Deno.test("provider and model selection are retained in the effective profile", async () => {
  const source = `component Example {
  goal { Explain the example. }
  interface { Run { run() } }
}
`;
  const openCodeRoot = await workspace(source, {}, {
    adapter: {
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
    },
  });
  const piRoot = await workspace(source, {}, {
    adapter: { provider: "pi", model: "openai/gpt-5" },
  });
  try {
    const openCode = await compile(openCodeRoot, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    const pi = await compile(piRoot, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter(),
    });
    assertEquals(openCode.profile.evaluators, [{
      id: "default",
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
    }]);
    assertEquals(pi.profile.evaluators, [{
      id: "default",
      provider: "pi",
      model: "openai/gpt-5",
    }]);
    assertEquals(
      openCode.profile.fingerprint === pi.profile.fingerprint,
      false,
    );
  } finally {
    await Deno.remove(openCodeRoot, { recursive: true });
    await Deno.remove(piRoot, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/profile.sigil::SigilCompilationProfile::ProfileConfiguration constraints,cases
Deno.test("selected evaluator models must be non-empty identifiers", async () => {
  const root = await workspace(
    `component Example { goal { Explain. } interface { Run { run() } } }\n`,
    {},
    { adapter: { provider: "opencode", model: "" } },
  );
  try {
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, {
          requestedStage: "semantic-readiness",
          adapter: new MockAdapter(),
        }),
      Error,
      "non-empty provider-native identifier",
    );
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
        compile(root, { kind: "workspace" }, {
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
}
`);
  try {
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "semantic-readiness",
      adapter: new MockAdapter([{
        code: "INVENTED_RULE",
        severity: "error",
        message: "Unsupported.",
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

// @sigil tests packages/compiler/src/adapter.sigil::SigilAgentAdapter::AgentAdapter interface,logic,cases
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
    const adapter = new CodexAdapter(undefined, (_command, args, input) => {
      observedArgs = args;
      observedPrompt = input;
      return Promise.resolve([
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command:
              '/bin/zsh -lc "rg -n \\"SigilCompiler\\" packages/compiler"',
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
      ].join("\n"));
    });
    const result = await adapter.evaluate(adapterRequest(root));
    assertEquals(observedArgs.includes("--ephemeral"), true);
    assertEquals(observedArgs.includes("read-only"), true);
    assertEquals(observedArgs[observedArgs.indexOf("-C") + 1], root);
    assertEquals(observedArgs.includes("--json"), true);
    assertMatch(observedPrompt, /^\{"allowedRules"/);
    assertMatch(observedPrompt, /"authority":"sigil-evaluator-v1"/);
    assertEquals(result.commands[0].canonicalCommandFamily, "workspace.grep");
    assertEquals(result.usage.inputTokens, 100);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/adapter.sigil::SigilAgentAdapter::AgentAdapter interface,logic,cases
Deno.test("Codex adapter rejects an unauthorized command trace", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }
}
`);
  try {
    const adapter = new CodexAdapter(undefined, () =>
      Promise.resolve([
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
      ].join("\n")));
    await assertRejects(
      () => adapter.evaluate(adapterRequest(root)),
      Error,
      "unauthorized command operation",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/proposal-workspace.sigil::SigilProposalWorkspace interface,logic,cases
Deno.test("proposal workspace atomically replaces complete source override sets", async () => {
  const root = await workspace(`component Example {
  goal { Explain the example. }
  interface { Run { run() } }
}
`);
  const identity = crypto.randomUUID();
  const created = await SigilProposalWorkspace.create(root, identity);
  try {
    const first = await created.workspace.apply({
      sources: {
        "main.sigil": `component Example {
  goal { Explain the changed example. }
  interface { Run { run() } }
}
`,
      },
    });
    assertEquals(first.generation, 1);
    assertMatch(first.proposalFingerprint, /^[0-9a-f]{64}$/);
    await assertRejects(
      () => created.workspace.apply({ sources: { "../escape.sigil": "" } }),
      Error,
      "Invalid proposal",
    );
    assertEquals(created.workspace.persistedState().generation, 1);
  } finally {
    await created.workspace.close();
    await Deno.remove(root, { recursive: true });
  }
});

/*
 * @sigil tests packages/compiler/src/session-factory.sigil::SigilCompilationSessionFactory interface,logic,cases
 * @sigil tests packages/compiler/src/session.sigil::SigilCompilationSession interface,state,logic,constraints,cases
 */
Deno.test("durable compilation sessions refresh and close without a daemon", async () => {
  const root = await workspace(`component Example {
  goal { Explain the example. }
  interface { Run { run() } }
}
`);
  const created = await new SigilCompilationSessionFactory().create(
    root,
    { kind: "workspace" },
    "standard",
    "design",
  );
  try {
    assertMatch(created.result.sessionIdentity, /^[0-9a-f-]{36}$/);
    assertEquals(created.result.baseEpoch, 1);
    const refreshed = await created.session.refresh();
    assertEquals(refreshed.baseEpoch, 2);
    assertMatch(refreshed.baseFingerprint, /^[0-9a-f]{64}$/);
    const events: CompilationEvent[] = [];
    const session = new SigilCompilationSession(
      created.result.sessionIdentity,
      undefined,
      async (
        workspacePath,
        target = { kind: "workspace" },
        options = {},
      ) => {
        assertMatch(
          await Deno.readTextFile(`${workspacePath}/main.sigil`),
          /changed example/,
        );
        return {
          reportVersion: 2,
          runId: "proposal-run",
          workspaceRoot: workspacePath,
          target,
          componentNames: ["Example"],
          status: "green",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          sourceFingerprint: "proposal-source",
          focus: options.focus,
          profile: {
            name: "standard",
            criticalSystem: false,
            contextBudgetChars: 1,
            agentInputBudgetChars: 1,
            limits: {
              maxCompilationRequestChars: 1,
              maxAgentInputChars: 1,
              sessionTtlMs: 1,
            },
            executionBudgets: {
              elapsedTimeMs: 1,
              maxCommands: 1,
              maxCommandOutputChars: 1,
              maxInputTokens: 1,
              maxOutputTokens: 1,
            },
            capabilities: COMPILER_AGENT_CAPABILITIES,
            stages: [],
            evaluators: [],
            fingerprint: "profile",
          },
          stages: [],
          diagnostics: [],
        };
      },
    );
    const report = await session.evaluate({
      sources: {
        "main.sigil": `component Example {
  goal { Explain the changed example. }
  interface { Run { run() } }
}
`,
      },
    }, {
      onEvent: (event) => {
        events.push(event);
      },
    });
    assertEquals(report.workspaceRoot, root.replaceAll("\\", "/"));
    assertEquals(report.session?.baseEpoch, 2);
    assertEquals(report.session?.generation, 1);
    assertEquals(events.at(-1)?.type, "completed");
  } finally {
    await created.session.close();
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
    const report = await compile(root, { kind: "workspace" }, {
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
    const report = await compile(root, { kind: "workspace" }, {
      requestedStage: "deterministic-foundation",
      reportExport: destination,
    });
    assertEquals(
      JSON.parse(await Deno.readTextFile(destination)).runId,
      report.runId,
    );
    await assertRejects(
      () =>
        compile(root, { kind: "workspace" }, {
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
    evidence: `${filePath}:${line}`,
    impact: "The contract is ambiguous.",
    correction: "Clarify the contract.",
  };
}
