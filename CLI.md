# Relay terminal client

`relay` is a terminal front end for the local Relay server. It uses the same
chats, plans, streaming steps, side answers, and stop button as the browser UI.
It is a client only: it talks to `/api/bootstrap` and `/api/events`; it never
reads `sessions/*/state.json` or `agents.json`.

## Requirements

- Node 24 or newer on your `PATH`.
- No new npm packages for the client and no build step.
- The Relay server at `http://127.0.0.1:7777`. If it is not running, the client
  starts it with `node server.mjs` (set `RELAY_NODE` to choose another Node
  executable). Use `--no-start` to turn that off.
- Windows users can run `relay.cmd` from this folder, or `npm run cli -- ...`.

## Start

```bat
relay                         full-screen view (default when run in a terminal)
relay chat                    streaming chat with a normal prompt
relay "build a landing page"  plan, approve, run, summarize
relay --auto "build it"       plan and run without stopping
relay plan "build it"         only make a plan; nothing runs
```

If the input is not a terminal, `relay` prints usage and exits 2. Use a one-shot
command there instead.

## Commands

| Command | What it does |
| --- | --- |
| `relay "task"` | Makes a plan, asks for approval, runs it, prints the summary. |
| `relay task "task"` | Same as above. |
| `relay plan "task"` | Makes and prints a plan. Never runs it. |
| `relay --plan-only "task"` | Same as `plan`. |
| `relay run [planId]` | Runs a plan, or the last plan in the active chat. |
| `relay chain <file\|->` | Manual chain, one `agent: prompt` per line. Use `-` or a pipe for stdin. |
| `relay direct <agent\|role> "prompt"` | One assistant, no planning. |
| `relay btw "question"` | Side answer while work continues. |
| `relay stop` | Stops the active run and side answers. |
| `relay status` | Chat, folder, planner, model, state, last step, files. |
| `relay sessions` | Lists chats. |
| `relay use <n\|id>` | Switches chat. |
| `relay new` | Creates a chat. |
| `relay rm <n\|id>` | Deletes a chat. |
| `relay rename "title"` | Renames the active chat. |
| `relay cwd [path]` | Shows or sets the working folder. |
| `relay instructor [id\|auto]` | Shows or sets the planner. |
| `relay models` | Lists model refs by assistant. |
| `relay agents` | Lists assistants and roles. No commands, args, or env are shown. |
| `relay quota` | Shows each assistant's local quota meter and the next least-used route. |
| `relay quota set <agent> <n> [day\|week\|month\|total]` | Sets that assistant's local call cap. |
| `relay quota reset [agent]` | Resets one counter, or every counter. |
| `relay export [path]` | Writes the active chat as JSON. |

Quota limits are local guardrails, not live provider balances: Relay counts the
calls it makes and records quota/auth walls. Set a cap from the command line,
the web Quota panel, or `.\quota.ps1 -Set <agent> -Limit <n>`. The provider's own
dashboard remains authoritative.

Nothing runs without pressing Enter on the approval prompt, passing `--yes`, or
passing `--auto`. `--json` without `--yes` prints the plan and exits 0.

### Global options

```
--url <url>          server address (default http://127.0.0.1:7777)
--no-start           do not start the server automatically
--no-color           disable color (NO_COLOR also works)
--no-mouse           full-screen view: no mouse reporting
--session <id>       switch chat before doing anything
--model <ref>        model override for this command
--instructor <id>    planner: opencode | qoder | agy | auto
-y, --yes            approve the plan without asking
--auto               plan and run in one request
--plan-only          plan, print, exit
--json               one-shot JSON on stdout; progress stays on stderr
--debug              extra diagnostics on stderr
-h, --help           help
-V, --version        version
```

## Full-screen view

The full-screen view has the same OpenCode-style shape on every terminal:

- A header with the chat title, folder, model, and live status.
- A left sidebar with chats, the current run's steps, changed files, and last-run
  stats. It appears at 88 × 20 or larger; `Ctrl+B` shows or hides it.
- A clean transcript with user messages, plans, step cards, side answers, and a
  `WHAT HAPPENED` summary. Markdown, lists, quotes, and fenced code blocks are
  rendered in place; raw assistant output stays visible.
- A bordered composer with the real blinking cursor and a status/hint line.
- A searchable command palette for actions, models, and planners.

The palette is the quickest way to drive the view. Press `Ctrl+P`, type part of
an action, then use `↑`/`↓` and `Enter`.

