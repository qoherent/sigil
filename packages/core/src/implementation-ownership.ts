import { componentFacetsFor } from "./projections.ts";
import { validTagName } from "./inline-content.ts";
import {
  compareScalarText,
  diagnostic,
  orderDiagnostics,
} from "./diagnostics.ts";
import { normalizeImportPath, normalizePath } from "./path.ts";
import type {
  ComponentIdentity,
  ImplementationArtifactKind,
  ImplementationRelation,
  ImplementationSection,
  ImplementationSource,
  OwnedImplementationProjection,
  OwnedImplementationTarget,
} from "./model/ownership.ts";
import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
} from "./model/resolution.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import type { ImplementationRange } from "./model/language.ts";

const IMPLEMENTATION_RELATIONS: ReadonlySet<ImplementationRelation> = new Set([
  "implements",
  "uses",
  "tests",
]);
const IMPLEMENTATION_SECTIONS: ReadonlySet<ImplementationSection> = new Set([
  "interface",
  "state",
  "logic",
  "constraints",
  "cases",
]);

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown"];
const HASH_COMMENT_EXTENSIONS = new Set([".py", ".rb", ".sh", ".bash", ".zsh"]);
const SLASH_COMMENT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".cts",
  ".cxx",
  ".dart",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".rs",
  ".scala",
  ".swift",
  ".ts",
  ".tsx",
]);
const MARKUP_COMMENT_EXTENSIONS = new Set([
  ".gohtml",
  ".htm",
  ".html",
  ".tmpl",
]);
const STYLE_COMMENT_EXTENSIONS = new Set([
  ".css",
  ".less",
  ".sass",
  ".scss",
]);
const COMPONENT_FILE_EXTENSIONS = new Set([".astro", ".svelte", ".vue"]);
// Markup families whose own comment form is stripped before rendering.
const TEMPLATE_COMMENT_EXTENSIONS = new Set([".gohtml", ".tmpl"]);
const SUPPORTED_IMPLEMENTATION_SOURCE_GLOB_PATTERNS = Object.freeze([
  ...MARKDOWN_EXTENSIONS,
  ...HASH_COMMENT_EXTENSIONS,
  ...SLASH_COMMENT_EXTENSIONS,
  ...MARKUP_COMMENT_EXTENSIONS,
  ...STYLE_COMMENT_EXTENSIONS,
  ...COMPONENT_FILE_EXTENSIONS,
].map((extension) => `**/*${extension}`));

interface ParsedAnnotation {
  readonly relation: ImplementationRelation;
  readonly sigilPath: string;
  readonly componentName: string;
  readonly tagName?: string;
  readonly sectionNames: readonly string[];
}

type CommentSyntax = "slash" | "hash" | "markup" | "style";

/**
 * `symbol` requires an adjacent entrypoint definition, `file` never resolves
 * one, and `optional-symbol` prefers an adjacent entrypoint but falls back to
 * the containing file when a region has no exported definition to attach to.
 */
type AnnotationBinding = "symbol" | "optional-symbol" | "file";

