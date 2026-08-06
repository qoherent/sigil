import assert from "node:assert/strict";
import test from "node:test";
import {
  type CompilerDiagnostic,
  componentAt,
  diagnosticDisplayRange,
  parseCompilationEvent,
  runCompilationProcess,
} from "../../src/compilation.ts";

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints,cases
test("validates compiler protocol envelopes", () => {
  const event = parseCompilationEvent(JSON.stringify({
    protocolVersion: 1,
    runId: "run",
    sequence: 1,
    type: "started",
    payload: {},
  }));
  assert.equal(event.sequence, 1);
  assert.throws(() =>
    parseCompilationEvent(JSON.stringify({
      protocolVersion: 2,
      runId: "run",
      sequence: 1,
      type: "started",
      payload: {},
    }))
  );
  assert.throws(() =>
    parseCompilationEvent(JSON.stringify({
      protocolVersion: 1,
      runId: "run",
      sequence: 1.5,
      type: "started",
      payload: {},
    }))
  );
  assert.throws(() =>
    parseCompilationEvent(JSON.stringify({
      protocolVersion: 1,
      runId: "run",
      sequence: 1,
      type: "surprise",
      payload: {},
    }))
  );
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,cases
test("resolves the nearest component declaration at the cursor", () => {
  const source = `component One {
  goal {
    First.
  }
}

component Two {
  goal {
    Second.
  }
}`;
  assert.equal(componentAt(source, 2), "One");
  assert.equal(componentAt(source, 8), "Two");
  assert.equal(componentAt(source, 4), undefined);
  assert.equal(
    componentAt(`expand One {\n  logic {\n    More.\n  }\n}`, 2),
    "One",
  );
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints,cases
test("accepts exactly one completed terminal event with a valid report", async () => {
  const script = `
const report = {reportVersion:2,status:"green",componentNames:["One"],diagnostics:[]};
console.log(JSON.stringify({protocolVersion:1,runId:"run",sequence:1,type:"started",payload:{}}));
console.log(JSON.stringify({protocolVersion:1,runId:"run",sequence:2,type:"completed",payload:{report}}));
`;
  const events: string[] = [];
  const compilation = runCompilationProcess(
    process.execPath,
    ["-e", script, "--"],
    process.cwd(),
    (event) => events.push(event.type),
    () => {},
  );
  assert.equal((await compilation.result).status, "green");
  assert.deepEqual(events, ["started", "completed"]);
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints,cases
test("surfaces compiler failed terminal events instead of a generic close", async () => {
  const script = `
console.log(JSON.stringify({protocolVersion:1,runId:"run",sequence:1,type:"started",payload:{}}));
console.log(JSON.stringify({protocolVersion:1,runId:"run",sequence:2,type:"failed",payload:{code:"COMPILER_PROFILE_EVALUATORS_REQUIRED",message:"Two evaluators are required."}}));
process.exitCode = 3;
`;
  const compilation = runCompilationProcess(
    process.execPath,
    ["-e", script, "--"],
    process.cwd(),
    () => {},
    () => {},
  );
  await assert.rejects(compilation.result, /Two evaluators are required/);
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface constraints,cases
test("rejects invalid compiler stage lifecycle transitions", async () => {
  const script = `
console.log(JSON.stringify({protocolVersion:1,runId:"run",sequence:1,type:"started",payload:{}}));
console.log(JSON.stringify({protocolVersion:1,runId:"run",sequence:2,type:"stage-completed",payload:{stage:{id:"semantic-readiness"}}}));
`;
  const compilation = runCompilationProcess(
    process.execPath,
    ["-e", script, "--"],
    process.cwd(),
    () => {},
    () => {},
  );
  await assert.rejects(
    compilation.result,
    /completed without its matching start event/,
  );
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints
test("projects a direct semantic unit as the diagnostic display range", () => {
  const diagnostic = {
    code: "ARCHITECTURE_BOUNDARY",
    severity: "error",
    stage: "architecture-design",
    lifecycle: "new",
    message: "Conflicting agent startup contract.",
    filePath: "packages/compiler/src/compiler.sigil",
    range: {
      start: { line: 72, column: 20 },
      end: { line: 72, column: 21 },
    },
    semanticSubjects: [{
      relation: "direct",
      sigilPath: "packages/compiler/src/compiler.sigil",
      componentName: "SigilCompiler",
      ownerKind: "expand",
      ownerName: "SigilCompiler",
      sectionName: "logic",
      conceptIdentifier: "AgentWorkspaceInspection",
      semanticUnit: {
        range: {
          start: { line: 71, column: 7 },
          end: { line: 72, column: 68 },
        },
        fingerprint: "unit",
      },
    }],
  } satisfies CompilerDiagnostic;

  assert.deepEqual(diagnosticDisplayRange(diagnostic), {
    start: { line: 71, column: 7 },
    end: { line: 72, column: 68 },
  });
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints
test("falls back to the physical diagnostic range without a direct unit", () => {
  const diagnostic = {
    code: "ARCHITECTURE_BOUNDARY",
    severity: "error",
    stage: "architecture-design",
    lifecycle: "new",
    message: "Conflicting agent startup contract.",
    filePath: "packages/compiler/src/compiler.sigil",
    range: {
      start: { line: 72, column: 20 },
      end: { line: 72, column: 21 },
    },
    semanticSubjects: [],
  } satisfies CompilerDiagnostic;

  assert.equal(diagnosticDisplayRange(diagnostic), diagnostic.range);
});
