import { match as matches, ok as assert } from "node:assert/strict";
import {
  type AttemptRecord,
  type BatchManifest,
  pendingRecord,
} from "./batch.ts";
import { exists } from "./files.ts";
import { SLOTTED_FIXTURE } from "./fixture.ts";
import { renderReport, type ReportAttempt, writeReport } from "./report.ts";

const fixtureIssues = SLOTTED_FIXTURE.issues.map((issue, index) => ({
  ...issue,
  status: "scorable" as const,
  reason: null,
  facets: index === 0
    ? ["F-range-interface", "F-range-constraint"]
    : index === 1
    ? ["F-booking-mark", "F-rooms-mark"]
    : index === 2
    ? ["F-display"]
    : ["F-digest"],
}));
const manifest = {
  version: 2,
  createdAt: "2026-10-02T00:00:00Z",
  fixture: SLOTTED_FIXTURE,
  preflight: { canSchedule: true, sourceDrift: [], issues: fixtureIssues },
  schedule: [
    {
      id: "000001",
      agent: "claude",
      model: "sonnet",
      pass: 1,
    },
    {
      id: "000002",
      agent: "claude",
      model: "sonnet",
      pass: 2,
    },
    {
      id: "000003",
      agent: "claude",
      model: "sonnet",
      pass: 3,
    },
  ],
  input: { workspaceDigest: "snapshot" },
  tools: { sigilcSha256: "native", claimsSha256: "native" },
  timeoutMs: 1000,
  reasoning: "medium",
} as unknown as BatchManifest;

function attempt(
  id: string,
  status: AttemptRecord["status"],
  findings: unknown[],
  attemptManifest: BatchManifest = manifest,
  context: Record<string, unknown> = {
    units: [
      {
        facet: "F-range-interface",
        asserted: [{ claim: "witness-1", body: { kind: "claim" } }],
      },
      {
        facet: "F-range-constraint",
        asserted: [{ claim: "witness-2", body: { kind: "claim" } }],
      },
    ],
  },
  unread: unknown[] = [],
  overrides: Partial<AttemptRecord> = {},
): ReportAttempt {
  const planned = attemptManifest.schedule.find((row) => row.id === id)!;
  const state = unread.length ? "incomplete" : "disjoint";
  const record = {
    ...pendingRecord(planned),
    status,
    startedAt: "start",
    finishedAt: "end",
    state: status === "valid" ? state : null,
    handbackState: status === "valid" || status === "invalid" ? state : null,
    failureStep: status === "valid" ? null : "validation",
    error: status === "valid" ? null : "evidence did not validate",
    unreadUnits: unread.length,
    observedModels: ["claude-sonnet-observed"],
    modelVerification: "observed",
    requestedEffort: "medium",
    childCount: 1,
    childModels: ["claude-sonnet-observed"],
    childEfforts: [],
    childEffortVerification: "unverified",
    outcomePath: `attempts/${id}/outcome.json`,
    ...overrides,
  } as AttemptRecord;
  const outcome = {
    status,
    state: record.state,
    linked: {
      exitCode: 1,
      validation: { valid: true },
      report: {
        source: "workspace",
        state,
        findings,
        unread,
        unresolvedImports: [],
      },
      context,
    },
  };
  return { record, outcome };
}

Deno.test("same-state passes show evidence-based 1/2 detection and extras, and unscored passes do not count", () => {
  const contradiction = {
    class: "contradiction",
    law: "contradictory-claims",
    subject: "urn:sigil:component:booking.sigil:Booking",
    object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
    claims: ["witness-1"],
  };
  const extra = {
    class: "flow",
    law: "unguarded-flow",
    subject: "some-step",
    object: "urn:sigil:component:rooms.sigil:Rooms",
    claims: ["witness-2"],
  };
  const first = attempt("000001", "valid", [contradiction, {
    ...contradiction,
    claims: ["witness-2"],
  }]);
  const second = attempt("000002", "valid", [extra]);
  // An invalid pass still has a report, but its findings are not scored.
  const invalid = attempt("000003", "invalid", [contradiction]);
  const report = renderReport(manifest, [first, second, invalid]);
  matches(report, /booking-pending-range-contradiction: 1\/2/);
  matches(report, /linked finding 1, 2/);
  matches(report, /unguarded-flow/);
  matches(report, /000003.*invalid/);
  assert(!report.includes("false positive"));
  assert(!report.includes("Overall rank"));
});

