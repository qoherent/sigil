import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  nativeState,
  parseNativeReport,
  runCompilationProcess,
} from "../../src/compilation.ts";

const diagnostics = { items: [], omitted: 0 };
const design = (state: string) => ({
  version: 2,
  world: { state },
  diagnostics,
});
const implementation = (state: string) => ({
  version: 2,
  design: design("Coherent"),
  implementation: {},
  comparison: { design: "Coherent", implementation: state },
  diagnostics,
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface constraints,cases
test("accepts all six native named states only with their command-specific exit", () => {
  for (
    const [state, exit] of [["Coherent", 0], ["Loose", 0], [
      "Disjoint",
      1,
    ]] as const
  ) {
    assert.equal(
      nativeState(parseNativeReport(design(state), "design", exit)),
      state,
    );
    assert.throws(() => parseNativeReport(design(state), "design", 1 - exit));
  }
  for (
    const [state, exit] of [["Closed", 0], ["Converged", 0], [
      "Drift",
      1,
    ]] as const
  ) {
    assert.equal(
      nativeState(
        parseNativeReport(implementation(state), "implementation", exit),
      ),
      state,
    );
    assert.throws(() =>
      parseNativeReport(implementation(state), "implementation", 1 - exit)
    );
  }
  const unavailable = {
    version: 2,
    design: design("Loose"),
    implementation: null,
    comparison: null,
    reason: "Current catalog unavailable",
    diagnostics,
  };
  assert.equal(
    nativeState(parseNativeReport(unavailable, "implementation", 3)),
    undefined,
  );
  assert.throws(() => parseNativeReport(unavailable, "implementation", 0));
  assert.throws(() =>
    parseNativeReport(implementation("Closed"), "implementation", 3)
  );
});

test("rejects legacy, malformed, mismatched and unsafe diagnostic reports", () => {
  for (
    const invalid of [
      null,
      {},
      { ...design("Coherent"), version: 1 },
      { reportVersion: 3, status: "green", diagnostics: [] },
      { ...design("Coherent"), diagnostics: { items: [], omitted: -1 } },
      design("green"),
    ]
  ) {
    assert.throws(() => parseNativeReport(invalid, "design", 0));
  }
  const finding = {
    code: "D",
    side: "design",
    severity: "warning",
    message: "Unresolved",
    locations: [{
      side: "design",
      source: "a.sigil",
      coordinate_system: "utf8-bytes",
      source_digest: "a".repeat(64),
      range: { start: 2, end: 8 },
    }],
    omitted_locations: 0,
  };
  const report = {
    ...design("Loose"),
    diagnostics: { items: [finding], omitted: 7 },
  };
  assert.deepEqual(parseNativeReport(report, "design", 0), report);
  finding.locations[0].source = "../escape.sigil";
  assert.throws(() => parseNativeReport(report, "design", 0));
  const mixed = { ...implementation("Closed"), design: design("Loose") };
  assert.throws(() => parseNativeReport(mixed, "implementation", 0));
});

async function fixture(nativeScript?: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "sigil editor tests "));
  await writeFile(
    path.join(cwd, "export"),
    'process.stdout.write(JSON.stringify({schemaVersion:2,languageVersion:"0.8.0", sources:[{path:"a.sigil",text:"exact"}]}));',
  );
  await writeFile(
    path.join(cwd, "compile"),
    nativeScript ?? `
const fs=require("node:fs");
const args=process.argv.slice(2);
if(args.includes("--profile")||args.includes("--format")||args.includes("--position")) process.exit(2);
const frontend=args[args.indexOf("--frontend")+1];
const scope=args.includes("--scope")?JSON.parse(fs.readFileSync(args[args.indexOf("--scope")+1])):null;
fs.writeFileSync("observed.json",JSON.stringify({args,frontend,bundle:JSON.parse(fs.readFileSync(frontend)),scope}));
console.log(JSON.stringify(args[0] === "implementation" ? ${
      JSON.stringify(implementation("Converged"))
    } : ${JSON.stringify(design("Loose"))}));`,
  );
  return cwd;
}

