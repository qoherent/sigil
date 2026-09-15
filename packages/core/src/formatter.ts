import { canonicalJson } from "./canonical.ts";
import { diagnostic, orderDiagnostics } from "./diagnostics.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import { SIGIL_VERSION, type SourceRange } from "./model/language.ts";
import type { SigilResolution } from "./model/resolution.ts";
import type { Facet, FormatResult, SigilDocument } from "./model/source.ts";
import { parseSigilDocument } from "./parser.ts";
import { PROSE_WIDTH, proseContentWidth } from "./prose-width.ts";
import { resolveSigilRelationships } from "./resolver.ts";
import type { PhysicalLine, SourceText } from "./source-text.ts";

/*
 * @sigil implements packages/core/src/formatter.sigil::SigilFormatter::Formatting interface,logic,cases
 * @sigil implements packages/core/src/formatter.sigil::SigilFormatter::MeaningPreservation logic
 * @sigil implements packages/core/src/formatter.sigil::SigilFormatter::DeterministicFormatting constraints
 */
export function formatSigilDocument(
  document: SigilDocument,
  source: string,
  providerContext?: SigilResolution,
): FormatResult {
  const reject = (diagnostics: readonly SigilDiagnostic[]): FormatResult => ({
    changed: false,
    diagnostics: orderDiagnostics(diagnostics),
  });
  const contextFailure = (message: string) =>
    reject([
      ...document.diagnostics,
      diagnostic("SIGIL_FORMAT_CONTEXT_UNAVAILABLE", message, {
        filePath: document.filePath,
      }),
    ]);
  if (!document.source || document.source.text !== source) {
    return contextFailure(
      "Formatting requires the exact captured source document.",
    );
  }
  if (document.imports.length && !providerContext) {
    return contextFailure(
      "Formatting imports requires the captured workspace and provider vocabulary.",
    );
  }
  const before = providerContext ??
    resolveSigilRelationships({
      root: ".",
      workspaceSnapshotIdentity: "format",
      memberRoots: [],
      files: [{ path: document.filePath, source, document }],
      diagnostics: document.diagnostics,
    });
  const original = before.workspace.files.find((f) =>
    f.path === document.filePath
  );
  if (
    original?.source !== source || original.document.source?.text !== source
  ) {
    return contextFailure(
      "Provider context was resolved against a different source snapshot.",
    );
  }
  const errors = before.diagnostics.filter((d) =>
    d.severity === "error" && d.code !== "SIGIL_LINE_TOO_LONG"
  );
  if (errors.length || !document.complete) return reject(before.diagnostics);
  const components = before.components.filter((c) =>
    c.filePath === document.filePath
  );
  const facets = components.flatMap((c) =>
    c.declaration.sections.flatMap((s) => s.units)
  );
  const references = components.flatMap((c) => c.references);
  const referenceRanges = new Map<string, SourceRange[]>();
  for (const reference of references) {
    const ranges = referenceRanges.get(reference.facetId) ?? [];
    ranges.push(reference.range);
    referenceRanges.set(reference.facetId, ranges);
  }
  const protectedRanges = new Map(facets.map((facet) => [facet.id, {
    spans: [
      ...facet.definitions.map((d) => d.range),
      ...facet.links.map((l) => l.range),
      ...referenceRanges.get(facet.id) ?? [],
    ],
    destinations: facet.links.map((l) => l.destinationRange),
  }]));
  const sourceMap = document.source;
  const proseLines = new Map<number, Facet>();
  const payloadLines = new Set<number>();
  for (const facet of facets) {
    const first =
      (sourceMap.locationAtByte(facet.proseRange.start)?.line ?? 1) - 1;
    for (
      let i = first;
      i < sourceMap.lines.length &&
      sourceMap.lines[i].start < facet.proseRange.end;
      i++
    ) proseLines.set(i, facet);
    for (const payload of facet.literalBlocks) {
      const start =
        (sourceMap.locationAtByte(payload.bodyRange.start)?.line ?? 1) - 1;
      for (
        let i = start;
        i < sourceMap.lines.length &&
        sourceMap.lines[i].start < payload.bodyRange.end;
        i++
      ) payloadLines.add(i);
    }
  }
  const rendered: string[] = [];
  let blank = false;
  for (let index = 0; index < sourceMap.lines.length; index++) {
    const line = sourceMap.lines[index];
    if (payloadLines.has(index)) {
      rendered.push(line.content + line.ending);
      blank = false;
      continue;
    }
    const facet = proseLines.get(index);
    if (facet) {
      const ranges = protectedRanges.get(facet.id)!;
      const wrapped = wrapLine(
        sourceMap,
        line,
        ranges.spans,
        ranges.destinations,
      );
      if (!wrapped) {
        return reject([
          ...before.diagnostics.filter((d) => d.code !== "SIGIL_LINE_TOO_LONG"),
          diagnostic(
            "SIGIL_UNFORMATTABLE_LINE",
            "No safe whitespace wrapping preserves this prose line.",
            {
              filePath: document.filePath,
              range: { start: line.start, end: line.contentEnd },
            },
          ),
        ]);
      }
      rendered.push(wrapped.join(line.ending || "\n") + line.ending);
      blank = false;
    } else {
      const content = line.content.replace(/[ \t]+$/, "");
      if (!content && blank) continue;
      rendered.push(content + line.ending);
      blank = !content;
    }
  }
  const formattedSource = rendered.join("");
  const parsed = parseSigilDocument(document.filePath, formattedSource, {
    sigilVersion: SIGIL_VERSION,
  });
  const after = resolveSigilRelationships({
    ...before.workspace,
    files: before.workspace.files.map((f) =>
      f.path === document.filePath
        ? { path: f.path, source: formattedSource, document: parsed.document }
        : f
    ),
    diagnostics: [
      ...before.workspace.diagnostics.filter((d) =>
        d.filePath !== document.filePath
      ),
      ...parsed.diagnostics,
    ],
  });
  const invalid = after.diagnostics.some((d) =>
    d.severity === "error" &&
    (d.filePath === document.filePath || d.code !== "SIGIL_LINE_TOO_LONG")
  );
  if (
    invalid ||
    meaningSignature(before, document.filePath) !==
      meaningSignature(after, document.filePath)
  ) {
    return reject([
      ...before.diagnostics.filter((d) => d.code !== "SIGIL_LINE_TOO_LONG"),
      diagnostic(
        "SIGIL_UNFORMATTABLE_LINE",
        "Rewrapping would change structure or resolved source meaning.",
        { filePath: document.filePath },
      ),
    ]);
  }
  return {
    formattedSource,
    changed: formattedSource !== source,
    diagnostics: after.diagnostics,
  };
}