interface RawComment {
  readonly kind: "line" | "multiline" | "markup";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface CommentBlock extends RawComment {
  readonly binding: AnnotationBinding;
}

interface SourceRegion {
  readonly syntax: CommentSyntax;
  readonly binding: AnnotationBinding;
  readonly start: number;
  readonly end: number;
}

interface Entrypoint {
  readonly identity: string;
  readonly range: ImplementationRange;
}

interface EntrypointMatch {
  readonly name: string;
  readonly offset: number;
}

/*
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::OwnedImplementationLookup interface
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership logic,constraints,cases
 */
export function ownedImplementationTargetsFor(
  resolved: ResolvedSigilWorkspace,
  implementationSources: readonly ImplementationSource[],
  componentIdentity: ComponentIdentity,
  tagName?: string,
  sectionName?: ImplementationSection,
): OwnedImplementationProjection | undefined {
  const componentName = componentIdentity.componentName;
  const owningComponent = resolved.components.find((component) =>
    component.identity && component.name === componentName &&
    relativeToWorkspace(resolved, component.filePath) ===
      componentIdentity.declarationPath
  );
  if (!owningComponent) return undefined;
  const tag = tagName === undefined
    ? undefined
    : owningComponent.accessibleTags.find((t) =>
      t.name === tagName && t.status === "resolved"
    )?.tag;
  if (tagName !== undefined && !tag?.identity) return undefined;

  const diagnostics: SigilDiagnostic[] = [];
  const targets: OwnedImplementationTarget[] = [];
  const seen = new Set<string>();

  for (const source of implementationSources) {
    const normalizedSource = {
      filePath: normalizePath(source.filePath),
      text: source.text,
    };
    if (!isSupportedImplementationSource(normalizedSource.filePath)) continue;
    for (
      const result of implementationAnnotations(
        resolved,
        normalizedSource,
        diagnostics,
      )
    ) {
      if (
        result.annotation.componentName !== componentName ||
        (tagName !== undefined &&
          result.annotation.tagName !== tagName) ||
        (sectionName !== undefined &&
          !result.target.sections.includes(sectionName))
      ) continue;
      if (
        !componentMatchesSigilPath(
          resolved,
          owningComponent,
          result.annotation.sigilPath,
        )
      ) continue;
      const key = `${result.target.relation}\0${result.target.filePath}\0${
        result.target.symbolIdentity ?? ""
      }\0${result.target.sections.join(",")}\0${
        JSON.stringify(result.target.tagName)
      }`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(result.target);
    }
  }

  targets.sort((left, right) =>
    compareScalarText(left.filePath, right.filePath) ||
    compareScalarText(left.symbolIdentity ?? "", right.symbolIdentity ?? "") ||
    compareScalarText(left.relation, right.relation) ||
    compareScalarText(left.sections.join(","), right.sections.join(","))
  );

  return {
    owningComponent,
    tag,
    facets: componentFacetsFor(owningComponent, tagName, sectionName),
    sectionName,
    targets,
    diagnostics: orderDiagnostics(diagnostics),
  };
}

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::OwnershipDiagnostics interface,logic,cases
export function ownershipDiagnosticsFor(
  resolved: ResolvedSigilWorkspace,
  implementationSources: readonly ImplementationSource[],
): readonly SigilDiagnostic[] {
  const diagnostics: SigilDiagnostic[] = [];
  for (const source of implementationSources) {
    const normalizedSource = {
      filePath: normalizePath(source.filePath),
      text: source.text,
    };
    if (!isSupportedImplementationSource(normalizedSource.filePath)) continue;
    implementationAnnotations(resolved, normalizedSource, diagnostics);
  }
  return orderDiagnostics(diagnostics);
}

/*
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport interface,cases
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationTargetScope constraints
 */
export function isSupportedImplementationSource(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  if (normalized.endsWith(".sigil") || normalized.endsWith(".json")) {
    return false;
  }
  const extension = fileExtension(normalized);
  return MARKDOWN_EXTENSIONS.includes(extension) ||
    HASH_COMMENT_EXTENSIONS.has(extension) ||
    SLASH_COMMENT_EXTENSIONS.has(extension) ||
    MARKUP_COMMENT_EXTENSIONS.has(extension) ||
    STYLE_COMMENT_EXTENSIONS.has(extension) ||
    COMPONENT_FILE_EXTENSIONS.has(extension);
}

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport interface,cases
export function supportedImplementationSourceGlobPatterns(): readonly string[] {
  return SUPPORTED_IMPLEMENTATION_SOURCE_GLOB_PATTERNS;
}

function implementationAnnotations(
  resolved: ResolvedSigilWorkspace,
  source: ImplementationSource,
  diagnostics: SigilDiagnostic[],
): readonly {
  readonly annotation: ParsedAnnotation;
  readonly target: OwnedImplementationTarget;
}[] {
  const results: {
    annotation: ParsedAnnotation;
    target: OwnedImplementationTarget;
  }[] = [];
  for (const comment of commentBlocks(source)) {
    const annotationLines = normalizedCommentLines(comment)
      .filter((line) => line.includes("@sigil"));
    if (annotationLines.length === 0) continue;
    const fileBound = comment.binding === "file";
    if (
      !fileBound &&
      ((comment.kind === "line" &&
        annotationLines.length !== 1 &&
        !HASH_COMMENT_EXTENSIONS.has(fileExtension(source.filePath))) ||
        (comment.kind === "multiline" && annotationLines.length < 2))
    ) {
      diagnostics.push(annotationDiagnostic(
        source,
        comment,
        "Use one line comment for one ownership annotation and one multiline comment for multiple annotations.",
      ));
      continue;
    }

    const parsed = annotationLines.map(parseImplementationAnnotation);
    if (parsed.some((annotation) => annotation === undefined)) {
      diagnostics.push(annotationDiagnostic(
        source,
        comment,
        "Unable to parse implementation ownership annotation.",
      ));
      continue;
    }

    const entrypoint = fileBound
      ? undefined
      : entrypointAfter(source, comment.end);
    if (comment.binding === "symbol" && !entrypoint) {
      diagnostics.push(annotationDiagnostic(
        source,
        comment,
        "Implementation ownership annotation is not adjacent to a supported entrypoint definition.",
      ));
      continue;
    }

    for (const annotation of parsed as ParsedAnnotation[]) {
      const resolvedTarget = resolveAnnotationTarget(resolved, annotation);
      if (resolvedTarget) {
        diagnostics.push(annotationDiagnostic(
          source,
          comment,
          resolvedTarget,
        ));
        continue;
      }
      const component = resolved.components.find((c) =>
        c.identity && c.name === annotation.componentName &&
        componentMatchesSigilPath(resolved, c, annotation.sigilPath)
      )!;
      results.push({
        annotation,
        target: {
          relation: annotation.relation,
          artifactKind: inferArtifactKind(source.filePath, annotation.relation),
          filePath: relativeToWorkspace(resolved, source.filePath),
          sections: annotation.sectionNames as readonly ImplementationSection[],
          tagName: annotation.tagName,
          tagIdentity: component.accessibleTags.find((t) =>
            t.name === annotation.tagName && t.status === "resolved"
          )?.tag?.identity,
          facetIds: componentFacetsFor(component, annotation.tagName).filter(
            (f) => annotation.sectionNames.includes(f.sectionName),
          ).map((f) => f.id),
          symbolIdentity: entrypoint?.identity,
          location: entrypoint?.range.start ??
            (MARKDOWN_EXTENSIONS.includes(fileExtension(source.filePath))
              ? { line: 1, column: 1 }
              : undefined),
          annotationRange: rangeForOffsets(
            source.text,
            comment.start,
            comment.end,
          ),
        },
      });
    }
  }
  return results;
}

function parseImplementationAnnotation(
  line: string,
): ParsedAnnotation | undefined {
  const prefix =
    /^@sigil\s+(implements|uses|tests)\s+(\S+?\.sigil)::([A-Za-z][A-Za-z0-9_]*)(.*)$/i
      .exec(line.trim());
  if (!prefix) return undefined;
  const relation = prefix[1].toLowerCase() as ImplementationRelation;
  if (!IMPLEMENTATION_RELATIONS.has(relation)) return undefined;
  const sigilPath = normalizeImportPath(prefix[2]);
  if (!sigilPath) return undefined;
  let suffix = prefix[4], tagName: string | undefined;
  if (suffix.startsWith("::")) {
    suffix = suffix.slice(2);
    if (suffix.startsWith('"')) {
      const quoted = /^"(?:[^"\\]|\\.)*"/.exec(suffix)?.[0];
      if (!quoted) return undefined;
      try {
        tagName = JSON.parse(quoted);
      } catch {
        return undefined;
      }
      suffix = suffix.slice(quoted.length);
    } else {
      const name = /^\S+/.exec(suffix)?.[0];
      if (!name || name.includes("::")) return undefined;
      tagName = name;
      suffix = suffix.slice(name.length);
    }
    if (tagName === undefined || !validTagName(tagName)) return undefined;
  }
  const sections = /^\s+(\S+)\s*$/.exec(suffix)?.[1];
  if (!sections) return undefined;
  return {
    relation,
    sigilPath,
    componentName: prefix[3],
    tagName,
    sectionNames: sections.split(",").map((s) => s.toLowerCase()),
  };
}

