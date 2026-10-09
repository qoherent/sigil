/** The parts of `sigilc tree` output the preflight reads. */
export interface TreeOutput {
  readonly trees: readonly {
    readonly parse: {
      readonly path: string;
      readonly valid: boolean;
      readonly components: readonly {
        readonly iri: string;
        readonly name: string;
        readonly sections: readonly unknown[];
      }[];
    };
    readonly resolution: {
      readonly components: readonly {
        readonly iri: string;
        readonly tags: readonly {
          readonly name: string;
          readonly status: string;
          readonly iri?: string;
        }[];
      }[];
      readonly imports: readonly {
        readonly provider: string;
        readonly status: string;
      }[];
    };
  }[];
}

/** A Design world flattened from trees: sources, entities, Facets, and imports. */
export interface DesignView {
  readonly sources: readonly { readonly path: string; readonly text: string }[];
  readonly entities: readonly {
    readonly id: string;
    readonly type: "Component" | "Tag";
    readonly valid: boolean;
    readonly source: string;
  }[];
  readonly units: readonly {
    readonly id: string;
    readonly source: string;
    readonly section: string;
    readonly owner: string;
    readonly valid: boolean;
    readonly proseRange: { readonly start: number; readonly end: number };
  }[];
  readonly imports: readonly {
    readonly source: string;
    readonly provider: string;
    readonly status: string;
  }[];
}

/** Flatten `sigilc tree` output and the sources it was read from. */
export function designViewFromTrees(
  output: TreeOutput,
  texts: Readonly<Record<string, string>>,
): DesignView {
  const sources: { path: string; text: string }[] = [];
  const entities: DesignView["entities"][number][] = [];
  const units: DesignView["units"][number][] = [];
  const imports: DesignView["imports"][number][] = [];
  for (const tree of output.trees) {
    const source = tree.parse.path;
    const valid = tree.parse.valid;
    sources.push({ path: source, text: texts[source] ?? "" });
    for (const entry of tree.resolution.imports) {
      imports.push({ source, provider: entry.provider, status: entry.status });
    }
    for (const component of tree.parse.components) {
      entities.push({ id: component.iri, type: "Component", valid, source });
      for (const facet of facetsOf(component.sections)) {
        units.push({
          id: facet.id,
          source,
          section: facet.section,
          owner: component.iri,
          valid,
          proseRange: { start: facet.proseRange[0], end: facet.proseRange[1] },
        });
      }
    }
    for (const component of tree.resolution.components) {
      for (const tag of component.tags) {
        if (tag.iri) {
          entities.push({
            id: tag.iri,
            type: "Tag",
            valid: valid && tag.status === "resolved",
            source,
          });
        }
      }
    }
  }
  return { sources, entities, units, imports };
}

