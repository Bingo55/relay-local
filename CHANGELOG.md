# Changelog

## Unreleased — 2026-11-07

- Connected HTTP agents surface the real network failure cause (e.g.
  `fetch failed · ETIMEDOUT`) instead of a bare message.
- Optional client `user-agent` and `apiStyle: 'responses'` fields on
  connection records; the Responses API (streamed `response.output_text.delta`
  and full payloads) is now parsed by the HTTP runner.
- Opt-in tool loop for connected HTTP agents (`tools: true`): run_shell,
  read_file and write_file rooted at the session folder, bounded to
  `maxToolRounds` rounds, streaming text across rounds.
- A plain (non-quota) step failure gets exactly one reroute to a healthy
  fallback agent, so a single CLI crash no longer ends a plan step.

## 0.1.0 — 2026-10-25

Initial public release.

- Local web workspace for planning, routing, and running CLI coding agents.
- Plan, Code, and Orchestrate modes with editable plans and parallel fan-out.
- 83 provider presets covering 76 of the 81 TokenVault providers. Sail and
  ACLIDE are omitted because they use the Responses API; Moondream, Speechify,
  and Replicate are omitted because they are media-only.
- OpenAI-compatible and Anthropic Messages API connections, with masked key
  hints in the browser.
- Local sessions, pinned context, side notes, usage statistics, and quota
  meters.
- Terminal client, MCP bridge, health probe, and 41 CLI tests.
- Separate Vite marketing site in `site/`. (Historic: that release had 41 CLI tests; the current suite is 47 static/CLI + 29 UI.)
