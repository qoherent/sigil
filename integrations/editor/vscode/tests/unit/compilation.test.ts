import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  incompleteExplanation,
  nativeState,
  parseNativeReport,
  runCompilationProcess,
} from "../../src/compilation.ts";

const design = (state: string) => ({
  version: 6,
  source: "workspace",
  state,
  identity: {},
  iterations: 1,
  findings: [],
});
const implementation = (state: string) => ({
  version: 1,
  source: "workspace",
  state,
  designState: "coherent",
  identity: {},
  iterations: 1,
  incompleteReasons: [],
  findings: [],
  undesignedFiles: [],
  undesignedElements: [],
  unanswered: [],
  unreadFiles: [],
  selection: {},
  designFindings: [],
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface constraints,cases
test("all eight native states map to their label and command-specific exit", () => {
  for (
    const [focus, make, states] of [
      ["design", design, ["coherent", "loose", "disjoint", "incomplete"]],
      ["implementation", implementation, [
        "closed",
        "converged",
        "drift",
        "incomplete",
      ]],
    ] as const
  ) {
    states.forEach((state, index) => {
      const exit = index < 2 ? 0 : 1;
      assert.equal(
        nativeState(parseNativeReport(make(state), focus, exit)),
        state[0].toUpperCase() + state.slice(1),
      );
      for (const wrongExit of [1 - exit, 2, 3]) {
        assert.throws(
          () => parseNativeReport(make(state), focus, wrongExit),
          /Incompatible/,
        );
      }
    });
  }
});

test("rejects legacy, wrong-version, malformed and unsafe reports", () => {
  for (
    const invalid of [
      null,
      {},
      { ...design("coherent"), version: 5 },
      {
        version: 2,
        world: { state: "Coherent" },
        diagnostics: { items: [] },
      },
      { ...design("coherent"), findings: 0 },
      design("green"),
    ]
  ) {
    assert.throws(
      () => parseNativeReport(invalid, "design", 0),
      /Incompatible/,
    );
  }
  assert.throws(() =>
    parseNativeReport(
      { ...implementation("closed"), version: 2 },
      "implementation",
      0,
    )
  );
  const finding = {
    class: "gap",
    law: "missing-tag",
    subject: "Facet",
    object: "Tag",
    claims: [],
    component: "A",
    section: "interface",
    detail: "Unresolved",
    locations: [{
      side: "design",
      source: "a.sigil",
      coordinate_system: "utf8-bytes",
      source_digest: "a".repeat(64),
      range: { start: 2, end: 8 },
    }],
  };
  const report = { ...design("loose"), findings: [finding] };
  assert.deepEqual(parseNativeReport(report, "design", 0), report);
  finding.locations[0].source = "../escape.sigil";
  assert.throws(() => parseNativeReport(report, "design", 0));
});

test("Incomplete explains design and code reading gaps and their owners", () => {
  const report = {
    ...implementation("incomplete"),
    incompleteReasons: [
      "design-incomplete",
      "design-disjoint",
      "unread-files",
      "unpresentable-files",
    ],
    unreadFiles: ["src/a.ts"],
  };
  const text = incompleteExplanation(
    parseNativeReport(report, "implementation", 1),
  );
  for (const reason of report.incompleteReasons) assert(text.includes(reason));
  for (
    const name of ["src/a.ts", "sigil-compute-design", "sigil-compute-align"]
  ) assert(text.includes(name));
  const designText = incompleteExplanation(
    parseNativeReport(
      {
        ...design("incomplete"),
        unread: [{
          source: "a.sigil",
          component: "A",
          section: "goal",
          facets: [],
        }],
        unresolvedImports: [{
          source: "a.sigil",
          path: "missing.sigil",
          provider: "Missing",
          status: "missing",
        }],
      },
      "design",
      1,
    ),
  );
  for (const name of ["a.sigil", "missing.sigil", "sigil-compute-design"]) {
    assert(designText.includes(name));
  }
});

async function fixture(nativeScript?: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "sigil editor tests "));
  const script = nativeScript ?? `
const fs=require("node:fs"),path=require("node:path");fs.mkdirSync(".sigil/claims",{recursive:true});
const args=[path.basename(process.argv[1]),...process.argv.slice(2)];
fs.writeFileSync("observed.json",JSON.stringify({args}));
const report=args[0]==="align"?${JSON.stringify(implementation("converged"))}:${
    JSON.stringify(design("loose"))
  };
if(args.includes("--source"))report.source=args[args.indexOf("--source")+1];
report.identity={workspaceDigest:"current",guidanceFingerprint:"guidance",vocabularyGeneration:1};
if(report.version===6)report.linked={workspaceDigest:"current"};
fs.writeFileSync(".sigil/claims/result.json",JSON.stringify(report));
console.log(JSON.stringify({workspaceDigest:"current",guidanceFingerprint:"guidance",vocabularyGeneration:1,version:report.version,state:report.state,scope:report.source,findings:report.findings.length,designState:report.designState,incompleteReasons:report.incompleteReasons,report:".sigil/claims/result.json"}));`;
  for (const command of ["check", "align"]) {
    await writeFile(path.join(cwd, command), script);
  }
  return cwd;
}
async function compile(
  cwd: string,
  focus: "design" | "implementation",
  file?: string,
) {
  return await runCompilationProcess({
    executable: process.execPath,
    cwd,
    focus,
    file,
    onLog: () => {},
  }).result;
}