Deno.test("the runs table is per pass: state, hand-back, planted problems, unread units and observed children, with no per-source sections", () => {
  const contradiction = {
    class: "contradiction",
    law: "contradictory-claims",
    subject: "urn:sigil:component:booking.sigil:Booking",
    object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
    claims: ["witness-1"],
  };
  const observedEffort = attempt(
    "000001",
    "valid",
    [contradiction],
    manifest,
    undefined,
    [],
    {
      childCount: 3,
      childModels: ["gpt-served"],
      childEfforts: ["medium"],
      childEffortVerification: "observed",
    },
  );
  const unverified = attempt("000002", "valid", [], manifest, undefined, [
    {
      source: "rooms.sigil",
      component: "Rooms",
      section: "state",
      facets: ["F-rooms-mark"],
    },
    {
      source: "rooms.sigil",
      component: "Rooms",
      section: "state",
      facets: ["F-rooms-other"],
    },
  ]);
  const report = renderReport(manifest, [observedEffort, unverified]);
  matches(
    report,
    /\| # \| Agent \| Requested model \| Observed model \| Reasoning \| Pass \| Status \| Linked state \| Handed back \| Planted findings \| Additional findings \| Unread units \| Children \| Evidence \|/,
  );
  // State, hand-back, planted problem, extras and unread count in one row.
  matches(
    report,
    /\| 000001 \| claude \| sonnet \| claude-sonnet-observed \(observed\) \| medium \| 1 \| valid \| disjoint \| disjoint \| booking-pending-range-contradiction \| 0 \| 0 \| 3 × gpt-served \/ medium \(observed\) \|/,
  );
  matches(
    report,
    /\| 000002 \|.*\| valid \| incomplete \| incomplete \| [^|]*N\/A[^|]* \| 0 \| 2 \| 1 × claude-sonnet-observed \/ effort unverified \|/,
  );
  matches(report, /\[pass directory\]\(attempts\/000001\/pass\)/);
  matches(report, /\[prompt\]\(attempts\/000001\/evidence\/prompt\.txt\)/);
  matches(report, /Requested reasoning effort: medium/);
  // Nothing per source, no Facet coverage and no cross-run row variation.
  for (
    const gone of [
      "## Source readings",
      "Facet coverage",
      "## Variation across valid repeated runs",
      "Validity",
      "Sources read",
      "Own state",
    ]
  ) {
    assert(!report.includes(gone), `report still has "${gone}"`);
  }
  // The comparison totals the unread units of scored passes.
  matches(
    report,
    /Planted problem detection \| Additional finding frequencies \(identity passes\/scored\) \| Unread units \(scored passes\) \|/,
  );
  matches(report, /booking-pending-range-contradiction: 1\/2.* \| 2 \|\n/);
});

Deno.test("an interrupted or invalid pass keeps its unread count but its planted problems are not scored or counted as missed", () => {
  const contradiction = {
    class: "contradiction",
    law: "contradictory-claims",
    subject: "urn:sigil:component:booking.sigil:Booking",
    object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
    claims: ["witness-1"],
  };
  const unread = [{
    source: "rooms.sigil",
    component: "Rooms",
    section: "state",
    facets: ["F-rooms-mark"],
  }];
  const report = renderReport(manifest, [
    attempt(
      "000001",
      "interrupted",
      [contradiction],
      manifest,
      undefined,
      unread,
    ),
    attempt("000002", "invalid", [contradiction], manifest, undefined, unread, {
      error:
        "the agent handed back coherent but the benchmark's check is incomplete",
      failureStep: "handback",
    }),
    attempt("000003", "valid", [contradiction]),
  ]);
  matches(
    report,
    /\| 000001 \|.*\| interrupted \| — \| [a-z—]+ \| — \| — \| 1 \|/,
  );
  matches(
    report,
    /\| 000002 \|.*\| invalid \| — \| incomplete \| — \| — \| 1 \|/,
  );
  // Only the valid pass counts, so detection is 1/1, not 1/3.
  matches(report, /booking-pending-range-contradiction: 1\/1/);
  matches(report, /0 \/ 1 \/ 1 \/ 0/);
});

