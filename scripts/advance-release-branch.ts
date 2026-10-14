/**
 * Moves the `release` branch to a published CLI release tag. Every agent install
 * follows that branch, so it may only ever move forward to a newer release: the
 * script refuses a tag that does not descend from the current tip or that is not
 * a newer version, and it never force-pushes.
 */

const TAG_PATTERN = /^cli-v(\d+)\.(\d+)\.(\d+)$/;

export type AdvanceResult = "created" | "advanced" | "unchanged";

export interface AdvanceOptions {
  /** A git checkout that holds the tag. */
  repo: string;
  /** The release tag, for example `cli-v0.9.1`. */
  tag: string;
  remote?: string;
  branch?: string;
}

export class AdvanceRefusal extends Error {}

async function git(
  repo: string,
  args: string[],
  allowFailure = false,
): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command("git", {
    args: ["-C", repo, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  const result = {
    ok: output.success,
    code: output.code,
    stdout: decoder.decode(output.stdout).trim(),
    stderr: decoder.decode(output.stderr).trim(),
  };
  if (!result.ok && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result;
}

function parseVersion(text: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? match.slice(1).map(Number) : undefined;
}

function isNewer(next: number[], current: number[]): boolean {
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

/**
 * Fast-forwards the remote `release` branch to the commit the tag points at.
 * Creates the branch when it does not exist and does nothing when it is already
 * there. Throws `AdvanceRefusal` naming the reason when it must not move.
 */
export async function advanceReleaseBranch(
  options: AdvanceOptions,
): Promise<AdvanceResult> {
  const { repo, tag } = options;
  const remote = options.remote ?? "origin";
  const branch = options.branch ?? "release";

  const match = TAG_PATTERN.exec(tag);
  if (!match) {
    throw new AdvanceRefusal(`${tag} is not a cli-vX.Y.Z release tag`);
  }
  const tagVersion = match.slice(1).map(Number);

  const tagged = await git(
    repo,
    ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`],
    true,
  );
  if (!tagged.ok) {
    throw new AdvanceRefusal(`tag ${tag} does not exist in this checkout`);
  }
  const target = tagged.stdout;

  const listing = await git(repo, [
    "ls-remote",
    "--heads",
    remote,
    `refs/heads/${branch}`,
  ]);
  const tip = listing.stdout.split(/\s+/)[0];
  if (!tip) {
    await push(repo, remote, target, branch);
    return "created";
  }
  if (tip === target) return "unchanged";

  // The tip may not be in a fresh checkout yet; fetching it also lets the
  // ancestry check below see the commits it compares.
  await git(repo, ["fetch", "--quiet", remote, `refs/heads/${branch}`]);
  const ancestry = await git(
    repo,
    ["merge-base", "--is-ancestor", tip, target],
    true,
  );
  // Exit 1 means "not an ancestor"; any other failure is git unable to compare.
  if (!ancestry.ok && ancestry.code !== 1) {
    throw new Error(`git merge-base --is-ancestor failed: ${ancestry.stderr}`);
  }
  if (!ancestry.ok) {
    const shallow = (await git(repo, ["rev-parse", "--is-shallow-repository"]))
      .stdout === "true";
    throw new AdvanceRefusal(
      shallow
        ? `this checkout is shallow and lacks the history to compare ${tag} with the ${branch} tip; fetch the full history (fetch-depth: 0) and rerun`
        : `${tag} does not descend from the ${branch} tip ${
          tip.slice(0, 12)
        }; ${branch} only moves forward, so merge the hotfix line into main and cut a newer release`,
    );
  }

  const tipManifest = await git(
    repo,
    ["show", `${tip}:packages/cli/deno.json`],
    true,
  );
  let tipVersion: number[] | undefined;
  if (tipManifest.ok) {
    try {
      tipVersion = parseVersion(JSON.parse(tipManifest.stdout).version);
    } catch {
      tipVersion = undefined;
    }
  }
  if (!tipVersion) {
    throw new AdvanceRefusal(
      `cannot read the CLI version at the ${branch} tip ${
        tip.slice(0, 12)
      }, so ${tag} cannot be shown to be newer`,
    );
  }
  if (!isNewer(tagVersion, tipVersion)) {
    throw new AdvanceRefusal(
      `${tag} is not newer than the ${
        tipVersion.join(".")
      } at the ${branch} tip`,
    );
  }

  await push(repo, remote, target, branch);
  return "advanced";
}

/** A plain push: git itself rejects anything that is not a fast-forward. */
async function push(
  repo: string,
  remote: string,
  commit: string,
  branch: string,
): Promise<void> {
  await git(repo, [
    "push",
    "--quiet",
    remote,
    `${commit}:refs/heads/${branch}`,
  ]);
}

if (import.meta.main) {
  const args = Deno.args;
  const read = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const tag = read("--tag");
  if (!tag) {
    console.error(
      "usage: advance-release-branch.ts --tag cli-vX.Y.Z [--remote origin] [--branch release] [--repo .]",
    );
    Deno.exit(2);
  }
  try {
    const result = await advanceReleaseBranch({
      repo: read("--repo") ?? ".",
      tag,
      remote: read("--remote"),
      branch: read("--branch"),
    });
    console.log(`${read("--branch") ?? "release"}: ${result} at ${tag}`);
  } catch (error) {
    if (error instanceof AdvanceRefusal) {
      console.error(`refusing to move the release branch: ${error.message}`);
      Deno.exit(1);
    }
    throw error;
  }
}