function safeProseLine(text: string): boolean {
  const content = text.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  return content !== "}" && !content.endsWith("{") && !/^`{3}/.test(content);
}

/** Keep authored physical breaks; new breaks cannot join previously separate names. */
function wrapLine(
  source: SourceText,
  line: PhysicalLine,
  protectedSpans: readonly SourceRange[],
  destinations: readonly SourceRange[],
): string[] | undefined {
  const text = line.content.replace(/[ \t]+$/, "");
  const indent = text.match(/^[ \t]*/)?.[0] ?? "";
  const range = (a: number, b: number) => ({
    start: source.byteOffsetAtUtf16(line.utf16Start + a)!,
    end: source.byteOffsetAtUtf16(line.utf16Start + b)!,
  });
  const breaks = [...text.matchAll(/[ \t]+/g)].filter((m) =>
    m.index >= indent.length
  ).map((m) => ({ start: m.index, end: m.index + m[0].length })).filter((b) => {
    const span = range(b.start, b.end);
    return !protectedSpans.some((p) =>
      span.start < p.end && p.start < span.end
    );
  });
  const starts = [indent.length, ...breaks.map((b) => b.end)];
  const choices = new Map<number, { end: number; next?: number }>();
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i];
    const options: { end: number; next?: number }[] = [];
    for (const boundary of breaks) {
      if (boundary.start <= start) continue;
      if (
        proseContentWidth(source, range(start, boundary.start), destinations) >
          PROSE_WIDTH
      ) break;
      options.push({ end: boundary.start, next: boundary.end });
    }
    if (
      proseContentWidth(source, range(start, text.length), destinations) <=
        PROSE_WIDTH
    ) options.push({ end: text.length });
    const chosen = options.reverse().find((option) =>
      safeProseLine(text.slice(start, option.end)) &&
      (option.next === undefined || choices.has(option.next))
    );
    if (chosen) choices.set(start, chosen);
  }
  if (!choices.has(indent.length)) return undefined;
  const result: string[] = [];
  let start: number | undefined = indent.length;
  while (start !== undefined) {
    const choice: { end: number; next?: number } = choices.get(start)!;
    result.push(indent + text.slice(start, choice.end));
    start = choice.next;
  }
  return result;
}

/** Ignore moved coordinates, retaining every authored contribution and relationship. */
function meaningSignature(
  resolution: SigilResolution,
  filePath: string,
): string {
  const document =
    resolution.workspace.files.find((f) => f.path === filePath)!.document;
  return canonicalJson({
    imports: document.imports.map((i) => ({
      path: i.path,
      provider: i.provider,
      names: i.names,
    })),
    components: resolution.components.filter((c) => c.filePath === filePath)
      .map((c) => ({
        name: c.name,
        sections: c.declaration.sections.map((section) => ({
          name: section.name,
          groups: section.groups.map((g) => g.name),
          facets: section.units.map((f) => ({
            group: section.groups.findIndex((g) => g.id === f.groupingId),
            prose: f.prose.replace(/[ \t]+/g, " "),
            definitions: f.definitions.map((d) => ({
              name: d.name,
              raw: d.raw,
            })),
            references: c.references.filter((r) => r.facetId === f.id).map(
              (r) => ({
                name: r.name,
                status: r.status,
                identity: r.tagIdentity?.id,
              }),
            ),
            links: f.links.map((l) => ({
              raw: l.raw,
              label: l.label,
              destination: l.destination,
              title: l.title,
              image: l.image,
            })),
            payloads: f.literalBlocks.map((p) => ({
              type: p.type,
              rawBody: p.rawBody,
              fenceLength: p.fenceLength,
            })),
          })),
        })),
      })),
  });
}
