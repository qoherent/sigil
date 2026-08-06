import type {
  ConceptIdentity,
  GlossaryTerm,
  ImplementationSection,
  ImplementationSource,
  OwnedImplementationProjection,
  OwnedImplementationTarget,
  ResolvedComponent,
  ResolvedConcept,
  ResolvedSigilWorkspace,
  Section,
  SemanticUnit,
  SigilDiagnostic,
  SigilDocument,
  SigilFileSystem,
  SigilSectionName,
  SourceRange,
} from "@qoherent/sigil-core";
import {
  isSupportedImplementationSource,
  ownedImplementationTargetsFor,
} from "@qoherent/sigil-core";
import { normalizePath, relativePath } from "@qoherent/sigil-core";
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

const SYMBOL_NAMESPACE = 3;
const SYMBOL_CLASS = 5;
const SYMBOL_PROPERTY = 7;
const SEMANTIC_TOKEN_COMPONENT = 0;
const SEMANTIC_TOKEN_CONCEPT = 1;
const SEMANTIC_TOKEN_TERM = 2;

interface ComponentReference {
  readonly component: ResolvedComponent;
  readonly range: Range;
  readonly includeExpansions: boolean;
}

interface ConceptReference {
  readonly concept: ResolvedConcept;
  readonly context: ResolvedComponent;
  readonly sectionName: SigilSectionName;
  readonly range: Range;
}

interface GlossaryReference {
  readonly term: GlossaryTerm;
  readonly matchedSpelling: string;
  readonly range: Range;
}

interface SemanticReference {
  readonly range: Range;
  readonly tokenType: number;
}

// @sigil implements packages/lsp/_module.sigil::SigilLsp::OwnershipSourceIndex state,logic,constraints
export class OwnershipSourceIndex {
  readonly #sources: Promise<readonly ImplementationSource[]>;

  constructor(
    workspaceRoot: string,
    fs: SigilFileSystem,
  ) {
    this.#sources = implementationSources(workspaceRoot, fs);
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
    componentName: string,
    conceptName?: string,
    sectionName?: ImplementationSection,
  ): Promise<OwnedImplementationProjection | undefined> {
    const key = `${componentName}\0${conceptName ?? ""}\0${sectionName ?? ""}`;
    let projection = this.#projections.get(key);
    if (!projection) {
      projection = this.#sourceIndex.sources().then((sources) =>
        ownedImplementationTargetsFor(
          this.#resolved,
          sources,
          componentName,
          conceptName,
          sectionName,
        )
      );
      this.#projections.set(key, projection);
    }
    return projection;
  }
}

export function sourceRangeToLsp(range?: SourceRange): Range {
  if (!range) return zeroRange();
  return {
    start: {
      line: Math.max(0, range.start.line - 1),
      character: Math.max(0, range.start.column - 1),
    },
    end: {
      line: Math.max(0, range.end.line - 1),
      character: Math.max(0, range.end.column - 1),
    },
  };
}

// @sigil implements packages/lsp/_module.sigil::SigilLsp::DiagnosticPublishing interface
export function diagnosticsByUri(
  diagnostics: readonly SigilDiagnostic[],
): ReadonlyMap<string, PublishDiagnosticsParams["diagnostics"]> {
  const grouped = new Map<string, PublishDiagnosticsParams["diagnostics"]>();
  for (const item of diagnostics) {
    if (!item.filePath) continue;
    const uri = pathToFileUri(item.filePath);
    const entries = [...(grouped.get(uri) ?? [])];
    entries.push({
      range: sourceRangeToLsp(item.range),
      severity: item.severity === "error"
        ? 1
        : item.severity === "warning"
        ? 2
        : 4,
      code: item.code,
      source: "sigil",
      message: item.message,
    });
    grouped.set(uri, entries);
  }
  return grouped;
}

// @sigil implements packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
export function documentSymbols(
  document: SigilDocument,
  source: string,
): readonly DocumentSymbol[] {
  return [
    ...document.components.map((declaration) => ({
      name: declaration.name,
      detail: "component",
      kind: SYMBOL_CLASS,
      range: sourceRangeToLsp(declaration.range),
      selectionRange: declarationNameRange(
        source,
        declaration.range.start.line,
        declaration.name,
      ),
      children: declaration.sections.map((section) =>
        sectionSymbol(section, source)
      ),
    })),
    ...document.expands.map((declaration) => ({
      name: declaration.name,
      detail: "expand",
      kind: SYMBOL_NAMESPACE,
      range: sourceRangeToLsp(declaration.range),
      selectionRange: declarationNameRange(
        source,
        declaration.range.start.line,
        declaration.name,
      ),
      children: declaration.sections.map((section) =>
        sectionSymbol(section, source)
      ),
    })),
  ];
}

