/**
 * Fake hosts for the regenerate-pass tests. This file is not a test.
 *
 * Each fake is a JavaScript module run by the runtime running the tests, so no
 * test starts a real agent. The fake writer authors canned files into
 * `design/` and prints host events that show the tool calls a test needs. The
 * fake reader runs the staged `sigilc` itself: in the claims stage it reads
 * every unread unit with `(reading ... "no-commitment")` rows through
 * `prepare` and `ingest`, so its readings are real ones `sigilc` accepts; in
 * the coverage stage it writes a canned answer.
 */
import { copyFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { writeScript } from "../agent-runner/test_support.ts";
import { type Environment, rereadReference } from "./batch.ts";
import { pinReader } from "./reader.ts";
import { referenceStorePaths, REPO_ROOT } from "./records.ts";
import { copyDir, type HostCommand, type Role } from "./stages.ts";
import type { ReviewMark, WriterState } from "./writer.ts";

export interface FakeWriterOptions {
  /** Which host's stream to print. */
  readonly host?: "claude" | "pi";
  /** Files written into `design/`, by relative path. */
  readonly design?: Record<string, string>;
  /** `delegated`: start an interpreter and a reviewer, write run/ and store/. */
  readonly review?: ReviewMark;
  /** The hand-back state; omit the line entirely with `null`. */
  readonly state?: WriterState | null;
  /** A path a reviewer child reads (shown in the events only). */
  readonly childRead?: string;
  /** Append to the staged requirement file. */
  readonly editRequirement?: boolean;
  /** A path written outside the staging directory, shown as a Write call. */
  readonly writeOutside?: string;
  /** Leave readings in the design's own claims store. */
  readonly leaveClaims?: boolean;
  /** Wait this long first, to exercise timeouts and cancellation. */
  readonly sleepMs?: number;
}

export interface FakeReaderOptions {
  /** Wait this long in the claims stage before reading. */
  readonly claimsSleepMs?: number;
  /** Requirement ID to the handles cited; the rest are `none`. */
  readonly coverage?: Record<string, string[]>;
  /** Wait this long in the coverage stage. */
  readonly coverageSleepMs?: number;
  /** The hand-back state to print in place of the check's own state. */
  readonly handback?: string;
  /** Skip the claims readings, so every unit stays unread. */
  readonly skipClaims?: boolean;
  /** Write no coverage answer, so the coverage stage fails. */
  readonly skipCoverage?: boolean;
}

const HEADER =
  `import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
if (process.argv.includes("--version")) {
  console.log("fake-host 1.0");
  process.exit(0);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
`;

const WRITER = `${HEADER}
const O = JSON.parse(__OPTIONS__);
const cwd = process.cwd();
write("run/argv.json", JSON.stringify({
  argv: process.argv.slice(2),
  sigil: spawnSync("sigil", ["--version"], { encoding: "utf8" }).stdout,
  piAgents: existsSync(".pi/agents") ? readdirSync(".pi/agents").sort() : [],
}));
if (O.sleepMs) await sleep(O.sleepMs);
const calls = [{ name: "Read", input: { file_path: "skills/sigil-write/SKILL.md" } }];
const children = [];
for (const [path, text] of Object.entries(O.design ?? {})) {
  write(join("design", path), text);
  calls.push({ name: "Write", input: { file_path: join("design", path), content: text } });
}
if (O.review === "delegated") {
  write("run/prep/request.json", "{}");
  write("run/review/request.md", "review request");
  write("run/review/report.md", "no findings");
  write("store/claims/interpretations/fake.json", "{}");
  calls.push({ name: "Bash", input: { command: "sigilc check --root design --store store > run/check.json" } });
  children.push({ type: "interpreter", calls: [
    { name: "Read", input: { file_path: "run/prep/request.json" } },
    { name: "Write", input: { file_path: "run/prep/answer-1.egg", content: "" } },
  ] });
  children.push({ type: "reviewer", calls: [
    { name: "Read", input: { file_path: "skills/sigil-evaluate/SKILL.md" } },
    { name: "Read", input: { file_path: "run/review/request.md" } },
  ] });
}
if (O.childRead) {
  children.push({ type: "reviewer", calls: [{ name: "Read", input: { file_path: O.childRead } }] });
}
if (O.leaveClaims) write("design/.sigil/claims/interpretations/stale.json", "{}");
if (O.editRequirement) appendFileSync("requirement.md", "\\nAlso build a spaceship.\\n");
if (O.writeOutside) {
  write(O.writeOutside, "outside");
  calls.push({ name: "Write", input: { file_path: O.writeOutside, content: "outside" } });
}
const state = O.state === undefined ? "written" : O.state;
const text = "Draft written to design/." + (state === null ? "" : "\\nHand-back: " + state + ", review " + (O.review ?? "none"));
if (O.host === "pi") {
  const blocks = [
    ...calls.map((call) => ({ type: "toolCall", name: call.name.toLowerCase(), arguments: call.input })),
    ...children.map((child) => ({ type: "toolCall", name: "subagent", arguments: { agent: child.type, context: "fresh", task: "go" } })),
    { type: "text", text },
  ];
  emit({ type: "message_end", message: { role: "assistant", model: "fake-writer-model", content: blocks } });
} else {
  emit({ type: "system", subtype: "init", cwd, agents: ["interpreter", "reviewer"] });
  const spawns = children.map((child, index) => ({ type: "tool_use", id: "toolu_child_" + index, name: "Agent", input: { subagent_type: child.type, prompt: "go" } }));
  emit({ type: "assistant", message: { model: "fake-writer-model", content: [
    ...calls.map((call, index) => ({ type: "tool_use", id: "toolu_" + index, name: call.name, input: call.input })),
    ...spawns,
  ] } });
  children.forEach((child, index) => emit({ type: "assistant", parent_tool_use_id: "toolu_child_" + index, message: { model: "fake-writer-model", content: child.calls.map((call, n) => ({ type: "tool_use", id: "toolu_c" + index + "_" + n, name: call.name, input: call.input })) } }));
  emit({ type: "result", result: text });
}
`;

const READER = `${HEADER}
const O = JSON.parse(__OPTIONS__);
const cwd = process.cwd();
const result = (text) => {
  emit({ type: "system", subtype: "init", cwd, agents: [] });
  emit({ type: "assistant", message: { model: "fake-reader-model", content: [] } });
  emit({ type: "result", result: text });
};
if (existsSync("facets.md")) {
  if (O.coverageSleepMs) await sleep(O.coverageSleepMs);
  const list = JSON.parse(readFileSync("requirement-list.json", "utf8"));
  const cited = O.coverage ?? {};
  const entries = list.requirements.map((requirement) => cited[requirement.id]
    ? { id: requirement.id, verdict: "answered", facets: cited[requirement.id] }
    : { id: requirement.id, verdict: "none", facets: [] });
  if (!O.skipCoverage) write("answer/coverage.json", JSON.stringify({ entries }));
  result("Coverage: written");
} else {
  write("run/start-state.json", JSON.stringify({
    storeEntries: readdirSync("store"),
    rootClaims: existsSync("root/.sigil/claims"),
    skills: readdirSync("skills").sort(),
  }));
  if (O.claimsSleepMs) await sleep(O.claimsSleepMs);
  const sigilc = (...args) => spawnSync("sigilc", args, { encoding: "utf8" });
  const first = sigilc("check", "--root", "root", "--store", "store");
  const report = JSON.parse(readFileSync(JSON.parse(first.stdout).report, "utf8"));
  const sources = [...new Set(report.unread.map((unit) => unit.source))].sort();
  if (O.skipClaims) mkdirSync("store/claims/interpretations", { recursive: true });
  else sources.forEach((source, index) => {
    const prep = "run/prep-" + index;
    const prepared = sigilc("prepare", "--source", source, "--out", prep, "--root", "root", "--store", "store");
    if (prepared.status !== 0) {
      process.stderr.write(prepared.stderr);
      process.exit(3);
    }
    const request = JSON.parse(readFileSync(prep + "/request.json", "utf8"));
    const rows = request.rows.filter((row) => !row.context)
      .map((row) => "(reading " + JSON.stringify(row.facet) + " \\"no-commitment\\")");
    const answer = "run/answer-" + index + ".egg";
    write(answer, rows.join("\\n") + "\\n");
    const ingested = sigilc("ingest", "--binding", prep + "/binding.json", "--claims", answer, "--root", "root", "--store", "store");
    if (ingested.status !== 0 && ingested.status !== 1) {
      process.stderr.write(ingested.stderr);
      process.exit(3);
    }
  });
  mkdirSync("root/.sigil/claims/interpretations", { recursive: true });
  for (const name of readdirSync("store/claims/interpretations")) {
    copyFileSync(join("store/claims/interpretations", name), join("root/.sigil/claims/interpretations", name));
  }
  const final = JSON.parse(sigilc("check", "--root", "root", "--store", "store").stdout);
  result("Final check: " + final.state + ".\\nHand-back state: " + (O.handback ?? final.state));
}
`;

async function writeFake(
  dir: string,
  name: string,
  source: string,
  options: unknown,
): Promise<HostCommand> {
  return await writeScript(
    join(dir, name),
    source.replace("__OPTIONS__", JSON.stringify(JSON.stringify(options))),
  );
}

export async function fakeWriter(
  dir: string,
  options: FakeWriterOptions = {},
): Promise<HostCommand> {
  return await writeFake(dir, "fake-writer.mjs", WRITER, options);
}

export async function fakeReader(
  dir: string,
  options: FakeReaderOptions = {},
): Promise<HostCommand> {
  return await writeFake(dir, "fake-reader.mjs", READER, options);
}

/** A `hostFor` that starts `writer` for the writer and `reader` for readers. */
export function fakeHosts(
  writer: HostCommand | null,
  reader: HostCommand,
): (role: Role) => HostCommand {
  return (role) => {
    if (role === "reader") return reader;
    if (writer === null) throw new Error("this test starts no writer");
    return writer;
  };
}

/** A reference with a pinned fake reader. */
export interface PinnedReference {
  readonly root: string;
  readonly dir: string;
  readonly environment: Environment;
}

/**
 * Pin a reader for a canned reference design and take its readings with the
 * fake `reader`, as the README's pinning steps do: pin-reader, then
 * `reread reference --coverage` into a new directory, then copy it in.
 */
export async function pinnedReference(input: {
  readonly root: string;
  readonly dir: string;
  readonly scratch: string;
  readonly reader: HostCommand;
}): Promise<PinnedReference> {
  const environment: Environment = {
    references: { slotted: { root: input.root, dir: input.dir } },
    slottedWorkspace: null,
    timeoutMs: 60_000,
    hostFor: fakeHosts(null, input.reader),
  };
  await pinReader({
    referenceDir: input.dir,
    skillsDir: join(REPO_ROOT, "skills"),
    agent: "claude",
    model: "reader-model",
    effort: "high",
  });
  const out = join(input.scratch, "reference-readings");
  await rereadReference({ ...environment, coverage: true, out });
  const paths = referenceStorePaths(input.dir);
  await copyDir(join(out, "store"), paths.store);
  await copyFile(join(out, "readings.json"), paths.readings);
  await copyFile(join(out, "coverage.json"), paths.coverage);
  return { root: input.root, dir: input.dir, environment };
}

/**
 * A copy of a pinned reference's store under `scratch`, sharing its design
 * and its fake reader, so a test may change the store without touching the
 * reference other tests use.
 */
export async function copyPinnedReference(
  reference: PinnedReference,
  scratch: string,
): Promise<PinnedReference> {
  const dir = join(scratch, "reference-store");
  await cp(reference.dir, dir, { recursive: true });
  return {
    root: reference.root,
    dir,
    environment: {
      ...reference.environment,
      references: { slotted: { root: reference.root, dir } },
    },
  };
}
