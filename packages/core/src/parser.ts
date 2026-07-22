import { diagnostic } from "./diagnostics.ts";
import type {
  ComponentDeclaration,
  ConceptBlock,
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
import { isModuleFile } from "./path.ts";

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
  concepts: ConceptBlock[];
  ungroupedLines: SemanticLine[];
  freeformBraceDepth: number;
}

interface ConceptDraft {
  identifier: string;
  startLine: number;
  lines: SemanticLine[];
  braceDepth: number;
}

const CONCEPT_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PREFERRED_CONCEPT_IDENTIFIER = /^[A-Z][A-Za-z0-9]*$/;

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
  let concept: ConceptDraft | undefined;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index];
    const trimmed = line.trim();

    if (section && form) {
      if (concept) {
        if (trimmed === "}" && concept.braceDepth === 1) {
          finishConcept(
            section,
            concept,
            lineNumber,
            line.length,
            filePath,
            diagnostics,
          );
          concept = undefined;
          continue;
        }

        if (concept.braceDepth === 1 && conceptHeader(trimmed)) {
          diagnostics.push(diagnostic(
            "SIGIL_NESTED_CONCEPT_BLOCK",
            "Concept blocks cannot nest.",
            { filePath, range: lineRange(lineNumber, line) },
          ));
        }

        if (trimmed.length > 0 && trimmed !== "}") {
          const semanticLine = makeSemanticLine(
            filePath,
            lineNumber,
            line,
            form,
            section.name,
            concept.identifier,
          );
          section.lines.push(semanticLine);
          concept.lines.push(semanticLine);
        }

        concept.braceDepth += braceDelta(line);
        continue;
      }

      if (trimmed === "}" && section.freeformBraceDepth === 0) {
        reportUngroupedInterfaceRegion(section, filePath, diagnostics);
        form.sections.push(finishSection(section, lineNumber, line.length));
        section = undefined;
        continue;
      }

      const header = section.freeformBraceDepth === 0
        ? conceptHeader(trimmed)
        : undefined;
      if (header) {
        reportUngroupedInterfaceRegion(section, filePath, diagnostics);
        const identifier = header.identifier;
        if (!CONCEPT_IDENTIFIER.test(identifier)) {
          diagnostics.push(diagnostic(
            "SIGIL_INVALID_CONCEPT_IDENTIFIER",
            `Invalid concept identifier ${
              JSON.stringify(identifier)
            }; expected [A-Za-z][A-Za-z0-9_-]* with no spaces.`,
            { filePath, range: lineRange(lineNumber, line) },
          ));
        } else if (!PREFERRED_CONCEPT_IDENTIFIER.test(identifier)) {
          diagnostics.push(diagnostic(
            "SIGIL_CONCEPT_IDENTIFIER_STYLE",
            `Concept identifier ${identifier} is valid; prefer PascalCase without hyphens or underscores.`,
            {
              severity: "info",
              filePath,
              range: identifierRange(lineNumber, line, identifier),
            },
          ));
        }
        concept = {
          identifier,
          startLine: lineNumber,
          lines: [],
          braceDepth: 1,
        };
        continue;
      }

      if (trimmed.length > 0) {
        const semanticLine = makeSemanticLine(
          filePath,
          lineNumber,
          line,
          form,
          section.name,
        );
        section.lines.push(semanticLine);
        section.ungroupedLines.push(semanticLine);
        section.freeformBraceDepth += braceDelta(line);
      }
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
            concepts: [],
            ungroupedLines: [],
            freeformBraceDepth: 0,
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

  if (concept && section && form) {
    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      `Unclosed concept ${concept.identifier}.`,
      { filePath, range: singlePointRange(concept.startLine) },
    ));
    finishConcept(
      section,
      concept,
      lines.length,
      lines.at(-1)?.length ?? 1,
      filePath,
      diagnostics,
    );
    concept = undefined;
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
    reportUngroupedInterfaceRegion(section, filePath, diagnostics);
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

  if (isModuleFile(filePath) && components.length === 0) {
    diagnostics.push(diagnostic(
      "SIGIL_MODULE_WITHOUT_COMPONENT",
      "#module.sigil must declare at least one component.",
      { filePath },
    ));
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
    concepts: section.concepts,
  };
}

function finishConcept(
  section: SectionDraft,
  concept: ConceptDraft,
  endLine: number,
  endColumn: number,
  filePath: string,
  diagnostics: SigilDiagnostic[],
): void {
  const range = {
    start: { line: concept.startLine, column: 1 },
    end: { line: endLine, column: Math.max(1, endColumn + 1) },
  };
  if (concept.lines.length === 0) {
    diagnostics.push(diagnostic(
      "SIGIL_EMPTY_CONCEPT_BLOCK",
      `Concept block ${concept.identifier} must contain at least one semantic line.`,
      { filePath, range },
    ));
  }
  section.concepts.push({
    identifier: concept.identifier,
    range,
    bodyRange: {
      start: { line: concept.startLine + 1, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    lines: concept.lines,
  });
}

function reportUngroupedInterfaceRegion(
  section: SectionDraft,
  filePath: string,
  diagnostics: SigilDiagnostic[],
): void {
  if (section.name !== "interface" || section.ungroupedLines.length === 0) {
    section.ungroupedLines = [];
    return;
  }
  const first = section.ungroupedLines[0];
  const last = section.ungroupedLines.at(-1)!;
  diagnostics.push(diagnostic(
    "SIGIL_MISSING_CONCEPT_IDENTIFIER",
    "Interface content should be grouped under one or more concept identifiers.",
    {
      severity: "warning",
      filePath,
      range: { start: first.range.start, end: last.range.end },
    },
  ));
  section.ungroupedLines = [];
}

function conceptHeader(
  trimmed: string,
): { readonly identifier: string } | undefined {
  const match = trimmed.match(/^(.+?)\s*\{\s*$/);
  if (!match || trimmed.startsWith("@")) return undefined;
  const identifier = match[1].trim();
  if (/[=:()\[\]<>"'`]/.test(identifier)) return undefined;
  return { identifier };
}

function makeSemanticLine(
  filePath: string,
  lineNumber: number,
  line: string,
  form: FormDraft,
  sectionName: SigilSectionName,
  conceptIdentifier?: string,
): SemanticLine {
  return {
    filePath,
    range: lineRange(lineNumber, line),
    ownerKind: form.kind,
    ownerName: form.name,
    sectionName,
    conceptIdentifier,
    text: line.trim(),
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

function identifierRange(
  lineNumber: number,
  line: string,
  identifier: string,
): SourceRange {
  const start = Math.max(0, line.indexOf(identifier));
  return {
    start: { line: lineNumber, column: start + 1 },
    end: { line: lineNumber, column: start + identifier.length + 1 },
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
