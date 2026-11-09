# Relay browser workspace

## Scope and direction

This replaces the browser workspace, not the separate `site/` marketing app.
Relay remains local, single-user and loopback-only. The HTTP/SSE contract,
agents, configuration, stored chats and scratch folders are unchanged.
Backend edits are limited to static serving in `server.mjs` and its tests.

Hallmark direction: **Ink & Red**, a custom dark modern-minimal app screen,
with selectable palettes. Seed: `relay-local-coding-agent-4571·2ccf9f19·2026-11-04·r0`.
The signature is the editable **agent / model / prompt plan**: users inspect
and change real execution inputs, rather than approving an ornamental preview.

Near-black paper separates history, conversation, code and settings; red marks
action, selection and focus. Inter carries UI/prose; JetBrains Mono carries code
and keyboard notation. Both are self-hosted with licenses in
`ui/public/fonts/NOTICE.md`. Colours, fonts, spacing and layers live in
`ui/src/styles/tokens.css`; the runtime palette, presets and persistence live in
`ui/src/lib/theme.ts`.
No photography, external image fetching, gradients, glow, decorative status
dots, tracked-capital labels, invented activity metrics or cloud/account UI.

## Layout and interaction

- 280px history rail; 52px header; 728px maximum message/composer measure.
- 320px inspector beside the conversation at 1200px and wider; modal sheet
  below that width. The rail becomes a mobile sheet below 768px.
- Docked composer, growing textarea capped at 240px. Conversation scrolls
  independently; empty chats start at the top. Existing chats start at the
  latest message; scrolling up disengages following and exposes Jump to latest.
- Opaque sticky header/composer layers are 300/200; dropdowns 350, modal
  sheets/dialogs 400, notices 500 and tooltips 600. The mobile inspector has
  one visible Close control, tested by browser hit-testing.
- Focus is immediate and visible. Radix manages modal focus; onboarding
  returns focus to the composer. Reduced motion removes animations and
  transitions. Destructive actions require confirmation.
- `Ctrl/⌘ K`: command palette; `Ctrl/⌘ B`: history; `Ctrl/⌘ N`: new chat;
  Enter: submit; Shift+Enter: newline; Escape: stop active work globally.

The tradeoff is deliberate: the old UI exposed all agents/models/quotas at
once. They now take an inspector-opening step so the conversation and plan
stay primary. Model choice remains searchable, but the old usage-ranked
picker and `relay.modelUsage` tracking are not reproduced. Existing
`relay.mode`, `relay.model` and `relay.modelAgent` preferences remain readable.
Unsent drafts survive chat switching within the tab, not a page reload.

## Appearance and themes

The default is **Ink & Red**: near-black paper `#0b0b0c`, a vivid red action
colour `#d92d20`, white button labels and solid primary buttons. Other presets
change both the paper and the accent rather than applying a filter:

| Preset | Paper | Accent | Starting buttons |
| --- | --- | --- | --- |
| Ink & Red | `#0b0b0c` | `#d92d20` | Solid |
| Black & Green | `#090d0b` | `#3ddc84` | Solid |
| Red & White | `#ffffff` | `#b91c1c` | Solid |
| Grey & Black | `#e9e9e6` | `#171717` | Solid |
| Coral | `#f7f3ef` | `#b8512f` | Solid |
| Clear & Outline | `#fafaf8` | `#1f1f1f` | Outline |

The Appearance panel also exposes independent background and button/accent
colour pickers with hex fields, plus three button treatments: solid, outline and
transparent. These can be combined freely; a combination that exactly matches a
preset is labelled with that preset, otherwise it is labelled custom. “Clear &
Outline” is a visual preset inside the page; it does not make the operating
system window transparent.

`ui/src/lib/theme.ts` derives every surface, text, rule, status, focus, overlay
and shadow token from the two chosen colours. It enforces at least 4.5:1 for
muted text, button labels, accent text and status text, and at least 7:1 for body
ink. Arbitrary or low-contrast input is adjusted toward black or white; malformed
stored values fall back to Ink & Red. `ui/src/lib/theme.test.ts` checks every
preset and a set of adversarial custom pairs, including the tinted hover surface.
The choice is stored only in this browser under `relay.theme`, applied before
React renders, and mirrored into `theme-color`; no theme data reaches the local
server or an external service.

