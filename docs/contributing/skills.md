# Work on a skill

The seven Sigil skills live in [`skills/`](../../skills). Set up your
[environment](setup.md) first, so your agent loads the checkout.

## What a skill is made of

Each skill is one folder, `skills/<name>/`:

| Part | What it holds |
| --- | --- |
| `SKILL.md` | The skill's frontmatter (`name`, `description`) and the instructions an agent follows |
| `references/` | Longer contracts and tables that `SKILL.md` links to |
| `agents/openai.yaml` | The agent adapter: display name, short description and the prompt that invokes `$<name>` |
| `VERSION` | The skill's own version, `X.Y.Z` |
| `compatibility.json` | The Sigil language version and the sibling skills it needs |
| `evals/` | Fixtures and the procedure for observing the skill with real agents; never read by the skill |

`sigil-understand` also carries a language pack under `references/language/`. It is
generated from the specifications, so you never edit it by hand.

## The rules, and the check for each

Run these before you open a pull request:

```bash
deno task test:skill
deno test --allow-read --allow-write scripts/skill-foundation_test.ts
deno run --allow-read scripts/sync-skill-language.ts --check
deno task test:plugin-manifests
```

| Rule | Check that catches it |
| --- | --- |
| `SKILL.md` starts with frontmatter whose `name` equals the folder name and which has a `description` | `deno task test:skill` |
| `VERSION` is a plain `X.Y.Z` | `deno task test:skill` |
| `compatibility.json` has exactly `sigilVersion` (the current language version) and `requiredSkills` | `deno task test:skill` |
| `requiredSkills` is the sibling set the catalog declares for that skill, and every sibling folder exists | `deno task test:skill` |
| `agents/openai.yaml` has `display_name`, `short_description` and `default_prompt`, and the prompt invokes `$<name>` | `deno task test:skill` |
| Markdown links resolve and point only into the skill itself or a declared dependency | `deno task test:skill` |
| The language pack is reproduced from its recorded sources and never hand-edited | `scripts/sync-skill-language.ts --check`; regenerate with `deno run --allow-read --allow-write scripts/sync-skill-language.ts` after an intentional specification change |
| Missing siblings, reference failures and relocation behave | `scripts/skill-foundation_test.ts` |
| `skills/` holds exactly the seven catalogued skills, and the installer pin names the CLI release | `deno task test:plugin-manifests` |

Adding or removing a skill also changes the catalog in
[`scripts/validate-skill.ts`](../../scripts/validate-skill.ts), the plugin checks,
and the install guides; ask in your pull request before you do it.

## When to bump a version

A skill's `VERSION` and `compatibility.json` are owned by the skill. Bump in the
same commit as the change.

| Change | Bump |
| --- | --- |
| A new capability, a new or removed required sibling, or a changed hand-back contract | Minor |
| Any other change to text an agent follows in `SKILL.md`, `references/` or `agents/` | Patch |
| Eval fixtures, a pure rename or move, or the installer pin edited in a release-cut commit | None |

`compatibility.json` changes only when the Sigil language version or the sibling
set changes. Do not bump the CLI version or the plugin manifests in a skill change;
that happens once, in the [release-cut commit](releasing.md#the-release-cut-commit).

Write a [CHANGELOG.md](../../CHANGELOG.md) entry under `## Unreleased` for any
user-visible skill change: the skill name and new version, and what an agent or
user now sees differently. Update the skill's row in
[COMPATIBILITY.md](../../COMPATIBILITY.md) when you bump it.

A merged skill change does not reach users until the next CLI release. Even a fix
that touches only skills ships as a CLI patch release; there is no skill-only
release. See [Cut a release](releasing.md).

## Run an observed eval

Package checks show the files are well formed. An observed eval shows what a real
agent does with the skill, and a change to what an agent follows needs one.

The procedure is the same for all seven skills:

1. Copy the skill and its required siblings (and `sigil-evaluate` and `sigil-write`
   where the fixture routes to them) to a temporary catalog outside the
   checkout, **without their `evals/` folders**. The tested agent must never see the
   expected answers.
2. Materialize the fixture's fenced inputs in a separate temporary workspace.
3. Start a fresh agent with **no Sigil plugin loaded**. It sees only the catalog
   you built, never the checkout you load for development. Run nothing inside the
   checkout, where the fixtures hold the expected answers.
4. Give it the fixture's request, the exact skill entrypoint, and the tools it
   really has. Keep each variant independent.
5. Record the host and model, hashes of the skill and inputs, the requests and
   responses, every command with its exit code, and the retained files. Compare
   with the fixture's observer notes, and keep failed attempts.

Each skill's own instructions:

| Skill | Eval instructions | Record the result in |
| --- | --- | --- |
| `sigil-compute-design` | [evals/README.md](../../skills/sigil-compute-design/evals/README.md) | [sigil-compute-design.md](../skill-evaluation/sigil-compute-design.md) |
| `sigil-compute-align` | [evals/README.md](../../skills/sigil-compute-align/evals/README.md) | [sigil-compute-design.md](../skill-evaluation/sigil-compute-design.md) |
| `sigil-align` | [evals/README.md](../../skills/sigil-align/evals/README.md) | [sigil-align.md](../skill-evaluation/sigil-align.md) |
| `sigil-write` | [evals/README.md](../../skills/sigil-write/evals/README.md) | [sigil-0.8-foundation.md](../skill-evaluation/sigil-0.8-foundation.md) |
| `sigil-egglog`, `sigil-evaluate`, `sigil-understand` | No README of their own: follow the steps above with their fixtures in `evals/`, and the [write procedure](../../skills/sigil-write/evals/README.md) for the shared catalog | [sigil-0.8-foundation.md](../skill-evaluation/sigil-0.8-foundation.md), or [claims-guided-review.md](../skill-evaluation/claims-guided-review.md) for evaluation runs |

Write only what you observed. A dated section with enough detail for another
person to repeat the run is the format; say plainly what was not observed.

## Run the benchmarks

The slotted interpretation benchmark measures the computed-claims loop across
real agents. Its [README](../../scripts/slotted-benchmark/README.md) is the guide.
What you need first:

- Deno and Rust; the benchmark builds `sigilc` for you.
- The Claude, Codex or Pi command you pick, installed and signed in, and a model
  name that command accepts.
- A budget in time: a pass can run for up to two hours.

Run `deno task slotted-benchmark:probe` to see which hosts the benchmark can use.
Results land under `analyze-demo/slotted-runs/benchmarks/`, which Git ignores;
copy what you want to keep into a report under
[`docs/skill-evaluation/`](../skill-evaluation).
