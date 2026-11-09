# Relay

[![ci](https://github.com/Bingo55/relay-local/actions/workflows/ci.yml/badge.svg)](https://github.com/Bingo55/relay-local/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Relay is a local-first control room for CLI coding agents and API models. Plan a
job once, route each step to the agent or model you trust, and keep the plan,
outputs, and review notes in one workspace.

It runs on `127.0.0.1` and never asks you to create a Relay account.

```
you ──► instructor ──► plan: [build, review]
                         │
              build ─────┤
                         ▼
                    one transcript
```

## What it does

- **Plan, Code, Orchestrate.** Write an editable plan, plan-and-run, or fan the
  same objective out to several agents in parallel.
- **Bring your own agents.** Claude Code, Codex, Gemini CLI, opencode, Kilo,
  Kiro, Qoder, Cline, and compatible CLI tools.
- **Bring your own models.** 83 provider presets for OpenAI-compatible and
  Anthropic Messages endpoints.
- **Keep context.** Sessions, pinned outputs, side answers, run history, git
  snapshots, usage stats, and local quota meters.
- **Stay local.** The browser UI, session store, and API keys are all on your
  machine.

Relay is not a hosted service, a sandbox, or a replacement for the agents
themselves. It is the place where you coordinate them.

## Tech stack

Relay keeps its runtime local:

- **Server:** Node.js 24, plain ESM, standard library only. No framework and no
  build step.
- **Browser UI:** React 19, strict TypeScript, Vite, Tailwind, shadcn/ui and
  prompt-kit. Source lives in `ui/`; its build is served from `public/`.
- **Marketing site:** Vite, React 18, Tailwind CSS, and anime.js v4.
- **Storage:** local JSON files under `sessions/`. No database.
- **Transport:** HTTP and Server-Sent Events on `127.0.0.1`.

There is no Relay account, cloud service, container, or database to provision.
The only runtime requirement is Node 24 plus the agent CLIs or API keys you
choose to connect.

## Requirements

- **Node.js 24 or newer** and npm.
- At least one supported agent CLI, or an API key for a provider you want to
  call directly.
- Windows 10/11 is the primary development platform. The CLI test suite runs on
  Windows and Ubuntu in CI; macOS and Linux should work with Node 24, but the
  full app is not yet exercised end-to-end on every platform.

## Install from source

```bash
git clone https://github.com/Bingo55/relay-local.git
cd relay-local
npm install
npm run build
npm start
```

Open <http://127.0.0.1:7777>.

Root installation also installs the locked UI dependencies. A clean checkout
supports `npm ci && npm run build`. Without a build, the server displays a
build-first page rather than an empty workspace. Fonts are self-hosted; see
`ui/public/fonts/NOTICE.md` and `UI-DESIGN.md` for design and parity details.

To install the terminal client globally:

```bash
npm link
relay --help
```

On Windows you can also run `relay.cmd` from the project folder. The npm package
is marked `private` because Relay is distributed as a local install, not as a
public npm package.

## First run

1. **Pick a working folder.** New chats start in `scratch/`, a disposable folder
   inside the app. Change the folder in the header to the project you want the
   agents to touch before you run anything.
2. **Connect an agent or a provider.** Open **API connections** for an API key,
   or install and sign in to a CLI agent. `agents.json` is the registry; the
   app reloads it when it starts.
3. **Check the install.** Run:

   ```bash
   npm run doctor
   ```

   The probe writes `probe-report.json` (ignored by git) and prints a fix hint for
   each agent that cannot answer headlessly.

## Modes

| Mode | What happens |
| --- | --- |
| **Plan** | The instructor writes a plan and waits. Edit the agent, model, or prompt of each step, then run it. |
| **Code** | The instructor plans and runs automatically. Every step sees the earlier outputs. |
| **Orchestrate** | The same objective is fanned out to several agents in parallel; their outputs feed the later steps. |

Plans are validated before anything runs: known agents, at most six steps, a
fan-out of two to four agents, and a non-empty prompt.

## Agents

`agents.json` contains the default registry. The shipped entries are:

`qoder`, `agy`, `agy-flash`, `kilo`, `opencode-build`, `kiro`, `gemini`,
`claude`, `codex`, `nvidia`, and `cline`.

Some entries are disabled until you authenticate them or provide a working
provider key. Relay does not install agent CLIs for you.

A minimal agent entry:

```json
{
  "id": "cursor",
  "label": "Cursor CLI",
  "cmd": "cursor-agent",
  "args": ["-p"],
  "delivery": "stdin",
  "caps": "what it is good at, in one line",
  "timeoutMin": 30
}
```

| Field | Meaning |
| --- | --- |
| `cmd` / `args` | Process to spawn. Use `{prompt}` in `args` to place the prompt somewhere other than the end. |
| `delivery` | `stdin`, `arg`, or `file`. Long prompts switch to `file` when an argument would exceed the command-line limit. |
| `parse` | `json:response` unwraps an envelope; `json:result` unwraps Claude Code's result. Omit for plain text. |
| `resume` | Optional session continuity for CLIs that support it. |
| `model` / `models` | Default model and the list shown in the model pickers. |
| `modelArg` | Flag whose following argument is the model (`-m`, `--model`, etc.). |
| `disabled` | Hide the agent from routing. |
| `note` | Shown in the UI and used by `npm run doctor` as the fix hint. |

Use portable command names (`kiro-cli`, `cline`, `opencode`) rather than
absolute paths so the registry works on another machine.

## Providers

The **Connect** dialog contains 83 presets. 76 of the 81 providers in the
TokenVault catalog are covered. Five are intentionally omitted because Relay
cannot call them:

- **Sail** and **ACLIDE** use the Responses API.
- **Moondream**, **Speechify**, and **Replicate** are media-only.

Relay speaks OpenAI chat completions and Anthropic Messages. A provider must
offer a raw chat endpoint to be usable here.

Provider balances stay on the provider dashboard. Relay tracks observed local
calls only; it cannot see upstream token counts.

Cloudflare Workers AI needs your account ID in the base URL. Replace
`REPLACE_ACCOUNT_ID` in the preset before connecting.

Keys are stored in `sessions/connections.json` with best-effort `0600`
permissions. The browser only receives a masked hint.

## Security

Relay is local, but it is not a security boundary.

- The server binds to `127.0.0.1` and has no authentication layer. Do not expose
  port `7777` to a network or the public internet.
- API keys are **not encrypted at rest**. Use a dedicated OS account or a
  container/VM when that matters.
- Agents run with your OS permissions. Several presets use permission-bypass
  flags so they can finish a task. Relay is not a sandbox.
- Output from one agent is wrapped and labelled as data, but prompt injection
  between agents is still possible. Do not chain auto-approving agents over a
  repository you cannot restore.
- `Stop` kills the process tree; it does not roll back files. Relay records git
  status and a diff-stat before and after a step when the working folder is a git
  repository root.
- New chats default to `scratch/`, not to the Relay source tree. Change the
  folder deliberately before running agents.

See [SECURITY.md](SECURITY.md) for the reporting process and a hardening
checklist.

## Terminal client

The `relay` command is a terminal front end for the same local server:

```bash
relay                         # full-screen view
relay chat                    # streaming chat
relay "build a landing page"  # plan, approve, run, summarize
relay plan "build it"         # plan only
relay --auto "build it"       # plan and run without stopping
relay status                  # plain status card
relay sessions                # list chats
relay agents                  # list assistants and roles
```

See [CLI.md](CLI.md) for the full command list, keys, exit codes, and JSON
output.

## MCP bridge

`mcp.mjs` exposes Relay to opencode or any other MCP client over stdio. Tools:
`relay_dispatch`, `relay_plan`, `relay_chain`, and `relay_agents`.

```json
{
  "mcp": {
    "relay": {
      "type": "local",
      "command": ["node", "/absolute/path/to/relay-local/mcp.mjs"],
      "enabled": true
    }
  }
}
```

MCP calls are synchronous and can take minutes. The agents can write files in the
supplied working folder.

## Marketing site

The site in `site/` is a separate Vite app:

```bash
cd site
npm install
npm run dev      # http://127.0.0.1:5173
npm run build
npm run preview
```

The GitHub Pages workflow builds it with `BASE_PATH=/relay-local/`. If you rename
the repository or use a custom domain, update `BASE_PATH` in
`.github/workflows/pages.yml` and the canonical/Open Graph URLs in
`site/index.html`.

Fonts and their licenses are in `site/public/fonts/NOTICE.md`.

## Development

```bash
npm ci
npm test                  # CLI/static and UI data-layer tests
npm run typecheck         # strict UI TypeScript
npm run build             # builds ui/ into public/
npm run doctor            # probe every configured agent
npm run smoke             # live end-to-end smoke test
npm pack --dry-run        # inspect the local package
```

The server reads `agents.json` at startup; restart it after changing the agent
registry. Rebuild the browser app after source changes. For UI development,
run `npm --prefix ui run dev` alongside `npm start`; Vite proxies the local API.
Agent probes and smoke tests make real provider calls; they are not part of CI.
For isolated browser checks, run `node ui/tests/fixture.mjs` in a separate
terminal, then `node ui/tests/browser.mjs`. This uses Chrome and global
`puppeteer-core`, never starts agents, and changes only in-memory sample data.
See [UI-DESIGN.md](UI-DESIGN.md) for parity, visual review and test limitations.

### Project layout

```text
agents.json             agent registry
presets.json            saved pipelines
server.mjs              HTTP server, SSE, API routes
cli.mjs                 terminal client
mcp.mjs                 MCP stdio bridge
probe.mjs               health probe / doctor
lib/plan.mjs            instructor prompt, JSON extraction, validation
lib/execute.mjs         step runner, fan-out, context assembly, git snapshots
lib/providers.mjs       provider catalog
lib/provider-extras.mjs additional provider presets
lib/connections.mjs     connection storage and key hints
ui/                     React browser app source and self-hosted fonts
public/                 compiled browser app (assets generated by build)
site/                   Vite marketing site
sessions/<id>/          local chats, steps, and connections (ignored)
scratch/                disposable default working folder (ignored)
```

## Troubleshooting

- **An agent is missing.** Add it to `agents.json`, restart the server, and run
  `npm run doctor`.
- **An agent returns an auth error.** Run the CLI's own login command, or set the
  environment variable named in its `note`.
- **An API provider returns 401.** Check the key on the provider dashboard and
  reconnect it. Relay only stores the key you paste.
- **Port 7777 is busy.** Change `port` in `agents.json` and restart.
- **The quota panel is empty on Windows.** Use the web panel or
  `.\quota.ps1 -Set <agent> -Limit <n>`.
- **The site build warns about fonts.** The warnings are expected for public
  assets resolved at runtime; verify the built page loads the fonts.

## Known limits

- One run at a time. Separate runs would fight over the same working folder.
- Each earlier output is clipped to 12,000 characters when it is fed forward.
- Per-CLI session resume is not reliable in one-shot mode, so Relay re-sends the
  transcript.
- Relay cannot count upstream tokens; usage is what it observes locally.
- The API keys are stored in plaintext. The OS account is the boundary.

## License

MIT. See [LICENSE](LICENSE).

The MIT license covers the code. Fonts are under the SIL Open Font License;
see the font notices linked above.