// @sigil implements packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
export async function definitionAt(
  resolved: ResolvedSigilWorkspace,
  fs: SigilFileSystem,
  filePath: string,
  position: Position,
): Promise<Location | null> {
  const normalized = normalizePath(filePath);
  const source = await fs.readTextFile(normalized);
  const token = tokenAt(source, position);
  if (!token) return null;

  const importEntry = resolved.imports.find((item) =>
    normalizePath(item.sourceFile) === normalized &&
    contains(sourceRangeToLsp(item.declaration.range), position)
  );
  if (importEntry) {
    const imported = importEntry.names.find((item) => item.name === token.text);
    if (imported?.component && imported.componentFile) {
      return location(imported.componentFile, imported.component.range);
    }
    if (
      importEntry.targetFile &&
      token.text.includes(importEntry.declaration.path)
    ) {
      const target = resolved.workspace.files.find((item) =>
        normalizePath(item.path) === normalizePath(importEntry.targetFile!)
      );
      const declaration = target?.document.components[0] ??
        target?.document.expands[0];
      return location(importEntry.targetFile, declaration?.range);
    }
  }

  const conceptReference = conceptReferences(
    resolved,
    normalized,
    source,
  ).find((item) => contains(item.range, position));
  if (conceptReference) {
    return await conceptDefinition(resolved, fs, conceptReference.concept);
  }

  const glossaryReference = glossaryReferences(resolved, normalized).find(
    (item) => contains(item.range, position),
  );
  if (glossaryReference && resolved.glossary.glossaryPath) {
    return location(
      resolved.glossary.glossaryPath,
      glossaryReference.term.declarationRange,
    );
  }

  const reference = componentReferences(resolved, normalized, source).find(
    (item) => contains(item.range, position),
  );
  return reference
    ? location(
      reference.component.filePath,
      reference.component.declaration.range,
    )
    : null;
}

/*
 * @sigil implements packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
 * @sigil implements packages/lsp/_module.sigil::SigilLsp::ConceptLanguageFeatures interface,logic,constraints,cases
 * @sigil implements packages/lsp/_module.sigil::SigilLsp::OwnershipHoverCache state,logic,constraints,cases
 */
