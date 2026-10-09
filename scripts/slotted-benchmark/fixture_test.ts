import {
  deepStrictEqual as assertEquals,
  match as assertMatch,
  ok as assert,
} from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  type DesignView,
  designViewFromTrees,
  preflightSlottedFixture,
  SLOTTED_FIXTURE,
  type TreeOutput,
} from "./fixture.ts";

const sourcePaths = [
  "slotted.sigil",
  "identity.sigil",
  "rooms.sigil",
  "shared.sigil",
  "availability.sigil",
  "booking.sigil",
  "calendar.sigil",
];
const exe = Deno.build.os === "windows" ? ".exe" : "";
const sigilc = fileURLToPath(
  new URL(`../../packages/sigilc/target/debug/sigilc${exe}`, import.meta.url),
);
const claims = fileURLToPath(
  new URL(
    `../../packages/sigilc/target/debug/sigil-claims${exe}`,
    import.meta.url,
  ),
);

async function run(
  executable: string,
  args: string[],
  code = 0,
): Promise<string> {
  const output = await new Deno.Command(executable, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  assertEquals(
    output.code,
    code,
    `${args.join(" ")}: ${new TextDecoder().decode(output.stderr)}`,
  );
  return stdout;
}

/** A temporary Slotted workspace, optionally edited before use. */
async function slottedWorkspace(
  change?: (files: Record<string, string>) => void,
): Promise<{ root: string; files: Record<string, string> }> {
  const root = await Deno.makeTempDir({ prefix: "slotted-fixture-" });
  const files: Record<string, string> = {};
  for (const path of sourcePaths) {
    files[path] = await Deno.readTextFile(
      new URL(`../../examples/slotted/${path}`, import.meta.url),
    );
  }
  change?.(files);
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.9.0",
      workspace: { name: "slotted" },
      files: { include: ["**/*.sigil"] },
    }),
  );
  for (const [path, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${root}/${path}`, text);
  }
  return { root, files };
}

/** What `sigil-claims prepare` really shows the model for one source. */
interface PreparedRequest {
  readonly binding: { readonly source: string };
  readonly rows: readonly {
    readonly facet: string;
    readonly source: string;
    readonly section: string;
    readonly context?: boolean;
  }[];
}

/**
 * The workspace trees plus the black-box request of every source, taken from
 * the real `sigil-claims prepare`. Dependencies' private sections are not in
 * these requests, which is the behaviour the linked check exists to cover.
 */
async function snapshot(
  change?: (files: Record<string, string>) => void,
): Promise<{ design: DesignView; requests: PreparedRequest[] }> {
  const { root, files } = await slottedWorkspace(change);
  try {
    const tree = JSON.parse(
      await run(sigilc, [
        "tree",
        "--root",
        root,
        "--store",
        `${root}/store`,
      ]),
    ) as TreeOutput;
    const design = designViewFromTrees(tree, files);
    const requests: PreparedRequest[] = [];
    for (const source of SLOTTED_FIXTURE.sources) {
      if (!files[source.path]) continue;
      const out = `${root}/prepared-${source.path}`;
      await run(claims, [
        "prepare",
        "--root",
        root,
        "--store",
        `${root}/prepare-store-${source.path}`,
        "--source",
        source.path,
        "--out",
        out,
      ]);
      requests.push(
        JSON.parse(await Deno.readTextFile(`${out}/request.json`)),
      );
    }
    return { design, requests };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("tool fixture resolves all seven Slotted sources and four issue IDs", async () => {
  const { design } = await snapshot();
  const result = preflightSlottedFixture(design);
  assertEquals(SLOTTED_FIXTURE.version, 1);
  assertEquals(SLOTTED_FIXTURE.sources.map((s) => s.path), sourcePaths);
  assertEquals(result.canSchedule, true);
  assertEquals(result.sourceDrift, []);
  assertEquals(result.issues.length, 4);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "scorable",
    "scorable",
    "scorable",
  ]);
  assertEquals(new Set(result.issues.map((issue) => issue.id)).size, 4);
  assertEquals(result.issues.map((issue) => issue.findingEvidence), [
    {
      subject: "urn:sigil:component:booking.sigil:Booking",
      object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
    },
    {
      subject: "urn:sigil:component:booking.sigil:Booking",
      object: "urn:sigil:component:rooms.sigil:Rooms",
      eitherDirection: true,
    },
    {
      subject: "urn:sigil:component:calendar.sigil:Calendar",
      object:
        "urn:sigil:component:calendar.sigil:Calendar:tag:renter%20display%20name",
    },
    {
      subject: "cited-claim",
      object: "urn:sigil:component:calendar.sigil:Calendar",
    },
  ]);
  for (const issue of result.issues) {
    assertEquals(issue.facets.length, issue.anchors.length);
    assert(issue.facets.every((facet) => facet.startsWith("facet:")));
  }
  const ownership = result.issues.find((issue) =>
    issue.id === "booking-rooms-archived-mark-ownership"
  );
  assertEquals(ownership?.facets.length, 2);
  assertEquals(
    new Set(ownership?.anchors.map((anchor) => anchor.source)),
    new Set(["booking.sigil", "rooms.sigil"]),
  );
});

Deno.test("removed Booking exclusivity evidence withholds only ownership", async () => {
  const { design } = await snapshot((files) => {
    files["booking.sigil"] = files["booking.sigil"].replace(
      "Booking owns the archived room mark, and Booking is the only one that may set\n    or clear it, because only its archive workflow and unarchive workflow change\n    it.",
      "Booking calls Rooms to archive and unarchive a room.",
    );
  });
  const result = preflightSlottedFixture(design);
  assertEquals(result.canSchedule, true);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "drift",
    "scorable",
    "scorable",
  ]);
  assertMatch(result.issues[1].reason ?? "", /booking\.sigil.*anchor/i);
});

Deno.test("anchor ownership drift withholds only the affected issue", async () => {
  const { design } = await snapshot();
  const ownershipAnchor = SLOTTED_FIXTURE.issues[1].anchors[0];
  const original = design.units.find((unit) =>
    unit.source === ownershipAnchor.source &&
    unit.section === ownershipAnchor.section &&
    new TextDecoder().decode(
      new TextEncoder().encode(
        design.sources.find((source) => source.path === unit.source)!.text,
      ).slice(unit.proseRange.start, unit.proseRange.end),
    ).includes(ownershipAnchor.text)
  );
  assert(original, "ownership anchor Facet must exist");
  const anotherValidOwner = design.entities.find((entity) =>
    entity.type === "Component" && entity.source === "calendar.sigil" &&
    entity.valid
  );
  assert(anotherValidOwner, "another valid component must exist");
  const changed = {
    ...design,
    units: design.units.map((unit) =>
      unit.id === original.id ? { ...unit, owner: anotherValidOwner.id } : unit
    ),
  };

  const result = preflightSlottedFixture(changed);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "drift",
    "scorable",
    "scorable",
  ]);
  assertMatch(result.issues[1].reason ?? "", /owner.*booking\.sigil/i);
});

Deno.test("fixed entity identity drift withholds only its issue", async () => {
  const { design } = await snapshot();
  const rangeChangeTag = design.entities.find((entity) =>
    entity.id === SLOTTED_FIXTURE.issues[0].findingEvidence.object
  );
  assert(rangeChangeTag, "fixed Range Change Tag must exist");
  const cases = [
    {
      label: "missing",
      entities: design.entities.filter((entity) =>
        entity.id !== rangeChangeTag.id
      ),
    },
    {
      label: "invalid",
      entities: design.entities.map((entity) =>
        entity.id === rangeChangeTag.id ? { ...entity, valid: false } : entity
      ),
    },
    {
      label: "wrong type",
      entities: design.entities.map((entity) =>
        entity.id === rangeChangeTag.id
          ? { ...entity, type: "Component" as const }
          : entity
      ),
    },
  ];
  for (const testCase of cases) {
    const result = preflightSlottedFixture(
      { ...design, entities: testCase.entities },
    );
    assertEquals(
      result.issues.map((issue) => issue.status),
      ["drift", "scorable", "scorable", "scorable"],
      `${testCase.label} fixed entity must withhold only contradiction`,
    );
    assertMatch(result.issues[0].reason ?? "", /fixed Tag entity/i);
  }
});

Deno.test("ownership is scorable although Booking's black-box request omits Rooms' private anchor", async () => {
  const { design, requests } = await snapshot();
  const result = preflightSlottedFixture(design);
  assertEquals(result.issues.map((entry) => entry.status), [
    "scorable",
    "scorable",
    "scorable",
    "scorable",
  ]);
  const issue = result.issues[1];
  assertEquals(issue.id, "booking-rooms-archived-mark-ownership");
  const roomsFacet = issue.facets[
    issue.anchors.findIndex((anchor) => anchor.source === "rooms.sigil")
  ];
  const bookingFacet = issue.facets[
    issue.anchors.findIndex((anchor) => anchor.source === "booking.sigil")
  ];
  const booking = requests.find((request) =>
    request.binding.source === "booking.sigil"
  );
  const rooms = requests.find((request) =>
    request.binding.source === "rooms.sigil"
  );
  assert(booking && rooms, "source requests must exist");
  // Booking sees Rooms' interface only, never its `state` section.
  assert(!booking.rows.some((row) => row.facet === roomsFacet));
  assert(
    booking.rows.some((row) => row.facet === bookingFacet && !row.context),
  );
  assert(rooms.rows.some((row) => row.facet === roomsFacet && !row.context));
  // Every anchor Facet exists in the workspace trees.
  for (const facet of issue.facets) {
    assert(design.units.some((unit) => unit.id === facet && unit.valid));
  }
});

Deno.test("Identity display-name provider withholds only Calendar obligation", async () => {
  const { design } = await snapshot((files) => {
    files["identity.sigil"] = files["identity.sigil"].replace(
      "    Identity provides resolution of the session from request headers outside",
      "    Identity keeps a display name for each user.\n\n    Identity provides resolution of the session from request headers outside",
    );
  });
  const result = preflightSlottedFixture(design);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "scorable",
    "drift",
    "scorable",
  ]);
  assertMatch(
    result.issues[2].reason ?? "",
    /Identity.*display.name provider/i,
  );
});

Deno.test("explicit Identity absence does not count as a display-name provider", async () => {
  const { design } = await snapshot((files) => {
    files["identity.sigil"] = files["identity.sigil"].replace(
      "    Identity provides resolution of the session from request headers outside",
      "    Identity does not provide a display name for each user.\n\n    Identity will not provide a display name for each user.\n\n    Identity won't provide a display name for each user.\n\n    Identity provides resolution of the session from request headers outside",
    );
  });
  const result = preflightSlottedFixture(design);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "scorable",
    "scorable",
    "scorable",
  ]);
});

Deno.test("an anchor in two Facets is ambiguous", async () => {
  const { design } = await snapshot((files) => {
    const phrase =
      "Booking must not provide a range change of a pending request";
    files["booking.sigil"] = files["booking.sigil"].replace(
      "    Booking must not accept a booking request from the room owner of its room.",
      `    ${phrase}.\n\n    Booking must not accept a booking request from the room owner of its room.`,
    );
  });
  const result = preflightSlottedFixture(design);
  assertEquals(result.issues[0].status, "drift");
  assertMatch(result.issues[0].reason ?? "", /ambiguous.*booking\.sigil/i);
  assertEquals(result.issues.slice(1).map((issue) => issue.status), [
    "scorable",
    "scorable",
    "scorable",
  ]);
});

Deno.test("a missing required source refuses the seven-source batch", async () => {
  const { design } = await snapshot((files) => {
    delete files["rooms.sigil"];
  });
  const result = preflightSlottedFixture(design);
  assertEquals(result.canSchedule, false);
  assertMatch(result.sourceDrift.join(" "), /missing.*rooms\.sigil/i);
});

Deno.test("import drift is reported while all seven sources can still run", async () => {
  const { design } = await snapshot();
  const changed = {
    ...design,
    imports: design.imports.filter((entry) =>
      !(entry.source === "calendar.sigil" && entry.provider === "Booking")
    ),
  };
  const result = preflightSlottedFixture(changed);
  assertEquals(result.canSchedule, true);
  assertMatch(
    result.sourceDrift.join(" "),
    /imports changed for calendar\.sigil/i,
  );
});

Deno.test("a reformat between two prepares with a shared store requests no units", async () => {
  const { root, files } = await slottedWorkspace();
  const store = `${root}/store`;
  const prepare = async (label: string) => {
    const out = `${root}/prepared-${label}`;
    const summary = JSON.parse(
      await run(claims, [
        "prepare",
        "--root",
        root,
        "--store",
        store,
        "--source",
        "booking.sigil",
        "--out",
        out,
      ]),
    );
    return { out, summary };
  };
  try {
    const first = await prepare("first");
    assert(first.summary.requestedUnits > 0);
    assertMatch(first.summary.workspaceDigest, /^[a-f0-9]{64}$/);
    const request = JSON.parse(
      await Deno.readTextFile(`${first.out}/request.json`),
    );
    const readings = request.rows.filter((row: { context?: boolean }) =>
      !row.context
    ).map((row: { facet: string }) =>
      `(reading ${JSON.stringify(row.facet)} "no-commitment")\n`
    ).join("");
    await Deno.writeTextFile(`${root}/readings.egg`, readings);
    await run(claims, [
      "ingest",
      "--root",
      root,
      "--store",
      store,
      "--binding",
      `${first.out}/binding.json`,
      "--claims",
      `${root}/readings.egg`,
    ], 0);
    for (const [path, text] of Object.entries(files)) {
      await Deno.writeTextFile(`${root}/${path}`, `\n\n${text}\n`);
    }
    const second = await prepare("second");
    assertEquals(second.summary.requestedUnits, 0);
    assert(second.summary.reusedUnits > 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