test("design file uses check --source; workspace uses check and reads the reported file", async () => {
  const cwd = await fixture();
  try {
    for (const file of ["a.sigil", undefined]) {
      const report = await compile(cwd, "design", file);
      assert.equal(nativeState(report), "Loose");
      assert(
        Array.isArray(report.findings),
        "stdout summary must be replaced by the full report",
      );
      const seen = JSON.parse(
        await readFile(path.join(cwd, "observed.json"), "utf8"),
      );
      assert.deepEqual(seen.args, [
        "check",
        "--root",
        cwd,
        ...(file ? ["--source", file] : []),
      ]);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("implementation code and workspace use align check with workspace config selection", async () => {
  const cwd = await fixture();
  try {
    for (const file of ["src/a.ts", undefined]) {
      assert.equal(
        nativeState(await compile(cwd, "implementation", file)),
        "Converged",
      );
      const seen = JSON.parse(
        await readFile(path.join(cwd, "observed.json"), "utf8"),
      );
      assert.deepEqual(seen.args, ["align", "check", "--root", cwd]);
    }
    assert.equal(
      nativeState(await compile(cwd, "implementation", "a.sigil")),
      "Loose",
      ".sigil files always check design",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects a report whose state does not match its native summary", async () => {
  const cwd = await fixture(
    `const fs=require("node:fs");fs.mkdirSync(".sigil/claims",{recursive:true});fs.writeFileSync(".sigil/claims/result.json",JSON.stringify(${
      JSON.stringify(design("coherent"))
    }));console.log(JSON.stringify({version:6,state:"loose",scope:"workspace",findings:0,report:".sigil/claims/result.json"}));`,
  );
  try {
    await assert.rejects(compile(cwd, "design"), /summary|Incompatible/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects an old stored report with matching state but different workspace provenance", async () => {
  const cwd = await fixture(
    `const fs=require("node:fs");fs.mkdirSync(".sigil/claims",{recursive:true});
const report={...${
      JSON.stringify(design("loose"))
    },identity:{guidanceFingerprint:"guidance",vocabularyGeneration:1},linked:{workspaceDigest:"old"}};
fs.writeFileSync(".sigil/claims/result.json",JSON.stringify(report));
console.log(JSON.stringify({version:6,state:"loose",scope:"workspace",findings:0,workspaceDigest:"current",guidanceFingerprint:"guidance",vocabularyGeneration:1,report:".sigil/claims/result.json"}));`,
  );
  try {
    await assert.rejects(compile(cwd, "design"), /summary|Incompatible/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("terminates a compiler that exceeds the stderr bound", async () => {
  const cwd = await fixture(
    'process.stderr.write("x".repeat(2 * 1024 * 1024));setInterval(()=>{},1000);',
  );
  try {
    await assert.rejects(compile(cwd, "design"), /stderr exceeds/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cancellation kills the compiler process", async () => {
  const cwd = await fixture(
    'require("node:fs").writeFileSync("pid",String(process.pid));process.stderr.write("ready");setInterval(()=>{},1000);',
  );
  try {
    const operation = runCompilationProcess({
      executable: process.execPath,
      cwd,
      focus: "design",
      onLog: () => operation.cancel(),
    });
    await assert.rejects(operation.result, /cancelled/);
    const pid = Number(await readFile(path.join(cwd, "pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

for (const exit of [2, 3]) {
  test(`exit ${exit} has no computed verdict even with a valid-looking summary`, async () => {
    const cwd = await fixture(
      `console.log(JSON.stringify({version:6,state:"coherent",scope:"workspace",findings:0,report:".sigil/claims/result.json"}));process.exitCode=${exit};`,
    );
    try {
      await assert.rejects(compile(cwd, "design"), /exit|Incompatible/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test("an obsolete native report is rejected", async () => {
  const cwd = await fixture(
    `const fs=require("node:fs");fs.mkdirSync(".sigil/claims",{recursive:true});fs.writeFileSync(".sigil/claims/result.json",JSON.stringify({...${
      JSON.stringify(design("loose"))
    },version:5}));console.log(JSON.stringify({version:5,state:"loose",scope:"workspace",findings:0,report:".sigil/claims/result.json"}));`,
  );
  try {
    await assert.rejects(compile(cwd, "design"), /Incompatible design/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
