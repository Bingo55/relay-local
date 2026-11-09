# Hallmark review — Relay workspace

Date: 2026-11-04, structural review; palette update 2026-11-05.
Scope: app screen, full browser-workspace redesign.
Direction at structural review: Coral, deal 1/3; restrained warm surfaces.
Current direction: Ink & Red, custom dark palette with selectable presets.
The separate `site/` work is out of scope and was left untouched.

## Evidence

Preflight: `preflight.json`. Local, ignored screenshot sets:

- `empty/127.0.0.1-7789-*`: empty first screen, Ink & Red.
- `plan/127.0.0.1-7789-*`: actual editable sample plan.
- `conversation/127.0.0.1-7789-*`: completed sample run with markdown/code.
- `appearance/127.0.0.1-7789-panel-appearance-*`: Appearance panel and presets.
- `inspector/127.0.0.1-7789-panel-agents-*`: agent/quota inspector.

Each set includes 1280×800, 1440×900, 1920×1080, 1440 full-page and 375px
full-page captures from `sloplint --render`. Samples come from an isolated
in-memory fixture on port 7789, never a real agent execution or paid provider.
Before captures: `%LOCALAPPDATA%/Temp/opencode/relay-before/`.

Latest command for each state:

```sh
node <hallmark-skill>/scripts/sloplint.mjs ui/src ui/index.html --scope app --genre modern-minimal --render --url http://127.0.0.1:7789
```

Inspector URLs add `?panel=agents` or `?panel=appearance`. Reset the fixture
before captures, seed a plan through its `/api/plan`, and finish a fixture run
for conversation captures. Do not run mutation-heavy browser tests concurrently
with captures.
All five current render runs: 0 FAIL, 0 open REFLEX, five static WARN 49; the
empty and appearance states additionally report one WAIVED 39b.

## Palette update — 2026-11-05

The default palette changed from Coral to **Ink & Red**: paper `#0b0b0c`,
accent `#d92d20`, white button labels and solid primary buttons. A client-only
appearance system adds Black & Green, Red & White, Grey & Black, Coral and Clear
& Outline presets, independent background/accent pickers, and solid, outline or
transparent button treatments. Saved choices stay in browser storage; the local
server, API contract and layout are unchanged.

The palette module derives every surface, text, rule, status, focus, overlay and
shadow token from the two colours. Body ink reaches 15.91:1 on the default paper;
muted text is 6.17:1, button labels 4.83:1, accent text 6.21:1 and accent text on
the soft tint 5.34:1. Light presets also clear 4.5:1 for muted/button/accent text
and 7:1 for body ink. Five theme tests and the adversarial custom-pair cases
pass. All five render states have 0 FAIL and 0 open REFLEX, with the same five
judged WARN 49 labels and the descriptive-row 39b waiver.

At 320 and 375px the Appearance sheet has no horizontal overflow; all presets,
colour fields, treatment buttons, preview, contrast figures and Reset fit in its
scroll area. Keyboard Tab into the native preset radios produces a visible focus
ring. Light presets were also inspected at 1440px, including a completed
conversation/code block and the composer disabled state.



## First-screen review (Coral structure)

Fresh-context subagent verdict: **ship**.

- Bounded conversation/composer measure, compact header and 280px rail.
- Agent/model/prompt plan and real Run plan confirmation carry the signature.
- Restrained warm typography/surfaces without decorative filler.

Caveats answered: this review happened late, not before all implementation.
A tall plan may start scrolled with its heading above the mobile viewport;
latest-message following is intentional and the conversation is scrollable.
Screenshots do not prove API or state correctness; separate tests address them.

## Finish review and scoring

Fresh-context subagent verdict: **fix**, one finding.

**Finding:** at 375px, workspace header covered inspector title/Close and the
composer painted above the modal.

**Fix:** sheet/dialog overlays and content consume modal layer 400, above
header 300 and composer 200. Dropdown/tooltip layers use 350/600. Browser
hit-testing also found two overlapping Close buttons; the default direct-child
Sheet Close is hidden in the mobile inspector, retaining its own nested Close.

**Score: resolved.** Recaptured 375px inspector shows its complete title and
one Close control above the dimmed workspace. 1440px side-by-side inspector
remains unobstructed. The reviewer confirmed this in its one scoring round.
Browser suite asserts the Close centre is the painted hit target and exactly
one visible Close exists; all 17 browser checks pass.

Before did better: agents, models and quotas needed no inspector-opening step.
Answer: accepted density tradeoff; management remains available while the
conversation/plan become primary. No visual-direction gap was found.

## Judged gates and finish answers

- **39b — waived:** descriptive capability/model rows and whole-card appearance
  presets are touch targets, intentionally taller than a toolbar button. CSS
  records the guard and reason; this is a Reflex waiver, not a Floor waiver.
- **49 — five WARN dismissed:** three empty-state rows contain a short action
  plus wrapping helper, not a wrapping action; the pipeline link has nowrap;
  Auto route includes wrapping explanatory helper. Responsive render/browser
  checks cover 320px upward. CSS records this judgement.
- **11/16:** one hover surface change; no celebratory success toast for visible
  mutations. Notices/errors retain dismissal and retry where appropriate.
- **23/29/38/63/67:** accent only on selection/action/state, neutral surfaces,
  no glow/gradient or accented-word headings, decorative status dots,
  middle-dot metadata strings or tracked-capital labels.
- **46a/47c/70:** all production figures derive from API/message data. Fixture
  figures are explicit samples. Unsupported deletion is explained, not faked.
- **40/41/48:** shared role tokens, paired inks, computed render contrast and
  focus/field-edge checks; no literal application colours beyond theme blocks.
- **62/73:** no reveal-on-load; no-script fallback explains JavaScript needs.
  Header/composer are explicitly opaque sticky chrome. Corrected modal
  captures and Close hit-testing establish layering separately from the
  sticky-chrome exception in the occlusion gate.
- **Finish:** heading balance and themed caret/selection/scrollbar present;
  technical IDs/code/keyboard notation legitimately use the monospace face.
  Conditional local form helpers can change height on errors; accepted for
  an inspector, with no loss of input or false success. Marketing composition,
  section-rhythm, image-slot and screen word-budget checks are inapplicable.

## Limits

Final local verification: 47 CLI/static assertions + 29 UI tests, strict
typecheck/build, and 17 browser checks all pass. A fresh locked installation,
tests and build previously passed under
`%LOCALAPPDATA%/Temp/opencode/relay-final-clean-EZN73K/package`; npm excludes
the root lockfile from tarballs, so the current root lock was copied there
explicitly. Both installs report zero audit vulnerabilities. Fresh generated
HTML matches the current build. The current package has 95 allowed files and no
dependency/secret/chat/scratch trees. Live port 7777 serves current HTML, all
six assets and two WOFF2 fonts; traversal-shaped requests return 400 or 404.

No real provider calls, external parallel runs, process-tree stop revalidation,
screen-reader certification, browser zoom-control test or mobile hardware
keyboard test. Preset deletion and side-note removal need backend endpoints.
The old usage-ranked model picker is not reproduced. No photographic slots
or missing marketing proof were invented.
