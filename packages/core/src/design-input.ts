import { loadSigilWorkspace } from "./workspace.ts";
import { normalizePath, relativePath } from "./path.ts";
import { resolveSigilWorkspace } from "./pipeline.ts";
import { canonicalJson } from "./canonical.ts";
import { compareScalarText, orderDiagnostics } from "./diagnostics.ts";
import { captureSource, type SourceInput } from "./source-text.ts";
import type { ResolvedImport, ResolvedImportName } from "./model/resolution.ts";
import { SourceProvenance } from "./source-provenance.ts";
import {
  type EmbeddedContent,
  type InlineLink,
  SIGIL_CORE_VERSION,
  SIGIL_VERSION,
  type SigilDiagnostic,
  type SigilFileSystem,
  type SourceRange,
  type WorkspaceLoadOptions,
} from "./model.ts";

export interface DesignEntity {
  readonly id: string;
  readonly type: "Component" | "Tag";
  readonly label: string;
  readonly source: string;
  readonly owner: string | null;
  readonly range: SourceRange;
  readonly nameRange: SourceRange;
  readonly identityResolved: boolean;
  readonly valid: boolean;
  readonly complete: boolean;
}
export interface DesignUnit {
  readonly id: string;
  readonly source: string;
  readonly owner: string;
  readonly section: string;
  readonly range: SourceRange;
  readonly proseRange: SourceRange;
  readonly grouping: string | null;
  readonly introductions: readonly string[];
  readonly references: readonly string[];
  readonly links: readonly string[];
  readonly payload: EmbeddedContent | null;
  readonly valid: boolean;
  readonly complete: boolean;
}
export interface DesignIntroduction {
  readonly id: string;
  readonly kind: "group" | "inline";
  readonly name: string;
  readonly source: string;
  readonly owner: string;
  readonly tag: string | null;
  readonly section: string;
  readonly facet: string | null;
  readonly group: string | null;
  readonly range: SourceRange;
  readonly nameRange: SourceRange;
  readonly valid: boolean;
  readonly complete: boolean;
}
export interface DesignGroup {
  readonly id: string;
  readonly source: string;
  readonly owner: string;
  readonly name: string;
  readonly tag: string | null;
  readonly section: string;
  readonly range: SourceRange;
  readonly nameRange: SourceRange;
  readonly headerRange: SourceRange;
  readonly bodyRange: SourceRange;
  readonly valid: boolean;
  readonly complete: boolean;
}
export interface DesignReference {
  readonly id: string;
  readonly source: string;
  readonly owner: string;
  readonly facet: string;
  readonly name: string;
  readonly tag: string | null;
  readonly status: "resolved" | "ambiguous";
  readonly range: SourceRange;
}
export interface DesignLink extends InlineLink {
  readonly id: string;
  readonly source: string;
  readonly owner: string;
  readonly facet: string;
}
export interface DesignImport {
  readonly id: string;
  readonly source: string;
  readonly target: string | null;
  readonly path: string;
  readonly provider: string;
  readonly providerId: string | null;
  readonly range: SourceRange;
  readonly pathRange: SourceRange;
  readonly providerRange: SourceRange;
  readonly status: ResolvedImport["status"];
  readonly valid: boolean;
  readonly complete: boolean;
  readonly names: readonly {
    readonly id: string;
    readonly name: string;
    readonly entity: string | null;
    readonly range: SourceRange;
    readonly status: ResolvedImportName["status"];
    readonly uses: readonly string[];
  }[];
}
/** Structural transport only; no semantic laws or model-produced interpretation. */
export interface DesignInput {
  readonly schemaVersion: 2;
  readonly languageVersion: "0.8.0";
  readonly frontendVersion: string;
  readonly sources: readonly { path: string; text: string }[];
  readonly context: readonly { path: string; text: string | null }[];
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly imports: readonly DesignImport[];
  readonly entities: readonly DesignEntity[];
  readonly units: readonly DesignUnit[];
  readonly groups: readonly DesignGroup[];
  readonly introductions: readonly DesignIntroduction[];
  readonly references: readonly DesignReference[];
  readonly links: readonly DesignLink[];
}
export interface DesignInputResult {
  readonly root: string;
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly bundle: DesignInput | null;
}

