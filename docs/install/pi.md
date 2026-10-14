# Install Sigil in Pi

Pi installs Sigil as a package from the repository's `release` branch, which
follows the latest published release. Read the [prerequisites and cleanup
notes](README.md) once; the steps below point back to them. If you installed
before releases were the source, see
[Moving from an earlier install](README.md#moving-from-an-earlier-install), and
delete `~/.pi/agent/git/github.com/qoherent/sigil` after you remove the package.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first. Pi
read them from `~/.agents/skills` (user) and `<project>/.agents/skills`
(project). Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders.

## 2. Install

For your user account:

```bash
pi install git:github.com/qoherent/sigil@release
```

For one repository, add `-l`. Pi records the package in the repository's
`.pi/settings.json`, which you can share with your team (Pi installs it for them
once they trust the project), and clones it to
`.pi/git/github.com/qoherent/sigil` inside the repository:

```bash
pi install git:github.com/qoherent/sigil@release -l
```

The clone contains `.sigil` files, so if the project is itself a Sigil
workspace, add `.pi/**` to the `files.exclude` list in `.sigil/config.json` so
Sigil does not read the clone as your sources, or install globally instead.

To pin one release instead, use its tag as the ref:
`git:github.com/qoherent/sigil@cli-vX.Y.Z`. A tag never moves.

## 3. Update

Remove the package and install the same source again; this is the documented way
to move a package that has a ref:

```bash
pi remove git:github.com/qoherent/sigil@release
pi install git:github.com/qoherent/sigil@release
```

Add `-l` to both for a project install. A bare `pi update` updates Pi itself, not
your packages. Rerun the installer in the
[index](README.md#two-things-to-know-first) afterwards so `sigil` and `sigilc`
match the new skills.

## 4. Uninstall

```bash
pi remove git:github.com/qoherent/sigil@release
```

Add `-l` to remove a project install.

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
