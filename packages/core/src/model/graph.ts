import type { SourceRange } from "./language.ts";
import type { ComponentIdentity, TagIdentity } from "./identity.ts";
import type { ImportUse } from "./resolution.ts";
export type { SourceRange } from "./language.ts";
export type { ComponentIdentity, TagIdentity } from "./identity.ts";

// @sigil implements packages/core/src/model/graph.sigil::SigilGraphModel::GraphModel interface
export interface SigilGraph {
  readonly componentNodes: readonly ComponentNode[];
  readonly fileEdges: readonly FileDependencyEdge[];
  readonly importedTagEdges: readonly ImportedTagEdge[];
}
export interface ComponentNode {
  readonly id: string;
  readonly identity?: ComponentIdentity;
  readonly name: string;
  readonly filePath: string;
}
export interface ImportedTagEdge {
  readonly id: string;
  readonly importId: string;
  readonly sourceFile: string;
  readonly targetFile: string;
  readonly providerComponentId: string;
  readonly tagIdentity: TagIdentity;
  readonly importPath: string;
  readonly sourceComponents: readonly ComponentIdentity[];
  readonly uses: readonly ImportUse[];
  readonly originRange: SourceRange;
}
export interface FileDependencyEdge {
  readonly importId: string;
  readonly from: string;
  readonly to: string;
  readonly importPath: string;
}