// @sigil implements packages/core/src/design-input.sigil::SigilDesignInput::ResolvedDesignInput interface
// @sigil implements packages/core/src/design-input.sigil::SigilDesignInput::SourceFidelity constraints
export async function loadDesignInput(
  fs: SigilFileSystem,
  options: WorkspaceLoadOptions,
): Promise<DesignInputResult> {
  const captured = new Map<string, ReturnType<typeof captureSource>>();
  const read = async (path: string): Promise<SourceInput> => {
    const input = await fs.readSourceFile(path);
    const value = captureSource(path, input),
      key = normalizePath(path),
      previous = captured.get(key);
    if (
      previous &&
      canonicalJson(previous.source?.text ?? [...previous.rawBytes ?? []]) !==
        canonicalJson(value.source?.text ?? [...value.rawBytes ?? []])
    ) {
      throw new Error(`Frontend input changed during loading: ${path}`);
    }
    captured.set(key, value);
    return input;
  };
  const workspace = await loadSigilWorkspace({
    readSourceFile: read,
    async readTextFile(path) {
      await read(path);
      const source = captured.get(normalizePath(path))!.source;
      if (!source) throw new Error(`Invalid UTF-8 source: ${path}`);
      return source.text;
    },
    exists: (path) => fs.exists(path),
    listFiles: (root) => fs.listFiles(root),
  }, options);
  const resolved = resolveSigilWorkspace(workspace);
  if ([...captured.values()].some((c) => !c.source)) {
    return {
      root: workspace.root,
      bundle: null,
      diagnostics: orderDiagnostics([
        ...resolved.diagnostics,
        ...[...captured.values()].flatMap((c) => c.diagnostics),
      ]),
    };
  }
  const provenance = new SourceProvenance(workspace.root);
  const path = (value: string) => {
    const result = relativePath(workspace.root, value);
    if (
      result === "." || result.startsWith("/") ||
      result.split("/").includes("..") || /^[A-Za-z]:/.test(result)
    ) {
      throw new Error(`Frontend input outside workspace: ${value}`);
    }
    return result;
  };
  const componentIds = new Map(
    resolved.components.map((
      c,
    ) => [
      c.id,
      `urn:sigil:component:${encodeURIComponent(path(c.filePath))}:${
        encodeURIComponent(c.name)
      }${c.identity ? "" : `:at:${c.declaration.range.start}`}`,
    ]),
  );
  const tags = new Map<string, string>();
  const entities: DesignEntity[] = [],
    units: DesignUnit[] = [],
    groups: DesignGroup[] = [],
    introductions: DesignIntroduction[] = [],
    references: DesignReference[] = [],
    links: DesignLink[] = [];
  for (const c of resolved.components) {
    const owner = componentIds.get(c.id)!, source = path(c.filePath);
    entities.push({
      id: owner,
      type: "Component",
      label: c.name,
      source,
      owner: null,
      range: c.declaration.range,
      nameRange: c.declaration.nameRange,
      identityResolved: !!c.identity,
      valid: c.declaration.valid,
      complete: c.declaration.complete,
    });
    for (const tag of c.tags) {
      const id = tag.identity
        ? `${owner}:tag:${encodeURIComponent(tag.name)}`
        : null;
      if (id) {
        tags.set(tag.identity!.id, id);
        const first = tag.introductions[0];
        entities.push({
          id,
          type: "Tag",
          label: tag.name,
          source,
          owner,
          range: first.range,
          nameRange: first.nameRange,
          identityResolved: true,
          valid: true,
          complete: true,
        });
      }
      for (const i of tag.introductions) {
        introductions.push({
          id: provenance.occurrence(i.id),
          source,
          owner,
          name: i.name,
          kind: i.kind,
          tag: id,
          section: i.sectionName,
          facet: i.facetId ? provenance.occurrence(i.facetId) : null,
          group: i.groupId ? provenance.occurrence(i.groupId) : null,
          range: i.range,
          nameRange: i.nameRange,
          valid: i.valid,
          complete: i.complete,
        });
      }
    }
  }
  const introductionById = new Map(introductions.map((i) => [i.id, i]));
  const introductionsByFacet = new Map<string, string[]>();
  for (const i of introductions) {
    if (!i.facet) continue;
    const ids = introductionsByFacet.get(i.facet) ?? [];
    ids.push(i.id);
    introductionsByFacet.set(i.facet, ids);
  }
  const referencesByFacet = new Map<string, string[]>();
  for (const c of resolved.components) {
    const owner = componentIds.get(c.id)!, source = path(c.filePath);
    for (const ref of c.references) {
      const facet = provenance.occurrence(ref.facetId);
      const ids = referencesByFacet.get(facet) ?? [];
      ids.push(provenance.occurrence(ref.id));
      referencesByFacet.set(facet, ids);
      references.push({
        id: provenance.occurrence(ref.id),
        source,
        owner,
        facet: provenance.occurrence(ref.facetId),
        name: ref.name,
        tag: ref.tagIdentity ? tags.get(ref.tagIdentity.id) ?? null : null,
        status: ref.status,
        range: ref.range,
      });
    }
    for (const section of c.declaration.sections) {
      const addGroup = (g: (typeof section.groups)[number]) => {
        groups.push({
          id: provenance.occurrence(g.id),
          source,
          owner,
          name: g.name,
          tag: introductionById.get(provenance.occurrence(g.id))?.tag ?? null,
          section: section.name,
          range: g.range,
          nameRange: g.nameRange,
          headerRange: g.headerRange,
          bodyRange: g.bodyRange,
          valid: g.valid,
          complete: g.complete,
        });
        g.groups.forEach(addGroup);
      };
      section.groups.forEach(addGroup);
      for (const facet of section.units) {
        const id = provenance.occurrence(facet.id);
        const facetLinks = facet.links.map((link) => ({
          ...link,
          id: `link:${encodeURIComponent(source)}:${link.range.start}`,
          source,
          owner,
          facet: id,
        }));
        links.push(...facetLinks);
        units.push({
          id,
          source,
          owner,
          section: section.name,
          range: facet.range,
          proseRange: facet.proseRange,
          grouping: facet.groupingId
            ? provenance.occurrence(facet.groupingId)
            : null,
          introductions: introductionsByFacet.get(id) ?? [],
          references: referencesByFacet.get(id) ?? [],
          links: facetLinks.map((l) => l.id),
          payload: facet.literalBlocks[0] ?? null,
          valid: facet.valid,
          complete: facet.complete,
        });
      }
    }
  }
  const diagnostics = orderDiagnostics(
    resolved.diagnostics.map((d) => ({
      ...d,
      filePath: d.filePath ? path(d.filePath) : undefined,
      related: d.related.map((r) => ({
        ...r,
        filePath: r.filePath ? path(r.filePath) : undefined,
      })),
    })),
  );
  const sort = <T extends { id: string }>(items: T[]) =>
    items.sort((a, b) => compareScalarText(a.id, b.id));
  return {
    root: workspace.root,
    diagnostics,
    bundle: {
      schemaVersion: 2,
      languageVersion: SIGIL_VERSION,
      frontendVersion: SIGIL_CORE_VERSION,
      sources: workspace.files.map((f) => ({
        path: path(f.path),
        text: f.document.source!.text,
      })).sort((a, b) => compareScalarText(a.path, b.path)),
      context: [
        ".sigil/config.json",
        ".sigil/glossary.json",
        ".sigil/local.json",
      ].map((file) => ({
        path: file,
        text: captured.get(normalizePath(`${workspace.root}/${file}`))?.source
          ?.text ?? null,
      })),
      diagnostics,
      imports: sort(resolved.imports.map((item) => ({
        id: provenance.occurrence(item.id),
        source: path(item.sourceFile),
        target: item.targetFile ? path(item.targetFile) : null,
        path: item.declaration.path,
        provider: item.declaration.provider,
        providerId: item.providerId
          ? componentIds.get(item.providerId) ?? null
          : null,
        range: item.declaration.range,
        pathRange: item.declaration.pathRange,
        providerRange: item.declaration.providerRange,
        status: item.status,
        valid: item.declaration.valid,
        complete: item.declaration.complete,
        names: item.names.map((n) => ({
          id: provenance.occurrence(n.id),
          name: n.name,
          entity: n.tag?.identity ? tags.get(n.tag.identity.id) ?? null : null,
          range: n.selection.range,
          status: n.status,
          uses: n.uses.map((u) => provenance.occurrence(u.referenceId)),
        })),
      }))),
      entities: sort(entities),
      units: sort(units),
      groups: sort(groups),
      introductions: sort(introductions),
      references: sort(references),
      links: sort(links),
    },
  };
}
