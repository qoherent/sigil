/**
 * The pinned reader: who takes every claims and coverage
 * reading, the skills it reads with, and what each of its two stages asks.
 *
 * - The claims stage runs the evaluation benchmark's own full-design prompt
 *   (`orchestratorPrompt` in `../slotted-benchmark/agents.ts`) on a staged
 *   copy of the design, in that benchmark's pass layout, so a claims reading
 *   here is the same whole-design reading step that benchmark measures.
 * - The coverage stage has one fresh child read the whole design with the
 *   requirement file, the requirement list and every Facet's `#N` handle, and
 *   write one JSON answer. This module turns that answer into the stored
 *   coverage format (`coverage.ts`).
 *
 * The reader's skills come from the frozen copy beside the reference store,
 * never from the working tree, and `reader.json` records their digests and
 * the digests of both prompt templates.
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  copySkill,
  exists,
  treeSha256,
  writeJson,
} from "../agent-runner/files.ts";
import type { ChildAgentDefinition } from "../agent-runner/hosts.ts";
import type { PromptContext } from "../agent-runner/launch.ts";
import {
  INTERPRETER_CHILD,
  orchestratorPrompt,
} from "../slotted-benchmark/agents.ts";
import { textDigest } from "./baseline.ts";
import type { CoverageEntry, CoverageFile } from "./coverage.ts";
import type { RequirementInputs } from "./measure.ts";
import {
  COVERAGE_VERSION,
  type ReaderIdentity,
  readOptionalJson,
  referenceStorePaths,
  type RequirementList,
} from "./records.ts";
import type { FacetHandle } from "./structure.ts";

/** The skills the reader is frozen with, in `reader-skills/<name>`. */
export const READER_SKILLS = [
  "sigil-compute-design",
  "sigil-understand",
  "sigil-egglog",
] as const;

/** Where each part of the coverage stage's directory lives, relative to it. */
export const COVERAGE_LAYOUT = {
  design: "design",
  requirement: "requirement.md",
  list: "requirement-list.json",
  facets: "facets.md",
  answerDir: "answer",
  answer: "answer/coverage.json",
  skill: "skills/sigil-understand/SKILL.md",
  bin: "bin",
} as const;

/** The one child the coverage stage starts. */
export const COVERAGE_CHILD: ChildAgentDefinition = {
  name: "coverage-reader",
  description: "Fresh requirement-coverage reader",
  prompt:
    "You are a fresh requirement-coverage reader. Do exactly the task you are handed: read only the files it names, write your answer to the file it names, and write nothing else.",
  claudeTools: ["Read", "Glob", "Grep", "Write"],
  piTools: ["read", "write", "grep", "find", "ls"],
};

/**
 * The task the coverage child is handed word for word. It names the inputs
 * and the output format; everything else is the child's judgment.
 */
export function coverageTask(): string {
  const { design, requirement, list, facets, answer, skill } = COVERAGE_LAYOUT;
  return [
    "Judge which Facets of a Sigil design answer each requirement.",
    "",
    `Read ${skill}, and each reference file it names, for how to read Sigil. Then read:`,
    "",
    `- \`${requirement}\`: the full requirement text. It is the only statement of what was asked.`,
    `- \`${list}\`: every requirement ID, each with a one-line label. Judge each ID against its full text in \`${requirement}\`, not against the label alone.`,
    `- \`${facets}\`: every Facet of the design, each with its handle (\`#N\`), its label (\`Component section N\`), its source file and its prose.`,
    `- every file under \`${design}/\`: the whole design. A Facet means what it means within its component and its neighbours, so read the design around each Facet you cite before you judge it.`,
    "",
    "A Facet answers a requirement when what it promises, together with the other Facets you cite for that requirement, delivers what the requirement asks. A Facet that only mentions the same subject or words does not answer it. Cite every Facet the answer needs, by handle, and only handles that appear in the Facet list. If no Facet answers a requirement, its verdict is `none`.",
    "",
    `Write \`${answer}\` as JSON of exactly this shape, with one entry per requirement ID in list order:`,
    "",
    "```json",
    '{"entries": [',
    '  {"id": "R1", "verdict": "answered", "facets": ["#4", "#17"]},',
    '  {"id": "R2", "verdict": "none", "facets": []}',
    "]}",
    "```",
    "",
    '`verdict` is `answered` (with at least one handle) or `none` (with no handles). An entry may add a short `"note"`. Write nothing else, and change no file you read.',
  ].join("\n");
}