function facetsOf(value: unknown): {
  id: string;
  section: string;
  proseRange: [number, number];
}[] {
  if (Array.isArray(value)) return value.flatMap(facetsOf);
  if (value === null || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  if (node.kind === "facet") {
    return [node as unknown as ReturnType<typeof facetsOf>[number]];
  }
  return Object.values(node).flatMap(facetsOf);
}

export interface FixtureSource {
  readonly path: string;
  readonly role: string;
  readonly imports: readonly string[];
  readonly target: {
    readonly state: "Coherent" | "Loose" | "Disjoint";
    readonly exitCode: 0 | 1;
  };
}

export interface EvidenceAnchor {
  readonly source: string;
  readonly section: string;
  readonly text: string;
}

export interface FixtureIssue {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly findingClass:
    | "contradiction"
    | "ownership-conflict"
    | "unmet-obligation"
    | "flow";
  readonly laws: readonly string[];
  readonly findingEvidence: {
    /** Exact native subject URI, or the ID of a cited claim for flow findings. */
    readonly subject: string | "cited-claim";
    readonly object: string;
    readonly eitherDirection?: true;
  };
  readonly remedy: string;
  readonly anchors: readonly EvidenceAnchor[];
  readonly requiresAbsentIdentityDisplayNameProvider?: true;
}

export interface IssuePreflight extends FixtureIssue {
  readonly status: "scorable" | "drift";
  readonly reason: string | null;
  /** Facet IDs resolved from this tree view, in the same order as anchors. */
  readonly facets: readonly string[];
}

export interface FixturePreflight {
  readonly canSchedule: boolean;
  readonly sourceDrift: readonly string[];
  readonly issues: readonly IssuePreflight[];
}

/** The benchmark's versioned Slotted answer key. Never passed to an interpretation child. */
export const SLOTTED_FIXTURE: {
  readonly version: 1;
  readonly description: string;
  readonly sources: readonly FixtureSource[];
  readonly issues: readonly FixtureIssue[];
} = {
  version: 1,
  description:
    "Slotted is a room-booking design: people own rooms and rent other people's rooms, with owner approval of requests. SharedKernel is a kernel rather than a module.",
  sources: [
    {
      path: "slotted.sigil",
      role: "The app: module list, dependency rules, technology stack",
      imports: ["Identity", "Rooms", "Availability", "Booking", "SharedKernel"],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "identity.sigil",
      role: "User accounts, sessions, the signed-in user, requireUser",
      imports: [],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "rooms.sigil",
      role: "Rooms, room owners, room timezone, archiving, the room lock",
      imports: ["Identity"],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "shared.sigil",
      role: "The kernel: clock, 30-minute grid, time conversion, domain errors",
      imports: [],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "availability.sigil",
      role: "Weekly windows, blackouts, open time",
      imports: ["Identity", "Rooms", "SharedKernel"],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "booking.sigil",
      role:
        "Booking requests, their lifecycle, the no-overlap rule, owner workflows",
      imports: ["Identity", "Rooms", "Availability", "SharedKernel"],
      target: { state: "Disjoint", exitCode: 1 },
    },
    {
      path: "calendar.sigil",
      role: "The room calendar, with masking by viewer",
      imports: ["Rooms", "Availability", "Booking", "SharedKernel"],
      target: { state: "Loose", exitCode: 0 },
    },
  ],
  issues: [
    {
      id: "booking-pending-range-contradiction",
      title: "Pending request range change contradiction",
      explanation:
        "Booking's interface offers a renter a range change for their pending request, while its constraint forbids that range change.",
      findingClass: "contradiction",
      laws: ["contradictory-claims", "negated-claim-holds"],
      findingEvidence: {
        subject: "urn:sigil:component:booking.sigil:Booking",
        object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
      },
      remedy:
        "Decide whether a pending range may change, then make the interface and constraint agree.",
      anchors: [
        {
          source: "booking.sigil",
          section: "interface",
          text:
            "Booking provides a renter a *range change* of their own pending request",
        },
        {
          source: "booking.sigil",
          section: "constraints",
          text: "Booking must not provide a range change of a pending request",
        },
      ],
    },
    {
      id: "booking-rooms-archived-mark-ownership",
      title: "Archived room mark ownership conflict",
      explanation:
        "Booking claims exclusive control of the archived room mark, while Rooms also claims ownership of that mark.",
      findingClass: "ownership-conflict",
      laws: ["exclusive-ownership"],
      findingEvidence: {
        subject: "urn:sigil:component:booking.sigil:Booking",
        object: "urn:sigil:component:rooms.sigil:Rooms",
        eitherDirection: true,
      },
      remedy:
        "Keep the mark in Rooms. Reword Booking so its workflows call Rooms' archive and unarchive mutations.",
      anchors: [
        {
          source: "booking.sigil",
          section: "constraints",
          text:
            "Booking owns the archived room mark, and Booking is the only one that may set",
        },
        {
          source: "rooms.sigil",
          section: "state",
          text: "Rooms owns the archived room\n    mark",
        },
      ],
    },
    {
      id: "calendar-display-name-unmet-obligation",
      title: "Renter display name without a provider",
      explanation:
        "Calendar requires each renter's display name from Identity, which supplies no display-name provider.",
      findingClass: "unmet-obligation",
      laws: ["unmet-obligation"],
      findingEvidence: {
        subject: "urn:sigil:component:calendar.sigil:Calendar",
        object:
          "urn:sigil:component:calendar.sigil:Calendar:tag:renter%20display%20name",
      },
      remedy:
        "Give Identity a display name and interface, return the label from Booking, or use the email.",
      anchors: [
        {
          source: "calendar.sigil",
          section: "constraints",
          text:
            "Calendar requires the *renter display name* of each renter from Identity",
        },
      ],
      requiresAbsentIdentityDisplayNameProvider: true,
    },
    {
      id: "calendar-owner-digest-unreached-step",
      title: "Owner digest comparison without an effect",
      explanation:
        "Calendar compares the owner digest with the previous digest, but the step writes and returns nothing.",
      findingClass: "flow",
      laws: ["unreached-step"],
      findingEvidence: {
        subject: "cited-claim",
        object: "urn:sigil:component:calendar.sigil:Calendar",
      },
      remedy: "Delete the step or say what consumes its result.",
      anchors: [
        {
          source: "calendar.sigil",
          section: "logic",
          text:
            "Step two compares the\n    owner digest of the room with the digest kept from the previous refresh",
        },
      ],
    },
  ],
};

function proseOf(
  design: DesignView,
  source: string,
  start: number,
  end: number,
): string | null {
  const text = design.sources.find((entry) => entry.path === source)?.text;
  if (text === undefined) return null;
  return new TextDecoder().decode(
    new TextEncoder().encode(text).slice(start, end),
  );
}

/**
 * Resolve the fixture against one `sigilc tree` view of the workspace.
 *
 * Every anchor Facet is looked up in the workspace trees. No source's
 * black-box request is consulted: the linked check reads every source's
 * stored readings, so an anchor in a private section is scorable.
 */
export function preflightSlottedFixture(design: DesignView): FixturePreflight {
  const expected = new Set(
    SLOTTED_FIXTURE.sources.map((source) => source.path),
  );
  const actual = new Set(design.sources.map((source) => source.path));
  const sourceDrift: string[] = [];
  for (const path of expected) {
    if (!actual.has(path)) sourceDrift.push(`missing required source: ${path}`);
  }
  for (const path of actual) {
    if (!expected.has(path)) sourceDrift.push(`unexpected source: ${path}`);
  }
  const canSchedule = sourceDrift.length === 0;
  for (const source of SLOTTED_FIXTURE.sources) {
    if (!actual.has(source.path)) continue;
    const imports = design.imports.filter((entry) =>
      entry.source === source.path && entry.status === "resolved"
    ).map((entry) => entry.provider).sort();
    const wanted = [...source.imports].sort();
    if (JSON.stringify(imports) !== JSON.stringify(wanted)) {
      sourceDrift.push(
        `imports changed for ${source.path}: expected ${
          wanted.join(", ") || "none"
        }; found ${imports.join(", ") || "none"}`,
      );
    }
  }

  const issues = SLOTTED_FIXTURE.issues.map((issue): IssuePreflight => {
    const facets: string[] = [];
    let reason: string | null = null;

    const fixedReferences = [
      issue.findingEvidence.subject === "cited-claim"
        ? null
        : issue.findingEvidence.subject,
      issue.findingEvidence.object,
    ].filter((id): id is string => id !== null);
    const fixedComponents: string[] = [];
    for (const id of fixedReferences) {
      const expectedType = id.includes(":tag:") ? "Tag" : "Component";
      const entity = design.entities.find((candidate) => candidate.id === id);
      if (!entity || !entity.valid || entity.type !== expectedType) {
        reason =
          `fixed ${expectedType} entity ${id} is missing, invalid, or has the wrong type`;
        break;
      }
      if (expectedType === "Component") fixedComponents.push(id);
    }

    for (const anchor of issue.anchors) {
      if (reason) break;
      const matches = design.units.filter((unit) =>
        unit.valid && unit.source === anchor.source &&
        unit.section === anchor.section &&
        proseOf(design, unit.source, unit.proseRange.start, unit.proseRange.end)
          ?.includes(anchor.text)
      );
      if (matches.length !== 1) {
        reason = matches.length === 0
          ? `missing ${anchor.source} ${anchor.section} anchor: ${anchor.text}`
          : `ambiguous ${anchor.source} ${anchor.section} anchor: ${anchor.text} (${matches.length} Facets)`;
        break;
      }
      const unit = matches[0];
      const expectedOwner = fixedComponents.find((id) =>
        design.entities.find((entity) => entity.id === id)?.source ===
          anchor.source
      );
      if (!expectedOwner || unit.owner !== expectedOwner) {
        reason = `anchor Facet owner drift for ${anchor.source}: expected ${
          expectedOwner ?? "no fixed component"
        }, found ${unit.owner}`;
        break;
      }
      facets.push(unit.id);
    }
    if (!reason && issue.requiresAbsentIdentityDisplayNameProvider) {
      const provider = design.units.some((unit) => {
        if (!unit.valid || unit.source !== "identity.sigil") return false;
        const prose = proseOf(
          design,
          unit.source,
          unit.proseRange.start,
          unit.proseRange.end,
        );
        return prose !== null && hasDisplayNameProvider(prose);
      });
      if (provider) reason = "Identity now describes a display-name provider";
    }
    return {
      ...issue,
      status: reason ? "drift" : "scorable",
      reason,
      facets: reason ? [] : facets,
    };
  });
  return { canSchedule, sourceDrift, issues };
}

function hasDisplayNameProvider(prose: string): boolean {
  const positiveProvider =
    /\b(?:provides?|supplies?|exposes?|returns?|offers?|keeps?|stores?|contains?|has|have)\b([^.!?]{0,100})\bdisplay[- ]name\b/gi;
  const clauses = prose
    .split(/[.!?]\s*|\b(?:but|however|although)\b/i)
    .map((clause) => clause.trim());
  for (const clause of clauses) {
    positiveProvider.lastIndex = 0;
    for (const match of clause.matchAll(positiveProvider)) {
      const verbStart = match.index!;
      const prefix = clause.slice(Math.max(0, verbStart - 48), verbStart);
      const between = match[1] ?? "";
      if (/\bnot\b(?!\s+only)|\b(?:never|cannot|can't|won't)\b/i.test(prefix)) {
        continue;
      }
      if (/\b(?:no|not|without|never|cannot|can't|won't)\b/i.test(between)) {
        continue;
      }
      return true;
    }
  }
  return false;
}