export async function hoverAt(
  resolved: ResolvedSigilWorkspace,
  fs: SigilFileSystem,
  ownership: OwnershipHoverCache,
  filePath: string,
  position: Position,
): Promise<Hover | null> {
  const source = await fs.readTextFile(filePath);
  const normalized = normalizePath(filePath);
  const markdown = new HoverMarkdownRenderer(resolved, fs, ownership);
  const conceptReference = conceptReferences(
    resolved,
    normalized,
    source,
  ).find((item) => contains(item.range, position));
  const glossaryOccurrence = glossaryReferences(resolved, normalized).find(
    (item) => contains(item.range, position),
  );
  if (conceptReference) {
    const glossaryReference = glossaryOccurrence ??
      glossaryReferenceForConcept(resolved, normalized, conceptReference);
    const concept = await conceptMarkdown(conceptReference, markdown);
    const identity = conceptReference.concept.identity;
    const owningComponent = markdown.component(
      identity.componentName,
      identity.filePath,
    );
    const ownedImplementationLines = owningComponent
      ? await markdown.ownedImplementationLines(
        owningComponent,
        identity.identifier,
        implementationSection(conceptReference.sectionName),
      )
      : [];
    const sections = [
      concept,
      ...(glossaryReference ? [glossaryMarkdown(glossaryReference)] : []),
      ...(ownedImplementationLines.length
        ? [ownedImplementationLines.join("\n")]
        : []),
    ];
    return {
      contents: {
        kind: "markdown",
        value: sections.join("\n\n---\n\n"),
      },
      range: conceptReference.range,
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
  const reference = componentReferences(resolved, normalized, source).find(
    (item) => contains(item.range, position),
  );
  if (!reference) return null;
  return {
    contents: {
      kind: "markdown",
      value: await componentMarkdown(
        reference.component,
        reference.includeExpansions,
        markdown,
      ),
    },
    range: reference.range,
  };
}

// @sigil implements packages/lsp/_module.sigil::SigilLsp::GlossaryLanguageFeatures interface,logic,constraints,cases
export function semanticTokens(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  source: string,
): SemanticTokens {
  const byRange = new Map<string, SemanticReference>();
  const components = componentReferences(resolved, filePath, source);
  const concepts = conceptReferences(resolved, filePath, source);
  const structuredRanges = [
    ...components.map((item) => item.range),
    ...concepts.map((item) => item.range),
  ];
  for (const item of glossaryReferences(resolved, filePath)) {
    if (structuredRanges.some((range) => overlaps(range, item.range))) continue;
    byRange.set(rangeKey(item.range), {
      range: item.range,
      tokenType: SEMANTIC_TOKEN_TERM,
    });
  }
  for (const item of components) {
    byRange.set(rangeKey(item.range), {
      range: item.range,
      tokenType: SEMANTIC_TOKEN_COMPONENT,
    });
  }
  for (const item of concepts) {
    byRange.set(rangeKey(item.range), {
      range: item.range,
      tokenType: SEMANTIC_TOKEN_CONCEPT,
    });
  }
  const references = [...byRange.values()].sort((left, right) =>
    compareRanges(left.range, right.range)
  );
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const reference of references) {
    const range = reference.range;
    if (range.start.line !== range.end.line) continue;
    const deltaLine = range.start.line - previousLine;
    const deltaCharacter = deltaLine === 0
      ? range.start.character - previousCharacter
      : range.start.character;
    data.push(
      deltaLine,
      deltaCharacter,
      range.end.character - range.start.character,
      reference.tokenType,
      0,
    );
    previousLine = range.start.line;
    previousCharacter = range.start.character;
  }
  return { data };
}

function glossaryReferences(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
): readonly GlossaryReference[] {
  const normalized = normalizePath(filePath);
  return resolved.glossary.occurrences
    .filter((occurrence) => normalizePath(occurrence.filePath) === normalized)
    .map((occurrence) => ({
      term: occurrence.term,
      matchedSpelling: occurrence.matchedSpelling,
      range: sourceRangeToLsp(occurrence.range),
    }));
}

function glossaryReferenceForConcept(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  conceptReference: ConceptReference,
): GlossaryReference | undefined {
  const relativeFilePath = relativePath(resolved.workspace.root, filePath);
  const context = resolved.glossary.resolvedContexts.find((item) =>
    normalizePath(item.filePath) === normalizePath(relativeFilePath)
  );
  const identifier = conceptReference.concept.identity.identifier;
  const normalizedIdentifier = identifier.toLowerCase();
  const term = context?.entries.find((entry) =>
    [entry.term, ...entry.aliases].some(
      (spelling) => spelling.toLowerCase() === normalizedIdentifier,
    )
  );
  return term
    ? {
      term,
      matchedSpelling: identifier,
      range: conceptReference.range,
    }
    : undefined;
}

function componentReferences(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  source: string,
): readonly ComponentReference[] {
  const normalized = normalizePath(filePath);
  const document = resolved.workspace.files.find((item) =>
    normalizePath(item.path) === normalized
  )?.document;
  if (!document) return [];

  const references: ComponentReference[] = [];
  const visible = new Map<string, ResolvedComponent | null>();
  const localComponents = resolved.components.filter((item) =>
    normalizePath(item.filePath) === normalized
  );
  for (const component of localComponents) {
    addVisibleComponent(visible, component);
    references.push({
      component,
      includeExpansions: true,
      range: declarationNameRange(
        source,
        component.declaration.range.start.line,
        component.name,
      ),
    });
  }

  for (
    const imported of resolved.imports.filter((item) =>
      normalizePath(item.sourceFile) === normalized
    )
  ) {
    const namesRange = importNamesRange(source, imported.declaration.range);
    for (const name of imported.names) {
      if (!name.component || !name.componentFile) continue;
      const component = resolved.components.find((item) =>
        item.declaration === name.component &&
        normalizePath(item.filePath) === normalizePath(name.componentFile!)
      );
      if (!component) continue;
      addVisibleComponent(visible, component);
      for (const range of identifierRanges(source, name.name, namesRange)) {
        references.push({ component, range, includeExpansions: false });
      }
    }
  }

  for (const expand of document.expands) {
    const matches = resolved.components.filter((item) =>
      item.name === expand.name
    );
    if (matches.length !== 1) continue;
    references.push({
      component: matches[0],
      includeExpansions: true,
      range: declarationNameRange(
        source,
        expand.range.start.line,
        expand.name,
      ),
    });
  }

  const semanticUnits = [
    ...document.components,
    ...document.expands,
  ].flatMap((declaration) =>
    declaration.sections.flatMap((section) => section.units)
  );
  const sourceLines = source.split(/\r?\n/);
  for (const unit of semanticUnits) {
    for (let offset = 0; offset < unit.sourceLines.length; offset++) {
      const sourceLine = sourceLines[unit.range.start.line - 1 + offset] ?? "";
      const lineRange = {
        start: { line: unit.range.start.line - 1 + offset, character: 0 },
        end: {
          line: unit.range.start.line - 1 + offset,
          character: sourceLine.length,
        },
      };
      for (const [name, component] of visible) {
        if (!component) continue;
        for (const range of identifierRanges(source, name, lineRange)) {
          references.push({
            component,
            range,
            includeExpansions: normalizePath(component.filePath) === normalized,
          });
        }
      }
    }
  }

  return deduplicateReferences(references);
}

function conceptReferences(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  source: string,
): readonly ConceptReference[] {
  const normalized = normalizePath(filePath);
  const document = resolved.workspace.files.find((item) =>
    normalizePath(item.path) === normalized
  )?.document;
  if (!document) return [];

  const references: ConceptReference[] = [];
  for (const declaration of [...document.components, ...document.expands]) {
    const context = componentContext(
      resolved,
      normalized,
      declaration.kind,
      declaration.name,
    );
    if (!context) continue;
    for (const section of declaration.sections) {
      for (const block of section.concepts) {
        const localConcept = context.conceptNamespace.concepts.find((item) =>
          item.occurrences.some((occurrence) => occurrence.block === block)
        );
        const concept = localConcept &&
          (context.conceptNamespace.accessibleConcepts.find((item) =>
            conceptIdentityKey(item.identity) ===
              conceptIdentityKey(localConcept.identity)
          ) ?? localConcept);
        if (concept) {
          references.push({
            concept: conceptForHover(concept, context),
            context,
            sectionName: section.name,
            range: declarationNameRange(
              source,
              block.range.start.line,
              block.identifier,
            ),
          });
        }
      }
    }
  }

  for (const context of resolved.components) {
    for (const reference of context.conceptNamespace.references) {
      if (normalizePath(reference.filePath) !== normalized) continue;
      const concept = context.conceptNamespace.accessibleConcepts.find(
        (candidate) =>
          conceptIdentityKey(candidate.identity) ===
            conceptIdentityKey(reference.conceptIdentity),
      );
      if (concept) {
        references.push({
          concept: conceptForHover(concept, context),
          context,
          sectionName: reference.sectionName,
          range: sourceRangeToLsp(reference.range),
        });
      }
    }
  }
  return deduplicateConceptReferences(references);
}

function conceptForHover(
  concept: ResolvedConcept,
  context: ResolvedComponent,
): ResolvedConcept {
  const isContextualReuse = concept.identity.componentName !== context.name ||
    normalizePath(concept.identity.filePath) !==
      normalizePath(context.filePath);
  return isContextualReuse
    ? {
      ...concept,
      occurrences: concept.occurrences.filter((occurrence) =>
        occurrence.sectionName === "interface"
      ),
    }
    : concept;
}

function componentContext(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  kind: "component" | "expand",
  name: string,
): ResolvedComponent | undefined {
  const matches = resolved.components.filter((component) => {
    if (component.name !== name) return false;
    if (kind === "component") {
      return normalizePath(component.filePath) === filePath;
    }
    return component.expansions.expands.some((expansion) =>
      normalizePath(expansion.filePath) === filePath &&
      expansion.declaration.name === name
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function addVisibleComponent(
  visible: Map<string, ResolvedComponent | null>,
  component: ResolvedComponent,
): void {
  const existing = visible.get(component.name);
  if (existing === undefined) visible.set(component.name, component);
  else if (existing !== component) visible.set(component.name, null);
}

function importNamesRange(source: string, range: SourceRange): Range {
  const lineNumber = range.start.line - 1;
  const line = source.split(/\r?\n/)[lineNumber] ?? "";
  const start = line.indexOf("{");
  const end = start < 0 ? -1 : line.indexOf("}", start + 1);
  return start >= 0 && end >= 0
    ? {
      start: { line: lineNumber, character: start + 1 },
      end: { line: lineNumber, character: end },
    }
    : sourceRangeToLsp(range);
}

function identifierRanges(
  source: string,
  name: string,
  within: Range,
): readonly Range[] {
  if (within.start.line !== within.end.line) return [];
  const line = source.split(/\r?\n/)[within.start.line] ?? "";
  const ranges: Range[] = [];
  let start = within.start.character;
  while (start <= within.end.character - name.length) {
    const found = line.indexOf(name, start);
    if (found < 0 || found + name.length > within.end.character) break;
    const before = line[found - 1];
    const after = line[found + name.length];
    if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after)) {
      ranges.push({
        start: { line: within.start.line, character: found },
        end: { line: within.start.line, character: found + name.length },
      });
    }
    start = found + name.length;
  }
  return ranges;
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_-]/.test(value);
}

function deduplicateReferences(
  references: readonly ComponentReference[],
): readonly ComponentReference[] {
  const unique = new Map<string, ComponentReference>();
  for (const reference of references) {
    const key =
      `${reference.range.start.line}:${reference.range.start.character}:${reference.range.end.line}:${reference.range.end.character}`;
    if (!unique.has(key)) unique.set(key, reference);
  }
  return [...unique.values()];
}

function deduplicateConceptReferences(
  references: readonly ConceptReference[],
): readonly ConceptReference[] {
  const unique = new Map<string, ConceptReference>();
  for (const reference of references) {
    const key = `${rangeKey(reference.range)}:${
      conceptIdentityKey(reference.concept.identity)
    }`;
    if (!unique.has(key)) unique.set(key, reference);
  }
  return [...unique.values()];
}

function rangeKey(range: Range): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

function conceptIdentityKey(identity: ConceptIdentity): string {
  return `${
    normalizePath(identity.filePath)
  }::${identity.componentName}::${identity.normalizedIdentifier}`;
}

function compareRanges(left: Range, right: Range): number {
  return compare(left.start, right.start) || compare(left.end, right.end);
}

function sectionSymbol(section: Section, source: string): DocumentSymbol {
  return {
    name: section.name,
    kind: SYMBOL_PROPERTY,
    range: sourceRangeToLsp(section.range),
    selectionRange: {
      start: {
        line: section.range.start.line - 1,
        character: section.range.start.column - 1,
      },
      end: {
        line: section.range.start.line - 1,
        character: section.range.start.column - 1 + section.name.length,
      },
    },
    children: section.concepts.map((concept) => ({
      name: concept.identifier,
      detail: "concept",
      kind: SYMBOL_PROPERTY,
      range: sourceRangeToLsp(concept.range),
      selectionRange: declarationNameRange(
        source,
        concept.range.start.line,
        concept.identifier,
      ),
    })),
  };
}

function declarationNameRange(
  source: string,
  oneBasedLine: number,
  name: string,
): Range {
  const line = source.split(/\r?\n/)[oneBasedLine - 1] ?? "";
  const character = Math.max(0, line.indexOf(name));
  return {
    start: { line: oneBasedLine - 1, character },
    end: { line: oneBasedLine - 1, character: character + name.length },
  };
}

function tokenAt(
  source: string,
  position: Position,
): { readonly text: string; readonly range: Range } | null {
  const line = source.split(/\r?\n/)[position.line];
  if (
    line === undefined || position.character < 0 ||
    position.character > line.length
  ) {
    return null;
  }
  const isToken = (char: string): boolean => /[\p{L}\p{N}_@./#-]/u.test(char);
  let start = position.character;
  let end = position.character;
  while (start > 0 && isToken(line[start - 1])) start--;
  while (end < line.length && isToken(line[end])) end++;
  const text = line.slice(start, end).replace(/^@/, "");
  const range = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };
  return text && contains(range, position) ? { text, range } : null;
}

async function componentMarkdown(
  component: ResolvedComponent,
  includeExpansions: boolean,
  markdown: HoverMarkdownRenderer,
): Promise<string> {
  const goal = component.declaration.sections.find((item) =>
    item.name === "goal"
  );
  const iface = component.declaration.sections.find((item) =>
    item.name === "interface"
  );
  const componentLink = await markdown.componentLink(component);
  const lines = [
    `### component ${componentLink}`,
    "",
    `Source: \`${markdown.displayPath(component.filePath)}\``,
    "",
    "**Goal**",
    ...markdownList(await markdown.semanticUnits(goal?.units ?? [])),
    "",
    "**Interface**",
    ...markdownList(await markdown.semanticUnits(iface?.units ?? [])),
  ];
  if (includeExpansions && component.expansions.expands.length) {
    lines.push("", "**Collected expansions**");
    for (const expansion of component.expansions.expands) {
      lines.push("", `\`${markdown.displayPath(expansion.filePath)}\``);
      for (const section of expansion.declaration.sections) {
        const semanticUnits = await markdown.semanticUnits(section.units);
        lines.push(
          `- **${section.name}:** ${semanticUnits.join(" ")}`,
        );
      }
    }
  }
  const ownedImplementationLines = await markdown.ownedImplementationLines(
    component,
  );
  if (ownedImplementationLines.length) {
    lines.push("", ...ownedImplementationLines);
  }
  return lines.join("\n");
}

async function conceptDefinition(
  resolved: ResolvedSigilWorkspace,
  fs: SigilFileSystem,
  concept: ResolvedConcept,
): Promise<Location | null> {
  const origin = resolved.components.find((component) =>
    component.name === concept.identity.componentName &&
    normalizePath(component.filePath) ===
      normalizePath(concept.identity.filePath)
  );
  const resolvedConcept = origin?.conceptNamespace.concepts.find((item) =>
    conceptIdentityKey(item.identity) === conceptIdentityKey(concept.identity)
  );
  const occurrence =
    resolvedConcept?.occurrences.find((item) =>
      item.sectionName === "interface"
    ) ?? resolvedConcept?.occurrences[0];
  if (!occurrence) return null;
  const source = await fs.readTextFile(occurrence.filePath);
  return {
    uri: pathToFileUri(occurrence.filePath),
    range: declarationNameRange(
      source,
      occurrence.block.range.start.line,
      occurrence.block.identifier,
    ),
  };
}

async function conceptMarkdown(
  reference: ConceptReference,
  markdown: HoverMarkdownRenderer,
): Promise<string> {
  const identity = reference.concept.identity;
  const conceptLink = await markdown.conceptLink(reference.concept);
  const origin = reference.context.name === identity.componentName &&
      normalizePath(reference.context.filePath) ===
        normalizePath(identity.filePath)
    ? reference.context
    : markdown.component(identity.componentName, identity.filePath);
  const originLink = origin
    ? await markdown.componentLink(origin)
    : `\`${identity.componentName}\``;
  const lines = [
    `### concept ${conceptLink}`,
    "",
    `Origin: ${originLink} in \`${markdown.displayPath(identity.filePath)}\``,
  ];
  for (const occurrence of reference.concept.occurrences) {
    const semanticUnits = await markdown.semanticUnits(occurrence.block.units);
    const occurrenceComponent = markdown.component(
      occurrence.componentName,
      occurrence.filePath,
    );
    const occurrenceComponentLink = occurrenceComponent
      ? await markdown.componentLink(occurrenceComponent)
      : `\`${occurrence.componentName}\``;
    lines.push(
      "",
      `**${occurrence.sectionName}** — ${occurrenceComponentLink} in \`${
        markdown.displayPath(occurrence.filePath)
      }\``,
      ...markdownList(semanticUnits),
    );
  }
  return lines.join("\n");
}

interface HoverLinkReference {
  readonly range: Range;
  readonly target: Location;
}

class HoverMarkdownRenderer {
  readonly #resolved: ResolvedSigilWorkspace;
  readonly #fs: SigilFileSystem;
  readonly #ownership: OwnershipHoverCache;
  readonly #sources = new Map<string, Promise<string>>();
  readonly #references = new Map<
    string,
    Promise<readonly HoverLinkReference[]>
  >();

  constructor(
    resolved: ResolvedSigilWorkspace,
    fs: SigilFileSystem,
    ownership: OwnershipHoverCache,
  ) {
    this.#resolved = resolved;
    this.#fs = fs;
    this.#ownership = ownership;
  }

  displayPath(filePath: string): string {
    return relativePath(this.#resolved.workspace.root, filePath);
  }

  component(
    name: string,
    filePath: string,
  ): ResolvedComponent | undefined {
    const normalized = normalizePath(filePath);
    return this.#resolved.components.find((component) =>
      component.name === name &&
      (
        normalizePath(component.filePath) === normalized ||
        component.expansions.expands.some((expansion) =>
          normalizePath(expansion.filePath) === normalized
        )
      )
    );
  }

  async componentLink(component: ResolvedComponent): Promise<string> {
    const source = await this.#source(component.filePath);
    return markdownLink(component.name, {
      uri: pathToFileUri(component.filePath),
      range: declarationNameRange(
        source,
        component.declaration.range.start.line,
        component.name,
      ),
    });
  }

  async conceptLink(concept: ResolvedConcept): Promise<string> {
    const target = await conceptDefinition(this.#resolved, this.#fs, concept);
    return target
      ? markdownLink(concept.identifier, target)
      : `\`${concept.identifier}\``;
  }

  // @sigil implements packages/lsp/_module.sigil::SigilLsp::NavigationAndInspection interface,logic,constraints,cases
  async ownedImplementationLines(
    component: ResolvedComponent,
    conceptName?: string,
    sectionName?: ImplementationSection,
  ): Promise<string[]> {
    if (conceptName && !sectionName) return [];
    const projection = await this.#ownership.projection(
      component.name,
      conceptName,
      sectionName,
    );
    if (!projection || projection.targets.length === 0) return [];

    const lines = ["**Owned implementations**"];
    for (const target of projection.targets) {
      lines.push(`- ${this.#ownedImplementationTargetLine(target)}`);
    }
    return lines;
  }

  async semanticUnits(units: readonly SemanticUnit[]): Promise<string[]> {
    return await Promise.all(units.map((unit) => this.semanticUnit(unit)));
  }

  async semanticUnit(unit: SemanticUnit): Promise<string> {
    const allReferences = await this.#referencesFor(unit.filePath);
    const rendered: string[] = [];
    for (let offset = 0; offset < unit.sourceLines.length; offset++) {
      const sourceLine = unit.sourceLines[offset];
      const content = sourceLine.trim();
      const contentColumn = sourceLine.indexOf(content);
      const lineNumber = unit.range.start.line - 1 + offset;
      const lineRange = {
        start: { line: lineNumber, character: contentColumn },
        end: { line: lineNumber, character: contentColumn + content.length },
      };
      const references = allReferences
        .filter((reference) => containsRange(lineRange, reference.range))
        .sort((left, right) => compareRanges(right.range, left.range));
      let result = content;
      for (const reference of references) {
        const start = reference.range.start.character -
          lineRange.start.character;
        const end = reference.range.end.character - lineRange.start.character;
        if (start < 0 || end > result.length || start >= end) continue;
        const label = result.slice(start, end);
        result = `${result.slice(0, start)}${
          markdownLink(label, reference.target)
        }${result.slice(end)}`;
      }
      rendered.push(result);
    }
    for (const literal of unit.literalBlocks) {
      rendered.push(
        `\n\`\`\`${literal.type ?? ""}\n${literal.body}\n\`\`\``,
      );
    }
    return rendered.join(" ");
  }

  #source(filePath: string): Promise<string> {
    const normalized = normalizePath(filePath);
    let source = this.#sources.get(normalized);
    if (!source) {
      source = this.#fs.readTextFile(normalized);
      this.#sources.set(normalized, source);
    }
    return source;
  }

  #referencesFor(filePath: string): Promise<readonly HoverLinkReference[]> {
    const normalized = normalizePath(filePath);
    let references = this.#references.get(normalized);
    if (!references) {
      references = this.#resolveReferences(normalized);
      this.#references.set(normalized, references);
    }
    return references;
  }

  async #resolveReferences(
    filePath: string,
  ): Promise<readonly HoverLinkReference[]> {
    const source = await this.#source(filePath);
    const byRange = new Map<string, HoverLinkReference>();
    for (
      const reference of componentReferences(
        this.#resolved,
        filePath,
        source,
      )
    ) {
      const targetSource = await this.#source(reference.component.filePath);
      byRange.set(rangeKey(reference.range), {
        range: reference.range,
        target: {
          uri: pathToFileUri(reference.component.filePath),
          range: declarationNameRange(
            targetSource,
            reference.component.declaration.range.start.line,
            reference.component.name,
          ),
        },
      });
    }
    for (
      const reference of conceptReferences(
        this.#resolved,
        filePath,
        source,
      )
    ) {
      const target = await conceptDefinition(
        this.#resolved,
        this.#fs,
        reference.concept,
      );
      if (target) {
        byRange.set(rangeKey(reference.range), {
          range: reference.range,
          target,
        });
      }
    }
    return [...byRange.values()];
  }

  #ownedImplementationTargetLine(
    target: OwnedImplementationTarget,
  ): string {
    const absoluteFilePath = workspaceRelativeToAbsolute(
      this.#resolved.workspace.root,
      target.filePath,
    );
    const fileLabel = relativePath(
      this.#resolved.workspace.root,
      absoluteFilePath,
    );
    const label = target.symbolIdentity
      ? `${target.symbolIdentity} · ${fileLabel}`
      : fileLabel;
    return `${target.relation} ${
      markdownLink(label, location(absoluteFilePath, target.range))
    } (${target.sections.join(", ")})`;
  }
}

