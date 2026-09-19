import { loadSigilWorkspace } from "./workspace.ts";
import { normalizePath, relativePath } from "./path.ts";
import { resolveSigilWorkspace } from "./pipeline.ts";
import {
  SIGIL_CORE_VERSION,
  type SigilDiagnostic,
  type SigilFileSystem,
  type SourceRange,
  type WorkspaceLoadOptions,
} from "./model.ts";

/** Structural transport only. sigilc owns hashing, schema checks and meaning. */
export interface DesignInput {
  readonly schemaVersion: 1;
  readonly frontendVersion: string;
  readonly sources: readonly { path: string; text: string }[];
  readonly context: readonly { path: string; text: string | null }[];
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly imports: readonly {
    source: string;
    target: string | null;
    names: readonly { name: string; entity: string | null }[];
  }[];
  readonly entities: readonly {
    id: string;
    type: "Component" | "Tag";
    label: string;
    source: string;
    owner: string | null;
    exported: boolean;
  }[];
  readonly units: readonly {
    id: string;
    source: string;
    owner: string | null;
    form: "component" | "expand";
    section: string;
    tag: string | null;
    range: SourceRange;
  }[];
}

// @sigil implements packages/core/src/design-input.sigil::SigilDesignInput::ResolvedDesignInput interface
export async function loadDesignInput(
  fs: SigilFileSystem,
  options: WorkspaceLoadOptions,
): Promise<{ root: string; bundle: DesignInput }> {
  const captured = new Map<string, string>();
  const workspace = await loadSigilWorkspace({
    async readTextFile(path) {
      const text = await fs.readTextFile(path);
      const key = normalizePath(path);
      const previous = captured.get(key);
      if (previous !== undefined && previous !== text) {
        throw new Error(`Frontend input changed during loading: ${path}`);
      }
      captured.set(key, text);
      return text;
    },
    exists: (path) => fs.exists(path),
    listFiles: (root) => fs.listFiles(root),
  }, options);
  const resolved = resolveSigilWorkspace(workspace);
  const path = (value: string) => {
    const result = relativePath(workspace.root, value);
    if (
      result === "." || result.startsWith("/") ||
      result.split("/").includes("..") || /^[A-Za-z]:/.test(result)
    ) throw new Error(`Frontend input outside workspace: ${value}`);
    return result;
  };
  const componentId = (file: string, name: string) =>
    `urn:sigil:component:${encodeURIComponent(path(file))}:${
      encodeURIComponent(name)
    }`;
  const entities: DesignInput["entities"][number][] = [];
  const owners = new Map<string, string>();
  const formKey = (file: string, range: SourceRange) =>
    JSON.stringify([path(file), range.start.line, range.start.column]);
  for (const component of resolved.components) {
    const id = componentId(component.filePath, component.name);
    entities.push({
      id,
      type: "Component",
      label: component.name,
      source: path(component.filePath),
      owner: null,
      exported: true,
    });
    owners.set(formKey(component.filePath, component.declaration.range), id);
    for (const expand of component.expansions.expands) {
      owners.set(formKey(expand.filePath, expand.declaration.range), id);
    }
    for (const tag of component.tagScope.tags) {
      if (tag.isImported) continue;
      entities.push({
        id: `${id}:tag:${
          encodeURIComponent(tag.identity.normalizedIdentifier)
        }`,
        type: "Tag",
        label: tag.identifier,
        source: path(tag.identity.filePath),
        owner: id,
        exported: tag.isPublic,
      });
    }
  }
  const units: DesignInput["units"][number][] = [];
  for (const file of workspace.files) {
    for (
      const form of [...file.document.components, ...file.document.expands]
    ) {
      for (const section of form.sections) {
        for (const unit of section.units) {
          units.push({
            id: `urn:sigil:unit:${
              encodeURIComponent(path(file.path))
            }:${unit.range.start.line}:${unit.range.start.column}`,
            source: path(file.path),
            owner: owners.get(formKey(file.path, form.range)) ?? null,
            form: form.kind,
            section: section.name,
            tag: unit.conceptName ?? null,
            range: unit.range,
          });
        }
      }
    }
  }
  const sources = workspace.files.map((file) => {
    const text = captured.get(normalizePath(file.path));
    if (text === undefined) throw new Error(`Uncaptured source: ${file.path}`);
    return { path: path(file.path), text };
  }).sort((a, b) => compare(a.path, b.path));
  // Discovery may inspect parent workspace configs. Only the selected
  // workspace's interpretation inputs belong in its preparation bundle.
  const contextPaths = [
    ".sigil/config.json",
    ".sigil/local.json",
    ".sigil/glossary.json",
  ];
  return {
    root: workspace.root,
    bundle: {
      schemaVersion: 1,
      frontendVersion: SIGIL_CORE_VERSION,
      sources,
      context: contextPaths.sort().map((file) => ({
        path: file,
        text: captured.get(normalizePath(`${workspace.root}/${file}`)) ?? null,
      })),
      diagnostics: resolved.diagnostics.map((d) => ({
        ...d,
        ...(d.filePath ? { filePath: path(d.filePath) } : {}),
      })).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
      imports: resolved.imports.map((item) => ({
        source: path(item.sourceFile),
        target: item.targetFile ? path(item.targetFile) : null,
        names: item.names.map((name) => ({
          name: name.name,
          entity: name.componentFile && name.component
            ? componentId(name.componentFile, name.component.name)
            : null,
        })),
      })).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
      entities: entities.sort((a, b) => compare(a.id, b.id)),
      units: units.sort((a, b) => compare(a.id, b.id)),
    },
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
