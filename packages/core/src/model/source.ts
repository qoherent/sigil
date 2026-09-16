import type { SigilDiagnostic } from "./diagnostics.ts";
import type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
import type { InlineLink, InlineTagDefinition } from "../inline-content.ts";
import type { SourceText } from "../source-text.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
export type { InlineLink, InlineTagDefinition } from "../inline-content.ts";

export interface SourceNode {
  readonly range: SourceRange;
  readonly valid: boolean;
  /** False means recovery cannot establish complete authored contents. */
  readonly complete: boolean;
}

export interface EmbeddedContent extends SourceNode {
  readonly type?: string;
  readonly body: string;
  readonly rawBody: string;
  readonly sourceLines: readonly string[];
  readonly bodyRange: SourceRange;
  readonly openingRange: SourceRange;
  readonly closingRange?: SourceRange;
  readonly fenceLength: number;
  readonly indentation: string;
}

/** A physical authored contribution keeps its consumer owner and contract role. */
export interface Facet extends SourceNode {
  readonly id: string;
  readonly filePath: string;
  readonly componentId: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly groupingId?: string;
  readonly groupingTag?: string;
  readonly prose: string;
  readonly proseRange: SourceRange;
  readonly sourceLines: readonly string[];
  readonly literalBlocks: readonly [] | readonly [EmbeddedContent];
  readonly definitions: readonly InlineTagDefinition[];
  readonly links: readonly InlineLink[];
  readonly eligible: readonly SourceRange[];
}

export interface EmbeddedFacet extends Facet {
  readonly literalBlocks: readonly [EmbeddedContent];
}
export function isEmbeddedFacet(facet: Facet): facet is EmbeddedFacet {
  return facet.literalBlocks.length === 1;
}

/** Repeated headings are occurrences; collective resolution establishes a Tag. */
export interface TagGroup extends SourceNode {
  readonly id: string;
  readonly name: string;
  readonly nameRange: SourceRange;
  readonly headerRange: SourceRange;
  readonly bodyRange: SourceRange;
  readonly units: readonly Facet[];
  /** Only recovered invalid nesting can populate this collection. */
  readonly groups: readonly TagGroup[];
}

export interface Section extends SourceNode {
  readonly name: string;
  readonly known: boolean;
  readonly nameRange: SourceRange;
  readonly headerRange: SourceRange;
  readonly bodyRange: SourceRange;
  readonly units: readonly Facet[];
  readonly groups: readonly TagGroup[];
}

export interface ImportSelection extends SourceNode {
  readonly name: string;
}
export interface ImportDeclaration extends SourceNode {
  readonly path: string;
  readonly pathRange: SourceRange;
  readonly provider: string;
  readonly providerRange: SourceRange;
  readonly names: readonly string[];
  readonly nameRanges: readonly SourceRange[];
  readonly selections: readonly ImportSelection[];
}

export interface ComponentDeclaration extends SourceNode {
  readonly kind: "component";
  /** Physical occurrence identity, including for globally ambiguous names. */
  readonly id: string;
  readonly name: string;
  readonly nameRange: SourceRange;
  readonly headerRange: SourceRange;
  readonly sections: readonly Section[];
}

export interface InvalidSourceRegion extends SourceNode {
  readonly kind: "structure" | "detached-payload";
  readonly payload?: EmbeddedContent;
}

// @sigil implements packages/core/src/model/source.sigil::SigilSourceModel::SourceModel interface
export interface SigilDocument {
  readonly filePath: string;
  readonly source?: SourceText;
  readonly rawBytes?: Uint8Array;
  readonly rawText?: string;
  readonly valid: boolean;
  readonly complete: boolean;
  readonly imports: readonly ImportDeclaration[];
  readonly components: readonly ComponentDeclaration[];
  readonly invalidRegions: readonly InvalidSourceRegion[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ParseResult {
  readonly document: SigilDocument;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface FormatResult {
  readonly formattedSource?: string;
  readonly changed: boolean;
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface ParseOptions {
  readonly sigilVersion: string;
}

export function sourceOccurrenceId(
  filePath: string,
  kind: string,
  start: number,
): string {
  return `${kind}:${encodeURIComponent(filePath)}:${start}`;
}