/*
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationAnnotation interface
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::TargetResolution constraints,cases
 */
function resolveAnnotationTarget(
  resolved: ResolvedSigilWorkspace,
  annotation: ParsedAnnotation,
): string | undefined {
  const component = resolved.components.find((item) =>
    item.identity && item.name === annotation.componentName &&
    componentMatchesSigilPath(resolved, item, annotation.sigilPath)
  );
  if (!component) {
    return `Ownership annotation references unknown Sigil component ${annotation.componentName} in ${annotation.sigilPath}.`;
  }
  if (
    annotation.tagName !== undefined &&
    !component.accessibleTags.some((t) =>
      t.name === annotation.tagName && t.status === "resolved"
    )
  ) {
    return `Ownership annotation references unknown or ambiguous Tag ${
      JSON.stringify(annotation.tagName)
    } on ${annotation.componentName}.`;
  }
  if (
    annotation.sectionNames.length === 0 ||
    annotation.sectionNames.some((section) => section.length === 0)
  ) {
    return "Ownership annotation requires one or more section selectors.";
  }
  const repeatedSection = annotation.sectionNames.find((section, index) =>
    annotation.sectionNames.indexOf(section) !== index
  );
  if (repeatedSection) {
    return `Ownership annotation repeats section selector ${repeatedSection}.`;
  }
  const unsupportedSection = annotation.sectionNames.find((section) =>
    !IMPLEMENTATION_SECTIONS.has(section as ImplementationSection)
  );
  if (unsupportedSection) {
    return `Ownership annotation uses unsupported section selector ${unsupportedSection}.`;
  }
  const availableSections = componentFacetsFor(component, annotation.tagName)
    .map((f) => f.sectionName);
  const unresolvedSection = annotation.sectionNames.find((section) =>
    !availableSections.includes(section as ImplementationSection)
  );
  if (unresolvedSection) {
    const target = annotation.tagName
      ? `Tag ${
        JSON.stringify(annotation.tagName)
      } on ${annotation.componentName}`
      : `component ${annotation.componentName}`;
    return `Ownership annotation references section ${unresolvedSection} without a matching occurrence on ${target}.`;
  }
  return undefined;
}