/** The coverage stage's orchestrator prompt. */
export function coveragePrompt(context: PromptContext): string {
  const effort = context.effort
    ? `reasoning effort ${context.effort}`
    : "the host's default reasoning effort";
  return [
    "Take one requirement-coverage reading of the Sigil design in this directory.",
    "",
    `Start exactly one fresh child for the whole reading. It inherits none of your conversation. ${context.spawnInstruction} The child runs with model ${context.model} at ${effort}; the host is already set to that, so do not pass a model or effort override. Hand the child the task below word for word. Do not read the design or write the answer yourself.`,
    "",
    "<task>",
    coverageTask(),
    "</task>",
    "",
    "Do not read anything outside this directory. There is no answer key to look for.",
    "",
    `When the child is done, check that \`${COVERAGE_LAYOUT.answer}\` exists, then stop. Your final message must end with exactly one line, \`Coverage: written\` when the file exists or \`Coverage: failed\` when it does not.`,
    "",
  ].join("\n");
}

/** The digest of the coverage prompt template; part of the reader identity. */
export async function coveragePromptDigest(): Promise<string> {
  return await textDigest(coveragePrompt({
    spawnInstruction: "{spawnInstruction}",
    model: "{model}",
    effort: "{effort}",
  }));
}

/** The two claims-reading prompts, injectable so pin validation is testable. */
export interface ClaimsPromptDefinition {
  readonly orchestrator: typeof orchestratorPrompt;
  readonly child: ChildAgentDefinition;
}

type OrchestratorInput = Parameters<typeof orchestratorPrompt>[0];

/**
 * The claims orchestrator's prompt for a benchmark reading. The harness reads
 * the private store, so the workspace write-back is not part of the reading and
 * the shared template's instruction to do it is overridden here.
 */
export function benchmarkClaimsPrompt(input: OrchestratorInput): string {
  return [
    orchestratorPrompt(input),
    "Benchmark note, which overrides the write-back above: this is a benchmark reading. Do not copy anything into the workspace store or under `root/.sigil`. The harness reads the private store `store` directly. Your final check is the one you run with `--root root --store store`, and its state is the hand-back.",
    "",
  ].join("\n");
}

const CLAIMS_PROMPTS: ClaimsPromptDefinition = {
  orchestrator: benchmarkClaimsPrompt,
  child: INTERPRETER_CHILD,
};

/** Digest the claims orchestrator template and its interpreter child prompt. */
export async function claimsPromptDigest(
  prompts: ClaimsPromptDefinition = CLAIMS_PROMPTS,
): Promise<string> {
  const orchestrator = prompts.orchestrator({
    action: "design",
    spawnInstruction: "{spawnInstruction}",
    model: "{model}",
    effort: "{effort}",
  });
  return await textDigest(JSON.stringify({
    orchestrator,
    child: prompts.child,
  }));
}

/** The coverage stage's hand-back: whether the answer file was written. */
export type CoverageHandback = "written" | "failed";

export function parseCoverageHandback(
  text: string,
): CoverageHandback | null {
  let found: CoverageHandback | null = null;
  for (
    const match of text.matchAll(
      /^[\s*_`>-]*Coverage:\s*[*_`]*\s*([A-Za-z]+)/gim,
    )
  ) {
    const word = match[1].toLowerCase();
    found = word === "written" || word === "failed" ? word : null;
  }
  return found;
}