## Full-screen keys

| Key | Action |
| --- | --- |
| `Enter` | Send, or run the pending plan. |
| `s` | Skip a pending plan. |
| `Alt+Enter` | New line in the composer. |
| `Shift+Enter` | Same as Alt+Enter in terminals that send it as a newline. |
| `←` `→` `Home` `End` | Move the caret. |
| `↑` `↓` | Previous/next line, then prompt history at the edges. |
| `Ctrl+←` `Ctrl+→` | Move by word. |
| `Backspace` `Delete` | Delete a character. |
| `Ctrl+W` | Delete the previous word. |
| `Ctrl+U` / `Ctrl+K` | Delete to the start / end of the line. |
| `PgUp` `PgDn` | Scroll the transcript. |
| Mouse wheel | Scroll the transcript or the open overlay. |
| Click in the composer | Place the caret. |
| `Ctrl+End` | Jump to the newest output. |
| `Esc` | Close an overlay, skip a pending plan, or stop the run. |
| `Ctrl+P` | Searchable command palette. |
| `Ctrl+B` | Show or hide the left sidebar. |
| `Ctrl+O` | Chat picker. |
| `Ctrl+N` | New chat. |
| `Ctrl+R` | Reconnect and refresh. |
| `Ctrl+L` | Redraw. |
| `Ctrl+Q` | Quit when idle. |
| `Ctrl+D` | Quit when idle. Does not quit while work is running. |
| `Ctrl+C` | Stop the run; clear the line; press twice to quit. |
| `?` | Help, when the composer is empty. |
| `Tab` | Complete a slash command. |

Slash commands in the REPL and full-screen view:

```
/help /new /sessions /use <n|id> /rm <n|id> /status
/btw <text> /stop /model [ref|auto] /models /agents /quota
/instructor [id] /cwd [path] /rename <title>
/plan <text> /chain <script> /direct <agent> <prompt>
/pin <step> /export [path] /clear /palette /sidebar /quit
```

`/model` without an argument opens the model picker. `/instructor` without an
argument opens the planner picker. `/palette` opens the command palette.
`/chain` accepts `\n` between steps. `/clear` clears the screen; the chat is
still on disk.

## Approval

After a plan is made, the client asks:

```
Run this?  Enter = run · s = skip
```

`s` skips in the full-screen view; one-shot mode uses `n`. In one-shot mode
without a terminal to ask, the plan is printed and the command exits 0; use
`--yes` or `--auto` to run. The plan steps are shown with assistant labels,
never raw agent ids, commands, or environment variables.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success, including a plan that was only printed. |
| 1 | A run problem: a step failed, timed out, ran out of credits, or the planner failed. |
| 2 | Usage error: unknown option, missing task, or no terminal where one is required. |
| 3 | Connection problem: Relay is down, the port is busy, or the server could not start. |
| 130 | Interrupted with Ctrl+C. The client tries to stop the server run first. |
| 143 | Terminated with SIGTERM. |

Usage errors print to stderr. `--json` output goes only to stdout; progress,
warnings, and errors go to stderr.

## JSON

`--json` is for one-shot commands. Example shape:

```json
{
  "ok": true,
  "exitCode": 0,
  "ran": true,
  "command": "task",
  "session": { "id": "ses_...", "title": "...", "cwd": "..." },
  "plan": { "id": "plan_...", "task": "...", "steps": [] },
  "steps": [{ "n": 1, "agent": "...", "status": "done", "text": "..." }],
  "summary": { "total": 1, "finished": 1, "problems": 0, "files": [] },
  "error": null
}
```

Only display-safe fields are included. Agent `env`, `cmd`, and `args` are never
printed by any command.

## Selecting text

The full-screen view uses the terminal's alternate screen and turns on mouse
reporting by default. A normal drag is sent to the app, not to the terminal, so
it will not select text. Hold **Shift** while dragging to use the terminal's
own selection, then copy as usual. `--no-mouse` turns mouse reporting off
entirely if you prefer the terminal's selection behavior.

## Notes

- One chat is active at a time. The browser and terminal share it.
- Switching chats is refused while a run or side answer is active. Stop it first.
- Raw assistant output is always shown. The `WHAT HAPPENED` card is derived from
  the messages and the folder's git snapshot; it is not a replacement for the
  raw lines.
- The client has no config file and stores nothing itself. Chats live in the
  server's `sessions/` folder, as they do for the browser.
- `Relay` does not retry a failed step. Read the last lines and ask again.
