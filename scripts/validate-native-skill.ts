import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Packaging checks are separate from model-behavior evaluation. Executing the
// published command examples catches stale guidance that text-presence checks miss.
const root = "integrations/skills/sigil";
const files: string[] = [];
async function collect(directory: string): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) await collect(path);
    else if (entry.isFile) files.push(path);
  }
}
await collect(root);
const skill = await Deno.readTextFile(`${root}/SKILL.md`);
assert(/^---\nname: sigil\ndescription: .+\n---/m.test(skill));
const version = (await Deno.readTextFile(`${root}/VERSION`)).trim();
assert(/^\d+\.\d+\.\d+$/.test(version), "Invalid skill artifact version");
const compatibility = JSON.parse(
  await Deno.readTextFile(`${root}/compatibility.json`),
);
equal(Object.keys(compatibility).sort(), [
  "cliVersion",
  "coreVersion",
  "sigilVersion",
  "sigilcVersion",
]);
equal(compatibility, {
  cliVersion: "^0.8.0",
  coreVersion: "^0.7.0",
  sigilVersion: "0.7.0",
  sigilcVersion: "^0.1.0",
});
const config = {
  sigilVersion: compatibility.sigilVersion,
  files: { include: ["**/*.sigil"], exclude: [".sigil/tmp/**"] },
};
function inRange(actual: string, range: string): boolean {
  assert(/^\^\d+\.\d+\.\d+$/.test(range), `Invalid stable range: ${range}`);
  assert(/^\d+\.\d+\.\d+(\+[^-]+)?$/.test(actual));
  const floor = range.slice(1).split(".").map(Number);
  const current = actual.split("+")[0].split(".").map(Number);
  const pivot = floor[0] ? 0 : floor[1] ? 1 : 2;
  const upper = floor.map((value, index) =>
    index < pivot ? value : index === pivot ? value + 1 : 0
  );
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  return compare(current, floor) >= 0 && compare(current, upper) < 0;
}
for (const path of files.filter((p) => /\.(md|sigil|yaml)$/.test(p))) {
  const source = await Deno.readTextFile(path);
  assert(
    !/\bsigil (?:semantic|compile|doctor)\b|--agent\b|--profile\b|ReviewGate|semantic-readiness|architecture-design/
      .test(
        source,
      ),
    `Removed workflow in ${path}`,
  );
  const prose = source.replace(/```[^]*?```/g, "");
  for (const link of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = link[1].split("#")[0];
    if (!target || /^[a-z]+:/.test(target) || isAbsolute(target)) continue;
    assert(
      (await Deno.stat(resolve(dirname(path), target))).isFile,
      `Missing reference from ${path}: ${target}`,
    );
  }
}
const adapter = await Deno.readTextFile(`${root}/agents/openai.yaml`);
assert(adapter.includes("$sigil"), "Default prompt must invoke the skill");
assert(
  files.some((path) => path.endsWith("evals/frontend-surface-fixture.md")),
);
assert(files.some((path) => path.endsWith("references/sigil-format.md")));