function componentMatchesSigilPath(
  resolved: ResolvedSigilWorkspace,
  component: ResolvedComponent,
  sigilPath: string,
): boolean {
  return relativeToWorkspace(resolved, component.filePath) === sigilPath;
}

/*
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ComponentFileRegions logic,constraints,cases
 */
function commentBlocks(source: ImplementationSource): readonly CommentBlock[] {
  const extension = fileExtension(source.filePath.toLowerCase());
  if (MARKDOWN_EXTENSIONS.includes(extension)) {
    return markdownCommentBlocks(source.text)
      .map((comment) => ({ ...comment, binding: "file" as const }));
  }
  const blocks: CommentBlock[] = [];
  for (const region of sourceRegions(source.text, extension)) {
    const text = source.text.slice(region.start, region.end);
    for (const comment of scanRegion(text, region.syntax, extension)) {
      blocks.push({
        ...comment,
        binding: region.binding,
        start: comment.start + region.start,
        end: comment.end + region.start,
      });
    }
  }
  return blocks.sort((left, right) => left.start - right.start);
}

function scanRegion(
  text: string,
  syntax: CommentSyntax,
  extension: string,
): RawComment[] {
  if (syntax === "hash") return hashCommentBlocks(text);
  if (syntax === "markup") return markupCommentBlocks(text, extension);
  if (syntax === "style") return styleCommentBlocks(text);
  return slashCommentBlocks(text);
}

/**
 * A single-file component mixes languages, so its comment syntax and its
 * ownership binding are decided per region rather than per file.
 */
function sourceRegions(
  text: string,
  extension: string,
): readonly SourceRegion[] {
  if (HASH_COMMENT_EXTENSIONS.has(extension)) {
    return [{ syntax: "hash", binding: "symbol", start: 0, end: text.length }];
  }
  if (SLASH_COMMENT_EXTENSIONS.has(extension)) {
    return [{ syntax: "slash", binding: "symbol", start: 0, end: text.length }];
  }
  if (STYLE_COMMENT_EXTENSIONS.has(extension)) {
    return [{ syntax: "style", binding: "file", start: 0, end: text.length }];
  }
  if (
    MARKUP_COMMENT_EXTENSIONS.has(extension) ||
    COMPONENT_FILE_EXTENSIONS.has(extension)
  ) {
    return componentFileRegions(text, extension);
  }
  return [];
}

