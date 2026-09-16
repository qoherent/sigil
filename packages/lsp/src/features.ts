import {
  componentFacetsFor,
  type ComponentIdentity,
  type Facet,
  type GlossaryTerm,
  type ImplementationRange,
  type ImplementationSection,
  type ImplementationSource,
  isExcludedPath,
  isSupportedImplementationSource,
  joinPath,
  normalizePath,
  type OwnedImplementationProjection,
  type OwnedImplementationTarget,
  ownedImplementationTargetsFor,
  relativePath,
  type ResolvedComponent,
  type ResolvedSigilWorkspace,
  type ResolvedTag,
  type ResolvedTagReference,
  type Section,
  type SigilConfig,
  type SigilDiagnostic,
  type SigilDocument,
  type SigilFileSystem,
  type SourceRange,
  type SourceText,
} from "@qoherent/sigil-core";
import { pathToFileUri } from "./filesystem.ts";
import type {
  DocumentSymbol,
  Hover,
  Location,
  Position,
  PublishDiagnosticsParams,
  Range,
  SemanticTokens,
} from "./types.ts";
export type SourceSnapshots = ReadonlyMap<string, SourceText>;
interface TagOccurrence {
  readonly tag: ResolvedTag;
  readonly contexts: readonly ResolvedComponent[];
  readonly sectionName?: string;
  readonly range: SourceRange;
}
interface ComponentOccurrence {
  readonly component: ResolvedComponent;
  readonly range: SourceRange;
}
interface GlossaryReference {
  readonly term: GlossaryTerm;
  readonly matchedSpelling: string;
  readonly range: Range;
}
// @sigil implements packages/lsp/_module.sigil::SigilLsp::OwnershipSourceIndex state,logic,constraints
export class OwnershipSourceIndex {
  readonly #sources: Promise<readonly ImplementationSource[]>;

  constructor(
    workspaceRoot: string,
    fs: SigilFileSystem,
    config?: SigilConfig,
  ) {
    this.#sources = implementationSources(workspaceRoot, fs, config);
  }

  sources(): Promise<readonly ImplementationSource[]> {
    return this.#sources;
  }
}

// @sigil implements packages/lsp/_module.sigil::SigilLsp::OwnershipHoverCache state,logic,constraints,cases
export class OwnershipHoverCache {
  readonly #resolved: ResolvedSigilWorkspace;
  readonly #sourceIndex: OwnershipSourceIndex;
  readonly #projections = new Map<
    string,
    Promise<OwnedImplementationProjection | undefined>
  >();

  constructor(
    resolved: ResolvedSigilWorkspace,
    sourceIndex: OwnershipSourceIndex,
  ) {
    this.#resolved = resolved;
    this.#sourceIndex = sourceIndex;
  }

  projection(
    componentIdentity: ComponentIdentity,
    tagName?: string,
    sectionName?: ImplementationSection,
  ): Promise<OwnedImplementationProjection | undefined> {
    const key =
      `${componentIdentity.declarationPath}\0${componentIdentity.componentName}\0${
        tagName ?? ""
      }\0${sectionName ?? ""}`;
    let projection = this.#projections.get(key);
    if (!projection) {
      projection = this.#sourceIndex.sources().then((sources) =>
        ownedImplementationTargetsFor(
          this.#resolved,
          sources,
          componentIdentity,
          tagName,
          sectionName,
        )
      );
      this.#projections.set(key, projection);
    }
    return projection;
  }
}