/** The Facet list the coverage reader is given, one heading per handle. */
export function facetsDocument(handles: readonly FacetHandle[]): string {
  const lines = ["# Facets", ""];
  for (const handle of handles) {
    lines.push(
      `## ${handle.handle} ${handle.label} (${handle.source})`,
      "",
      ...handle.prose.split("\n").map((line) => `> ${line}`.trimEnd()),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** What the coverage stored for one reading names besides its entries. */
export interface CoverageHeader {
  readonly listName: string;
  readonly listDigest: string;
  /** Benchmark name to the digest of its requirement file. */
  readonly requirementFiles: Readonly<Record<string, string>>;
  readonly reader: ReaderIdentity;
}

/** The header of a pass's coverage reading: its own benchmark's file only. */
export function coverageHeader(
  requirements: RequirementInputs,
  reader: ReaderIdentity,
): CoverageHeader {
  return {
    listName: requirements.listName,
    listDigest: requirements.listDigest,
    requirementFiles: {
      [requirements.benchmark]: requirements.requirementFileDigest,
    },
    reader,
  };
}

/**
 * Turn the reader's answer into a stored coverage reading. Cited handles map
 * to Facet ids; a requirement whose answer cites a handle that does not exist,
 * gives no verdict or an unknown one, is stored `not-read` with the reason in
 * its note. With no answer at all, every requirement is `not-read` with
 * `failure` as its note.
 */
export function coverageFromAnswer(input: {
  readonly answer: unknown;
  readonly failure: string | null;
  readonly list: RequirementList;
  readonly handles: readonly FacetHandle[];
  readonly header: CoverageHeader;
}): CoverageFile {
  const byHandle = new Map(input.handles.map((h) => [h.handle, h]));
  const answers = new Map<string, Record<string, unknown>>();
  const rows = (input.answer as { entries?: unknown } | null)?.entries;
  if (input.failure === null && Array.isArray(rows)) {
    for (const row of rows) {
      if (row && typeof row === "object" && "id" in row) {
        const id = String((row as { id: unknown }).id);
        if (!answers.has(id)) answers.set(id, row as Record<string, unknown>);
      }
    }
  }
  const notRead = (id: string, note: string): CoverageEntry => ({
    id,
    verdict: "not-read",
    facets: [],
    note,
  });
  const withNote = (entry: CoverageEntry, note: string | undefined) =>
    note ? { ...entry, note } : entry;
  const entries = input.list.requirements.map((requirement): CoverageEntry => {
    const id = requirement.id;
    if (input.failure !== null) return notRead(id, input.failure);
    if (!Array.isArray(rows)) {
      return notRead(id, "the reader's answer has no entries list");
    }
    const row = answers.get(id);
    if (!row) return notRead(id, "the reader gave no verdict");
    const note = typeof row.note === "string" && row.note.trim()
      ? row.note.trim()
      : undefined;
    const cited = Array.isArray(row.facets) ? row.facets.map(String) : [];
    if (row.verdict === "none") {
      return withNote({ id, verdict: "none", facets: [] }, note);
    }
    if (row.verdict === "not-read") {
      return notRead(id, note ?? "the reader did not read it");
    }
    if (row.verdict !== "answered") {
      return notRead(id, `the reader gave the unknown verdict ${row.verdict}`);
    }
    const unknown = cited.filter((handle) => !byHandle.has(handle));
    if (unknown.length > 0) {
      return notRead(
        id,
        `the reader cited ${
          unknown.join(", ")
        }, which no Facet of the design has`,
      );
    }
    if (cited.length === 0) {
      return notRead(id, "the reader answered it with no Facet");
    }
    const facets = [...new Set(cited)].map((handle) => {
      const facet = byHandle.get(handle)!;
      return { id: facet.id, label: facet.label };
    });
    return withNote({ id, verdict: "answered", facets }, note);
  });
  return {
    version: COVERAGE_VERSION,
    requirementList: {
      name: input.header.listName,
      digest: input.header.listDigest,
    },
    requirementFiles: input.header.requirementFiles,
    reader: input.header.reader,
    entries,
  };
}

/** Read and check the pinned reader of a reference store. */
export async function loadPinnedReader(
  referenceDir: string,
  claimsPrompts: ClaimsPromptDefinition = CLAIMS_PROMPTS,
): Promise<ReaderIdentity> {
  const paths = referenceStorePaths(referenceDir);
  const reader = await readOptionalJson<ReaderIdentity>(paths.reader);
  if (!reader) {
    throw new Error(
      `The reference store ${referenceDir} has no reader.json. Pin the reference first: run pin-reader, then reread reference --coverage (see README.md, "Pin the reference").`,
    );
  }
  for (const name of READER_SKILLS) {
    const dir = join(paths.readerSkills, name);
    if (!(await exists(dir))) {
      throw new Error(
        `The pinned reader's skill ${name} is missing from ${paths.readerSkills}; run pin-reader again`,
      );
    }
    const digest = await treeSha256(dir);
    if (reader.skillDigests[name] !== digest) {
      throw new Error(
        `The frozen ${name} in ${paths.readerSkills} does not match reader.json (${digest}, not ${
          reader.skillDigests[name]
        }); run pin-reader again`,
      );
    }
  }
  const promptDigest = await coveragePromptDigest();
  if (reader.coveragePromptDigest !== promptDigest) {
    throw new Error(
      `The coverage prompt changed since the reader was pinned (${promptDigest}, not ${reader.coveragePromptDigest}); run pin-reader --force and reread reference --coverage`,
    );
  }
  const currentClaimsPromptDigest = await claimsPromptDigest(claimsPrompts);
  if (reader.claimsPromptDigest !== currentClaimsPromptDigest) {
    throw new Error(
      `The claims prompt changed since the reader was pinned (${currentClaimsPromptDigest}, not ${reader.claimsPromptDigest}); run pin-reader --force and reread reference --coverage`,
    );
  }
  return reader;
}

/**
 * Freeze the reader's skills from `skillsDir` into the reference store and
 * write `reader.json`. Refuses to replace a pinned reader unless `force`.
 */
export async function pinReader(input: {
  readonly referenceDir: string;
  readonly skillsDir: string;
  readonly agent: string;
  readonly model: string;
  readonly effort: string;
  readonly force?: boolean;
}): Promise<ReaderIdentity> {
  const paths = referenceStorePaths(input.referenceDir);
  if (await exists(paths.reader) && !input.force) {
    throw new Error(
      `${paths.reader} already pins a reader; pass --force to replace it, then take new readings with reread reference --coverage`,
    );
  }
  await rm(paths.readerSkills, { recursive: true, force: true });
  const skillDigests: Record<string, string> = {};
  for (const name of READER_SKILLS) {
    const dir = join(paths.readerSkills, name);
    await copySkill(join(input.skillsDir, name), dir);
    skillDigests[name] = await treeSha256(dir);
  }
  const reader: ReaderIdentity = {
    agent: input.agent,
    model: input.model,
    effort: input.effort,
    skillDigests,
    coveragePromptDigest: await coveragePromptDigest(),
    claimsPromptDigest: await claimsPromptDigest(),
  };
  await mkdir(paths.dir, { recursive: true });
  await writeJson(paths.reader, reader);
  return reader;
}

/** Parse the reader's answer file; null with a reason when it cannot. */
export async function readCoverageAnswer(
  path: string,
): Promise<{ answer: unknown; failure: string | null }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { answer: null, failure: "the reader wrote no answer file" };
  }
  try {
    return { answer: JSON.parse(text), failure: null };
  } catch {
    return { answer: null, failure: "the reader's answer file is not JSON" };
  }
}
