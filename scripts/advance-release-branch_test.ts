import { deepStrictEqual as equal, rejects } from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { advanceReleaseBranch } from "./advance-release-branch.ts";

async function emptyConfig(): Promise<string> {
  return await Deno.makeTempFile({ prefix: "sigil-gitconfig-" });
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  // An empty file, not /dev/null, so this works on Windows runners too.
  GIT_CONFIG_GLOBAL: await emptyConfig(),
  GIT_CONFIG_NOSYSTEM: "1",
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["-C", cwd, ...args],
    env: GIT_ENV,
    clearEnv: false,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")}: ${text.decode(output.stderr)}`);
  }
  return text.decode(output.stdout).trim();
}

interface Fixture {
  remote: string;
  work: string;
  /** Commits a CLI version on the current branch and returns the sha. */
  commit(version: string): Promise<string>;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const base = await Deno.makeTempDir({ prefix: "sigil-release-branch-" });
  try {
    const remote = join(base, "remote.git");
    const work = join(base, "work");
    await Deno.mkdir(work);
    await git(base, "init", "--bare", "--initial-branch=main", remote);
    await git(work, "init", "--initial-branch=main");
    await git(work, "remote", "add", "origin", remote);
    await run({
      remote,
      work,
      async commit(version) {
        await Deno.mkdir(join(work, "packages/cli"), { recursive: true });
        await Deno.writeTextFile(
          join(work, "packages/cli/deno.json"),
          JSON.stringify({ version }),
        );
        await git(work, "add", ".");
        await git(work, "commit", "--allow-empty", "-m", `release ${version}`);
        return await git(work, "rev-parse", "HEAD");
      },
    });
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

async function remoteRelease(remote: string): Promise<string | undefined> {
  const out = await git(remote, "rev-parse", "--verify", "--quiet", "release")
    .catch(() => "");
  return out || undefined;
}

Deno.test("a new repository gets a release branch at the tag commit", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    const sha = await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    const result = await advanceReleaseBranch({
      repo: work,
      tag: "cli-v0.9.0",
    });
    equal(result, "created");
    equal(await remoteRelease(remote), sha);
  });
});

Deno.test("a release branch behind the tag is fast-forwarded", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    await advanceReleaseBranch({ repo: work, tag: "cli-v0.9.0" });
    await commit("0.9.0"); // unreleased work on main
    const sha = await commit("0.9.1");
    await git(work, "tag", "cli-v0.9.1");
    const result = await advanceReleaseBranch({
      repo: work,
      tag: "cli-v0.9.1",
    });
    equal(result, "advanced");
    equal(await remoteRelease(remote), sha);
  });
});

Deno.test("a release branch already at the tag is left alone", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    const sha = await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    await advanceReleaseBranch({ repo: work, tag: "cli-v0.9.0" });
    const result = await advanceReleaseBranch({
      repo: work,
      tag: "cli-v0.9.0",
    });
    equal(result, "unchanged");
    equal(await remoteRelease(remote), sha);
  });
});

Deno.test("a hotfix cut from an older line is refused and release stays put", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    await git(work, "branch", "hotfix-line");
    await commit("0.10.0");
    await git(work, "tag", "cli-v0.10.0");
    await advanceReleaseBranch({ repo: work, tag: "cli-v0.10.0" });
    const tip = await remoteRelease(remote);

    await git(work, "switch", "hotfix-line");
    await commit("0.9.1");
    await git(work, "tag", "cli-v0.9.1");
    await rejects(
      advanceReleaseBranch({ repo: work, tag: "cli-v0.9.1" }),
      /does not descend/,
    );
    equal(await remoteRelease(remote), tip);
  });
});

Deno.test("a tag that is not newer than the release tip is refused", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    await advanceReleaseBranch({ repo: work, tag: "cli-v0.9.0" });
    const tip = await remoteRelease(remote);

    await commit("0.9.0");
    await git(work, "tag", "cli-v0.8.9");
    await rejects(
      advanceReleaseBranch({ repo: work, tag: "cli-v0.8.9" }),
      /not newer/,
    );
    equal(await remoteRelease(remote), tip);
  });
});

Deno.test("a tag that does not exist is refused before the branch is touched", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    await commit("0.9.0");
    await rejects(
      advanceReleaseBranch({ repo: work, tag: "cli-v0.9.0" }),
      /does not exist/,
    );
    equal(await remoteRelease(remote), undefined);
  });
});

Deno.test("a name that is not a CLI release tag is refused", async () => {
  await withFixture(async ({ work, commit }) => {
    await commit("0.9.0");
    await git(work, "tag", "vscode-v0.1.0");
    await rejects(
      advanceReleaseBranch({ repo: work, tag: "vscode-v0.1.0" }),
      /not a cli-vX.Y.Z/,
    );
  });
});

Deno.test("a shallow clone names the missing history instead of calling it a hotfix", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    await advanceReleaseBranch({ repo: work, tag: "cli-v0.9.0" });
    await commit("0.9.0");
    await commit("0.9.1");
    await git(work, "tag", "cli-v0.9.1");
    await git(work, "push", "origin", "main", "cli-v0.9.1");
    const tip = await remoteRelease(remote);

    const shallow = join(
      await Deno.makeTempDir({ prefix: "sigil-shallow-" }),
      "clone",
    );
    try {
      await git(
        ".",
        "clone",
        "--depth",
        "1",
        "--branch",
        "cli-v0.9.1",
        pathToFileURL(remote).href,
        shallow,
      );
      equal(await git(shallow, "rev-parse", "--is-shallow-repository"), "true");
      await rejects(
        advanceReleaseBranch({ repo: shallow, tag: "cli-v0.9.1" }),
        /shallow and lacks the history/,
      );
      equal(await remoteRelease(remote), tip);
    } finally {
      await Deno.remove(join(shallow, ".."), { recursive: true });
    }
  });
});

Deno.test("a descendant tag whose version equals the release tip's is refused", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    await commit("0.9.0"); // the tip's manifest already says 0.9.0
    await git(work, "tag", "cli-v0.8.0");
    await advanceReleaseBranch({ repo: work, tag: "cli-v0.8.0" });
    const tip = await remoteRelease(remote);

    await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    await rejects(
      advanceReleaseBranch({ repo: work, tag: "cli-v0.9.0" }),
      /not newer/,
    );
    equal(await remoteRelease(remote), tip);
  });
});

Deno.test("a release tip whose CLI version cannot be read refuses to move", async () => {
  await withFixture(async ({ remote, work, commit }) => {
    await commit("not-a-version");
    await git(work, "tag", "cli-v0.8.0");
    await advanceReleaseBranch({ repo: work, tag: "cli-v0.8.0" });
    const tip = await remoteRelease(remote);

    await commit("0.9.0");
    await git(work, "tag", "cli-v0.9.0");
    await rejects(
      advanceReleaseBranch({ repo: work, tag: "cli-v0.9.0" }),
      /cannot read the CLI version/,
    );
    equal(await remoteRelease(remote), tip);
  });
});