test("exports exact structural data then calls native file scope and cleans temporary inputs", async () => {
  const cwd = await fixture();
  try {
    const operation = runCompilationProcess({
      executable: process.execPath,
      languageExecutable: process.execPath,
      cwd,
      focus: "design",
      file: "a.sigil",
      onLog: () => {},
    });
    assert.equal(nativeState(await operation.result), "Loose");
    const seen = JSON.parse(
      await readFile(path.join(cwd, "observed.json"), "utf8"),
    );
    assert.equal(seen.args[0], "design");
    assert.deepEqual(seen.scope, {
      version: 1,
      design: { paths: ["a.sigil"] },
      implementation: { exclude: ["**"], allowEmpty: true },
    });
    assert.equal(seen.bundle.sources[0].text, "exact");
    await assert.rejects(readFile(seen.frontend), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("requires explicit Implementation selection before launching any executable", async () => {
  const operation = runCompilationProcess({
    executable: "must-not-run",
    languageExecutable: "must-not-run",
    cwd: process.cwd(),
    focus: "implementation",
    onLog: () => {},
  });
  await assert.rejects(operation.result, /sigil.compile.selection/);
});

test("passes the explicit native Implementation selection for workspace and file focus", async () => {
  const cwd = await fixture();
  try {
    const selection = { paths: ["a.ts"], vendorDirs: ["vendor"] };
    await writeFile(
      path.join(cwd, "selection.json"),
      JSON.stringify(selection),
    );
    await writeFile(path.join(cwd, "a.ts"), "export const value = 1;");
    for (const file of [undefined, "a.sigil"]) {
      const result = await runCompilationProcess({
        executable: process.execPath,
        languageExecutable: process.execPath,
        cwd,
        focus: "implementation",
        selection: "selection.json",
        file,
        onLog: () => {},
      }).result;
      assert.equal(nativeState(result), "Converged");
      const seen = JSON.parse(
        await readFile(path.join(cwd, "observed.json"), "utf8"),
      );
      assert.equal(seen.args[0], "implementation");
      if (file) assert.deepEqual(seen.scope.implementation, selection);
      else {assert.equal(
          seen.args[seen.args.indexOf("--selection") + 1],
          path.join(cwd, "selection.json"),
        );}
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("terminates a compiler that exceeds the stderr bound", async () => {
  const cwd = await fixture(
    'process.stderr.write("x".repeat(2 * 1024 * 1024));setInterval(()=>{},1000);',
  );
  try {
    await assert.rejects(
      runCompilationProcess({
        executable: process.execPath,
        languageExecutable: process.execPath,
        cwd,
        focus: "design",
        onLog: () => {},
      }).result,
      /stderr exceeds/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cancellation stops an export and prevents the native gate from starting", async () => {
  const cwd = await fixture();
  try {
    await writeFile(
      path.join(cwd, "export"),
      'process.stderr.write("ready"); setInterval(()=>{},1000);',
    );
    const operation = runCompilationProcess({
      executable: process.execPath,
      languageExecutable: process.execPath,
      cwd,
      focus: "design",
      onLog: () => operation.cancel(),
    });
    await assert.rejects(operation.result, /cancelled/);
    await assert.rejects(readFile(path.join(cwd, "observed.json")), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runtime failure cannot accept a valid-looking successful report", async () => {
  const cwd = await fixture(
    `console.log(JSON.stringify(${
      JSON.stringify(design("Coherent"))
    }));process.exitCode=3;`,
  );
  try {
    await assert.rejects(
      runCompilationProcess({
        executable: process.execPath,
        languageExecutable: process.execPath,
        cwd,
        focus: "design",
        onLog: () => {},
      }).result,
      /gate exit 3/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("obsolete or failing language exports never launch the native compiler", async () => {
  for (
    const script of [
      'console.log(JSON.stringify({schemaVersion:1,languageVersion:"0.7.0"}));',
      'console.log(JSON.stringify({schemaVersion:2,languageVersion:"0.8.0",diagnostics:[{code:"INVALID"}]}));process.exitCode=1;',
    ]
  ) {
    const cwd = await fixture();
    try {
      await writeFile(path.join(cwd, "export"), script);
      await assert.rejects(
        runCompilationProcess({
          executable: process.execPath,
          languageExecutable: process.execPath,
          cwd,
          focus: "design",
          onLog: () => {},
        }).result,
        /Incompatible language export|Language export failed/,
      );
      await assert.rejects(readFile(path.join(cwd, "observed.json")), /ENOENT/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});