The panel is reachable from `/theme`, the header overflow menu (“Appearance and
theme”) and `?panel=appearance`. Preset cards are native radio buttons with a
visible focus ring; sample buttons in the panel are inert previews, and the
contrast figures are computed from the live palette rather than typed in.

## Actual components and architecture

`ui/` uses React 19, strict TypeScript, Vite, Tailwind 3 and shadcn/ui.
`ui/components.json` registers `@prompt-kit` against its real source registry.
Installed prompt-kit source lives in `ui/src/components/ui/`, including
Message, ChatContainer, PromptInput, Markdown, CodeBlock, Reasoning,
Tool, Loader and ScrollButton. These are composed in `App.tsx` and
`components/conversation.tsx`, not recreated as lookalike placeholders.
Adaptations apply Relay tokens, accessible labels, escaped code rendering,
unfinished-fence stability and reduced-motion behaviour.

`ui/src/lib/relay.ts` owns typed requests and the SSE store. Message IDs merge
without duplicates; deltas replace cumulative text, including corrections.
Background activity updates global busy/quota indicators without replacing
the selected chat. Request generations protect against late snapshots,
resource replies and session changes. Reconnect resynchronizes over HTTP;
the server's `hello` event is not allowed to rewind streamed content.
Management panels are lazy-loaded. Vite separates React and markdown chunks.

Markdown is React-rendered text with GFM tables and fenced-code copy controls.
Raw HTML is skipped, unsafe link schemes retain react-markdown filtering,
and images become links instead of loading remote resources. Incomplete
fences use a stable 240px escaped code shell. There is no raw agent HTML
injection or remote syntax-highlighting script.

## Feature parity against the frozen API

| Capability | Browser location and existing contract |
| --- | --- |
| Bootstrap, reconnect, notices and activity | `/api/bootstrap`, `/api/events`; loading/error/reconnect states, global stop and selected-chat isolation |
| New/switch/rename/delete sessions | History rail, inline title editing and confirmed deletion; `/api/session`, `/api/session/:id`, `/api/rename` |
| Working folder and instructor | Header/composer inspectors and first-run setup; `/api/cwd`, `/api/instructor` |
| Plan, Code, Orchestrate and overrides | Composer selectors and editable plan; `/api/plan` with text, mode, model, modelAgent and instructor. Only Code uses `auto:true` |
| Confirm/run, direct dispatch, manual chains/fan-out | Plan actions, `/dispatch`, `/chain`; `/api/run`, `/api/dispatch`, `/api/chain` |
| Stop and side questions | Composer, global Escape, `/stop`, `/btw`; `/api/stop`, `/api/btw` |
| Output, reasoning, retry and run details | Transcript, inspect-step disclosure, copy/pin/retry actions; existing messages and execution endpoints |
| Summary and files | Completed-run summary derived from actual statuses/timestamps/git snapshots; no fabricated token counts. File lists may include pre-existing working-tree changes |
| Pins and shared context | Message actions and Context inspector; `/api/pin`, bootstrap notes/pins |
| Saved pipelines | Save from a plan/summary, inspect and run; `/api/presets` GET/POST and `/api/run` |
| Quota and routing | Agents inspector; `/api/quota/config`, `/api/quota/reset`, quota events. Local observed caps, not provider balance |
| Provider connections and models | API Connections inspector and searchable model dialog; `/api/providers`, `/api/connections`, `/api/connections/:id`. Editing starts with an empty password field; saved keys stay masked |
| MCP and plugins | Registry inspector: add/edit/enable/disable/delete; `/api/mcp`, `/api/plugins`, existing item routes |
| Health/status | Status inspector and `/status`; `/api/health` displays the saved report, not a newly invented live probe |
| Export and help | `/export` downloads current chat JSON locally; Help lists keyboard shortcuts and slash syntax |

