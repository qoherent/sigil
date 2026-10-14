# Install Sigil in Claude Code

Claude Code installs Sigil from a plugin marketplace. The marketplace is
`qoherent/sigil` at its `release` branch, which follows the latest published
release. Read the [prerequisites and cleanup notes](README.md) once; the steps
below point back to them. If you installed before releases were the source, see
[Moving from an earlier install](README.md#moving-from-an-earlier-install) and
clear `~/.claude/plugins/cache/sigil` and `~/.claude/plugins/marketplaces/sigil`
after you uninstall.

## 1. Remove old copies

If you ever ran `sigil skill install`, remove its Sigil-managed copies first.
Claude Code read them from `~/.claude/skills` (user) and
`<project>/.claude/skills` (project). Follow
[Remove copies from `sigil skill install`](README.md#remove-copies-from-sigil-skill-install)
for each of those folders.

## 2. Install

In Claude Code:

```text
/plugin marketplace add qoherent/sigil#release
/plugin install sigil@sigil
```

The same from a shell:

```bash
claude plugin marketplace add qoherent/sigil#release
claude plugin install sigil@sigil
```

The default scope is your user account. To enable Sigil for one repository and
share that choice with its collaborators, add `--scope project` to the install
command; it records the plugin in the repository's `.claude/settings.json`.
Start a new session, or run `/reload-plugins`, and the seven skills are there.

## 3. Update

Claude Code does not update third-party marketplaces by default. Either turn
auto-update on for the `sigil` marketplace (in `/plugin`, open the Marketplaces
tab, select `sigil`, and enable auto-update), or update by hand. Refresh the
marketplace first, then the plugin, or the plugin keeps reading the old snapshot:

```text
/plugin marketplace update sigil
/plugin update sigil@sigil
```

An update appears only when a Sigil release raises the plugin version; changes
merged to `main` between releases do not reach you. Restart Claude Code after an
update, then rerun the installer in the [index](README.md#two-things-to-know-first)
so `sigil` and `sigilc` match the new skills.

## 4. Uninstall

```text
/plugin uninstall sigil@sigil
/plugin marketplace remove sigil
```

## `sigilc` for the compute skills

`sigil-compute-design` and `sigil-compute-align` need the `sigilc` binary. See
[Two things to know first](README.md#two-things-to-know-first) for how they
offer to install it.
