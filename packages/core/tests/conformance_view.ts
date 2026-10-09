import {
  type DesignInput,
  type DesignInputResult,
  relativePath,
  type SigilDiagnostic,
} from "../src/mod.ts";

type Range = { start: number; end: number };

/**
 * The normalized structural view the shared conformance corpus compares.
 * It leaves out identifiers (the parsers mint different ones) and diagnostic
 * messages (implementation-defined wording), and keeps everything else the
 * structural transport carries: ranges are UTF-8 byte offsets.
 */
export interface ConformanceView {
  readonly exported: boolean;
  readonly sources: readonly string[];
  readonly components: readonly unknown[];
  readonly tags: readonly unknown[];
  readonly groups: readonly unknown[];
  readonly facets: readonly unknown[];
  readonly imports: readonly unknown[];
  readonly diagnostics: readonly unknown[];
}

const span = (r: Range) => [r.start, r.end];

function key(source: string, range: Range, extra = ""): string {
  return `${source}\u0000${
    String(range.start).padStart(10, "0")
  }\u0000${extra}`;
}

function sorted<T>(items: readonly T[], by: (item: T) => string): T[] {
  return [...items].sort((a, b) => by(a).localeCompare(by(b)));
}

export function structuralView(result: DesignInputResult): ConformanceView {
  const bundle = result.bundle;
  const diagnostics = viewDiagnostics(result);
  if (!bundle) {
    return {
      exported: false,
      sources: [],
      components: [],
      tags: [],
      groups: [],
      facets: [],
      imports: [],
      diagnostics,
    };
  }
  return {
    exported: true,
    sources: bundle.sources.map((s) => s.path).sort(),
    ...projectBundle(bundle),
    diagnostics,
  };
}

function viewDiagnostics(result: DesignInputResult) {
  const bundle = result.bundle;
  const list: readonly SigilDiagnostic[] = bundle
    ? bundle.diagnostics
    : result.diagnostics;
  const path = (p: string | undefined) =>
    p === undefined ? null : (bundle ? p : relativePath(result.root, p));
  return sorted(
    list.map((d) => ({
      code: d.code,
      stage: d.stage,
      severity: d.severity,
      file: path(d.filePath),
      range: d.range ? span(d.range) : null,
      related: d.related.map((r) => ({
        file: path(r.filePath),
        range: r.range ? span(r.range) : null,
      })),
    })),
    (d) => `${d.file}\u0000${d.range?.[0] ?? -1}\u0000${d.code}`,
  );
}

function projectBundle(bundle: DesignInput) {
  const label = new Map<string, string>();
  for (const e of bundle.entities) {
    if (e.type === "Component") label.set(e.id, e.label);
  }
  for (const e of bundle.entities) {
    if (e.type === "Tag") {
      label.set(e.id, `${label.get(e.owner ?? "") ?? "?"}::${e.label}`);
    }
  }
  const owner = (
    id: string | null,
  ) => (id === null ? null : label.get(id) ?? id);
  const groupById = new Map(bundle.groups.map((g) => [g.id, g]));
  const introById = new Map(bundle.introductions.map((i) => [i.id, i]));
  const refById = new Map(bundle.references.map((r) => [r.id, r]));
  const linkById = new Map(bundle.links.map((l) => [l.id, l]));
  return {
    components: sorted(
      bundle.entities.filter((e) => e.type === "Component").map((e) => ({
        source: e.source,
        name: e.label,
        range: span(e.range),
        nameRange: span(e.nameRange),
        identityResolved: e.identityResolved,
        valid: e.valid,
        complete: e.complete,
      })),
      (e) => key(e.source, { start: e.range[0], end: e.range[1] }),
    ),
    tags: sorted(
      bundle.entities.filter((e) => e.type === "Tag").map((e) => ({
        source: e.source,
        component: owner(e.owner),
        name: e.label,
        identityResolved: e.identityResolved,
      })),
      (e) => `${e.source}\u0000${e.component}\u0000${e.name}`,
    ),
    groups: sorted(
      bundle.groups.map((g) => ({
        source: g.source,
        component: owner(g.owner),
        name: g.name,
        tag: owner(g.tag),
        section: g.section,
        range: span(g.range),
        headerRange: span(g.headerRange),
        bodyRange: span(g.bodyRange),
        valid: g.valid,
        complete: g.complete,
      })),
      (g) => key(g.source, { start: g.range[0], end: g.range[1] }),
    ),
    facets: sorted(
      bundle.units.map((u) => ({
        source: u.source,
        component: owner(u.owner),
        section: u.section,
        group: u.grouping ? groupById.get(u.grouping)?.name ?? null : null,
        range: span(u.range),
        proseRange: span(u.proseRange),
        introductions: u.introductions.map((id) => {
          const i = introById.get(id)!;
          return {
            name: i.name,
            kind: i.kind,
            tag: owner(i.tag),
            range: span(i.range),
            nameRange: span(i.nameRange),
          };
        }),
        references: u.references.map((id) => {
          const r = refById.get(id)!;
          return {
            name: r.name,
            status: r.status,
            tag: owner(r.tag),
            range: span(r.range),
          };
        }),
        links: u.links.map((id) => {
          const l = linkById.get(id)!;
          return {
            destination: l.destination,
            image: l.image,
            range: span(l.range),
          };
        }),
        payload: u.payload
          ? {
            type: u.payload.type ?? null,
            range: span(u.payload.range),
            bodyRange: span(u.payload.bodyRange),
            openingRange: span(u.payload.openingRange),
            closingRange: u.payload.closingRange
              ? span(u.payload.closingRange)
              : null,
            fenceLength: u.payload.fenceLength,
            rawBody: u.payload.rawBody,
          }
          : null,
        valid: u.valid,
        complete: u.complete,
      })),
      (u) => key(u.source, { start: u.range[0], end: u.range[1] }),
    ),
    imports: sorted(
      bundle.imports.map((i) => ({
        source: i.source,
        target: i.target,
        path: i.path,
        provider: i.provider,
        range: span(i.range),
        status: i.status,
        names: i.names.map((n) => ({
          name: n.name,
          status: n.status,
          entity: owner(n.entity),
          range: span(n.range),
        })),
      })),
      (i) => key(i.source, { start: i.range[0], end: i.range[1] }),
    ),
  };
}
