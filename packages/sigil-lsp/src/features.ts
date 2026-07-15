import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
  Section,
  SigilDiagnostic,
  SigilDocument,
  SigilFileSystem,
  SourceRange,
} from "@qoherent/core";
import { normalizePath } from "@qoherent/core";
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
const SEMANTIC_TOKEN_TYPE = 0;

interface ComponentReference {
  readonly component: ResolvedComponent;
  readonly range: Range;
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
        : 3,
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
      children: declaration.sections.map(sectionSymbol),
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
      children: declaration.sections.map(sectionSymbol),
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
    if (imported?.component && importEntry.targetFile) {
      return location(importEntry.targetFile, imported.component.range);
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
  const reference = componentReferences(resolved, normalized, source).find(
    (item) => contains(item.range, position),
  );
  if (!reference) return null;
  return {
    contents: {
      kind: "markdown",
      value: componentMarkdown(reference.component),
    },
    range: reference.range,
  };
}

export function semanticTokens(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  source: string,
): SemanticTokens {
  const references = componentReferences(resolved, filePath, source)
    .map((item) => item.range)
    .sort(compareRanges);
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const range of references) {
    if (range.start.line !== range.end.line) continue;
    const deltaLine = range.start.line - previousLine;
    const deltaCharacter = deltaLine === 0
      ? range.start.character - previousCharacter
      : range.start.character;
    data.push(
      deltaLine,
      deltaCharacter,
      range.end.character - range.start.character,
      SEMANTIC_TOKEN_TYPE,
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
      if (!name.component || !imported.targetFile) continue;
      const component = resolved.components.find((item) =>
        item.declaration === name.component &&
        normalizePath(item.filePath) === normalizePath(imported.targetFile!)
      );
      if (!component) continue;
      addVisibleComponent(visible, component);
      for (const range of identifierRanges(source, name.name, namesRange)) {
        references.push({ component, range });
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
        references.push({ component, range });
      }
    }
  }

  return deduplicateReferences(references);
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
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
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

function compareRanges(left: Range, right: Range): number {
  return compare(left.start, right.start) || compare(left.end, right.end);
}

function sectionSymbol(section: Section): DocumentSymbol {
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

function componentMarkdown(component: ResolvedComponent): string {
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
  if (component.expansions.expands.length) {
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
