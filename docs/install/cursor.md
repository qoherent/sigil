# Install Sigil in Cursor

Cursor installs Sigil as a plugin. The route that follows Sigil releases is a
local plugin copied from the repository's `release` branch, which follows the
latest published release. Read the [prerequisites and cleanup notes](README.md)
once; the steps below point back to them. If you installed before releases were
the source, see [Moving from an earlier install](README.md#moving-from-an-earlier-install);
the folder to clear is `~/.cursor/plugins/local/sigil`.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
Cursor reads skills from `~/.agents/skills` and `<project>/.agents/skills`, which
is where the old command wrote them. Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders. (The `.claude/skills` folders were written for Claude
Code; Cursor does not need them cleaned.)

The earlier manual-copy instructions put the seven skill folders in
`~/.cursor/skills` or `<project>/.cursor/skills`. Delete those seven `sigil-*`
folders (`sigil-understand`, `sigil-evaluate`, `sigil-write`, `sigil-align`,
`sigil-egglog`, `sigil-compute-design` and `sigil-compute-align`) from both
places and leave your other skills alone, or the skills appear twice.

## 2. Install

**As a local plugin (recommended).** Clone the `release` branch to a persistent
folder, not `/tmp`, and copy the plugin into Cursor's local plugin folder. Copy,
do not symlink: Cursor skips symlinks that point out of that folder.

```bash
git clone --branch release --depth 1 https://github.com/qoherent/sigil ~/.local/share/sigil-plugin
rm -rf ~/.cursor/plugins/local/sigil
mkdir -p ~/.cursor/plugins/local/sigil
cp -R ~/.local/share/sigil-plugin/.cursor-plugin ~/.local/share/sigil-plugin/skills ~/.cursor/plugins/local/sigil/
```

Reload the Cursor window afterwards. Cursor's handling of local plugins is
documented but not yet verified here; if the seven skills do not appear, tell the
maintainers.

**From the marketplace**, once Sigil is listed there. In Cursor Agent chat:

```text
/add-plugin sigil
```

Or search for "sigil" in the Cursor plugin marketplace.

**Through a team marketplace** (Teams and Enterprise plans). A team admin opens
Dashboard, then Settings, then Plugins, chooses **Import** under Team
Marketplaces, and pastes `https://github.com/qoherent/sigil`. Cursor reads the
repository's `.cursor-plugin/marketplace.json`. Team members then install `sigil`
from the team marketplace. **This route reads only the repository's default
branch, so it can give skills newer than the latest release.** It is the one
install route that does not follow releases; use the local plugin above when you
need that.

## 3. Update

For the local plugin, pull the clone, copy it over again and reload the window:

```bash
git -C ~/.local/share/sigil-plugin pull
rm -rf ~/.cursor/plugins/local/sigil
mkdir -p ~/.cursor/plugins/local/sigil
cp -R ~/.local/share/sigil-plugin/.cursor-plugin ~/.local/share/sigil-plugin/skills ~/.cursor/plugins/local/sigil/
```

Then rerun the installer in the [index](README.md#two-things-to-know-first) so
`sigil` and `sigilc` match the new skills.

Cursor's plugin update check is not documented, so this guide does not promise
that it notices a new Sigil release for a marketplace install. If one does not
update, remove it and install it again, or ask your team admin to refresh the team
marketplace import in the dashboard.

## 4. Uninstall

Remove a marketplace plugin in Cursor's plugin settings. For the local plugin,
delete `~/.cursor/plugins/local/sigil` and, if you no longer need it, the clone
in `~/.local/share/sigil-plugin`, then reload the window. Also delete any old
manual copies of the seven `sigil-*` folders in `~/.cursor/skills` or
`<project>/.cursor/skills`.

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
