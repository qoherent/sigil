import { strictEqual as equal } from "node:assert/strict";
import { join } from "node:path";
import type { AgentRunResult } from "./agents.ts";
import {
  fixtureStateSha256,
  LINKED_REPORT_VERSION,
  type PassExpectations,
  type PassRequest,
  preparePass,
  runPass,
  STAGED_SKILLS,
  validateLinkedEvidence,
} from "./claims.ts";
import { copySkill, copyTree, treeSha256 } from "./files.ts";
import { exists } from "./files.ts";

const claims =
  new URL("../../packages/sigilc/target/debug/sigil-claims", import.meta.url)
    .pathname;
const slotted = new URL("../../examples/slotted", import.meta.url).pathname;

const root = "/tmp/slotted-claims-test/private";
const linkedIdentity = {
  bindingDigest: "merged",
  guidanceFingerprint: "guidance",
  vocabularyGeneration: 3,
  interpretations: ["aaa", "bbb"],
};
function linkedInput(state: string, exitCode: number, unread: unknown[] = []) {
  return {
    privateStore: root,
    exitCode,
    workspaceDigest: "workspace",
    guidanceFingerprint: "guidance",
    vocabularyGeneration: 3,
    memoKeys: ["aaa", "bbb"],
    result: {
      version: LINKED_REPORT_VERSION,
      scope: "workspace",
      state,
      findings: 0,
      report: `${root}/claims/workspace.linked.json`,
      judgmentContext: `${root}/claims/workspace.linked.context.json`,
      workspaceDigest: "workspace",
      guidanceFingerprint: "guidance",
      vocabularyGeneration: 3,
    },
    report: {
      version: LINKED_REPORT_VERSION,
      source: "workspace",
      state,
      identity: linkedIdentity,
      findings: [],
      unread,
      unresolvedImports: [],
      linked: { workspaceDigest: "workspace", sources: [] },
    },
    context: { source: "workspace", identity: linkedIdentity, units: [] },
  };
}

Deno.test("a linked report exits 1 exactly when disjoint or incomplete", () => {
  equal(LINKED_REPORT_VERSION, 5);
  const loose = validateLinkedEvidence(linkedInput("loose", 0));
  equal(loose.valid, true, loose.errors.join("; "));
  equal(loose.state, "loose");
  const looseFails = validateLinkedEvidence(linkedInput("loose", 1));
  equal(looseFails.valid, false);
  equal(looseFails.state, null);
  equal(
    looseFails.errors.some((error) => error.includes("exit code")),
    true,
  );
  const disjoint = validateLinkedEvidence(linkedInput("disjoint", 1));
  equal(disjoint.valid, true, disjoint.errors.join("; "));
  const incomplete = validateLinkedEvidence(
    linkedInput("incomplete", 1, [{ source: "rooms.sigil", facets: ["f"] }]),
  );
  equal(incomplete.valid, true, incomplete.errors.join("; "));
  equal(incomplete.state, "incomplete");
  equal(validateLinkedEvidence(linkedInput("incomplete", 0)).valid, false);
});

Deno.test("a report that is not version 5 is rejected", () => {
  const old = linkedInput("loose", 0);
  const checked = validateLinkedEvidence({
    ...old,
    result: { ...old.result, version: 4 },
    report: { ...old.report, version: 4 },
  });
  equal(checked.valid, false);
  equal(
    checked.errors.some((error) => error.includes("version is not 5")),
    true,
  );
});

Deno.test("unread units reported as loose, or a stale workspace digest, are rejected", () => {
  const unread = linkedInput("loose", 0, [{ source: "rooms.sigil" }]);
  equal(validateLinkedEvidence(unread).valid, false);
  const stale = linkedInput("loose", 0);
  const checked = validateLinkedEvidence({
    ...stale,
    workspaceDigest: "other",
  });
  equal(checked.valid, false);
  equal(
    checked.errors.some((error) => error.includes("workspace digest")),
    true,
  );
});

// --- pass construction and judgement ------------------------------------

interface Setup {
  readonly scratch: string;
  readonly fixtureRoot: string;
  readonly skillDirs: PassRequest["skillDirs"];
  readonly expected: PassExpectations;
  request(overrides?: Partial<PassRequest>): PassRequest;
}

