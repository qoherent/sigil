const root = "integrations/codex/sigil-skill";
const required = [
  "SKILL.md",
  "VERSION",
  "compatibility.json",
  "agents/openai.yaml",
  "references/sigil-format.md",
  "references/standards-review.md",
  "references/implementation-design.md",
  "references/greenfield-design.md",
  "references/brownfield-adoption.md",
  "evals/brownfield-fixture.md",
  "evals/greenfield-fixture.md",
  "evals/implementation-coverage-fixture.md",
  "evals/expected.json",
];

for (const path of required) await requireFile(`${root}/${path}`);

const skill = await Deno.readTextFile(`${root}/SKILL.md`);
requireText(skill, "name: sigil", "SKILL.md name");
requireText(skill, "description:", "SKILL.md description");
requireText(skill, "sigil version", "version preflight");
requireText(skill, "sigil check", "structural preflight");
requireText(skill, "references/greenfield-design.md", "greenfield routing");
requireText(skill, "references/brownfield-adoption.md", "brownfield routing");
requireText(
  skill,
  "references/implementation-design.md",
  "implementation design routing",
);
requireText(skill, "sigil init", "brownfield initialization");
requireText(skill, "manageable rounds", "conversational clarification");
requireText(skill, "choices", "design choices");
requireText(
  skill,
  "verify that the affected\n     behavior has clear Sigil coverage",
  "clear Sigil coverage guard",
);
requireText(
  skill,
  "collaborate\n     with the user to define, review, and approve the affected Sigil",
  "missing coverage collaboration",
);
requireText(skill, "Stop at the Sigil review gate", "semantic review gate");
requireText(
  skill,
  "do not write implementation code",
  "implementation approval boundary",
);

const version = (await Deno.readTextFile(`${root}/VERSION`)).trim();
if (version !== "1.1.0") {
  throw new Error(`Expected skill VERSION 1.1.0, got ${version}`);
}

const compatibility = JSON.parse(
  await Deno.readTextFile(`${root}/compatibility.json`),
);
for (
  const [key, expected] of Object.entries({
    skillVersion: "1.1.0",
    cliVersion: "^0.1.0",
    coreVersion: "^0.1.0",
    sigilVersion: "0.1.0",
  })
) {
  if (compatibility[key] !== expected) {
    throw new Error(`Expected ${key} ${expected}, got ${compatibility[key]}`);
  }
}

const expected = JSON.parse(
  await Deno.readTextFile(`${root}/evals/expected.json`),
);
const fixture = await Deno.readTextFile(
  `${root}/evals/brownfield-fixture.md`,
);
const requiredBrownfieldBehaviors = [
  "detect-missing-config",
  "initialize-config-first",
  "validate-initialized-config",
  "classify-repository-evidence",
  "scan-application-evidence",
  "converse-when-application-vague",
  "continue-root-follow-up-questions",
  "elicit-application-goal-and-interface",
  "confirm-synthesized-root-contract-separately",
  "reject-empty-or-import-only-root-module",
  "propose-confirmed-root-application-summary",
  "classify-root-expand-evidence",
  "propose-minimal-root-expand",
  "preserve-only-binding-root-constraints",
  "exclude-incidental-and-module-specific-root-details",
  "propose-before-edit",
  "review-root-before-task-focus",
  "focus-requested-task-after-root-approval",
  "collaborate-on-missing-sigil-before-implementation",
  "validate-written-sigil",
  "stop-at-semantic-review-gate",
  "implement-only-after-approval",
];
if (!Array.isArray(expected.requiredBehaviors)) {
  throw new Error(
    "Brownfield fixture must declare required behaviors.",
  );
}
for (const behavior of requiredBrownfieldBehaviors) {
  if (!expected.requiredBehaviors.includes(behavior)) {
    throw new Error(`Brownfield fixture is missing behavior ${behavior}.`);
  }
}
requireText(
  fixture,
  "run `sigil init` before detailed project",
  "fixture initialization-first rule",
);
requireText(
  fixture,
  "begin a focused conversation",
  "fixture conversational discovery",
);
requireText(
  fixture,
  "Continue with targeted follow-up questions",
  "fixture follow-up conversation",
);
requireText(
  fixture,
  "then request separate confirmation",
  "fixture separate confirmation",
);
requireText(
  fixture,
  "Only after RootSigil approval, focus on the requested component",
  "fixture root-before-task ordering",
);
requireText(
  fixture,
  "collaborate with the user to define and approve that coverage",
  "brownfield missing coverage collaboration",
);