// Run the actual documented commands with fixture paths substituted, without a
// shell. Fixed empty Turtle exercises freshness and yellow/unavailable states;
// it does not stand in for independent reconstruction of this repository.
const legacyLanguage = Deno.env.get("SIGIL_LEGACY_LANGUAGE");
const legacyNative = Deno.env.get("SIGIL_LEGACY_COMPILER");
if (!legacyLanguage && !legacyNative) {
  console.log(
    `Validated retained legacy skill ${version}: static metadata and references only; runtime not run.`,
  );
  Deno.exit(0);
}
assert(
  legacyLanguage && legacyNative,
  "Supply both SIGIL_LEGACY_LANGUAGE and SIGIL_LEGACY_COMPILER for optional 0.7 runtime validation.",
);
const language = resolve(legacyLanguage), native = resolve(legacyNative);
for (
  const [tool, range] of [[language, compatibility.cliVersion], [
    native,
    compatibility.sigilcVersion,
  ]]
) {
  const result = await new Deno.Command(tool, {
    args: ["--version"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const actual = new TextDecoder().decode(result.stdout).trim().replace(
    /^sigilc /,
    "",
  );
  assert(
    result.success && inRange(actual, range),
    `Incompatible legacy executable: ${tool}`,
  );
}
const scratch = await Deno.makeTempDir({ prefix: "sigil skill examples 空 " });
try {
  const workspace = join(scratch, "workspace");
  const runDir = join(workspace, ".sigil", "tmp", "skill-fixture");
  await Deno.mkdir(join(workspace, ".sigil"), { recursive: true });
  await Deno.mkdir(join(workspace, "architecture"));
  await Deno.mkdir(join(workspace, "src"));
  await Deno.mkdir(runDir, { recursive: true });
  await Deno.writeTextFile(
    join(workspace, ".sigil/config.json"),
    JSON.stringify({
      ...config,
      workspace: { name: "skill-fixture", members: [] },
    }),
  );
  for (const name of ["a", "b"]) {
    await Deno.writeTextFile(
      join(workspace, `architecture/${name}.sigil`),
      `component ${name.toUpperCase()} {\n  goal {\n    Exercise documented native commands.\n  }\n  interface {\n    Operation {\n      Accept a fixture input.\n    }\n  }\n}\n`,
    );
  }
  await Deno.writeTextFile(join(workspace, "src/main.rs"), "fn main() {}\n");
  const reference = await Deno.readTextFile(
    `${root}/references/compilation-execution.md`,
  );
  const scope = JSON.parse(reference.match(/```json\n([^]*?)\n```/)![1]);
  await Deno.writeTextFile(join(runDir, "scope.json"), JSON.stringify(scope));
  const run = async (command: string, expected = 0) => {
    const words = command.trim().split(/\s+/);
    const executable = words.shift() === "sigil" ? language : native;
    let outputPath: string | undefined;
    const redirect = words.indexOf(">");
    if (redirect >= 0) {
      outputPath = words[redirect + 1].replace(".sigil/tmp/<run-id>", runDir);
      words.splice(redirect);
    }
    const args = words.map((word) =>
      word.replace(".sigil/tmp/<run-id>", runDir)
    );
    const result = await new Deno.Command(executable, {
      args,
      cwd: workspace,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(result.stdout);
    equal(
      result.code,
      expected,
      `${command}\n${new TextDecoder().decode(result.stderr)}\n${stdout}`,
    );
    if (outputPath) await Deno.writeTextFile(outputPath, stdout);
    return JSON.parse(stdout);
  };
  const commands = [...reference.matchAll(/```sh\n([^]*?)\n```/g)].flatMap(
    (block) =>
      block[1]
        .split("\n")
        .map((line) => line.replace(/^# /, ""))
        .filter((line) => /^sigilc? /.test(line)),
  );
  assert(commands.length >= 12, "Native protocol examples missing");
  for (const command of commands) {
    if (command.includes("attempt-2")) continue;
    if (command.startsWith("sigilc ingest")) {
      const turtle = command.split("--turtle ")[1].split(" ")[0].replace(
        ".sigil/tmp/<run-id>",
        runDir,
      );
      await Deno.writeTextFile(turtle, "");
      const binding = command.split("--binding ")[1].split(" ")[0].replace(
        ".sigil/tmp/<run-id>",
        runDir,
      );
      assert((await Deno.stat(binding)).isFile, `Missing binding: ${binding}`);
    }
    const expected = command.startsWith("sigilc stale design") ? 1 : 0;
    const report = await run(command, expected);
    if (command.startsWith("sigilc scope")) {
      equal(report.scope.design.focus_order, scope.design.paths);
      const unavailable = await run(
        command.replace("scope --", "compare --"),
        3,
      );
      equal(unavailable.comparison, null);
    }
    if (command.startsWith("sigilc compile design")) {
      equal(report.world.state, "Loose");
    }
    if (command.startsWith("sigilc prepare implementation")) {
      equal(report.inputs.length, 3);
    }
    if (/^sigilc (compare|compile implementation)/.test(command)) {
      equal(report.comparison.implementation, "Converged");
    }
  }
  console.log(
    `Validated skill ${version}: metadata, references and ${commands.length} native command examples (fixtures only).`,
  );
} finally {
  await Deno.remove(scratch, { recursive: true });
}