async function setup(prefix: string): Promise<Setup> {
  const scratch = await Deno.makeTempDir({ prefix });
  const fixtureRoot = join(scratch, "fixture");
  await copyTree(slotted, fixtureRoot);
  const skillDirs = {
    computeDir: join(scratch, "skills/sigil-compute"),
    understandDir: join(scratch, "skills/sigil-understand"),
    egglogDir: join(scratch, "skills/sigil-egglog"),
  };
  const hashes: Record<string, string> = {};
  for (
    const [name, dir] of [
      ["sigil-compute", skillDirs.computeDir],
      ["sigil-understand", skillDirs.understandDir],
      ["sigil-egglog", skillDirs.egglogDir],
    ]
  ) {
    await Deno.mkdir(`${dir}/references`, { recursive: true });
    await Deno.writeTextFile(`${dir}/SKILL.md`, `${name}\n`);
    await Deno.writeTextFile(`${dir}/references/detail.md`, `${name} detail\n`);
    const staged = join(scratch, "hash", name);
    await copySkill(dir, staged);
    hashes[name] = await treeSha256(staged);
  }
  // What a check of the untouched fixture reports, for the pass to be held to.
  const output = await new Deno.Command(claims, {
    args: [
      "check",
      "--root",
      fixtureRoot,
      "--store",
      join(scratch, "expect-store"),
    ],
    stdout: "piped",
    stderr: "null",
  }).output();
  const first = JSON.parse(new TextDecoder().decode(output.stdout));
  const expected: PassExpectations = {
    workspaceDigest: first.workspaceDigest,
    guidanceFingerprint: first.guidanceFingerprint,
    vocabularyGeneration: first.vocabularyGeneration,
    fixtureStateSha256: await fixtureStateSha256(fixtureRoot),
    skillSha256: hashes as PassExpectations["skillSha256"],
  };
  return {
    scratch,
    fixtureRoot,
    skillDirs,
    expected,
    request: (overrides = {}) => ({
      executable: claims,
      fixtureRoot,
      passDir: join(scratch, "pass"),
      evidenceDir: join(scratch, "evidence"),
      skillDirs,
      expected,
      requestedEffort: "medium",
      timeoutMs: 60_000,
      orchestrate: () => {
        throw new Error("the orchestrator should not have been launched");
      },
      ...overrides,
    }),
  };
}

/** What a host run looks like to the pass, without launching one. */
function agentRun(
  evidenceDir: string,
  finalText: string | null,
  overrides: Partial<AgentRunResult> = {},
  efforts: readonly string[] = [],
): AgentRunResult {
  const finalResponsePath = finalText === null
    ? null
    : join(evidenceDir, "final-response.txt");
  if (finalResponsePath !== null) {
    Deno.mkdirSync(evidenceDir, { recursive: true });
    Deno.writeTextFileSync(finalResponsePath, finalText!);
  }
  return {
    status: "completed",
    failureStep: null,
    error: null,
    exitCode: 0,
    agent: "claude",
    requestedModel: "m",
    requestedEffort: "medium",
    observedModels: [],
    modelVerification: "unverified",
    children: {
      count: efforts.length,
      models: [],
      efforts,
      effortVerification: efforts.length ? "observed" : "unverified",
      freshEvidence: [],
      observedFrom: null,
    },
    hostVersion: null,
    executable: "fake",
    settings: [],
    isolationLimits: [],
    passDir: "",
    promptPath: "",
    stdoutPath: "",
    stderrPath: "",
    finalResponsePath,
    ...overrides,
  };
}

