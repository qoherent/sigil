import type { SigilDiagnostic } from "./diagnostics.ts";
import type { GlossaryProjection } from "./glossary.ts";
import type { SigilSectionName, SourceRange } from "./language.ts";
import type {
  ComponentDeclaration,
  ImportDeclaration,
  ImportSelection,
} from "./source.ts";
import type { SigilWorkspace } from "./workspace.ts";
import type { SigilGraph } from "./graph.ts";
import type { ComponentIdentity, TagIdentity } from "./identity.ts";
export type { ComponentIdentity, TagIdentity } from "./identity.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type { GlossaryProjection } from "./glossary.ts";
export type {
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "./language.ts";
export type {
  ComponentDeclaration,
  Facet,
  ImportDeclaration,
  Section,
} from "./source.ts";
export type { SigilWorkspace } from "./workspace.ts";
export type { SigilGraph } from "./graph.ts";

export interface TagIntroduction {
  readonly id: string;
  readonly kind: "group" | "inline";
  readonly name: string;
  readonly componentId: string;
  readonly sectionName: SigilSectionName;
  readonly filePath: string;
  readonly facetId?: string;
  readonly groupId?: string;
  readonly range: SourceRange;
  readonly nameRange: SourceRange;
  readonly valid: boolean;
  readonly complete: boolean;
}
export interface ResolvedTag {
  readonly name: string;
  readonly identity?: TagIdentity;
  readonly status: "resolved" | "invalid" | "ambiguous";
  readonly introductions: readonly TagIntroduction[];
}
export interface AccessibleTag {
  readonly name: string;
  readonly status: "resolved" | "ambiguous";
  readonly tag?: ResolvedTag;
  readonly candidates: readonly ResolvedTag[];
  readonly selectionIds: readonly string[];
}
export interface ResolvedTagReference {
  readonly id: string;
  readonly name: string;
  readonly tagIdentity?: TagIdentity;
  readonly status: "resolved" | "ambiguous";
  readonly componentId: string;
  readonly facetId: string;
  readonly filePath: string;
  readonly sectionName: SigilSectionName;
  readonly range: SourceRange;
}
export interface ImportUse {
  readonly kind: "tag-reference";
  readonly referenceId: string;
  readonly componentId: string;
  readonly facetId: string;
  readonly filePath: string;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly range: SourceRange;
}
export interface ResolvedImportName {
  readonly id: string;
  readonly name: string;
  readonly selection: ImportSelection;
  readonly status:
    | "resolved"
    | "unresolved"
    | "duplicate"
    | "ambiguous"
    | "invalid";
  /** Provider evidence survives duplicate selections; status controls accessibility. */
  readonly tag?: ResolvedTag;
  readonly ambiguousIn: readonly string[];
  readonly used: boolean;
  readonly uses: readonly ImportUse[];
}
export interface ResolvedImport {
  readonly id: string;
  readonly declaration: ImportDeclaration;
  readonly sourceFile: string;
  readonly targetFile?: string;
  readonly providerId?: string;
  readonly status:
    | "resolved"
    | "unresolved-path"
    | "unresolved-provider"
    | "invalid";
  readonly names: readonly ResolvedImportName[];
}
export interface ResolvedComponent {
  readonly id: string;
  readonly identity?: ComponentIdentity;
  readonly name: string;
  readonly declaration: ComponentDeclaration;
  readonly filePath: string;
  readonly tags: readonly ResolvedTag[];
  readonly accessibleTags: readonly AccessibleTag[];
  readonly references: readonly ResolvedTagReference[];
}

// @sigil implements packages/core/src/model/resolution.sigil::SigilResolutionModel::ResolutionModel interface
export interface SigilResolution {
  readonly workspace: SigilWorkspace;
  readonly imports: readonly ResolvedImport[];
  readonly components: readonly ResolvedComponent[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
export interface ResolvedSigilWorkspace extends SigilResolution {
  readonly graph: SigilGraph;
  readonly glossary: GlossaryProjection;
}
