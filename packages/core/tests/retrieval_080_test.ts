import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { resolveSigilWorkspace } from "../src/pipeline.ts";
import {
  projectRetrieval,
  retrievePurposeContext,
} from "../src/context-retrieval.ts";
import { diagnostic } from "../src/diagnostics.ts";
import { canonicalJson, sha256Canonical } from "../src/canonical.ts";
import { assert, assertEquals } from "./assert.ts";
const config = JSON.stringify({
  sigilVersion: "0.8.0",
  workspace: { name: "test" },
  files: { include: ["**/*.sigil"] },
});
const component = (name: string, body: string, rest = "") =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${body}\n}\n${rest}\n}`;
async function fixture(files: Record<string, string>) {
  return resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({ ".sigil/config.json": config, ...files }),
      { startPath: "." },
    ),
  );
}
const files = {
  "leaf.sigil": component("Leaf", "A *leaf* exists."),
  "p.sigil": "@leaf.sigil from Leaf import { leaf }\n" +
    component(
      "P",
      "A *query* exists.\n\nUse leaf.",
      "state {\nRetain provider state.\n}\nconstraints {\nConstrain query.\n}\ndecisions {\nExplain the provider choice.\n}",
    ),
  "c.sigil": "@p.sigil from P import { query }\n" +
    component(
      "C",
      "Use query.",
      "logic {\nDescribe the consumer algorithm.\n}\ncases {\nExercise query.\n}",
    ),
  "_module.sigil": component("Summary", "Describe the project."),
};
const target = {
  kind: "component" as const,
  componentName: "C",
  path: "c.sigil",
};

Deno.test("retrieval v2 retains every seed Facet, complete direct provider context and no implicit ancestry", async () => {
  const r = await fixture(files);
  const result = await retrievePurposeContext(r, target, "semantic");
  assertEquals(result.schema, "sigil-purpose-retrieval/v2");
  assertEquals(result.policyVersion, 2);
  assertEquals(result.diagnostics, []);
  assertEquals(
    result.evidence.filter((e) => e.kind === "selected-contract").map((e) =>
      e.sectionName
    ),
    ["goal", "interface", "logic", "cases"],
  );
  const provider = result.evidence.filter((e) => e.componentName === "P");
  assertEquals(provider.map((e) => e.sectionName).sort(), [
    "constraints",
    "decisions",
    "goal",
    "interface",
    "interface",
    "state",
  ]);
  assert(
    !result.evidence.some((e) =>
      e.componentName === "Leaf" || e.componentName === "Summary"
    ),
  );
  assert(
    result.exclusions.some((e) => e.rule === "exclude-transitive-dependency"),
  );
  assert(
    result.evidence.filter((e) => e.facet).every((e) =>
      e.sourceSnapshot && e.facet!.sourceLines.length
    ),
  );
  const projection = await projectRetrieval(result);
  assertEquals(projection.schema, "sigil-retrieval-projection/v2");
  assertEquals(
    projection.components.find((c) => c.name === "P")!.constraints.length,
    1,
  );
  const { fingerprint, ...base } = result;
  assertEquals(fingerprint, await sha256Canonical(base));
});

Deno.test("Facet evidence preserves many Tags, links, physical prose and exact payload with one role", async () => {
  const source = component(
    "C",
    "A *query* uses *result*.\n\nUse query and result with [notes](./notes.md).\n```text\nraw  \n```",
    "constraints {\nConstrain query.\n}",
  );
  const r = await fixture({ "c.sigil": source });
  const result = await retrievePurposeContext(r, target, "architecture");
  const evidence = result.evidence.find((e) => e.facet?.payload)!;
  assertEquals(evidence.facet!.references.map((r) => r.name), [
    "query",
    "result",
  ]);
  assertEquals(evidence.facet!.links[0].destination, "./notes.md");
  assertEquals(evidence.facet!.payload!.rawBody, "raw  \n");
  assertEquals(result.evidence.filter((e) => e.facet).length, 4);
  assertEquals(
    new Set(result.evidence.filter((e) => e.facet).map((e) => e.facet!.id))
      .size,
    4,
  );
});

Deno.test("diagnostic evidence retains stage and related locations through deduplication and identity", async () => {
  const r = await fixture(files);
  const a = diagnostic("SIGIL_SEMANTIC_CONFLICT", "same", {
    filePath: "c.sigil",
    range: { start: 0, end: 1 },
    stage: "interpretation",
    related: [{ filePath: "p.sigil", range: { start: 1, end: 2 } }],
  });
  const b = { ...a, stage: "host" as const };
  const c = {
    ...a,
    related: [{ filePath: "p.sigil", range: { start: 2, end: 3 } }],
  };
  const result = await retrievePurposeContext(
    { ...r, diagnostics: [a, b, c, a] },
    target,
    "semantic",
  );
  assertEquals(result.diagnostics.length, 3);
  const units = result.evidence.filter((e) => e.kind === "diagnostic");
  assertEquals(units.length, 3);
  assertEquals(new Set(units.map((e) => e.identity)).size, 3);
  assert(units.every((e) => e.diagnostic));
});

Deno.test("budgets preserve selected evidence and disclose withheld provider context", async () => {
  const r = await fixture(files);
  const full = await retrievePurposeContext(r, target, "semantic");
  const limited = await retrievePurposeContext(
    r,
    target,
    "semantic",
    r.glossary,
    null,
    { maxEvidenceBytes: 0 },
  );
  assertEquals(limited.evidence.map((e) => e.kind), [
    "selected-contract",
    "selected-contract",
    "selected-contract",
    "selected-contract",
  ]);
  assert(limited.budget!.withheldCount > 0);
  assert(limited.budget!.includedBytes > 0);
  assertEquals((await projectRetrieval(limited)).budget, limited.budget);
  assert(full.evidence.length > limited.evidence.length);
});

Deno.test("implementation retrieval preserves imported Tag annotation scope and refuses stale evidence", async () => {
  const r = await fixture(files);
  const input = {
    workspaceSnapshotIdentity: r.workspace.workspaceSnapshotIdentity,
    discoveryState: "complete" as const,
    sources: [{
      filePath: "entry.ts",
      text:
        "// @sigil implements c.sigil::C::query interface\nexport function run() {}",
    }],
    diagnostics: [],
  };
  const result = await retrievePurposeContext(
    r,
    target,
    "implementation",
    r.glossary,
    input,
  );
  const owned = result.evidence.find((e) => e.kind === "ownership-projection")!;
  assertEquals(owned.ownership!.tagName, "query");
  assertEquals(owned.ownership!.tagIdentity!.owner.componentName, "P");
  assertEquals(owned.range, undefined);
  assert(!owned.text.includes("function run"));
  const projection = await projectRetrieval(result);
  const consumer = projection.components.find((c) => c.name === "C")!;
  assertEquals(consumer.ownership[0].tagName, "query");
  assertEquals(consumer.interface.map((g) => g.name), [undefined]);
  const stale = await retrievePurposeContext(
    r,
    target,
    "implementation",
    r.glossary,
    { ...input, workspaceSnapshotIdentity: "stale" },
  );
  assertEquals(stale.diagnostics.map((d) => d.code), [
    "SIGIL_RETRIEVAL_EVIDENCE_SNAPSHOT_MISMATCH",
  ]);
  const unavailable = await retrievePurposeContext(r, target, "implementation");
  assert(unavailable.evidence.some((e) => e.kind === "selected-contract"));
  assert(
    unavailable.diagnostics.some((d) =>
      d.code === "SIGIL_RETRIEVAL_IMPLEMENTATION_DISCOVERY_UNAVAILABLE"
    ),
  );
});

Deno.test("cycles, seed reasons and discovery permutations preserve deterministic context", async () => {
  const cyclic = {
    "a.sigil": "@b.sigil from B import { beta }\n" +
      component(
        "A",
        "A *alpha* exists.\n\nUse beta.",
        "state {\nRetain state.\n}",
      ),
    "b.sigil": "@a.sigil from A import { alpha }\n" +
      component(
        "B",
        "A *beta* exists.\n\nUse alpha.",
        "logic {\nRetain an algorithm.\n}",
      ),
  };
  const r = await fixture(cyclic),
    reverse = await fixture(
      Object.fromEntries(Object.entries(cyclic).reverse()),
    );
  const t = { kind: "component" as const, componentName: "A", path: "a.sigil" };
  const result = await retrievePurposeContext(r, t, "architecture"),
    again = await retrievePurposeContext(reverse, t, "architecture");
  assertEquals(canonicalJson(result), canonicalJson(again));
  assert(result.graph.edges.some((e) => e.relation === "cycle-member"));
  assert(
    result.evidence.some((e) =>
      e.componentName === "B" && e.sectionName === "logic"
    ),
  );
  const ids = new Set(result.graph.edges.map((e) => e.identity));
  assert(
    result.inclusionReasons.every((reason) =>
      reason.edgeIdentities.every((id) => ids.has(id))
    ),
  );
  assertEquals(
    new Set(result.evidence.filter((e) => e.facet).map((e) => e.facet!.id))
      .size,
    result.evidence.filter((e) => e.facet).length,
  );
});

Deno.test("retrieval provenance and fingerprints are portable across checkout roots", async () => {
  const at = async (root: string) =>
    resolveSigilWorkspace(
      await loadSigilWorkspace(
        new InMemorySigilFileSystem(Object.fromEntries(
          Object.entries({
            ".sigil/config.json": config,
            ...files,
          }).map(([path, text]) => [`${root}/${path}`, text]),
        )),
        { startPath: root },
      ),
    );
  const a = await at("/first/project"), b = await at("/second/project");
  const evidence = (r: typeof a) => ({
    workspaceSnapshotIdentity: r.workspace.workspaceSnapshotIdentity,
    discoveryState: "complete" as const,
    sources: [{
      filePath: "entry.ts",
      text:
        "// @sigil implements c.sigil::C::query interface\nexport function run() {}",
    }],
    diagnostics: [],
  });
  assertEquals(
    a.workspace.workspaceSnapshotIdentity,
    b.workspace.workspaceSnapshotIdentity,
  );
  const first = await retrievePurposeContext(
    a,
    target,
    "implementation",
    a.glossary,
    evidence(a),
  );
  const second = await retrievePurposeContext(
    b,
    target,
    "implementation",
    b.glossary,
    evidence(b),
  );
  assert(!JSON.stringify(first).includes("first%2Fproject"));
  assertEquals(canonicalJson(first), canonicalJson(second));
});

Deno.test("retrieval ignores inapplicable evidence and preserves failure precedence", async () => {
  const r = await fixture(files);
  const stale = {
    workspaceSnapshotIdentity: "stale",
    discoveryState: "unavailable" as const,
    sources: [],
    diagnostics: [diagnostic("SIGIL_IMPLEMENTATION_ANNOTATION", "unavailable")],
  };
  for (const purpose of ["semantic", "architecture"] as const) {
    assertEquals(
      await retrievePurposeContext(r, target, purpose, r.glossary, stale),
      await retrievePurposeContext(r, target, purpose),
    );
  }
  for (
    const [requested, code] of [
      [
        { ...target, path: "../c.sigil" },
        "SIGIL_RETRIEVAL_TARGET_PATH_INVALID",
      ],
      [
        { ...target, componentName: "Unknown" },
        "SIGIL_RETRIEVAL_COMPONENT_NOT_FOUND",
      ],
      [
        { ...target, path: "p.sigil" },
        "SIGIL_RETRIEVAL_COMPONENT_IDENTITY_MISMATCH",
      ],
    ] as const
  ) {
    const result = await retrievePurposeContext(
      r,
      requested,
      "implementation",
      r.glossary,
      stale,
    );
    assertEquals(result.diagnostics.map((d) => d.code), [code]);
    assertEquals(result.graph, { nodes: [], edges: [] });
    assertEquals(result.evidence, []);
    const { fingerprint, ...base } = result;
    assertEquals(fingerprint, await sha256Canonical(base));
  }
});

Deno.test("implementation discovery rejects duplicate, unsorted and extra-field source envelopes", async () => {
  const r = await fixture(files);
  const source = {
    filePath: "b.ts",
    text: "// @sigil implements c.sigil::C interface\nexport function b() {}",
  };
  for (
    const sources of [[source, source], [source, {
      ...source,
      filePath: "a.ts",
    }], [{ ...source, extra: true }]]
  ) {
    const result = await retrievePurposeContext(
      r,
      target,
      "implementation",
      r.glossary,
      {
        workspaceSnapshotIdentity: r.workspace.workspaceSnapshotIdentity,
        discoveryState: "complete",
        sources,
        diagnostics: [],
      },
    );
    assert(
      result.diagnostics.some((d) =>
        d.code === "SIGIL_RETRIEVAL_IMPLEMENTATION_DISCOVERY_UNAVAILABLE"
      ),
    );
    assert(!result.evidence.some((e) => e.ownership));
  }
});
