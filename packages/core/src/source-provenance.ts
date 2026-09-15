import { type TagIdentity, tagIdentity } from "./model/identity.ts";
import type {
  ResolvedTagReference,
  TagIntroduction,
} from "./model/resolution.ts";
import { sourceOccurrenceId } from "./model/source.ts";
import { relativePath } from "./path.ts";

/** Present source identities relative to the same workspace at transport boundaries. */
export class SourceProvenance {
  constructor(private readonly root: string) {}

  path(value: string): string {
    return relativePath(this.root, value);
  }

  occurrence(value: string): string {
    const match = /^([^:]+):([^:]+):(\d+)$/.exec(value);
    if (!match) {
      throw new TypeError(`Invalid source occurrence identity: ${value}`);
    }
    return sourceOccurrenceId(
      this.path(decodeURIComponent(match[2])),
      match[1],
      Number(match[3]),
    );
  }

  tag(value: TagIdentity): TagIdentity {
    return tagIdentity({
      ...value.owner,
      declarationPath: this.path(value.owner.declarationPath),
    }, value.name);
  }

  introduction(value: TagIntroduction): TagIntroduction {
    return {
      ...value,
      id: this.occurrence(value.id),
      filePath: this.path(value.filePath),
      componentId: this.occurrence(value.componentId),
      facetId: value.facetId ? this.occurrence(value.facetId) : undefined,
      groupId: value.groupId ? this.occurrence(value.groupId) : undefined,
    };
  }

  reference(value: ResolvedTagReference): ResolvedTagReference {
    return {
      ...value,
      id: this.occurrence(value.id),
      filePath: this.path(value.filePath),
      componentId: this.occurrence(value.componentId),
      facetId: this.occurrence(value.facetId),
      tagIdentity: value.tagIdentity ? this.tag(value.tagIdentity) : undefined,
    };
  }
}
