import type { SigilDiagnostic } from "./diagnostics.ts";
import type { ImplementationSection } from "./ownership.ts";
import type {
  SigilSectionName,
  SourceLocation,
  SourceRange,
} from "./language.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type { ImplementationSection } from "./ownership.ts";
export type { SigilSectionName, SourceRange } from "./language.ts";

export type RetrievalPurpose = "semantic" | "architecture" | "implementation";
export type PurposeRetrievalTarget =
  | {
    readonly kind: "component";
    readonly componentName: string;
    readonly path: string;
  }
  | { readonly kind: "file"; readonly path: string };

// @sigil implements packages/core/src/model/retrieval.sigil::SigilRetrievalModel::RetrievalModel interface
export interface RetrievalTargetIdentity {
  readonly kind: "component" | "file";
  readonly componentName?: string;
  readonly pathStatus: "accepted" | "rejected";
  readonly path: string;
}
export type RetrievalNodeKind =
  | "request-target"
  | "component-declaration"
  | "sigil-file"
  | "expansion"
  | "module-index"
  | "public-concept-origin"
  | "implementation-target";
export type RetrievalRelation =
  | "selected-declaration"
  | "matching-expansion"
  | "direct-dependency"
  | "direct-importer"
  | "containing-module-index"
  | "cycle-member"
  | "public-concept-origin"
  | "owned-implementation";
export type EvidenceKind =
  | "selected-contract"
  | "selected-expansion"
  | "dependency-contract"
  | "dependency-decision"
  | "importer-contract"
  | "cycle-contract"
  | "module-index-summary"
  | "public-concept-origin"
  | "glossary-definition"
  | "ownership-projection"
  | "diagnostic";
export interface RetrievalNode {
  readonly identity: string;
  readonly kind: RetrievalNodeKind;
  readonly path: string;
  readonly componentName?: string;
  readonly range?: SourceRange;
  readonly location?: SourceLocation;
}
export interface RetrievalEdge {
  readonly identity: string;
  readonly relation: RetrievalRelation;
  readonly sourceIdentity: string;
  readonly targetIdentity: string;
  readonly originPath: string;
  readonly originRange?: SourceRange;
}
export interface SelectedRetrievalGraph {
  readonly nodes: readonly RetrievalNode[];
  readonly edges: readonly RetrievalEdge[];
}
export interface EvidenceUnit {
  readonly identity: string;
  readonly kind: EvidenceKind;
  readonly path?: string;
  readonly componentName?: string;
  readonly sectionName?: SigilSectionName | ImplementationSection;
  readonly conceptIdentity?: string;
  readonly range?: SourceRange;
  readonly location?: SourceLocation;
  readonly text: string;
  readonly inclusionReasonIdentities: readonly string[];
}
export interface InclusionReason {
  readonly identity: string;
  readonly rule: string;
  readonly seedIdentity: string;
  readonly selectedIdentity: string;
  readonly edgeIdentities: readonly string[];
}
export interface ExcludedRelation {
  readonly identity: string;
  readonly rule: string;
  readonly edgeIdentity: string;
  readonly sourceIdentity: string;
  readonly targetIdentity: string;
}
export interface ContextSection {
  readonly kind: EvidenceKind;
  readonly text: string;
  readonly evidenceIdentity: string;
  readonly inclusionReasonIdentities: readonly string[];
}
export interface AggregatedRetrievalContext {
  readonly sections: readonly ContextSection[];
}
export interface PurposeRetrievalResult {
  readonly schema: "sigil-purpose-retrieval/v1";
  readonly policyVersion: 1;
  readonly workspaceSnapshotIdentity: string;
  readonly target: RetrievalTargetIdentity;
  readonly purpose: RetrievalPurpose;
  readonly graph: SelectedRetrievalGraph;
  readonly evidence: readonly EvidenceUnit[];
  readonly inclusionReasons: readonly InclusionReason[];
  readonly exclusions: readonly ExcludedRelation[];
  readonly context: AggregatedRetrievalContext;
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly fingerprint: string;
}
export interface RetrievalProjectionLocation {
  readonly path: string;
  readonly range?: SourceRange;
}
export interface RetrievalProjectionItem extends RetrievalProjectionLocation {
  readonly text: string;
}
export interface RetrievalProjectionConcept {
  readonly name?: string;
  readonly items: readonly RetrievalProjectionItem[];
  readonly ownership: readonly RetrievalProjectionOwnership[];
}
export interface RetrievalProjectionOwnership {
  readonly path: string;
  readonly location?: SourceLocation;
  readonly relation: "implements" | "uses" | "tests";
  readonly symbol?: string;
  readonly sections: readonly ImplementationSection[];
}
export interface RetrievalProjectionLink {
  readonly relation: string;
  readonly target: string;
  readonly location?: RetrievalProjectionLocation;
}
export interface RetrievalProjectionComponent {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly role:
    | "selected"
    | "dependency"
    | "importer"
    | "cycle-member"
    | "module-context";
  readonly goal: readonly RetrievalProjectionItem[];
  readonly interface: readonly RetrievalProjectionConcept[];
  readonly scope: readonly RetrievalProjectionItem[];
  readonly state: readonly RetrievalProjectionItem[];
  readonly logic: readonly RetrievalProjectionItem[];
  readonly constraints: readonly RetrievalProjectionItem[];
  readonly decisions: readonly RetrievalProjectionItem[];
  readonly cases: readonly RetrievalProjectionItem[];
  readonly ownership: readonly RetrievalProjectionOwnership[];
  readonly links: readonly RetrievalProjectionLink[];
}
export interface RetrievalProjectionGlossaryEntry {
  readonly term: string;
  readonly definition: string;
}
export interface RetrievalProjection {
  readonly schema: "sigil-retrieval-projection/v1";
  readonly purpose: RetrievalPurpose;
  readonly target: RetrievalTargetIdentity;
  readonly components: readonly RetrievalProjectionComponent[];
  readonly glossary: readonly RetrievalProjectionGlossaryEntry[];
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly fingerprint: string;
}
