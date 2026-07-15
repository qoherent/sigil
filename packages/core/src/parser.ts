import { diagnostic } from "./diagnostics.ts";
import type {
  ComponentDeclaration,
  ExpandDeclaration,
  ImportDeclaration,
  ParseOptions,
  ParseResult,
  Section,
  SemanticLine,
  SigilDiagnostic,
  SigilDocument,
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./model.ts";
import { SIGIL_VERSION } from "./model.ts";

const SECTION_NAMES = new Set<SigilSectionName>([
  "goal",
  "interface",
  "state",
  "logic",
  "constraints",
  "cases",
]);

interface FormDraft {
  kind: SigilFormKind;
  name: string;
  startLine: number;
  sections: Section[];
}

interface SectionDraft {
  name: SigilSectionName;
  startLine: number;
  lines: SemanticLine[];
  braceDepth: number;
}

export function parseSigilDocument(
  filePath: string,
  source: string,
  options: ParseOptions,
): ParseResult {
  const diagnostics: SigilDiagnostic[] = [];
  const imports: ImportDeclaration[] = [];
  const components: ComponentDeclaration[] = [];
  const expands: ExpandDeclaration[] = [];
  const lines = source.split(/\r?\n/);

  if (options.sigilVersion !== SIGIL_VERSION) {
    const unsupported = diagnostic(
      "SIGIL_UNSUPPORTED_VERSION",
      `Unsupported sigilVersion ${
        JSON.stringify(options.sigilVersion)
      }; supported version is ${SIGIL_VERSION}.`,
      { filePath },
    );
    const document: SigilDocument = {
      filePath,
      imports: [],
      components: [],
      expands: [],
      diagnostics: [unsupported],
    };
    return { document, diagnostics: [unsupported] };
  }

  let form: FormDraft | undefined;
  let section: SectionDraft | undefined;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index];
    const trimmed = line.trim();

    if (section && form) {
      if (trimmed === "}" && section.braceDepth === 1) {
        form.sections.push(finishSection(section, lineNumber, line.length));
        section = undefined;
        continue;
      }

      if (trimmed.length > 0) {
        section.lines.push({
          filePath,
          range: lineRange(lineNumber, line),
          ownerKind: form.kind,
          ownerName: form.name,
          sectionName: section.name,
          text: trimmed,
        });
      }

      section.braceDepth += braceDelta(line);
      continue;
    }

    if (form) {
      if (trimmed === "}") {
        const declaration = finishForm(form, lineNumber, line.length);
        if (declaration.kind === "component") components.push(declaration);
        else expands.push(declaration);
        form = undefined;
        continue;
      }

      const sectionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\{\s*$/);
      if (sectionMatch) {
        const sectionName = sectionMatch[1];
        if (SECTION_NAMES.has(sectionName as SigilSectionName)) {
          section = {
            name: sectionName as SigilSectionName,
            startLine: lineNumber,
            lines: [],
            braceDepth: 1,
          };
        } else {
          diagnostics.push(diagnostic(
            "SIGIL_UNKNOWN_SECTION",
            `Unknown section "${sectionName}".`,
            { filePath, range: lineRange(lineNumber, line) },
          ));
        }
        continue;
      }

      if (trimmed.length > 0) {
        diagnostics.push(diagnostic(
          "SIGIL_PARSE_STRUCTURE",
          `Unexpected content inside ${form.kind} ${form.name}.`,
          { filePath, range: lineRange(lineNumber, line) },
        ));
      }
      continue;
    }

    if (trimmed.length === 0) continue;

    const importMatch = trimmed.match(
      /^@(.+?)\s+import\s+\{\s*([^}]+?)\s*\}\s*$/,
    );
    if (importMatch) {
      imports.push({
        path: importMatch[1].trim(),
        names: importMatch[2].split(",").map((name) => name.trim()).filter(
          Boolean,
        ),
        range: lineRange(lineNumber, line),
      });
      continue;
    }

    const formMatch = trimmed.match(
      /^(component|expand)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{\s*$/,
    );
    if (formMatch) {
      form = {
        kind: formMatch[1] as SigilFormKind,
        name: formMatch[2],
        startLine: lineNumber,
        sections: [],
      };
      continue;
    }

    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      "Unexpected top-level content.",
      { filePath, range: lineRange(lineNumber, line) },
    ));
  }

  if (section && form) {
    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      `Unclosed section ${section.name}.`,
      { filePath, range: singlePointRange(section.startLine) },
    ));
    form.sections.push(
      finishSection(section, lines.length, lines.at(-1)?.length ?? 1),
    );
  }

  if (form) {
    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      `Unclosed ${form.kind} ${form.name}.`,
      { filePath, range: singlePointRange(form.startLine) },
    ));
    const declaration = finishForm(
      form,
      lines.length,
      lines.at(-1)?.length ?? 1,
    );
    if (declaration.kind === "component") components.push(declaration);
    else expands.push(declaration);
  }

  for (const component of components) {
    const sectionNames = new Set(component.sections.map((item) => item.name));
    if (!sectionNames.has("goal")) {
      diagnostics.push(diagnostic(
        "SIGIL_MISSING_GOAL",
        `component ${component.name} is missing required goal section.`,
        { filePath, range: component.range },
      ));
    }
    if (!sectionNames.has("interface")) {
      diagnostics.push(diagnostic(
        "SIGIL_MISSING_INTERFACE",
        `component ${component.name} is missing required interface section.`,
        { filePath, range: component.range },
      ));
    }
  }

  const document: SigilDocument = {
    filePath,
    imports,
    components,
    expands,
    diagnostics,
  };

  return { document, diagnostics };
}

function finishSection(
  section: SectionDraft,
  endLine: number,
  endColumn: number,
): Section {
  return {
    name: section.name,
    range: {
      start: { line: section.startLine, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    bodyRange: {
      start: { line: section.startLine + 1, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    lines: section.lines,
  };
}

function finishForm(
  form: FormDraft,
  endLine: number,
  endColumn: number,
): ComponentDeclaration | ExpandDeclaration {
  const base = {
    name: form.name,
    range: {
      start: { line: form.startLine, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    sections: form.sections,
  };
  return form.kind === "component"
    ? { kind: "component", ...base }
    : { kind: "expand", ...base };
}

function lineRange(lineNumber: number, line: string): SourceRange {
  return {
    start: { line: lineNumber, column: firstColumn(line) },
    end: { line: lineNumber, column: line.length + 1 },
  };
}

function singlePointRange(lineNumber: number): SourceRange {
  return {
    start: { line: lineNumber, column: 1 },
    end: { line: lineNumber, column: 1 },
  };
}

function firstColumn(line: string): number {
  const match = line.match(/\S/);
  return match ? match.index! + 1 : 1;
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const char of line) {
    if (char === "{") delta++;
    if (char === "}") delta--;
  }
  return delta;
}