Deno.test("comparison reports the frequency of each distinct additional finding", () => {
  const firstExtra = {
    class: "flow",
    law: "unreached-step",
    subject: "witness-1",
    object: "urn:example:first-effect",
    claims: ["witness-1"],
  };
  const secondExtra = {
    ...firstExtra,
    subject: "witness-2",
    object: "urn:example:second-effect",
    claims: ["witness-2"],
  };
  const report = renderReport(manifest, [
    attempt("000001", "valid", [firstExtra]),
    attempt("000002", "valid", [secondExtra]),
  ]);

  matches(
    report,
    /Planted problem detection \| Additional finding frequencies/,
  );
  matches(
    report,
    /flow \/ unreached-step \/ Facet F-range-interface \/ urn:example:first-effect: 1\/2/,
  );
  matches(
    report,
    /flow \/ unreached-step \/ Facet F-range-constraint \/ urn:example:second-effect: 1\/2/,
  );
});

Deno.test("Calendar planted findings require the intended facet and evidence identity", () => {
  const calendarManifest = {
    ...manifest,
    schedule: [
      {
        id: "000004",
        agent: "claude",
        model: "sonnet",
        pass: 1,
      },
    ],
  } as unknown as BatchManifest;
  const unmet = SLOTTED_FIXTURE.issues.find((issue) =>
    issue.id === "calendar-display-name-unmet-obligation"
  )!;
  const flow = SLOTTED_FIXTURE.issues.find((issue) =>
    issue.id === "calendar-owner-digest-unreached-step"
  )!;
  const calendarContext = {
    units: [
      {
        facet: "F-display",
        asserted: [{ claim: "display-claim" }],
      },
      {
        facet: "F-digest",
        asserted: [{ claim: "digest-claim" }],
      },
      {
        facet: "F-unrelated",
        asserted: [{ claim: "unrelated-claim" }],
      },
    ],
  };
  const obligation = {
    class: unmet.findingClass,
    law: unmet.laws[0],
    subject: unmet.findingEvidence.subject,
    object: unmet.findingEvidence.object,
    claims: ["display-claim"],
  };
  const flowFinding = {
    class: flow.findingClass,
    law: flow.laws[0],
    subject: "digest-claim",
    object: flow.findingEvidence.object,
    claims: ["digest-claim"],
  };

  const positive = renderReport(calendarManifest, [
    attempt(
      "000004",
      "valid",
      [obligation, flowFinding],
      calendarManifest,
      calendarContext,
    ),
  ]);
  matches(positive, /calendar-display-name-unmet-obligation: 1\/1/);
  matches(positive, /calendar-owner-digest-unreached-step: 1\/1/);
  matches(positive, /No additional findings in scored passes\./);

  const invalidFindings: Array<{ label: string; finding: unknown }> = [
    {
      label: "unrelated Facet witness",
      finding: { ...obligation, claims: ["unrelated-claim"] },
    },
    {
      label: "unknown Facet witness",
      finding: { ...obligation, claims: ["unknown-claim"] },
    },
    {
      label: "wrong obligation subject",
      finding: { ...obligation, subject: "urn:example:wrong-subject" },
    },
    {
      label: "wrong obligation object",
      finding: { ...obligation, object: "urn:example:wrong-object" },
    },
    {
      label: "wrong flow object",
      finding: { ...flowFinding, object: "urn:example:wrong-object" },
    },
    {
      label: "flow subject absent from cited claims",
      finding: { ...flowFinding, subject: "other-claim" },
    },
  ];
  for (const { label, finding } of invalidFindings) {
    const report = renderReport(calendarManifest, [
      attempt("000004", "valid", [finding], calendarManifest, calendarContext),
    ]);
    matches(
      report,
      /calendar-display-name-unmet-obligation: 0\/1/,
      label,
    );
    matches(
      report,
      /calendar-owner-digest-unreached-step: 0\/1/,
      label,
    );
    matches(
      report,
      /\| valid \| disjoint \| disjoint \| — \| 1 \| 0 \|/u,
      label,
    );
    matches(report, /## Additional findings for review/);
    matches(report, /- Attempt 000004, finding 1:/, label);
  }
});

Deno.test("moved batch report points at the retained check files inside the moved batch", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-report-move-" });
  const originalDir = `${root}/original`;
  const movedDir = `${root}/moved`;
  const planned = manifest.schedule[0];
  const base = attempt("000001", "valid", [
    {
      class: "contradiction",
      law: "contradictory-claims",
      subject: "urn:sigil:component:booking.sigil:Booking",
      object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
      claims: ["witness-1"],
    },
  ]);
  const claimsDir = `${originalDir}/attempts/000001/pass/store/claims`;
  const batchManifest = { ...manifest, schedule: [planned] };
  const outcome = {
    ...base.outcome,
    linked: {
      ...base.outcome!.linked as Record<string, unknown>,
      result: {
        report: `${claimsDir}/workspace.linked.json`,
        judgmentContext: `${claimsDir}/workspace.linked.context.json`,
      },
    },
  };

  try {
    await Deno.mkdir(`${originalDir}/records`, { recursive: true });
    await Deno.mkdir(claimsDir, { recursive: true });
    await Deno.writeTextFile(
      `${originalDir}/manifest.json`,
      JSON.stringify(batchManifest),
    );
    await Deno.writeTextFile(
      `${originalDir}/records/000001.json`,
      JSON.stringify(base.record),
    );
    await Deno.writeTextFile(
      `${originalDir}/attempts/000001/outcome.json`,
      JSON.stringify(outcome),
    );
    for (
      const name of ["workspace.linked.json", "workspace.linked.context.json"]
    ) {
      await Deno.writeTextFile(`${claimsDir}/${name}`, "{}\n");
    }
    await Deno.rename(originalDir, movedDir);
    const victim = `${root}/outside.md`;
    await Deno.writeTextFile(victim, "keep this file intact\n");
    await Deno.symlink(victim, `${movedDir}/report.md`);

    const reportPath = await writeReport(movedDir);
    const report = await Deno.readTextFile(reportPath);
    assert(!(await Deno.lstat(reportPath)).isSymlink);
    assert(await Deno.readTextFile(victim) === "keep this file intact\n");
    assert(!(await exists(originalDir)), "old batch location still exists");
    matches(report, /\| 000001 \|.*\| valid \| disjoint \|/);
    matches(report, /booking-pending-range-contradiction: 1\/1/);
    matches(
      report,
      /\]\(attempts\/000001\/pass\/store\/claims\/workspace\.linked\.json\)/,
    );
    matches(
      report,
      /\]\(attempts\/000001\/pass\/store\/claims\/workspace\.linked\.context\.json\)/,
    );
    await Deno.remove(`${movedDir}/attempts/000001/outcome.json`);
    const evidenceMissing = await writeReport(movedDir);
    const missingReport = await Deno.readTextFile(evidenceMissing);
    matches(missingReport, /\| invalid \|/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

const ownership = {
  class: "ownership-conflict",
  law: "exclusive-ownership",
  subject: "urn:sigil:component:booking.sigil:Booking",
  object: "urn:sigil:component:rooms.sigil:Rooms",
  claims: ["mark-witness"],
};
const markContext = (facet: string) => ({
  units: [{ facet, asserted: [{ claim: "mark-witness" }] }],
});

Deno.test("analyze finds ownership between Booking and Rooms in either direction from the linked report and context", () => {
  // Booking's claim, found through the linked context.
  const forward = renderReport(manifest, [
    attempt(
      "000001",
      "valid",
      [ownership],
      manifest,
      markContext("F-booking-mark"),
    ),
  ]);
  matches(forward, /booking-rooms-archived-mark-ownership: 1\/1/);
  // Rooms' claim, a Facet this pass's Booking reader never saw, is found too.
  const reversed = renderReport(manifest, [
    attempt(
      "000001",
      "valid",
      [{ ...ownership, subject: ownership.object, object: ownership.subject }],
      manifest,
      markContext("F-rooms-mark"),
    ),
  ]);
  matches(reversed, /booking-rooms-archived-mark-ownership: 1\/1/);
  // A witness on an unrelated Facet is not the planted problem.
  const unrelated = renderReport(manifest, [
    attempt("000001", "valid", [ownership], manifest, markContext("F-other")),
  ]);
  matches(unrelated, /booking-rooms-archived-mark-ownership: 0\/1/);
});

Deno.test("a problem anchored in an unread source is unavailable while the others still score", () => {
  const contradiction = {
    class: "contradiction",
    law: "contradictory-claims",
    subject: "urn:sigil:component:booking.sigil:Booking",
    object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
    claims: ["witness-1"],
  };
  const report = renderReport(manifest, [
    attempt(
      "000001",
      "valid",
      [contradiction, ownership],
      manifest,
      {
        units: [
          { facet: "F-range-interface", asserted: [{ claim: "witness-1" }] },
          { facet: "F-booking-mark", asserted: [{ claim: "mark-witness" }] },
        ],
      },
      [{
        source: "rooms.sigil",
        component: "Rooms",
        section: "state",
        facets: ["F-rooms-mark"],
      }],
    ),
  ]);
  matches(report, /booking-pending-range-contradiction: 1\/1/);
  matches(
    report,
    /booking-rooms-archived-mark-ownership: 0\/0 \(1 unavailable\)/,
  );
  matches(report, /booking-rooms-archived-mark-ownership: N\/A/);
  matches(report, /\| incomplete \|/);
  // The ownership finding is not credited, so it needs review as extra.
  matches(report, /ownership-conflict \/ exclusive-ownership/);
});

Deno.test("observed, unverified, and mixed model identities remain separate groups", () => {
  const base = attempt("000001", "valid", []);
  const unverified = attempt("000002", "valid", []);
  const mixed = attempt("000003", "valid", []);
  const report = renderReport(manifest, [
    base,
    {
      ...unverified,
      record: {
        ...unverified.record,
        observedModels: [],
        modelVerification: "unverified",
      },
    },
    {
      ...mixed,
      record: {
        ...mixed.record,
        observedModels: ["model-a", "model-b"],
        modelVerification: "mixed",
      },
    },
  ]);
  matches(report, /claude-sonnet-observed \(observed\)/);
  matches(report, /model-a, model-b \(mixed\)/);
  matches(report, /\| unverified \| medium \| 1 \| 1 \|/);
});

Deno.test("passes at different reasoning efforts are separate groups", () => {
  const low = attempt("000001", "valid", [], manifest, undefined, [], {
    requestedEffort: "low",
  });
  const medium = attempt("000002", "valid", []);
  const report = renderReport(manifest, [low, medium]);
  matches(report, /claude-sonnet-observed \(observed\) \| low \| 1 \| 1 \|/);
  matches(
    report,
    /claude-sonnet-observed \(observed\) \| medium \| 1 \| 1 \|/,
  );
});

Deno.test("interrupted attempts are counted separately from failures", () => {
  const report = renderReport(manifest, [
    attempt("000001", "interrupted", []),
    attempt("000002", "valid", []),
    attempt("000003", "valid", []),
  ]);
  matches(
    report,
    /\| claude \| sonnet \| claude-sonnet-observed \(observed\) \| medium \| 3 \| 2 \| 0 \/ 0 \/ 1 \/ 0 \|/,
  );
  matches(report, /\| 000001 \| claude \| sonnet \|.*\| interrupted \|/);
});

Deno.test("drift withholds one issue metric while states remain visible", () => {
  const drifted = {
    ...manifest,
    preflight: {
      ...manifest.preflight,
      issues: manifest.preflight.issues.map((issue) =>
        issue.id === "booking-rooms-archived-mark-ownership"
          ? {
            ...issue,
            status: "drift" as const,
            reason: "Booking anchor missing",
            facets: [],
          }
          : issue
      ),
    },
  };
  const report = renderReport(drifted, [attempt("000001", "valid", [])]);
  matches(report, /booking-rooms-archived-mark-ownership: N\/A/);
  matches(report, /disjoint/);
});