export function sourceRangeToLsp(
  range: SourceRange | undefined,
  source?: SourceText,
): Range | undefined {
  if (!range) return zeroRange();
  const start = source?.utf16PositionAtByte(range.start),
    end = source?.utf16PositionAtByte(range.end);
  return start && end ? { start, end } : undefined;
}
function implementationRangeToLsp(range: ImplementationRange): Range {
  return {
    start: { line: range.start.line - 1, character: range.start.column - 1 },
    end: { line: range.end.line - 1, character: range.end.column - 1 },
  };
}
function sourceFor(
  resolved: ResolvedSigilWorkspace,
  path: string,
  snapshots?: SourceSnapshots,
): SourceText | undefined {
  const normalized = normalizePath(path);
  return snapshots?.get(normalized) ??
    resolved.workspace.files.find((f) => normalizePath(f.path) === normalized)
      ?.document.source;
}
// @sigil implements packages/lsp/_module.sigil::SigilLsp::DiagnosticPublishing interface
export function diagnosticsByUri(
  diagnostics: readonly SigilDiagnostic[],
  snapshots: SourceSnapshots = new Map(),
): ReadonlyMap<string, PublishDiagnosticsParams["diagnostics"]> {
  const grouped = new Map<string, PublishDiagnosticsParams["diagnostics"]>();
  for (const item of diagnostics) {
    if (!item.filePath) continue;
    const uri = pathToFileUri(item.filePath);
    const locationRange = item.implementationRange
      ? implementationRangeToLsp(item.implementationRange)
      : sourceRangeToLsp(
        item.range,
        snapshots.get(normalizePath(item.filePath)),
      );
    const relatedInformation = item.related.flatMap((related) => {
      if (!related.filePath) return [];
      const range = related.implementationRange
        ? implementationRangeToLsp(related.implementationRange)
        : sourceRangeToLsp(
          related.range,
          snapshots.get(normalizePath(related.filePath)),
        );
      return range
        ? [{
          location: { uri: pathToFileUri(related.filePath), range },
          message: related.message ?? item.message,
        }]
        : [];
    });
    grouped.set(uri, [...(grouped.get(uri) ?? []), {
      range: locationRange ?? zeroRange(),
      severity: item.severity === "error"
        ? 1
        : item.severity === "warning"
        ? 2
        : 4,
      code: item.code,
      source: "sigil",
      message: item.message,
      relatedInformation,
      data: {
        stage: item.stage,
        originalRange: item.range,
        coordinateSystem: item.implementationRange
          ? "utf16-lines"
          : "utf8-bytes",
        locationAvailable: !!locationRange,
        related: item.related,
      },
    }]);
  }
  return grouped;
}
// @sigil implements packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
export function documentSymbols(
  document: SigilDocument,
): readonly DocumentSymbol[] {
  const source = document.source;
  if (!source) return [];
  const symbol = (
    name: string,
    detail: string,
    range: SourceRange,
    nameRange: SourceRange,
    children: readonly DocumentSymbol[] = [],
  ): DocumentSymbol => ({
    name,
    detail,
    kind: detail === "component" ? 5 : 7,
    range: sourceRangeToLsp(range, source)!,
    selectionRange: sourceRangeToLsp(nameRange, source)!,
    children,
  });
  const sectionSymbol = (section: Section) =>
    symbol(
      section.name,
      "section",
      section.range,
      section.nameRange,
      [
        ...section.groups.map((group) =>
          symbol(group.name, "Tag group", group.range, group.nameRange)
        ),
        ...section.units.flatMap((f) =>
          f.definitions.filter((d) => d.valid).map((d) =>
            symbol(d.name, "inline Tag", d.range, d.nameRange)
          )
        ),
      ].sort((a, b) => compare(a.range.start, b.range.start)),
    );
  return document.components.map((c) =>
    symbol(
      c.name,
      "component",
      c.range,
      c.nameRange,
      c.sections.map(sectionSymbol),
    )
  );
}
function componentOccurrences(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
): ComponentOccurrence[] {
  const local = resolved.components.filter((c) =>
    c.filePath === filePath && c.identity
  ).map((component) => ({ component, range: component.declaration.nameRange }));
  for (
    const item of resolved.imports.filter((i) =>
      i.sourceFile === filePath && i.status === "resolved"
    )
  ) {
    const component = resolved.components.find((c) =>
      c.id === item.providerId && c.identity
    );
    if (component) {
      local.push({ component, range: item.declaration.providerRange });
    }
  }
  return local;
}
function tagOccurrences(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
): TagOccurrence[] {
  const tags = new Map(
    resolved.components.flatMap((c) =>
      c.tags.filter((t) => t.identity && t.status === "resolved").map((t) =>
        [t.identity!.id, t] as const
      )
    ),
  );
  const items: TagOccurrence[] = [];
  for (
    const component of resolved.components.filter((c) =>
      c.filePath === filePath && c.identity
    )
  ) {
    for (const tag of component.tags) {
      if (!tag.identity || tag.status !== "resolved") continue;
      for (
        const introduction of tag.introductions.filter((i) =>
          i.valid && i.complete
        )
      ) {
        items.push({
          tag,
          contexts: [component],
          sectionName: introduction.sectionName,
          range: introduction.nameRange,
        });
      }
    }
    for (const reference of component.references) {
      const tag = reference.tagIdentity && tags.get(reference.tagIdentity.id);
      if (tag && reference.status === "resolved") {
        items.push({
          tag,
          contexts: [component],
          sectionName: reference.sectionName,
          range: reference.range,
        });
      }
    }
  }
  for (
    const item of resolved.imports.filter((i) => i.sourceFile === filePath)
  ) {
    for (const selection of item.names) {
      if (selection.status !== "resolved" || !selection.tag?.identity) continue;
      const contexts = resolved.components.filter((c) =>
        selection.uses.some((u) => u.componentId === c.id)
      );
      items.push({
        tag: selection.tag,
        contexts,
        range: selection.selection.range,
      });
    }
  }
  return items;
}
function at(range: SourceRange, byte: number): boolean {
  return byte >= range.start && byte < range.end;
}
function tagDefinition(
  resolved: ResolvedSigilWorkspace,
  tag: ResolvedTag,
  snapshots?: SourceSnapshots,
): Location | null {
  const valid = tag.introductions.filter((i) => i.valid && i.complete);
  const introduction = valid.find((i) => i.kind === "inline") ??
    valid.sort((a, b) => a.range.start - b.range.start)[0];
  return introduction
    ? location(
      resolved,
      introduction.filePath,
      introduction.nameRange,
      snapshots,
    )
    : null;
}
function location(
  resolved: ResolvedSigilWorkspace,
  path: string,
  range: SourceRange,
  snapshots?: SourceSnapshots,
): Location | null {
  const converted = sourceRangeToLsp(
    range,
    sourceFor(resolved, path, snapshots),
  );
  return converted ? { uri: pathToFileUri(path), range: converted } : null;
}
// @sigil implements packages/lsp/_module.sigil::SigilLsp::SourceCoordinates logic
export function definitionAt(
  resolved: ResolvedSigilWorkspace,
  _fs: SigilFileSystem,
  filePath: string,
  position: Position,
  snapshots?: SourceSnapshots,
): Location | null {
  const path = normalizePath(filePath),
    source = sourceFor(resolved, path, snapshots),
    byte = source?.byteOffsetAtUtf16Position(position);
  if (byte === undefined) return null;
  const tag = tagOccurrences(resolved, path).find((i) => at(i.range, byte));
  if (tag) return tagDefinition(resolved, tag.tag, snapshots);
  const component = componentOccurrences(resolved, path).find((i) =>
    at(i.range, byte)
  );
  if (component) {
    return location(
      resolved,
      component.component.filePath,
      component.component.declaration.nameRange,
      snapshots,
    );
  }
  const imported = resolved.imports.find((i) =>
    i.sourceFile === path && i.targetFile && at(i.declaration.pathRange, byte)
  );
  if (imported?.targetFile) {
    const provider = resolved.components.find((c) =>
      c.id === imported.providerId
    );
    return location(
      resolved,
      imported.targetFile,
      provider?.declaration.nameRange ?? { start: 0, end: 0 },
      snapshots,
    );
  }
  const glossary = glossaryReferences(resolved, path, snapshots).find((i) =>
    contains(i.range, position)
  );
  return glossary && resolved.glossary.glossaryPath
    ? location(
      resolved,
      resolved.glossary.glossaryPath,
      glossary.term.declarationRange,
      snapshots,
    )
    : null;
}
// @sigil implements packages/lsp/_module.sigil::SigilLsp::TagLanguageFeatures interface,logic,constraints,cases
export async function hoverAt(
  resolved: ResolvedSigilWorkspace,
  _fs: SigilFileSystem,
  ownership: OwnershipHoverCache,
  filePath: string,
  position: Position,
  snapshots?: SourceSnapshots,
): Promise<Hover | null> {
  const path = normalizePath(filePath),
    source = sourceFor(resolved, path, snapshots),
    byte = source?.byteOffsetAtUtf16Position(position);
  if (byte === undefined) return null;
  const renderer = new HoverMarkdownRenderer(resolved, ownership, snapshots);
  const tag = tagOccurrences(resolved, path).find((i) => at(i.range, byte));
  const glossaryOccurrence = glossaryReferences(resolved, path, snapshots).find(
    (i) => contains(i.range, position),
  );
  if (tag) {
    const identity = tag.tag.identity!;
    const provider = resolved.components.find((c) =>
      c.identity?.componentName === identity.owner.componentName &&
      c.filePath === identity.owner.declarationPath
    );
    if (!provider) return null;
    const lines = [
      `### Tag ${renderer.tagLink(tag.tag)}`,
      "",
      `Origin: ${renderer.componentLink(provider)} in \`${
        renderer.displayPath(provider.filePath)
      }\``,
      "",
      ...renderer.component(provider),
    ];
    for (const consumer of tag.contexts.filter((c) => c.id !== provider.id)) {
      lines.push("", `**Consumer: ${renderer.componentLink(consumer)}**`);
      for (const facet of componentFacetsFor(consumer, tag.tag.name)) {
        lines.push(`**${facet.sectionName}**`, renderer.facet(facet));
      }
    }
    const glossary = glossaryOccurrence ??
      glossaryForTag(resolved, path, tag, source!);
    if (glossary) lines.push("", glossaryMarkdown(glossary));
    for (const consumer of tag.contexts) {
      lines.push(
        ...await renderer.ownedImplementationLines(
          consumer,
          tag.tag.name,
          implementationSection(tag.sectionName),
        ),
      );
    }
    return {
      contents: { kind: "markdown", value: lines.join("\n") },
      range: sourceRangeToLsp(tag.range, source),
    };
  }
  if (glossaryOccurrence) {
    return {
      contents: {
        kind: "markdown",
        value: glossaryMarkdown(glossaryOccurrence),
      },
      range: glossaryOccurrence.range,
    };
  }
  const component = componentOccurrences(resolved, path).find((i) =>
    at(i.range, byte)
  );
  if (!component) return null;
  return {
    contents: {
      kind: "markdown",
      value: [
        ...renderer.component(component.component),
        ...await renderer.ownedImplementationLines(component.component),
      ].join("\n"),
    },
    range: sourceRangeToLsp(component.range, source),
  };
}
export function semanticTokens(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  snapshots?: SourceSnapshots,
): SemanticTokens {
  const path = normalizePath(filePath),
    source = sourceFor(resolved, path, snapshots);
  if (!source) return { data: [] };
  const structured = [
    ...componentOccurrences(resolved, path).map((i) => ({
      range: sourceRangeToLsp(i.range, source)!,
      type: 0,
    })),
    ...tagOccurrences(resolved, path).map((i) => ({
      range: sourceRangeToLsp(i.range, source)!,
      type: 1,
    })),
  ];
  const glossary = glossaryReferences(resolved, path, snapshots).filter((g) =>
    !structured.some((s) => overlaps(s.range, g.range))
  ).map((i) => ({ range: i.range, type: 2 }));
  const unique = new Map(
    [...structured, ...glossary].map((i) => [JSON.stringify(i.range), i]),
  );
  const ordered = [...unique.values()].sort((a, b) =>
    compare(a.range.start, b.range.start)
  );
  let previousLine = 0, previousCharacter = 0;
  const data: number[] = [];
  for (const { range, type } of ordered) {
    if (range.start.line !== range.end.line) continue;
    const deltaLine = range.start.line - previousLine;
    data.push(
      deltaLine,
      deltaLine === 0
        ? range.start.character - previousCharacter
        : range.start.character,
      range.end.character - range.start.character,
      type,
      0,
    );
    previousLine = range.start.line;
    previousCharacter = range.start.character;
  }
  return { data };
}
function glossaryReferences(
  resolved: ResolvedSigilWorkspace,
  path: string,
  snapshots?: SourceSnapshots,
): GlossaryReference[] {
  const source = sourceFor(resolved, path, snapshots);
  return resolved.glossary.occurrences.filter((o) =>
    normalizePath(o.filePath) === path
  ).flatMap((o) => {
    const range = sourceRangeToLsp(o.range, source);
    return range
      ? [{ term: o.term, matchedSpelling: o.matchedSpelling, range }]
      : [];
  });
}
function glossaryForTag(
  resolved: ResolvedSigilWorkspace,
  path: string,
  occurrence: TagOccurrence,
  source: SourceText,
): GlossaryReference | undefined {
  const context = resolved.glossary.resolvedContexts.find((c) =>
    normalizePath(c.filePath) === relativePath(resolved.workspace.root, path)
  );
  const term = context?.entries.find((t) =>
    [t.term, ...t.aliases].some((s) =>
      s.toLowerCase() === occurrence.tag.name.toLowerCase()
    )
  );
  return term
    ? {
      term,
      matchedSpelling: occurrence.tag.name,
      range: sourceRangeToLsp(occurrence.range, source)!,
    }
    : undefined;
}
export async function renderDocumentMarkdown(
  resolved: ResolvedSigilWorkspace,
  _fs: SigilFileSystem,
  ownership: OwnershipHoverCache,
  filePath: string,
  snapshots?: SourceSnapshots,
): Promise<string> {
  const renderer = new HoverMarkdownRenderer(resolved, ownership, snapshots),
    sections: string[] = [];
  for (
    const component of resolved.components.filter((c) =>
      c.filePath === normalizePath(filePath)
    )
  ) {
    sections.push(
      [
        ...renderer.component(component),
        ...await renderer.ownedImplementationLines(component),
      ].join("\n"),
    );
  }
  return sections.join("\n\n---\n\n");
}
class HoverMarkdownRenderer {
  readonly #tags = new Map<string, ResolvedTag>();
  readonly #references = new Map<string, ResolvedTagReference[]>();
  constructor(
    readonly resolved: ResolvedSigilWorkspace,
    readonly ownership: OwnershipHoverCache,
    readonly snapshots?: SourceSnapshots,
  ) {
    for (const component of resolved.components) {
      for (const tag of component.tags) {
        if (tag.identity && !this.#tags.has(tag.identity.id)) {
          this.#tags.set(tag.identity.id, tag);
        }
      }
      for (const reference of component.references) {
        if (reference.status !== "resolved") continue;
        const references = this.#references.get(reference.facetId) ?? [];
        references.push(reference);
        this.#references.set(reference.facetId, references);
      }
    }
  }
  displayPath(path: string): string {
    return relativePath(this.resolved.workspace.root, path);
  }
  componentLink(component: ResolvedComponent): string {
    const target = location(
      this.resolved,
      component.filePath,
      component.declaration.nameRange,
      this.snapshots,
    );
    return target
      ? markdownLink(component.name, target)
      : escapeMarkdown(component.name);
  }
  tagLink(tag: ResolvedTag): string {
    const target = tagDefinition(this.resolved, tag, this.snapshots);
    return target ? markdownLink(tag.name, target) : escapeMarkdown(tag.name);
  }
  component(component: ResolvedComponent): string[] {
    const lines = [
      `### component ${this.componentLink(component)}`,
      "",
      `Source: \`${this.displayPath(component.filePath)}\``,
    ];
    for (const section of component.declaration.sections) {
      lines.push(
        "",
        `**${section.name[0].toUpperCase()}${section.name.slice(1)}**`,
      );
      for (const facet of section.units) lines.push(this.facet(facet));
    }
    return lines;
  }
  facet(facet: Facet): string {
    const source = sourceFor(this.resolved, facet.filePath, this.snapshots);
    if (!source) return facet.prose;
    const references = this.#references.get(facet.id) ?? [];
    const start = source.utf16OffsetAtByte(facet.proseRange.start)!;
    let prose = source.slice(facet.proseRange);
    const replacements: { range: SourceRange; text: string }[] = [];
    for (const reference of references) {
      const tag = reference.tagIdentity
        ? this.#tags.get(reference.tagIdentity.id)
        : undefined;
      if (tag) {
        replacements.push({ range: reference.range, text: this.tagLink(tag) });
      }
    }
    for (const link of facet.links) {
      try {
        const target = new URL(link.destination, pathToFileUri(facet.filePath))
          .href
          .replaceAll("(", "%28").replaceAll(")", "%29").replaceAll(">", "%3E");
        replacements.push({
          range: link.destinationRange,
          text: `<${target}>`,
        });
      } catch {
        /* Preserve destinations that cannot be represented as URLs. */
      }
    }
    for (
      const replacement of replacements.sort((a, b) =>
        b.range.start - a.range.start
      )
    ) {
      const from = source.utf16OffsetAtByte(replacement.range.start)! - start,
        to = source.utf16OffsetAtByte(replacement.range.end)! - start;
      prose = prose.slice(0, from) + replacement.text + prose.slice(to);
    }
    const lines = [`- ${prose.trim()}`];
    for (const payload of facet.literalBlocks) {
      const fence = "`".repeat(Math.max(3, payload.fenceLength));
      lines.push(
        "",
        `${fence}${payload.type ?? ""}\n${payload.rawBody}${
          /[\r\n]$/.test(payload.rawBody) ? "" : "\n"
        }${fence}`,
      );
    }
    return lines.join("\n");
  }
  async ownedImplementationLines(
    component: ResolvedComponent,
    tagName?: string,
    sectionName?: ImplementationSection,
  ): Promise<string[]> {
    const projection = await this.ownership.projection(
      {
        componentName: component.name,
        declarationPath: this.displayPath(component.filePath),
      },
      tagName,
      sectionName,
    );
    if (!projection?.targets.length) return [];
    return [
      "",
      "**Owned implementations**",
      ...projection.targets.map((target) => `- ${this.ownedTarget(target)}`),
    ];
  }
  ownedTarget(target: OwnedImplementationTarget): string {
    const path = joinPath(this.resolved.workspace.root, target.filePath),
      position = target.location ?? target.annotationRange.start;
    const point = { line: position.line - 1, character: position.column - 1 };
    const label = target.symbolIdentity
      ? `${target.symbolIdentity} · ${target.filePath}`
      : target.filePath;
    const origin = target.tagIdentity?.owner;
    return `${target.relation} ${
      markdownLink(label, {
        uri: pathToFileUri(path),
        range: { start: point, end: point },
      })
    } (${target.sections.join(", ")})${
      target.tagName
        ? `; Tag: ${escapeMarkdown(target.tagName)}; Origin: ${
          origin
            ? `${origin.declarationPath}::${origin.componentName}`
            : "unresolved"
        }`
        : ""
    }`;
  }
}
function implementationSection(
  name?: string,
): ImplementationSection | undefined {
  return name === "interface" || name === "state" || name === "logic" ||
      name === "constraints" || name === "cases"
    ? name
    : undefined;
}
async function implementationSources(
  root: string,
  fs: SigilFileSystem,
  config?: SigilConfig,
): Promise<readonly ImplementationSource[]> {
  try {
    const paths = (await fs.listFiles(root)).filter(
      isSupportedImplementationSource,
    ).filter((path) =>
      !config || !isExcludedPath(relativePath(root, path), config)
    );
    const sources: ImplementationSource[] = [];
    for (const path of paths) {
      try {
        sources.push({ filePath: path, text: await fs.readTextFile(path) });
      } catch { /* Optional ownership evidence can disappear. */ }
    }
    return sources;
  } catch {
    return [];
  }
}
function markdownLink(label: string, target: Location): string {
  return `[${escapeMarkdown(label)}](${target.uri}#L${
    target.range.start.line + 1
  },${target.range.start.character + 1})`;
}
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_\[\]])/g, "\\$1");
}
function glossaryMarkdown(reference: GlossaryReference): string {
  return [
    `### term ${reference.term.term}`,
    "",
    reference.term.definition,
    "",
    reference.term.scope.kind === "context"
      ? `Bounded context: \`${reference.term.scope.id}\``
      : "Scope: workspace",
    ...(reference.matchedSpelling !== reference.term.term
      ? ["", `Matched alias: \`${reference.matchedSpelling}\``]
      : []),
  ].join("\n");
}
function compare(a: Position, b: Position): number {
  return a.line - b.line || a.character - b.character;
}
function contains(range: Range, position: Position): boolean {
  return compare(range.start, position) <= 0 &&
    compare(position, range.end) < 0;
}
function overlaps(a: Range, b: Range): boolean {
  return compare(a.start, b.end) < 0 && compare(b.start, a.end) < 0;
}
function zeroRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