const greenfieldFixture = await Deno.readTextFile(
  `${root}/evals/greenfield-fixture.md`,
);
const requiredGreenfieldBehaviors = [
  "start-with-design-conversation",
  "ask-multiple-manageable-rounds",
  "build-questions-on-answers",
  "surface-weak-assumptions",
  "present-choices-and-tradeoffs",
  "provide-reasoned-recommendation",
  "allow-user-to-reject-all-choices",
  "continue-until-contract-is-clear",
  "synthesize-conversation-into-exact-sigil",
  "confirm-before-writing-sigil",
  "collaborate-on-missing-sigil-before-implementation",
  "stop-at-semantic-review-gate",
  "implement-only-after-approval",
];
if (!Array.isArray(expected.greenfieldRequiredBehaviors)) {
  throw new Error("Greenfield fixture must declare required behaviors.");
}
for (const behavior of requiredGreenfieldBehaviors) {
  if (!expected.greenfieldRequiredBehaviors.includes(behavior)) {
    throw new Error(`Greenfield fixture is missing behavior ${behavior}.`);
  }
}
requireText(
  greenfieldFixture,
  "Ask multiple manageable rounds",
  "greenfield iterative conversation",
);
requireText(
  greenfieldFixture,
  "consequences and tradeoffs, plus a reasoned recommendation",
  "greenfield choices and recommendation",
);
requireText(
  greenfieldFixture,
  "combine, reject, revise, or replace",
  "greenfield user-directed choices",
);
requireText(
  greenfieldFixture,
  "exact proposed Sigil",
  "greenfield exact proposal",
);
requireText(
  greenfieldFixture,
  "collaborate with the user\n    on the affected Sigil before adding implementation",
  "greenfield missing coverage collaboration",
);

const implementationFixture = await Deno.readTextFile(
  `${root}/evals/implementation-coverage-fixture.md`,
);
const requiredImplementationBehaviors = [
  "reject-high-level-only-coverage",
  "inspect-implementation-boundary",
  "treat-interface-public-to-dependents",
  "model-programming-abstraction-as-component",
  "model-ui-surface-as-component",
  "use-expand-for-owned-implementation-detail",
  "omit-trivial-mechanics",
  "report-implementation-coverage-map",
  "propose-exact-implementation-sigil",
  "support-combined-or-dependent-review",
  "stop-at-semantic-review-gate",
  "implement-only-after-implementation-approval",
];
if (!Array.isArray(expected.implementationRequiredBehaviors)) {
  throw new Error("Implementation fixture must declare required behaviors.");
}
for (const behavior of requiredImplementationBehaviors) {
  if (!expected.implementationRequiredBehaviors.includes(behavior)) {
    throw new Error(`Implementation fixture is missing behavior ${behavior}.`);
  }
}
requireText(
  implementationFixture,
  "approved high-level service contract as sufficient",
  "implementation high-level coverage rejection",
);
requireText(
  implementationFixture,
  "queue programming abstraction as a component",
  "implementation abstraction component",
);
requireText(
  implementationFixture,
  "delivery-status surface as a UI component",
  "implementation UI component",
);
requireText(
  implementationFixture,
  "component/expand/omit decision",
  "implementation coverage map",
);

const brownfield = await Deno.readTextFile(
  `${root}/references/brownfield-adoption.md`,
);
requireText(
  brownfield,
  "`sigil init` must create the",
  "brownfield initialization-first rule",
);
requireText(
  brownfield,
  "Build The Application Picture Through Conversation",
  "brownfield conversational discovery",
);
requireText(
  brownfield,
  "Continue with targeted follow-up questions",
  "brownfield follow-up conversation",
);
requireText(
  brownfield,
  "Confirmation is mandatory",
  "brownfield separate confirmation",
);
requireText(
  brownfield,
  "Do not move to task modeling until the user approves the written RootSigil.",
  "brownfield root-before-task ordering",
);

const greenfield = await Deno.readTextFile(
  `${root}/references/greenfield-design.md`,
);
requireText(
  greenfield,
  "Ask questions in manageable rounds that",
  "greenfield iterative design",
);
requireText(
  greenfield,
  "which choice you recommend and why",
  "greenfield recommendation",
);
requireText(
  greenfield,
  "combine, reject, revise, or replace them",
  "greenfield rejectable choices",
);
requireText(
  greenfield,
  "Show the exact components, expands, and imports that would be written.",
  "greenfield exact proposal",
);

const implementationDesign = await Deno.readTextFile(
  `${root}/references/implementation-design.md`,
);
requireText(
  implementationDesign,
  "An interface is public relative to the component's dependents.",
  "dependent-relative public contract",
);
requireText(
  implementationDesign,
  "Select Component, Expand, Or Omit",
  "implementation selection rule",
);
requireText(
  implementationDesign,
  "Build The Implementation Coverage Map",
  "implementation coverage map procedure",
);
requireText(
  implementationDesign,
  "Review UI Component Coverage",
  "UI component coverage procedure",
);

console.log(
  "Sigil skill 1.1.0 structure, compatibility, gates, Greenfield design, Brownfield adoption, implementation coverage, and fixture rubrics are valid.",
);

async function requireFile(path: string): Promise<void> {
  const stat = await Deno.stat(path);
  if (!stat.isFile) throw new Error(`Expected file ${path}`);
}

function requireText(source: string, value: string, label: string): void {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}
