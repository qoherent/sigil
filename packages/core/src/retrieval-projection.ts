import { canonicalJson, sha256Canonical } from "./canonical.ts";
import { compareScalarText } from "./diagnostics.ts";
import type {
  EvidenceKind,
  PurposeRetrievalResult,
  RetrievalProjection,
  RetrievalProjectionComponent,
  RetrievalProjectionItem,
  RetrievalProjectionLink,
  RetrievalProjectionOwnership,
  RetrievalProjectionTagGroup,
} from "./model/retrieval.ts";
interface Entry {
  id: string;
  name: string;
  path: string;
  role: RetrievalProjectionComponent["role"];
  goal: RetrievalProjectionItem[];
  state: RetrievalProjectionItem[];
  logic: RetrievalProjectionItem[];
  constraints: RetrievalProjectionItem[];
  decisions: RetrievalProjectionItem[];
  cases: RetrievalProjectionItem[];
  ownership: RetrievalProjectionOwnership[];
  links: RetrievalProjectionLink[];
  groups: Map<
    string,
    {
      name?: string;
      groupId?: string;
      items: RetrievalProjectionItem[];
      ownership: RetrievalProjectionOwnership[];
    }
  >;
}
const roleRank = (role: RetrievalProjectionComponent["role"]) =>
  ["selected", "dependency", "importer", "cycle-member"].indexOf(role);
const roleFor = (
  kind: EvidenceKind,
): RetrievalProjectionComponent["role"] | undefined => {
  if (kind === "selected-contract") return "selected";
  if (
    kind === "dependency-contract" || kind === "dependency-decision" ||
    kind === "tag-origin"
  ) return "dependency";
  if (kind === "importer-contract") return "importer";
  if (kind === "cycle-contract") return "cycle-member";
};

// @sigil implements packages/core/src/context-retrieval.sigil::SigilContextRetrieval::RetrievalProjectionDerivation interface
export async function projectRetrieval(
  result: PurposeRetrievalResult,
): Promise<RetrievalProjection> {
  const key = (path: string, name: string) => canonicalJson([path, name]);
  const nodes = new Map(
    result.graph.nodes.filter((n) => n.kind === "component-declaration").map(
      (n) => [key(n.path, n.componentName!), n],
    ),
  );
  const entries = new Map<string, Entry>();
  for (const item of result.evidence) {
    const role = roleFor(item.kind);
    if (!role || !item.componentName || !item.path || !item.facet) continue;
    const id = key(item.path, item.componentName);
    let entry = entries.get(id);
    if (!entry && item.kind === "tag-origin") continue;
    if (!entry) {
      entry = {
        id: nodes.get(id)!.identity,
        name: item.componentName,
        path: item.path,
        role,
        goal: [],
        state: [],
        logic: [],
        constraints: [],
        decisions: [],
        cases: [],
        ownership: [],
        links: [],
        groups: new Map(),
      };
      entries.set(id, entry);
    }
    if (roleRank(role) < roleRank(entry.role)) entry.role = role;
    const value: RetrievalProjectionItem = {
      text: item.text,
      path: item.path,
      range: item.range,
      facet: item.facet,
      sourceSnapshot: item.sourceSnapshot,
    };
    if (item.sectionName === "interface") {
      const groupKey = item.facet.groupingId ?? "";
      const group = entry.groups.get(groupKey) ??
        {
          name: item.facet.groupingTag,
          groupId: item.facet.groupingId,
          items: [],
          ownership: [],
        };
      group.items.push(value);
      entry.groups.set(groupKey, group);
    } else if (item.sectionName) entry[item.sectionName].push(value);
  }
  for (const item of result.evidence) {
    if (!item.ownership || !item.componentName) continue;
    const entry = entries.get(
      key(item.ownership.componentPath, item.componentName),
    );
    if (!entry) continue;
    const owned = item.ownership;
    entry.ownership.push({
      path: owned.filePath,
      location: owned.location,
      relation: owned.relation,
      symbol: owned.symbolIdentity,
      sections: owned.sections,
      tagName: owned.tagName,
      tagIdentity: owned.tagIdentity,
      facetIds: owned.facetIds,
    });
  }
  const byIdentity = new Map(result.graph.nodes.map((n) => [n.identity, n]));
  for (const edge of result.graph.edges) {
    const source = byIdentity.get(edge.sourceIdentity),
      target = byIdentity.get(edge.targetIdentity);
    if (
      !source?.componentName || !target?.componentName ||
      edge.relation === "owned-implementation"
    ) continue;
    const sourceEntry = entries.get(key(source.path, source.componentName)),
      targetEntry = entries.get(key(target.path, target.componentName));
    if (sourceEntry && targetEntry) {
      sourceEntry.links.push({
        relation: edge.relation,
        target: targetEntry.id,
        location: { path: edge.originPath, range: edge.originRange },
      });
    }
  }
  const components: RetrievalProjectionComponent[] = [...entries.values()].sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      compareScalarText(a.path, b.path) || compareScalarText(a.name, b.name),
  ).map(({ groups, ...entry }) => ({
    ...entry,
    interface: [...groups.values()] as RetrievalProjectionTagGroup[],
  }));
  const glossary = result.evidence.flatMap((item) => {
    if (item.kind !== "glossary-definition") return [];
    const separator = item.text.indexOf(": ");
    return separator < 0 ? [] : [{
      term: item.text.slice(0, separator),
      definition: item.text.slice(separator + 2),
    }];
  });
  const base = {
    schema: "sigil-retrieval-projection/v2" as const,
    purpose: result.purpose,
    target: result.target,
    components,
    glossary,
    diagnostics: result.diagnostics,
    ...(result.budget ? { budget: result.budget } : {}),
  };
  return { ...base, fingerprint: await sha256Canonical(base) };
}
