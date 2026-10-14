# clawd-tasks

A task board for [Claude Code](https://claude.com/claude-code). When Claude makes a plan, the board lists its tasks under the prompt and, under the task in progress, the steps Claude takes for it: each tool call, what it worked on, and how long it ran.

With [clawd-statusbar](https://github.com/itsomidho/clawd-statusbar) installed, the board sits right above or below the bar, in a frame of the same width. Each plugin works on its own.

![The task board through one plan: four tasks, each tool call filed under the task in progress, a failed test run, then all four done](docs/board.gif)

<sub>One plan, time-lapsed: Claude reads the auth flow with an agent's help, adds an endpoint across three files, writes tests (the first run fails and is fixed), then updates the README. Once every task is done, the board folds to one line.</sub>

## What it shows

| | |
|---|---|
| `✓` `▶` `○` | done, in progress, not started |
| `4m 05s` | how long the task took, or has taken so far |
| `3f +48 −3` | files the task changed, and lines added and removed |
| `2ag` | agents the task started |
| `├ Read tests/AuthTest.php` | the steps of the task in progress: the tool and what it worked on; red when it failed |

The plan comes from Claude's own task list (`TodoWrite`, or `TaskCreate` and `TaskUpdate`). In a session that has neither, the plugin gives Claude a tool of its own, `plan`, to keep the plan on the board; where they exist, that tool waits behind tool search so Claude is not offered two ways to do one thing. Calls a subagent makes are filed under the task in progress too, marked `(agent)`. Calls made while no task is in progress are counted at the bottom.

Line counts come from what Claude sent to the edit tools, so they are close, not a `git diff`.

## Requirements

- Claude Code with plugin hooks (built and tested on 2.1.300)
- Nothing else: no scripts, no network, no tools to install

## Install

In Claude Code, type:

```
/plugin install clawd-tasks --marketplace itsomidho/claude-plugins
```

Answer `y` to add the marketplace if asked, then choose a scope. The [`itsomidho` marketplace](https://github.com/itsomidho/claude-plugins) also lists [clawd-statusbar](https://github.com/itsomidho/clawd-statusbar); each plugin works on its own.

From a shell: `claude plugin install clawd-tasks --marketplace itsomidho/claude-plugins`.

## Commands

| | |
|---|---|
| `/tasks` | hide or show the board (in a pane: open it) |
| `/tasks export` | print the plan as Markdown and copy it to the clipboard, for an MR description |
| `/tasks clear` | empty the board |
| `/tasks close` | hide the board (in a pane: close it) |

`/clear` empties the board too.

## Settings

Open `/plugin`, pick clawd-tasks, and set:

| Setting | Default | |
|---|---|---|
| Where | `prompt` | `prompt`: under the prompt, beside clawd-statusbar if you have it. `pane`: in a pane that docks beside the conversation in fullscreen |
| Open the pane on a plan | on | with Where set to `pane`: open it by itself when Claude writes a plan of two or more tasks, on a terminal 144 columns or wider |

## How it works

The plugin (`hooks/register.tsx`) watches each tool call as it runs. Calls to the plan tools (`TodoWrite`, `TaskCreate`, `TaskUpdate`, and the plugin's own `mcp__clawd-tasks__plan`) update the board's tasks; every other call becomes a step under the task most recently set in progress, timed from start to end, with its file and line counts for the edit tools and an agent count for `Agent`. The rules live in `hooks/board.ts` as plain functions, which the tests in `hooks/board.test.ts` cover; `hooks/register.test.tsx` draws the board under the prompt and calls the plan tool.

The board is kept in the session's state, so it survives a reload of the plugin. Under the prompt it is drawn by a hook on the hint line there, in a frame sized as clawd-statusbar sizes its own; it lists up to six tasks (past that the done ones fold into one line) and the last three steps, so it stays short. A new plan shows it again if you hid it. Nothing leaves your machine.

## Troubleshooting

**The board doesn't show.** It appears only once Claude makes a plan, so ask for work with a few steps ("make a plan and then …"). If it still doesn't show:

- `/tasks` hides and shows it; you may have hidden it. A new plan shows it again too.
- With Where set to `pane`, the board is in a pane: `/tasks` opens it.
- After installing or updating, restart Claude Code. The plan tool, which Claude needs in a session without `TodoWrite` or `TaskCreate`, reaches Claude only once the plugin loads at a session's start.

**`Host key verification failed` on install or update.** Claude Code fetched the plugin from GitHub over SSH, and this machine has no SSH key for GitHub. Either add one (`ssh-keygen -t ed25519`, add it to your GitHub account, then `ssh -T git@github.com` once to accept GitHub's host key), or have git use HTTPS for GitHub:

```
git config --global url."https://github.com/".insteadOf git@github.com:
```

Installing from a shell (`claude plugin install …`) also falls back to HTTPS by itself; updating does not.

**`/tasks` is listed twice, or the board draws twice.** Two copies of the plugin are loaded, such as the installed one and a working copy started with `--plugin-dir`. Run one: start Claude Code without `--plugin-dir`, or disable the installed copy with `/plugin` while you work on yours.

**The board is above the status bar, not below it (or the other way round).** The two plugins each add their frame under the prompt, and their order depends on which one Claude Code loads first; neither plugin can choose it.

## Development

```
claude plugin validate .
claude plugin test .
```

`docs/board.gif` is drawn by `python3 docs/board_gif.py docs/board.gif` (Pillow and the DejaVu fonts).

To run your working copy instead of the installed one, start Claude Code with `claude --plugin-dir /path/to/clawd-tasks`; edits reload when a turn ends.

## License

MIT
