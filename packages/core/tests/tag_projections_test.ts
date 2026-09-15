import { InMemorySigilFileSystem } from "../src/filesystem.ts";
import { loadSigilWorkspace } from "../src/workspace.ts";
import { resolveSigilWorkspace } from "../src/pipeline.ts";
import { stronglyConnectedComponentGroups } from "../src/graph.ts";
import {
  agentDependencyContextFor,
  agentDependentContextFor,
  componentContracts,
  componentDesignFor,
  tagNamespaceFor,
} from "../src/projections.ts";
import { assert, assertEquals } from "./assert.ts";
const config = JSON.stringify({
  sigilVersion: "0.8.0",
  workspace: { name: "test" },
  files: { include: ["**/*.sigil"] },
});
const component = (name: string, prose: string, rest = "") =>
  `component ${name} {\ngoal {\nOwn a responsibility.\n}\ninterface {\n${prose}\n}\n${rest}\n}`;
async function fixture(files: Record<string, string>) {
  return resolveSigilWorkspace(
    await loadSigilWorkspace(
      new InMemorySigilFileSystem({ ".sigil/config.json": config, ...files }),
      { startPath: "." },
    ),
  );
}

Deno.test("Tag graph and projections retain direct provider context and actual consumer uses", async () => {
  const r = await fixture({
    "leaf.sigil": component("Leaf", "A *leaf* has meaning."),
    "provider.sigil": "@leaf.sigil from Leaf import { leaf }\n" +
      component(
        "Provider",
        "A *query* has meaning.\n\nUse leaf.",
        "constraints {\nConstrain query.\n}\ndecisions {\nRetain rationale.\n}",
      ),
    "consumer.sigil": "@provider.sigil from Provider import { query }\n" +
      component("Consumer", "Use query.") + "\n" +
      component("Sibling", "Offer an interaction."),
    "folder/_module.sigil": component("Summary", "Summarize the project."),
  });
  assertEquals(r.diagnostics, []);
  const context = agentDependencyContextFor(r, "Consumer")!;
  assertEquals(context.providers.map((p) => p.component.name), ["Provider"]);
  assertEquals(
    context.providers[0].component.declaration.sections.map((s) => s.name),
    ["goal", "interface", "constraints", "decisions"],
  );
  assertEquals(context.providers[0].selections.map((s) => s.name), ["query"]);
  assertEquals(context.providers[0].uses.map((u) => u.ownerName), ["Consumer"]);
  assert(!context.relatedFilePaths.includes("leaf.sigil"));
  assert(!context.relatedFilePaths.includes("folder/_module.sigil"));
  assertEquals(
    tagNamespaceFor(r, "Consumer")!.accessibleTags.map((t) => t.name),
    ["query"],
  );
  assertEquals(
    componentDesignFor(r, "Provider"),
    r.components.find((c) => c.name === "Provider")!.declaration,
  );
  assertEquals(componentDesignFor(r, "Missing"), undefined);
  const dependents = agentDependentContextFor(r, "Provider")!;
  assertEquals(dependents.importingFiles.map((f) => f.filePath), [
    "consumer.sigil",
  ]);
  assertEquals(
    dependents.importingFiles[0].contextualContracts.map((c) => c.name),
    ["Consumer", "Sibling"],
  );
  const edge = r.graph.importedTagEdges.find((e) =>
    e.sourceFile === "consumer.sigil"
  )!;
  assertEquals(edge.tagIdentity.owner.componentName, "Provider");
  assertEquals(edge.uses.map((u) => u.ownerName), ["Consumer"]);
  assertEquals(edge.sourceComponents.map((c) => c.componentName), ["Consumer"]);
  assert(!("componentExpansionEdges" in r.graph));
  const contracts = componentContracts(r);
  assertEquals(contracts.find((c) => c.name === "Provider")!.interfaceLines, [
    "A *query* has meaning.",
    "Use leaf.",
  ]);
});

Deno.test("SCCs use selected Tag edges, preserve occurrence identities and include isolated nodes", async () => {
  const r = await fixture({
    "a.sigil": "@b.sigil from B import { beta }\n" +
      component("A", "A *alpha* exists.\n\nUse beta."),
    "b.sigil": "@a.sigil from A import { alpha }\n" +
      component("B", "A *beta* exists.\n\nUse alpha."),
    "c.sigil": component("C", "Offer an interaction."),
  });
  assertEquals(r.diagnostics, []);
  assertEquals(
    stronglyConnectedComponentGroups(r.graph).map((g) => g.map((n) => n.name)),
    [["A", "B"], ["C"]],
  );
  assertEquals(
    agentDependentContextFor(r, "A")!.importingFiles.map((f) => f.filePath),
    ["b.sigil"],
  );
  const duplicate = await fixture({
    "a.sigil": component("Same", "Offer an interaction."),
    "b.sigil": component("Same", "Offer another interaction."),
  });
  assertEquals(
    stronglyConnectedComponentGroups(duplicate.graph).map((g) => g.length),
    [1, 1],
  );
  assertEquals(componentDesignFor(duplicate, "Same"), undefined);
});

Deno.test("unused selections retain file context without fabricating a component use", async () => {
  const r = await fixture({
    "p.sigil": component("P", "A *query* exists."),
    "i.sigil": "@p.sigil from P import { query }\n",
  });
  assertEquals(r.diagnostics.map((d) => d.code), ["SIGIL_UNUSED_TAG_IMPORT"]);
  assertEquals(r.graph.importedTagEdges[0].sourceComponents, []);
  const context = agentDependentContextFor(r, "P")!;
  assertEquals(context.importingFiles[0].filePath, "i.sigil");
  assertEquals(context.importingFiles[0].contextualContracts, []);
});