Deno.test("a pass directory has a copied root with config and no claims store, the skills as siblings, and the pinned binary on bin", async () => {
  const s = await setup("slotted-pass-build-");
  try {
    // A fixture that has a stored reading must not leak it into the pass.
    await Deno.mkdir(`${s.fixtureRoot}/.sigil/claims/interpretations`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${s.fixtureRoot}/.sigil/claims/interpretations/old.json`,
      "{}",
    );
    const passDir = join(s.scratch, "pass");
    const staged = await preparePass({
      executable: claims,
      fixtureRoot: s.fixtureRoot,
      passDir,
      skillDirs: s.skillDirs,
      expected: s.expected,
    });
    equal(await exists(`${passDir}/root/.sigil/config.json`), true);
    equal(await exists(`${passDir}/root/.sigil/claims`), false);
    equal(await exists(`${passDir}/root/booking.sigil`), true);
    equal(staged.storeEntriesAtStart, 0);
    equal(staged.rootClaimsAtStart, false);
    for (const name of STAGED_SKILLS) {
      equal(await exists(`${passDir}/skills/${name}/SKILL.md`), true);
      equal(staged.skillSha256[name], s.expected.skillSha256[name]);
    }
    equal(
      await Deno.realPath(`${passDir}/bin/sigil-claims`),
      await Deno.realPath(claims),
    );
    equal((await Array.fromAsync(Deno.readDir(`${passDir}/store`))).length, 0);
    equal(await exists(`${passDir}/run`), true);
    // The fixture itself is untouched.
    equal(
      await exists(`${s.fixtureRoot}/.sigil/claims/interpretations/old.json`),
      true,
    );
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a pass whose store is not empty is refused before the orchestrator runs", async () => {
  const s = await setup("slotted-nonempty-store-");
  try {
    const store = join(s.scratch, "pass/store");
    await Deno.mkdir(store, { recursive: true });
    await Deno.writeTextFile(`${store}/old.txt`, "prior interpretation");
    const result = await runPass(s.request());
    equal(result.status, "failed");
    equal(result.failureStep, "setup");
    equal(result.error, "private claims store is not empty");
    equal(result.agent, null);
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a staged skill that differs from the pinned copy is refused", async () => {
  const s = await setup("slotted-skill-hash-");
  try {
    const result = await runPass(s.request({
      expected: {
        ...s.expected,
        skillSha256: { ...s.expected.skillSha256, "sigil-egglog": "other" },
      },
    }));
    equal(result.status, "failed");
    equal(result.failureStep, "setup");
    equal(result.error, "staged sigil-egglog differs from the pinned copy");
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a pass is scored from the benchmark's own check when the hand-back agrees", async () => {
  const s = await setup("slotted-pass-agree-");
  try {
    const request = s.request({
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(
          agentRun(
            evidence,
            "Left everything unread.\nHand-back state: incomplete\n",
          ),
        ),
    });
    const result = await runPass(request);
    equal(result.status, "valid", result.error ?? "");
    // The state comes from the check the benchmark ran, not the hand-back.
    equal(result.state, "incomplete");
    equal(result.handbackState, "incomplete");
    equal(result.linked?.validation?.valid, true);
    equal((result.unreadUnits ?? 0) > 0, true);
    equal(result.fixture.sha256Before, result.fixture.sha256After);
    equal(
      await exists(`${s.scratch}/evidence/check/check.stdout.txt`),
      true,
    );
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("an agent that hands back coherent while the check is incomplete makes the pass invalid", async () => {
  const s = await setup("slotted-pass-disagree-");
  try {
    const result = await runPass(s.request({
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(agentRun(evidence, "Hand-back state: coherent\n")),
    }));
    equal(result.status, "invalid");
    equal(result.failureStep, "handback");
    equal(result.state, null);
    equal(result.handbackState, "coherent");
    equal(result.error?.includes("incomplete"), true, result.error ?? "");
    // The benchmark's own check is still kept as evidence.
    equal(result.linked?.validation?.state, "incomplete");
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("an agent that hands back no state, or says it failed, fails the pass without scoring it", async () => {
  const s = await setup("slotted-pass-nohandback-");
  try {
    const missing = await runPass(s.request({
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(agentRun(evidence, "I finished.\n")),
    }));
    equal(missing.status, "failed");
    equal(missing.failureStep, "handback");
    equal(missing.handbackState, null);
    equal(missing.state, null);
    await Deno.remove(`${s.scratch}/pass`, { recursive: true });
    const failed = await runPass(s.request({
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(agentRun(evidence, "Hand-back state: failed\n")),
    }));
    equal(failed.status, "failed");
    equal(failed.handbackState, "failed");
    equal(failed.state, null);
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a child effort that differs from the requested effort makes the pass invalid", async () => {
  const s = await setup("slotted-pass-effort-");
  try {
    const result = await runPass(s.request({
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(
          agentRun(evidence, "Hand-back state: incomplete\n", {}, [
            "medium",
            "low",
          ]),
        ),
    }));
    equal(result.status, "invalid");
    equal(result.failureStep, "effort");
    equal(result.error?.includes("low"), true, result.error ?? "");
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a host that exposes no child effort is unverified and the pass is still scored", async () => {
  const s = await setup("slotted-pass-unverified-");
  try {
    const result = await runPass(s.request({
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(agentRun(evidence, "Hand-back state: incomplete\n")),
    }));
    equal(result.status, "valid", result.error ?? "");
    equal(result.agent?.children.effortVerification, "unverified");
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("with no effort requested, no child effort is checked", async () => {
  const s = await setup("slotted-pass-noeffort-");
  try {
    const result = await runPass(s.request({
      requestedEffort: null,
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(
          agentRun(evidence, "Hand-back state: incomplete\n", {}, ["high"]),
        ),
    }));
    equal(result.status, "valid", result.error ?? "");
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a pass that changes the fixture's own .sigil is invalid", async () => {
  const s = await setup("slotted-pass-tamper-");
  try {
    const result = await runPass(s.request({
      orchestrate: async (_pass, _bin, evidence) => {
        await Deno.mkdir(`${s.fixtureRoot}/.sigil/claims`, { recursive: true });
        await Deno.writeTextFile(
          `${s.fixtureRoot}/.sigil/claims/leak.json`,
          "{}",
        );
        return agentRun(evidence, "Hand-back state: incomplete\n");
      },
    }));
    equal(result.status, "invalid");
    equal(result.failureStep, "fixture");
    equal(result.fixture.sha256Before === result.fixture.sha256After, false);
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a pass that edits its copied sources fails the workspace digest", async () => {
  const s = await setup("slotted-pass-digest-");
  try {
    const result = await runPass(s.request({
      orchestrate: async (pass, _bin, evidence) => {
        const file = `${pass}/root/identity.sigil`;
        await Deno.writeTextFile(
          file,
          (await Deno.readTextFile(file)).replace(
            "one account type",
            "two account types",
          ),
        );
        return agentRun(evidence, "Hand-back state: incomplete\n");
      },
    }));
    equal(result.status, "invalid");
    equal(result.failureStep, "validation");
    equal(
      result.error?.includes("workspace digest"),
      true,
      result.error ?? "",
    );
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a timed-out orchestrator leaves the pass interrupted with partial evidence, not scored", async () => {
  const s = await setup("slotted-pass-timeout-");
  try {
    let budget = 0;
    const result = await runPass(s.request({
      timeoutMs: 30_000,
      orchestrate: (_pass, _bin, evidence, timeoutMs) => {
        budget = timeoutMs;
        return Promise.resolve(
          agentRun(evidence, null, {
            status: "timeout",
            failureStep: null,
            exitCode: null,
          }),
        );
      },
    }));
    equal(result.status, "interrupted");
    equal(result.failureStep, "orchestrator");
    equal(result.state, null);
    // The partial store was still checked, and its unread count kept.
    equal(result.linked?.validation?.state, "incomplete");
    equal((result.unreadUnits ?? 0) > 0, true);
    // `--timeout-ms` bounds the whole pass, so the agent never gets more.
    equal(budget > 0 && budget <= 30_000, true);
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a cancelled pass is interrupted and never launches the orchestrator", async () => {
  const s = await setup("slotted-pass-cancel-");
  try {
    const controller = new AbortController();
    controller.abort();
    const result = await runPass(s.request({ signal: controller.signal }));
    equal(result.status, "interrupted");
    equal(result.agent, null);
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a host that failed to launch fails the pass without a check", async () => {
  const s = await setup("slotted-pass-launch-");
  try {
    const result = await runPass(s.request({
      orchestrate: (_pass, _bin, evidence) =>
        Promise.resolve(
          agentRun(evidence, null, {
            status: "failed",
            failureStep: "launch",
            error: "no such host",
            exitCode: null,
          }),
        ),
    }));
    equal(result.status, "failed");
    equal(result.error, "no such host");
    equal(result.linked, null);
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});

Deno.test("a second pass starts from nothing the first pass stored", async () => {
  const s = await setup("slotted-pass-two-");
  try {
    const stored: number[] = [];
    for (const name of ["first", "second"]) {
      const result = await runPass(s.request({
        passDir: join(s.scratch, name),
        evidenceDir: join(s.scratch, `${name}-evidence`),
        orchestrate: async (pass, _bin, evidence) => {
          // The pass leaves a stored reading and a write-back behind.
          await Deno.mkdir(`${pass}/store/claims/interpretations`, {
            recursive: true,
          });
          await Deno.mkdir(`${pass}/root/.sigil/claims`, { recursive: true });
          await Deno.writeTextFile(`${pass}/root/.sigil/claims/x.json`, "{}");
          return agentRun(evidence, "Hand-back state: incomplete\n");
        },
      }));
      equal(result.staged?.storeEntriesAtStart, 0);
      equal(result.staged?.rootClaimsAtStart, false);
      stored.push(result.staged?.storeEntriesAtStart ?? -1);
    }
    // Neither pass wrote into the other's directory or the fixture.
    equal(await exists(`${s.fixtureRoot}/.sigil/claims`), false);
    equal(await exists(`${s.scratch}/second/root/.sigil/claims/x.json`), true);
    equal(stored.join(), "0,0");
  } finally {
    await Deno.remove(s.scratch, { recursive: true });
  }
});