function implementationSection(
  sectionName: SigilSectionName,
): ImplementationSection | undefined {
  return sectionName === "interface" ||
      sectionName === "state" ||
      sectionName === "logic" ||
      sectionName === "constraints" ||
      sectionName === "cases"
    ? sectionName
    : undefined;
}

async function implementationSources(
  workspaceRoot: string,
  fs: SigilFileSystem,
): Promise<readonly ImplementationSource[]> {
  const paths = (await fs.listFiles(workspaceRoot))
    .filter(isSupportedImplementationSource);
  const sources: ImplementationSource[] = [];
  for (const filePath of paths) {
    try {
      sources.push({ filePath, text: await fs.readTextFile(filePath) });
    } catch {
      // A file can disappear between listing and hover; omit that stale entry.
    }
  }
  return sources;
}

function locationMarkdownUri(location: Location): string {
  return `${location.uri}#L${location.range.start.line + 1},${
    location.range.start.character + 1
  }`;
}

function markdownLink(label: string, location: Location): string {
  return `[${label}](${locationMarkdownUri(location)})`;
}

function glossaryMarkdown(reference: GlossaryReference): string {
  const scope = reference.term.scope.kind === "context"
    ? `Bounded context: \`${reference.term.scope.id}\``
    : "Scope: workspace";
  const lines = [
    `### term ${reference.term.term}`,
    "",
    reference.term.definition,
    "",
    scope,
  ];
  if (reference.matchedSpelling !== reference.term.term) {
    lines.push(
      "",
      `Matched alias: \`${reference.matchedSpelling}\``,
    );
  }
  return lines.join("\n");
}

function markdownList(lines: readonly string[]): string[] {
  return lines.length ? lines.map((line) => `- ${line}`) : ["- none"];
}

function location(filePath: string, range?: SourceRange): Location {
  return { uri: pathToFileUri(filePath), range: sourceRangeToLsp(range) };
}

function workspaceRelativeToAbsolute(
  workspaceRoot: string,
  filePath: string,
): string {
  const normalized = normalizePath(filePath);
  if (/^(?:[A-Za-z]:[\\/]|\/)/.test(normalized)) return normalized;
  return normalizePath(`${normalizePath(workspaceRoot)}/${normalized}`);
}

function contains(range: Range, position: Position): boolean {
  return compare(range.start, position) <= 0 &&
    compare(position, range.end) < 0;
}

function containsRange(outer: Range, inner: Range): boolean {
  return compare(outer.start, inner.start) <= 0 &&
    compare(inner.end, outer.end) <= 0;
}

function overlaps(left: Range, right: Range): boolean {
  return compare(left.start, right.end) < 0 &&
    compare(right.start, left.end) < 0;
}

function compare(left: Position, right: Position): number {
  return left.line === right.line
    ? left.character - right.character
    : left.line - right.line;
}

function zeroRange(): Range {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };
}