function componentFileRegions(
  text: string,
  extension: string,
): readonly SourceRegion[] {
  const embedded: SourceRegion[] = [];
  if (extension === ".astro") {
    const frontmatter = astroFrontmatterRegion(text);
    if (frontmatter) embedded.push(frontmatter);
  }
  for (const match of text.matchAll(/<(script|style)\b[^>]*>/gi)) {
    const openingStart = match.index ?? 0;
    if (
      embedded.some((region) =>
        openingStart >= region.start && openingStart < region.end
      )
    ) continue;
    const tag = match[1].toLowerCase();
    const contentStart = openingStart + match[0].length;
    const closing = new RegExp(`</${tag}\\s*>`, "i")
      .exec(text.slice(contentStart));
    embedded.push({
      syntax: tag === "script" ? "slash" : "style",
      binding: tag === "script" ? "optional-symbol" : "file",
      start: contentStart,
      end: closing ? contentStart + closing.index : text.length,
    });
  }
  embedded.sort((left, right) => left.start - right.start);

  // Everything outside an embedded block is template markup.
  const regions: SourceRegion[] = [];
  let cursor = 0;
  for (const region of embedded) {
    if (region.start > cursor) {
      regions.push({
        syntax: "markup",
        binding: "file",
        start: cursor,
        end: region.start,
      });
    }
    regions.push(region);
    cursor = Math.max(cursor, region.end);
  }
  if (cursor < text.length) {
    regions.push({
      syntax: "markup",
      binding: "file",
      start: cursor,
      end: text.length,
    });
  }
  return regions;
}

function astroFrontmatterRegion(text: string): SourceRegion | undefined {
  const opening = /^﻿?[^\S\n]*---[^\S\n]*\r?\n/.exec(text);
  if (!opening) return undefined;
  const start = opening[0].length;
  const closing = text.indexOf("\n---", start - 1);
  if (closing < start - 1) return undefined;
  return {
    syntax: "slash",
    binding: "optional-symbol",
    start,
    end: closing + 1,
  };
}

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const TEMPLATE_COMMENT_PATTERN =
  /<!--[\s\S]*?-->|\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g;

