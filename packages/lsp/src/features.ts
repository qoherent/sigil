import type {
  ResolvedComponent,
  ResolvedConcept,
  ResolvedSigilWorkspace,
  Section,
  SigilDiagnostic,
  SigilDocument,
  SigilFileSystem,
  SourceRange,
} from "@qoherent/sigil-core";
import { normalizePath } from "@qoherent/sigil-core";
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

interface ComponentReference {
  readonly component: ResolvedComponent;
  readonly range: Range;
  readonly includeExpansions: boolean;
}

interface ConceptReference {
  readonly concept: ResolvedConcept;
  readonly context: ResolvedComponent;
  readonly range: Range;
}

interface SemanticReference {
  readonly range: Range;
  readonly tokenType: number;
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

export async function hoverAt(
  resolved: ResolvedSigilWorkspace,
  fs: SigilFileSystem,
  filePath: string,
  position: Position,
): Promise<Hover | null> {
  const source = await fs.readTextFile(filePath);
  const normalized = normalizePath(filePath);
  const conceptReference = conceptReferences(
    resolved,
    normalized,
    source,
  ).find((item) => contains(item.range, position));
  if (conceptReference) {
    return {
      contents: {
        kind: "markdown",
        value: conceptMarkdown(conceptReference),
      },
      range: conceptReference.range,
    };
  }
  const reference = componentReferences(resolved, normalized, source).find(
    (item) => contains(item.range, position),
  );
  if (!reference) return null;
  return {
    contents: {
      kind: "markdown",
      value: componentMarkdown(
        reference.component,
        reference.includeExpansions,
      ),
    },
    range: reference.range,
  };
}

export function semanticTokens(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  source: string,
): SemanticTokens {
  const byRange = new Map<string, SemanticReference>();
  for (const item of componentReferences(resolved, filePath, source)) {
    byRange.set(rangeKey(item.range), {
      range: item.range,
      tokenType: SEMANTIC_TOKEN_COMPONENT,
    });
  }
  for (const item of conceptReferences(resolved, filePath, source)) {
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

  const semanticLines = [
    ...document.components,
    ...document.expands,
  ].flatMap((declaration) =>
    declaration.sections.flatMap((section) => section.lines)
  );
  for (const line of semanticLines) {
    const lineRange = sourceRangeToLsp(line.range);
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
        const concept = context.conceptNamespace.concepts.find((item) =>
          item.occurrences.some((occurrence) => occurrence.block === block)
        );
        if (concept) {
          references.push({
            concept,
            context,
            range: declarationNameRange(
              source,
              block.range.start.line,
              block.identifier,
            ),
          });
        }
      }
      for (const line of section.lines) {
        const lineRange = sourceRangeToLsp(line.range);
        for (
          const accessible of unambiguousConcepts(
            context.conceptNamespace.accessibleConcepts,
          )
        ) {
          for (
            const range of identifierRanges(
              source,
              accessible.identifier,
              lineRange,
            )
          ) {
            references.push({ concept: accessible, context, range });
          }
        }
      }
    }
  }
  return deduplicateConceptReferences(references);
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

function unambiguousConcepts(
  concepts: readonly ResolvedConcept[],
): readonly ResolvedConcept[] {
  const grouped = new Map<string, ResolvedConcept[]>();
  for (const concept of concepts) {
    const key = concept.identity.normalizedIdentifier;
    const items = grouped.get(key) ?? [];
    items.push(concept);
    grouped.set(key, items);
  }
  return [...grouped.values()].flatMap((items) => {
    const identities = new Map(
      items.map((item) => [conceptIdentityKey(item), item]),
    );
    return identities.size === 1 ? [[...identities.values()][0]] : [];
  });
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
      conceptIdentityKey(reference.concept)
    }`;
    if (!unique.has(key)) unique.set(key, reference);
  }
  return [...unique.values()];
}

function rangeKey(range: Range): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

function conceptIdentityKey(concept: ResolvedConcept): string {
  return `${
    normalizePath(concept.identity.filePath)
  }::${concept.identity.componentName}::${concept.identity.normalizedIdentifier}`;
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
  const isToken = (char: string): boolean => /[A-Za-z0-9_@./#-]/.test(char);
  let start = position.character;
  let end = position.character;
  while (start > 0 && isToken(line[start - 1])) start--;
  while (end < line.length && isToken(line[end])) end++;
  const text = line.slice(start, end).replace(/^@/, "");
  return text
    ? {
      text,
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    }
    : null;
}

function componentMarkdown(
  component: ResolvedComponent,
  includeExpansions: boolean,
): string {
  const goal = component.declaration.sections.find((item) =>
    item.name === "goal"
  );
  const iface = component.declaration.sections.find((item) =>
    item.name === "interface"
  );
  const lines = [
    `### component ${component.name}`,
    "",
    `Source: \`${component.filePath}\``,
    "",
    "**Goal**",
    ...markdownList(goal?.lines.map((item) => item.text) ?? []),
    "",
    "**Interface**",
    ...markdownList(iface?.lines.map((item) => item.text) ?? []),
  ];
  if (includeExpansions && component.expansions.expands.length) {
    lines.push("", "**Collected expansions**");
    for (const expansion of component.expansions.expands) {
      lines.push("", `\`${expansion.filePath}\``);
      for (const section of expansion.declaration.sections) {
        lines.push(
          `- **${section.name}:** ${
            section.lines.map((item) => item.text).join(" ")
          }`,
        );
      }
    }
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
    conceptIdentityKey(item) === conceptIdentityKey(concept)
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

function conceptMarkdown(reference: ConceptReference): string {
  const identity = reference.concept.identity;
  const lines = [
    `### concept ${reference.concept.identifier}`,
    "",
    `Origin: \`${identity.componentName}\` in \`${identity.filePath}\``,
  ];
  for (const occurrence of reference.concept.occurrences) {
    lines.push(
      "",
      `**${occurrence.sectionName}** — \`${occurrence.filePath}\``,
      ...markdownList(occurrence.block.lines.map((item) => item.text)),
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

function contains(range: Range, position: Position): boolean {
  return compare(range.start, position) <= 0 &&
    compare(position, range.end) <= 0;
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
