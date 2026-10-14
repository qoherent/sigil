# Install Sigil in OpenCode

OpenCode loads Sigil as a plugin from the repository's `release` branch, which
follows the latest published release. Read the [prerequisites and cleanup
notes](README.md) once; the steps below point back to them. If you installed
before releases were the source, see
[Moving from an earlier install](README.md#moving-from-an-earlier-install); the
cache folder to clear is the one named under "Update" below.

This guide covers the OpenCode 1.x plugin API. OpenCode 2.x is not supported yet.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
OpenCode read them from `~/.agents/skills` (user) and `<project>/.agents/skills`
(project). Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders.

## 2. Install

Add Sigil to the `plugin` array in your global `~/.config/opencode/opencode.json`,
or in a project's `opencode.json` to install it for that repository only:

```json
{
  "plugin": ["sigil@git+https://github.com/qoherent/sigil.git#release"]
}
```

Restart OpenCode. The plugin registers the repository's `skills/` folder, so the
seven skills appear without a generated copy.

To pin one release instead, use its tag. Replace `X.Y.Z` with a version from the
[releases page](https://github.com/qoherent/sigil/releases):

```json
{
  "plugin": ["sigil@git+https://github.com/qoherent/sigil.git#cli-vX.Y.Z"]
}
```

## 3. Update

OpenCode has no update command, and it never fetches a git plugin it already
has. To update, remove the cached copy and restart OpenCode so it fetches the
plugin again. OpenCode keeps fetched plugins under
`~/.cache/opencode/node_modules/`; delete the `sigil` folder there. A pinned tag
never moves, so change the tag to update. Rerun the installer in the
[index](README.md#two-things-to-know-first) afterwards so `sigil` and `sigilc`
match the new skills.

## 4. Uninstall

Remove the `sigil@git+...` entry from the `plugin` array, delete the cached
`sigil` folder under `~/.cache/opencode/node_modules/`, and restart OpenCode.

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