Commands retained: `/help`, `/new`, `/clear`, `/rename`, `/model`, `/models`,
`/mode`, `/theme`, `/connect`, `/mcp`, `/plugins`, `/status`, `/btw`,
`/sessions`, `/agents`, `/quota`, `/instructor`, `/cwd`, `/pipelines`,
`/preset`, `/dispatch`, `/chain`, `/export`, `/stop`. Bare commands needing an
argument seed the composer or open the corresponding controls.

**Server-dependent gaps:** preset deletion and side-note removal have no
endpoint in the frozen contract. The UI explains their absence instead of
showing a fake successful delete. No new endpoints were added to fill them.

## Build, package and checks

```sh
npm ci                         # root postinstall installs locked UI dependencies
npm test                       # 47 CLI/static assertions + 29 UI tests
npm run typecheck
npm run build                  # emits public/ HTML, hashed assets and fonts
npm --prefix ui run dev         # loopback Vite development server, API proxy
```

Root CI installs, typechecks, tests and builds on its existing platforms.
Package allowlists include locked UI source/config/tests/fonts and compiled
`public/`, but exclude dependency trees, secrets, chats and scratch data.
Static serving rejects traversal, encoded/backslash variants and escaping
symlinks; hashed assets are immutable and HTML is no-store. Build output
is generated, not a new API or server-side framework.

Final local verification passed all 76 automated tests, strict typecheck and
production build. A fresh package extraction plus the root lockfile previously
passed `npm ci`, the same tests and build with zero reported audit
vulnerabilities; its generated HTML matched this workspace. After the palette
work the package contains 95 allowed files and no secret/session/dependency
trees. Current live HTML, all six built JS/CSS assets and both WOFF2 fonts return
200 on port 7777; traversal-shaped requests are rejected with 400 or 404.
Initial gzip chunks are approximately 69KB React, 65KB markdown and 79KB app;
the lazy inspector adds 11.7KB JS and 1.5KB CSS when opened.

Browser checks run against **only** the in-memory fixture:

```sh
node ui/tests/fixture.mjs       # separate terminal; never starts agents
node ui/tests/browser.mjs       # 17 checks, Chrome + global puppeteer-core
```

`RELAY_FIXTURE_PORT` can move the fixture; set `RELAY_FIXTURE_ORIGIN` to the
same address for the browser suite. `CHROME_PATH` can override Chrome's
location. The test's puppeteer lookup uses `%APPDATA%/npm/node_modules`; it is an
explicit local check, not portable CI.
The suite covers empty/populated narrow screens, appearance presets and custom
colours, button treatments and persistence, session mutations/drafts, editable
run payloads, cumulative streaming, reasoning/incomplete fences, scroll
following, global stop/side questions, code copy/XSS, quota, connections,
registry, pipelines, export, modal layering and onboarding focus. It also
accepts 20 cumulative updates with a 200-message history without duplicate
output. No uncaught browser errors were observed.

Reflow coverage uses 720×450 at DPR 2 to represent a 1440×900 desktop at
200%; it does **not** test browser zoom controls or mobile hardware keyboards.
This is not a screen-reader certification or an exhaustive payload fuzz test.
Real-provider execution, external fan-out and process-tree termination were
not rerun: fixture checks do not establish those external behaviours.

## Visual evidence

Fresh Hallmark render runs of empty, plan, completed conversation and agent
inspector states have **0 FAIL and 0 open REFLEX**. One 39b waiver allows
whole descriptive rows as touch targets. Five static 49 label warnings were
judged: three action-plus-helper rows, one already-nowrap pipeline link and
one model-choice action-plus-helper row; no primary action is intended to wrap.
Normal-paper contrast: ink 16.27:1, muted 6.28:1, error 5.56:1, focus 5.04:1,
accent-2 5.03:1. Render checks also test computed field-edge contrast.

First-screen fresh-context review: **ship**, with the caveat that a long plan
can start scrolled to its latest content on mobile. Finish review found modal
stacking; corrected captures and hit-tests resolve it. Review findings,
judged gates and tradeoffs are recorded in `.hallmark/REVIEW.md`; reproducible
direction in `.hallmark/log.json`. Local captures are ignored by Git.

There are no image slots needing replacement. The most useful further
evidence is a local real-agent run with an existing project, covering provider
authentication, parallel output and process-tree stopping without exposing keys.
