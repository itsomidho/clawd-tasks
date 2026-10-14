# clawd-tasks

A task board for [Claude Code](https://claude.com/claude-code). When Claude makes a plan, the board lists its tasks and, under the task in progress, the steps Claude takes for it: each tool call, what it worked on, and how long it ran.

```
Plan · 3/5 done · 12m 40s
✓ Read the existing auth flow                 1m 20s
✓ Add the token refresh endpoint              4m 05s  3f +48 −3
▶ Writing tests for refresh                   2m 10s  1f +48 −0
   ├ Read   tests/AuthTest.php                    0s
   ├ Edit   tests/RefreshTest.php                 0s
   └ Bash   Run the refresh tests           running…
○ Update the README
○ Run the full suite
```

## What it shows

| | |
|---|---|
| `✓` `▶` `○` | done, in progress, not started |
| `4m 05s` | how long the task took, or has taken so far |
| `3f +48 −3` | files the task changed, and lines added and removed |
| `2ag` | agents the task started |
| `├ Read tests/AuthTest.php` | the steps of the task in progress: the tool and what it worked on; red when it failed |

The plan comes from Claude's own task list (`TodoWrite`, or `TaskCreate` and `TaskUpdate`). Calls a subagent makes are filed under the task in progress too, marked `(agent)`. Calls made while no task is in progress are counted at the bottom.

Line counts come from what Claude sent to the edit tools, so they are close, not a `git diff`.

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
| `/tasks` | open the board |
| `/tasks export` | print the plan as Markdown and copy it to the clipboard, for an MR description |
| `/tasks clear` | empty the board |
| `/tasks close` | close the board |

`/clear` empties the board too.

## Settings

Open `/plugin`, pick clawd-tasks, and set:

| Setting | Default | |
|---|---|---|
| Open on a plan | on | open the board by itself when Claude writes a plan of two or more tasks, on a terminal 144 columns or wider |

## Development

```
claude plugin validate .
claude plugin test .
```

To run your working copy instead of the installed one, start Claude Code with `claude --plugin-dir /path/to/clawd-tasks`; edits reload when a turn ends.

## License

MIT
