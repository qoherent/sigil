# Cut a release

A release ships the skills, `sigil` and `sigilc` together, under one version.
Skills reach users only this way: merging a skill change to `main` changes nothing
for anyone until a `cli-v*` release is cut. Every skill-only fix is a CLI patch
release too.

Agents install from a `release` branch that the release workflow moves to the
tagged commit after it publishes. Gemini CLI installs the latest GitHub release.

## Who cuts a release

A maintainer of `qoherent/sigil` who can push tags there. Nobody pushes to the
`release` branch by hand; only the release workflow's GitHub App can, and its key
is available only to a run on a `cli-v*` tag (see [One-time setup](#one-time-setup)).

## The release-cut commit

On a branch from `main`, in one pull request:

1. Set the new version in `packages/cli/deno.json`.
2. Set the same version in every plugin manifest: `.claude-plugin/plugin.json`,
   `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
   `gemini-extension.json`, `plugin.json` and `package.json`.
3. Change the installer URLs in
   `skills/sigil-compute-design/references/computed-evaluation.md` to
   `releases/download/cli-vX.Y.Z/`. They are the only version literal in that
   skill's text. This edits a skill file but needs no skill `VERSION` bump.
4. In [CHANGELOG.md](../../CHANGELOG.md), turn the `## Unreleased` heading into the
   version and add a fresh `## Unreleased` above it.
5. Update the rows in [COMPATIBILITY.md](../../COMPATIBILITY.md).

`deno task test:plugin-manifests` fails when steps 1 to 3 disagree, and the release
build refuses the same mismatch. Run `deno task test`, merge the pull request, and
make sure `main` is green.

## Tag and push

Tag the merged commit and push the tag to `qoherent/sigil`. The publish job
refuses a tag whose commit is not on `main`. These commands assume `origin` is
`qoherent/sigil` (as in a fresh clone of it); if your `origin` is a fork, add the
upstream first with `git remote add upstream git@github.com:qoherent/sigil.git`
and use `upstream` in place of `origin`:

```bash
git switch main && git pull origin main
git tag cli-vX.Y.Z
git push origin cli-vX.Y.Z
```

## What the workflows do

The tag starts two workflows:

- [`release.yml`](../../.github/workflows/release.yml) checks the tag against the
  manifest and publishes the CLI package to JSR.
- [`native-release.yml`](../../.github/workflows/native-release.yml) builds and
  smoke-tests the archives on every target, then, in order, publishes the GitHub
  release **without** marking it latest, fast-forwards `release` to the tagged
  commit, and marks the release latest. It refuses to move `release` unless the tag
  descends from its current tip and is a newer version, and it never force-pushes.
  Publish jobs for different versions run one at a time, so a newer release is
  never overtaken by an older one. If three tags arrive close together, GitHub
  drops the middle run; once a newer release has advanced `release`, that older
  tag is superseded. Rerunning it can restore its assets but fails at the branch
  step, by design, and never moves `release` or Latest, so cut a newer release if
  its changes must ship. Every step skips what is already done, and a rerun
  uploads any asset the release is missing, so a run that failed for another
  reason can be rerun.
  Dispatch it from the
  Actions tab on the tag (choose the `cli-vX.Y.Z` tag under "Use workflow from"),
  give the version and turn publishing on; the release environment accepts only
  tag runs. A dispatch needs the tag to exist, so it is not a dry run.

If the run fails before `release` moves, every agent stays on the previous release.
If it fails after, only Gemini CLI and the README installer are one release behind
until you rerun it.

## Confirm users can update

After a green run:

```bash
git ls-remote https://github.com/qoherent/sigil release   # the tag's commit
gh release view cli-vX.Y.Z                                # assets, and Latest
```

Then update in each agent as its [install guide](../install/README.md) says, and
check that the skills and the plugin report the new version. Rerun the installer so
`sigil --version` matches.

## Rules

- **Merge a hotfix back into `main`.** A hotfix tagged from an older line cannot
  fast-forward `release`, and the workflow refuses it. Cut a newer release from
  `main`.
- **Keep every other release off "Latest".** Gemini CLI installs whatever is
  latest. The VS Code release already uses `--latest=false`; do the same for any
  new kind of release.
- **Do not edit `release` yourself,** not even to fix a bad release. Cut a newer
  release.

## One-time setup

A maintainer with admin rights on `qoherent/sigil` does this once, before the first
aligned release:

1. Create a GitHub App with read and write access to contents and workflows, and
   install it on `qoherent/sigil`.
2. Create an environment named `release` whose deployment branches and tags are
   limited to `cli-v*` tags, optionally with a required reviewer. Store the
   App's ID and private key in that environment, as secrets named
   `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`, not as repository secrets, so
   a workflow on any other branch cannot read them.
3. Add a tag ruleset that limits who can create `cli-v*` tags.
4. Add a ruleset on the `release` branch that blocks direct pushes, force pushes
   and deletion, with the App as the only bypass actor.
5. Cut the first release. Its run creates `release`. Announce the install guides
   only once that run is green and an update has been confirmed in each agent.
