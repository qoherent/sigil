# Set up your environment

This page takes you from a fresh clone to an edited skill running in your agent,
using the checkout's own `sigil` and `sigilc`. You run only the checkout's copies
while you develop: two same-named copies of a skill, or an installed `sigilc`
beside your build, make an agent silently use stale code.

## Tools

| Tool | Version | Needed for |
| --- | --- | --- |
| [Deno](https://docs.deno.com/runtime/getting_started/installation/) | 2.9.2 | The `sigil` CLI, every check and the skill tests |
| Rust | 1.91.1 | Building `sigilc`, the native compiler the compute skills run |
| [Node.js](https://nodejs.org/) | 24 | Only the full `deno task test` and `deno task check`, through the VS Code extension |
| Git | any recent | Cloning, and the release scripts |
| At least one supported agent | current | Running the skills: Claude Code, Codex, Pi, OpenCode 1.x, Gemini CLI, Antigravity or Cursor |

[CONTRIBUTING.md](../../CONTRIBUTING.md#prerequisites) explains the versions and
how to keep Node at 24. Then clone the repository and install the extension's
packages once (`npm ci --prefix integrations/editor/vscode`); the
[repository setup](../../CONTRIBUTING.md#set-up-the-repository) has the details.

## Build the tools from the checkout

Run these from the repository root.

```bash
deno task --cwd packages/cli install   # a launcher that runs the checkout's sigil
deno task build:sigilc                 # packages/sigilc/target/debug/sigilc
```

The first command installs a `sigil` launcher that compiles from your working tree
on every run, so edits take effect with no reinstall. The second builds `sigilc`.
Rebuild `sigilc` after you pull or switch branches; it does not follow your tree
the way the launcher does.

Put both checkout builds before any installed copy on `PATH`. The launcher lands
in Deno's command folder (`$DENO_INSTALL_ROOT/bin`, or `~/.deno/bin` when that is
unset), and `sigilc` in the checkout's `target/debug`. In `~/.zshrc` or
`~/.bashrc`:

```bash
export PATH="${DENO_INSTALL_ROOT:-$HOME/.deno}/bin:$HOME/Workspace/sigil/packages/sigilc/target/debug:$PATH"
```

Use your own checkout path, and keep this line before `~/.local/bin`, where the
released installer puts `sigil` and `sigilc`; otherwise the released `sigil` wins
over your launcher. Graphical agents (Cursor, the Codex
app, desktop launchers) do not read shell startup files. Start them from a terminal
that has the `PATH`, or set it where the app reads its environment.

A compute skill that finds your `sigilc` offers no installer. When `sigil
--version` reports the checkout's version, it raises no release warning either.

## Remove released copies

Load the checkout only after nothing else provides Sigil skills:

- Uninstall the released plugin as the agent's [install guide](../install/README.md)
  says under "Uninstall", or disable it where the agent allows that.
- Remove any copies made by the old `sigil skill install` command, using
  [the cleanup steps](../install/README.md#remove-copies-from-sigil-skill-install).
- Remove stale hand-made `sigil*` links or folders in the agent's skill folders
  (`~/.claude/skills`, `~/.agents/skills` and the project equivalents), including
  dangling links. Look with `ls -la ~/.claude/skills ~/.agents/skills`.
- If you installed an earlier release of `sigil` or `sigilc`, make sure the
  checkout build comes first on `PATH`.

## Load the checkout into your agent

Each agent loads a plugin folder itself, so you use the same packaging users do and
manifest mistakes show up before a release. In every command, `<checkout>` is the
absolute path of your clone.

| Agent | Load the checkout | After you edit a skill |
| --- | --- | --- |
| Claude Code | Start with `claude --plugin-dir <checkout>`, with the installed `sigil@sigil` disabled | Run `/reload-plugins` |
| Codex | Remove the `sigil` git marketplace, then `codex plugin marketplace add <checkout>` and `codex plugin add sigil@sigil` | `codex plugin remove sigil@sigil`, `codex plugin add sigil@sigil`, restart: Codex copies on install |
| Pi | `pi remove` the git source, then `pi install <checkout>` | Nothing; Pi loads the folder in place |
| OpenCode 1.x | Remove the git entry from `plugin` and add `"<checkout>"` to the global config's `plugin` array | Restart OpenCode |
| Gemini CLI | `gemini extensions uninstall sigil`, then `gemini extensions link <checkout>` | Restart the session |
| Antigravity | `agy plugin uninstall sigil`, then `agy plugin install <checkout>` | Reinstall and restart; whether it copies on install is not verified |
| Cursor | Copy the plugin into `~/.cursor/plugins/local/sigil` (below) | Copy again, then reload the window |

For Cursor, copy rather than link; Cursor skips symlinks that point out of its
plugin folder:

```bash
rm -rf ~/.cursor/plugins/local/sigil
mkdir -p ~/.cursor/plugins/local/sigil
cp -R <checkout>/.cursor-plugin <checkout>/skills ~/.cursor/plugins/local/sigil/
```

Codex copies the whole checkout on install, ignored folders included. A checkout
that holds large untracked output, such as benchmark runs under `analyze-demo/`,
makes `codex plugin add` slow and fills the plugin cache. Keep that output outside
the checkout you load, or load a fresh clone.

Symlinking skill folders into `~/.agents/skills` is the fallback only for an agent
that cannot load a folder. Five agents read that folder, so one link would show
the skills twice across them.

The Cursor, Gemini CLI and Antigravity rows, and OpenCode 1.x, have not been tried
on every maintainer machine. If a step does not behave as written, fix this page.

## Confirm the checkout is in use

Check paths, not versions: a released copy and the checkout can report the same
version.

```bash
command -v sigil sigilc
```

`sigil` should resolve to the launcher in Deno's command folder (it runs your
checkout), and `sigilc` to `packages/sigilc/target/debug/sigilc`. Neither should
resolve to `~/.local/bin`.

Then ask the agent which skills it has and where they come from:

| Agent | Where to look |
| --- | --- |
| Claude Code | `/plugin` or `/skills`: one `sigil-*` set, sourced from your `--plugin-dir` path |
| Codex | `codex plugin list`, and the skill list in a new session: one `sigil` plugin from your checkout marketplace |
| Pi | `pi list`: your checkout path |
| OpenCode | The skill list in a new session; the config's `plugin` entry is your path |
| Gemini CLI | `gemini extensions list`: `sigil` linked to your path |
| Antigravity | `agy plugin list`: `sigil` from your path |
| Cursor | The plugin list in settings, and the skills in a new chat |

Exactly one copy of each of the seven skills should appear. A second copy means a
released install or an old link is still present: go back to
[Remove released copies](#remove-released-copies). To be certain which text the
agent reads, add a harmless line to a skill's `SKILL.md`, start a new session,
and ask the agent to quote it; remove the line afterwards.

## Switch back to the released install

Undo the load, then follow the agent's [install guide](../install/README.md):

- Claude Code: restart without `--plugin-dir` and enable `sigil@sigil` again.
- Codex: `codex plugin remove sigil@sigil`, remove the checkout marketplace, then
  install the release-following one.
- Pi: `pi remove <checkout>`, then install `git:github.com/qoherent/sigil@release`.
- OpenCode: put the git entry back in `plugin` and drop the checkout path.
- Gemini CLI: `gemini extensions uninstall sigil`, then install it again.
- Antigravity and Cursor: uninstall, then follow the install guide.

Take your checkout build off the front of `PATH`, or remove it, so the released
`sigil` and `sigilc` are the ones the skills find.
