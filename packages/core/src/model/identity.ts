/** Stable declaration owner, independent of its source occurrence offset. */
export interface ComponentIdentity {
  readonly componentName: string;
  readonly declarationPath: string;
}

export interface TagIdentity {
  readonly id: string;
  readonly name: string;
  readonly owner: ComponentIdentity;
}

export function componentIdentityKey(owner: ComponentIdentity): string {
  return `component:${encodeURIComponent(owner.declarationPath)}:${
    encodeURIComponent(owner.componentName)
  }`;
}
export function tagIdentity(
  owner: ComponentIdentity,
  name: string,
): TagIdentity {
  return {
    id: `${componentIdentityKey(owner)}:tag:${encodeURIComponent(name)}`,
    name,
    owner,
  };
}
