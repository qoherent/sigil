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
if (
  !Array.isArray(expected.requiredBehaviors) ||
  expected.requiredBehaviors.length !== 6
) {
  throw new Error(
    "Brownfield fixture must declare all six required behaviors.",
  );
}

console.log(
  "Sigil skill 1.0.0 structure, compatibility, gates, and fixture rubric are valid.",
);

async function requireFile(path: string): Promise<void> {
  const stat = await Deno.stat(path);
  if (!stat.isFile) throw new Error(`Expected file ${path}`);
}

function requireText(source: string, value: string, label: string): void {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}
