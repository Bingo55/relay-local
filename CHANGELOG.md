# Changelog

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
- Separate Vite marketing site in `site/`.
