# Install the Sigil skills

The Sigil skills install through your coding agent's own plugin system, straight
from `qoherent/sigil`. You do not need the `sigil` binary first. Every install
brings the same seven skills as one set: `sigil-understand`, `sigil-evaluate`,
`sigil-write`, `sigil-align`, `sigil-egglog`, `sigil-compute-design` and
`sigil-compute-align`. They need each other, so install them together.

Pick your agent:

| Agent | Guide | Installs per project | Updates itself |
| --- | --- | --- | --- |
| Claude Code | [claude-code.md](claude-code.md) | Yes | Opt in |
| Codex | [codex.md](codex.md) | No, per user only | No |
| OpenCode | [opencode.md](opencode.md) | Yes | No |
| Pi | [pi.md](pi.md) | Yes | Remove and reinstall |
| Cursor | [cursor.md](cursor.md) | Manual copy only | Not documented |
| Gemini CLI and Antigravity | [gemini-antigravity.md](gemini-antigravity.md) | No, per user only | Gemini CLI on request; Antigravity no |

Each guide runs in the same order: remove old copies, install, update,
uninstall.

## Two things to know first

**Every install follows releases.** Skills reach you only when a Sigil release is
cut, together with `sigil` and `sigilc` at one version. A change merged to
`main` does not change what an installed copy gives you. Each guide installs from
the repository's `release` branch, which moves to the tagged commit when a
release is published. The one exception is the Cursor team marketplace import,
which reads only the default branch; the [Cursor guide](cursor.md) recommends the
release-following local plugin instead. After you update the skills, rerun the
installer below so `sigil` and `sigilc` match them.

**The compute skills need `sigilc`.** `sigil-compute-design` and
`sigil-compute-align` run the native `sigilc` binary. The other five skills do
not. If `sigilc` is missing, the compute skills stop before doing any work, tell
you so, and show the official installer for their release. If `sigilc` is there
but `sigil --version` reports another release than the skills, they say so and
offer the same installer; they run it only if you say yes. You can also install
it yourself first, with the same installer that installs the `sigil` CLI:

```bash
# macOS or Linux
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

```powershell
# Windows PowerShell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

## Moving from an earlier install

Before releases were the source, installs followed the repository's `main`
branch, and agents cache what they fetched, so adding the release source again is
not enough. Move once:

1. Uninstall the plugin and remove its marketplace or source, exactly as the
   agent's guide says under "Uninstall".
2. Clear the agent's cached copy. Each guide names the folder.
3. Install again from the release-following source in the guide.

Afterwards the agent lists one copy of each Sigil skill and updates only when a
release is published. This sits beside the cleanup for `sigil skill install`
copies below; do both if both apply.

## Build from source

Before the first release exists, or to try unreleased changes, build the tools
from a clone of `main` and load the skills from that clone. This runs unreleased
code, so expect it to change under you.

```bash
git clone https://github.com/qoherent/sigil
cd sigil
deno task build:cli       # builds build/sigil
deno task build:sigilc    # builds packages/sigilc/target/debug/sigilc
```

Put `sigil` and `sigilc` on your `PATH`, then load the skills from the clone with
your agent's folder loading. The [contributor setup guide](../contributing/setup.md)
has the exact steps for each agent, the tool versions you need and how to check
the agent is using the clone. The compute skills find that `sigilc` and offer no
installer. Once a release exists, switch to the release-following install in your
agent's guide: remove the clone's plugin as that setup guide explains, and put
the installed `sigil` and `sigilc` ahead of your builds on `PATH`.

## Remove copies from `sigil skill install`

Older versions of the CLI installed these skills with `sigil skill install`.
That command is gone. If you ran it, remove its copies before you install through
your agent, or the skills appear twice.

The command wrote into two folders, for your user account and, with `--project`,
for one repository:

| Folder | Read by |
| --- | --- |
| `~/.agents/skills` and `<project>/.agents/skills` | Codex, OpenCode, Pi, Cursor, Gemini CLI, Antigravity |
| `~/.claude/skills` and `<project>/.claude/skills` | Claude Code |

Each guide names the folders its agent reads. A folder holds Sigil-managed
copies when it contains a `.sigil-managed.json` file. Its `entries` object names
every skill the installer owns, each a symlink into the CLI install or a plain
copy. In a project folder the installer also wrote a `.gitignore` whose first
line is `# Managed by sigil skill install` (older versions wrote
`# Managed by sigil install`). Skills you added yourself are not listed there and
stay untouched.

On macOS or Linux, run this for each folder your agent reads. It prints each
entry it removes, deletes the manifest, and removes the lines the installer wrote
from the managed `.gitignore`, deleting the file only when nothing else is left.
Change `dir` to the folder you are cleaning:

```bash
dir="$HOME/.claude/skills"   # or ~/.agents/skills, or <project>/.claude/skills ...
manifest="$dir/.sigil-managed.json"
if [ -f "$manifest" ]; then
  owned="$(mktemp)"
  printf '%s\n' "# Managed by sigil skill install" "# Managed by sigil install" \
    "/.sigil-managed.json" > "$owned"
  sed -n 's/^    "\([^"/][^"/]*\)": {$/\1/p' "$manifest" | while read -r name; do
    echo "removing $dir/$name"
    rm -rf -- "${dir:?}/$name"
    printf '/%s\n' "$name" >> "$owned"
  done
  rm -f -- "$manifest"
  case "$(head -n 1 "$dir/.gitignore" 2>/dev/null)" in
    "# Managed by sigil skill install" | "# Managed by sigil install")
      # Drop only the lines the installer wrote; keep any rules you added.
      grep -vxF -f "$owned" "$dir/.gitignore" > "$dir/.gitignore.new"
      if grep -q '[^[:space:]]' "$dir/.gitignore.new"; then
        mv -- "$dir/.gitignore.new" "$dir/.gitignore"
      else
        rm -f -- "$dir/.gitignore.new" "$dir/.gitignore"
      fi ;;
  esac
  rm -f -- "$owned"
fi
```

Removing a symlink leaves the CLI install it pointed at alone. On Windows, open
`.sigil-managed.json`, delete the folders or links its `entries` name from the
same directory, then delete the manifest and the managed `.gitignore`. If
`.gitignore` has other lines of yours, delete only `/.sigil-managed.json`, the
`/<skill>` lines and the marker line.
