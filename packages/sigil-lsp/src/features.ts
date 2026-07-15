import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
  Section,
  SigilDiagnostic,
  SigilDocument,
  SigilFileSystem,
  SourceRange,
} from "@sigil/core";
import { normalizePath } from "@sigil/core";
import { pathToFileUri } from "./filesystem.ts";
import type {
  DocumentSymbol,
  Hover,
  Location,
  Position,
  PublishDiagnosticsParams,
  Range,
} from "./types.ts";

const SYMBOL_NAMESPACE = 3;
const SYMBOL_CLASS = 5;
const SYMBOL_PROPERTY = 7;

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

  const local = resolved.workspace.files.find((item) =>
    normalizePath(item.path) === normalized
  )?.document;
  const expand = local?.expands.find((item) =>
    item.name === token.text &&
    contains(sourceRangeToLsp(item.range), position)
  );
  if (expand) {
    const component = resolved.components.find((item) =>
      item.name === expand.name
    );
    return component
      ? location(component.filePath, component.declaration.range)
      : null;
  }
  const component = resolved.components.find((item) =>
    item.name === token.text && normalizePath(item.filePath) === normalized
  );
  return component
    ? location(component.filePath, component.declaration.range)
    : null;
}

export async function hoverAt(
  resolved: ResolvedSigilWorkspace,
  fs: SigilFileSystem,
  filePath: string,
  position: Position,
): Promise<Hover | null> {
  const source = await fs.readTextFile(filePath);
  const token = tokenAt(source, position);
  if (!token) return null;
  const component = resolved.components.find((item) =>
    item.name === token.text
  );
  if (!component) return null;
  return {
    contents: { kind: "markdown", value: componentMarkdown(component) },
    range: token.range,
  };
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
