import type { SigilDiagnostic } from "./diagnostics.ts";
import type { SourceLocation, SourceRange } from "./language.ts";
import type { ResolvedComponent, ResolvedTag } from "./resolution.ts";
export type { SigilDiagnostic } from "./diagnostics.ts";
export type { SourceRange } from "./language.ts";
export type {
  ResolvedComponent,
  ResolvedTag,
  ResolvedSigilWorkspace,
} from "./resolution.ts";

export type ImplementationRelation = "implements" | "uses" | "tests";

export type ImplementationSection =
  | "interface"
  | "state"
  | "logic"
  | "constraints"
  | "cases";

export type ImplementationArtifactKind = "code" | "test" | "markdown";

export interface ImplementationSource {
  readonly filePath: string;
  readonly text: string;
}

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationEvidenceInput interface
export interface ImplementationEvidenceInput {
  readonly workspaceSnapshotIdentity: string;
  readonly discoveryState: "complete" | "unavailable";
  readonly sources: readonly ImplementationSource[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface ComponentIdentity {
  readonly componentName: string;
  readonly declarationPath: string;
}

export interface OwnedImplementationTarget {
  readonly relation: ImplementationRelation;
  readonly artifactKind: ImplementationArtifactKind;
  readonly filePath: string;
  readonly sections: readonly ImplementationSection[];
  readonly symbolIdentity?: string;
  readonly location?: SourceLocation;
  readonly annotationRange: SourceRange;
}

export interface OwnedImplementationProjection {
  readonly owningComponent: ResolvedComponent;
  readonly concept?: ResolvedTag;
  readonly sectionName?: ImplementationSection;
  readonly targets: readonly OwnedImplementationTarget[];
  readonly diagnostics: readonly SigilDiagnostic[];
}
