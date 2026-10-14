# Install Sigil in Gemini CLI or Antigravity

Gemini CLI and Antigravity (`agy`) both install Sigil from the repository, and
they follow releases in different ways. Antigravity replaced Gemini CLI for consumer accounts; paid and
enterprise accounts can still use Gemini CLI. Read the [prerequisites and cleanup
notes](README.md) once; the steps below point back to them. If you installed
before releases were the source, see
[Moving from an earlier install](README.md#moving-from-an-earlier-install);
uninstalling removes Gemini CLI's copy under `~/.gemini/extensions/sigil`.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
Gemini CLI reads skills from `~/.agents/skills` and `<project>/.agents/skills`,
which is where the old command wrote them. Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders. If skills appear twice after you install, check both
`.agents/skills` folders again.

## 2. Install

Both agents install per user. There is no project-scoped install.

**Gemini CLI** installs the repository's latest GitHub release:

```bash
gemini extensions install https://github.com/qoherent/sigil
```

This works because the latest GitHub release is always a Sigil CLI release.
To pin one release instead, add `--ref cli-vX.Y.Z`.

**Antigravity** installs from a folder, so clone the `release` branch to a
persistent place (not `/tmp`) and install from it:

```bash
git clone --branch release --depth 1 https://github.com/qoherent/sigil ~/.local/share/sigil-plugin
agy plugin install ~/.local/share/sigil-plugin
agy plugin list
```

Start a new session afterwards. Antigravity's handling of this folder is
documented but not yet verified; if it does not list the seven skills, tell the
maintainers.

## 3. Update

**Gemini CLI** updates on request, or automatically if you installed with
`--auto-update`:

```bash
gemini extensions update sigil
```

**Antigravity** has no documented update command. Pull the folder, then uninstall
and install the plugin again:

```bash
git -C ~/.local/share/sigil-plugin pull
agy plugin uninstall sigil
agy plugin install ~/.local/share/sigil-plugin
```

Rerun the installer in the [index](README.md#two-things-to-know-first) after
either update so `sigil` and `sigilc` match the new skills.

## 4. Uninstall

```bash
gemini extensions uninstall sigil
agy plugin uninstall sigil
```

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