function markupCommentBlocks(
  source: string,
  extension: string,
): RawComment[] {
  const pattern = TEMPLATE_COMMENT_EXTENSIONS.has(extension)
    ? TEMPLATE_COMMENT_PATTERN
    : HTML_COMMENT_PATTERN;
  return [...source.matchAll(pattern)].map((match) => ({
    kind: "markup" as const,
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function styleCommentBlocks(source: string): RawComment[] {
  const comments: RawComment[] = [];
  let index = 0;
  let quote: "'" | '"' | undefined;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      const start = index;
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      comments.push({
        kind: "multiline",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    // `//` after a colon is a scheme separator such as `url(https://…)`, not a
    // comment. Plain CSS has no line comment, but Sass and Less do.
    if (char === "/" && next === "/" && source[index - 1] !== ":") {
      const start = index;
      index += 2;
      while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      comments.push({
        kind: "line",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    index++;
  }
  return mergeAdjacentLineComments(source, comments);
}

function markdownCommentBlocks(source: string): RawComment[] {
  const fencedRanges: { start: number; end: number }[] = [];
  let fenceStart: number | undefined;
  let fenceMarker: string | undefined;
  let offset = 0;
  for (const line of source.split(/(?<=\n)/)) {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (fenceStart === undefined) {
        fenceStart = offset;
        fenceMarker = marker[0];
      } else if (marker[0] === fenceMarker) {
        fencedRanges.push({ start: fenceStart, end: offset + line.length });
        fenceStart = undefined;
        fenceMarker = undefined;
      }
    }
    offset += line.length;
  }
  if (fenceStart !== undefined) {
    fencedRanges.push({ start: fenceStart, end: source.length });
  }
  return [...source.matchAll(/<!--[\s\S]*?-->/g)]
    .map((match) => ({
      kind: "markup" as const,
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }))
    .filter((comment) =>
      !fencedRanges.some((range) =>
        comment.start >= range.start && comment.start < range.end
      )
    );
}

function slashCommentBlocks(source: string): RawComment[] {
  const comments: RawComment[] = [];
  let index = 0;
  let quote: "'" | '"' | "`" | undefined;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index++;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      index++;
      continue;
    }
    if (char === "/" && next === "/") {
      const start = index;
      index += 2;
      while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      comments.push({
        kind: "line",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    if (char === "/" && next === "*") {
      const start = index;
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      comments.push({
        kind: "multiline",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    index++;
  }
  return mergeAdjacentLineComments(source, comments);
}

function hashCommentBlocks(source: string): RawComment[] {
  const comments: RawComment[] = [];
  let index = 0;
  let quote: "'" | '"' | undefined;
  let triple: "'''" | '"""' | undefined;
  while (index < source.length) {
    if (triple) {
      if (source.startsWith(triple, index)) {
        index += 3;
        triple = undefined;
      } else {
        index++;
      }
      continue;
    }
    const tripleStart = source.slice(index, index + 3);
    if (!quote && tripleStart === "'''") {
      triple = "'''";
      index += 3;
      continue;
    }
    if (!quote && tripleStart === '"""') {
      triple = '"""';
      index += 3;
      continue;
    }
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      index++;
      continue;
    }
    if (char === "#") {
      const start = index;
      while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      comments.push({
        kind: "line",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    index++;
  }
  return mergeAdjacentLineComments(source, comments);
}

function mergeAdjacentLineComments(
  source: string,
  comments: readonly RawComment[],
): RawComment[] {
  const merged: RawComment[] = [];
  for (const comment of comments) {
    const previous = merged.at(-1);
    const gap = previous ? source.slice(previous.end, comment.start) : "";
    if (
      previous?.kind === "line" &&
      comment.kind === "line" &&
      /^\s*$/.test(gap) &&
      (gap.match(/\n/g)?.length ?? 0) <= 1
    ) {
      merged[merged.length - 1] = {
        kind: "line",
        text: source.slice(previous.start, comment.end),
        start: previous.start,
        end: comment.end,
      };
    } else {
      merged.push(comment);
    }
  }
  return merged;
}

function normalizedCommentLines(comment: CommentBlock): string[] {
  return comment.text
    .replace(/^\{\{-?\s*/, "")
    .replace(/\s*-?\}\}$/, "")
    .replace(/^<!--|-->$/g, "")
    .replace(/^\/\*|\*\/$/g, "")
    .split(/\r?\n/)
    .map((line) =>
      line.trim()
        .replace(/^\/\/\s?/, "")
        .replace(/^\#\s?/, "")
        .replace(/^\*\s?/, "")
        .trim()
    )
    .filter(Boolean);
}

function entrypointAfter(
  source: ImplementationSource,
  offset: number,
): Entrypoint | undefined {
  const rest = source.text.slice(offset);
  const extension = fileExtension(source.filePath.toLowerCase());
  const match = entrypointMatch(rest, extension);
  if (!match) return undefined;
  const start = offset + match.offset;
  return {
    identity: match.name,
    range: rangeForOffsets(
      source.text,
      start,
      start + match.name.length,
    ),
  };
}

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
function entrypointMatch(
  source: string,
  extension: string,
): EntrypointMatch | undefined {
  let patterns: readonly RegExp[];
  let matchSource = source;
  let matchOffset = 0;
  if ([".sh", ".bash", ".zsh"].includes(extension)) {
    patterns = [
      /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*\{/,
    ];
  } else if (HASH_COMMENT_EXTENSIONS.has(extension)) {
    patterns = [
      /^\s*(?:@[A-Za-z_][\w.]*(?:\([^\r\n]*\))?\s*)*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".rs") {
    patterns = [
      /^\s*(?:#\[[^\]]+\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|trait|enum)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".go") {
    patterns = [
      /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
      /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/,
    ];
  } else if (extension === ".swift") {
    patterns = [
      /^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|fileprivate|internal|open|final|static|mutating|nonmutating|override|async)\s+)*(?:func|class|struct|protocol|enum)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".kt" || extension === ".kts") {
    patterns = [
      /^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|protected|internal|open|final|abstract|override|suspend|inline|data|sealed)\s+)*(?:fun|class|interface|object|struct|enum\s+class)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".scala") {
    patterns = [
      /^\s*(?:(?:@\w+(?:\([^)]*\))?|private|protected|final|sealed|abstract|override|implicit|lazy)\s+)*(?:def|class|trait|object|enum)\s+([A-Za-z_]\w*)/,
    ];
  } else if (
    [".c", ".cc", ".cpp", ".cs", ".cxx", ".dart", ".h", ".hpp", ".java"]
      .includes(extension)
  ) {
    const isCpp = [".cc", ".cpp", ".cxx", ".h", ".hpp"].includes(
      extension,
    );
    if (isCpp) {
      const templateEnd = cppTemplatePrefixEnd(source);
      if (templateEnd === undefined) return undefined;
      matchSource = source.slice(templateEnd);
      matchOffset = templateEnd;
    }
    const modifier = String
      .raw`(?:(?:@\w+(?:\([^)]*\))?|public|private|protected|internal|static|final|sealed|abstract|virtual|override|async|extern|inline|constexpr|unsafe|partial)\s+)*`;
    const requiresPrefix = isCpp
      ? String.raw`(?:requires\b(?:[^;{}]|\{[^{}]*\})*?\s+)?`
      : "";
    const modifiers = String
      .raw`^\s*${modifier}${requiresPrefix}${modifier}`;
    patterns = [
      new RegExp(
        `${modifiers}(?:class|interface|struct|enum|record)\\s+([A-Za-z_]\\w*)`,
      ),
      new RegExp(
        `${modifiers}(?:[A-Za-z_]\\w*(?:[<>,.?\\[\\]:*&]\\s*|\\s+))+([A-Za-z_]\\w*)\\s*\\(`,
      ),
    ];
  } else {
    const prefix = String
      .raw`^\s*(?:(?:@[A-Za-z_$][\w$]*(?:\([^\r\n]*\))?|#\[[^\]]+\])\s*)*(?:(?:export|default|declare|abstract|public|protected|private|static|final|sealed|partial|override|readonly|async|unsafe|extern)\s+)*`;
    patterns = [
      /^\s*(?:test|it|describe|suite)(?:\.(?:only|skip|todo))?\s*\(\s*["'`]([^"'`]+)["'`]/,
      new RegExp(
        `${prefix}(?:class|interface|struct|trait|enum|function)\\s+\\*?\\s*([A-Za-z_$][\\w$]*)`,
      ),
      new RegExp(
        `${prefix}(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`,
      ),
      new RegExp(
        `${prefix}(?:(?:get|set|async)\\s+)*([A-Za-z_$][\\w$]*)\\s*(?:<[^>{}]*>)?\\s*\\(`,
      ),
      /^\s*Deno\.test\(\s*["'`]([^"'`]+)["'`]/,
    ];
  }
  for (const pattern of patterns) {
    const match = matchSource.match(pattern);
    const name = match?.[1];
    if (!match || !name) continue;
    return {
      name,
      offset: matchOffset + (match.index ?? 0) + match[0].lastIndexOf(name),
    };
  }
  return undefined;
}

function cppTemplatePrefixEnd(source: string): number | undefined {
  let offset = skipWhitespace(source, 0);
  let foundTemplate = false;
  while (
    source.startsWith("template", offset) &&
    !isIdentifierCharacter(source[offset + "template".length])
  ) {
    foundTemplate = true;
    offset = skipWhitespace(source, offset + "template".length);
    if (source[offset] !== "<") return undefined;
    let depth = 0;
    let quote: '"' | "'" | undefined;
    let closed = false;
    for (; offset < source.length; offset++) {
      const character = source[offset];
      if (quote) {
        if (character === "\\") {
          offset++;
        } else if (character === quote) {
          quote = undefined;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "<") {
        depth++;
      } else if (character === ">") {
        depth--;
        if (depth === 0) {
          offset++;
          closed = true;
          break;
        }
      }
    }
    if (!closed) return undefined;
    offset = skipWhitespace(source, offset);
  }
  return foundTemplate ? offset : 0;
}

function skipWhitespace(source: string, offset: number): number {
  while (offset < source.length && /\s/.test(source[offset])) offset++;
  return offset;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function annotationDiagnostic(
  source: ImplementationSource,
  comment: CommentBlock,
  message: string,
): SigilDiagnostic {
  return diagnostic("SIGIL_IMPLEMENTATION_ANNOTATION", message, {
    filePath: source.filePath,
    implementationRange: rangeForOffsets(
      source.text,
      comment.start,
      comment.end,
    ),
  });
}

function rangeForOffsets(
  source: string,
  start: number,
  end: number,
): ImplementationRange {
  return { start: positionAt(source, start), end: positionAt(source, end) };
}

function positionAt(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const prefix = source.slice(0, Math.max(0, offset));
  const lines = prefix.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function relativeToWorkspace(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
): string {
  const root = normalizePath(resolved.workspace.root);
  const normalized = normalizePath(filePath);
  if (root === ".") return normalized;
  return normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}

function fileExtension(filePath: string): string {
  const basename = normalizePath(filePath).split("/").at(-1) ?? "";
  const index = basename.lastIndexOf(".");
  return index < 0 ? "" : basename.slice(index);
}

function inferArtifactKind(
  filePath: string,
  relation: ImplementationRelation,
): ImplementationArtifactKind {
  const normalized = normalizePath(filePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    return "markdown";
  }
  if (relation === "tests") return "test";
  return "code";
}
