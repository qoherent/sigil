const root = "integrations/codex/sigil-skill";
const required = [
  "SKILL.md",
  "VERSION",
  "compatibility.json",
  "agents/openai.yaml",
  "references/sigil-format.md",
  "references/standards-review.md",
  "references/brownfield-adoption.md",
  "evals/brownfield-fixture.md",
  "evals/expected.json",
];

for (const path of required) await requireFile(`${root}/${path}`);

const skill = await Deno.readTextFile(`${root}/SKILL.md`);
requireText(skill, "name: sigil", "SKILL.md name");
requireText(skill, "description:", "SKILL.md description");
requireText(skill, "sigil version", "version preflight");
requireText(skill, "sigil check", "structural preflight");
requireText(skill, "Stop at the Sigil review gate", "semantic review gate");
requireText(
  skill,
  "do not write implementation code",
  "implementation approval boundary",
);

const version = (await Deno.readTextFile(`${root}/VERSION`)).trim();
if (version !== "1.0.0") {
  throw new Error(`Expected skill VERSION 1.0.0, got ${version}`);
}

const compatibility = JSON.parse(
  await Deno.readTextFile(`${root}/compatibility.json`),
);
for (
  const [key, expected] of Object.entries({
    skillVersion: "1.0.0",
    cliVersion: "^1.0.0",
    coreVersion: "^1.0.0",
    configVersion: "1.0.0",
    languageVersion: "1.0.0",
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
  "classify-repository-evidence",
  "scan-application-evidence",
  "elicit-application-goal-and-interface",
  "reject-empty-or-import-only-root-module",
  "propose-confirmed-root-application-summary",
  "classify-root-expand-evidence",
  "propose-minimal-root-expand",
  "preserve-only-binding-root-constraints",
  "exclude-incidental-and-module-specific-root-details",
  "propose-before-edit",
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
  "Present a provisional application goal and externally meaningful interface",
  "fixture application confirmation step",
);
requireText(
  fixture,
  "must not be empty or import-only",
  "fixture meaningful root-module rule",
);
requireText(
  fixture,
  "Classify material application-wide evidence into root `state`, `logic`,",
  "fixture root-expand classification",
);
requireText(
  fixture,
  "only when evidence shows it is a binding application decision",
  "fixture binding root-constraint rule",
);

const brownfield = await Deno.readTextFile(
  `${root}/references/brownfield-adoption.md`,
);
requireText(
  brownfield,
  "Application Picture For A New Workspace",
  "brownfield application discovery",
);
requireText(
  brownfield,
  "Never create or preserve an empty root module or one containing only imports.",
  "meaningful root module requirement",
);
requireText(
  brownfield,
  "After the user confirms the goal and interface, classify the remaining material",
  "root-expand evidence classification",
);
requireText(
  brownfield,
  "`constraints` only when repository evidence or user confirmation shows",
  "binding technology constraint rule",
);

console.log(
  "Sigil skill 1.0.0 structure, compatibility, gates, application discovery, and fixture rubric are valid.",
);

async function requireFile(path: string): Promise<void> {
  const stat = await Deno.stat(path);
  if (!stat.isFile) throw new Error(`Expected file ${path}`);
}

function requireText(source: string, value: string, label: string): void {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}
