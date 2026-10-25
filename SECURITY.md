# Security

Relay is a local-first tool. It is designed to run on your machine, not as a
shared or public service.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting:

https://github.com/Nepoleon/relay-local/security/advisories/new

Include the version, the operating system, reproduction steps, and the impact
you believe the issue has. I will acknowledge the report and coordinate a fix
and disclosure.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Security model

- Relay binds to `127.0.0.1` only.
- Requests with a non-loopback `Host` header are rejected (DNS-rebinding
  protection), cross-origin browser requests are rejected, and writes that
  carry a body must use `Content-Type: application/json`.
- There is still no authentication layer. Do not expose port `7777` to a
  network, a container host, or the public internet.
- Connected API keys are stored in `sessions/connections.json` with best-effort
  `0600` permissions. They are **not encrypted at rest**. The browser receives
  only a masked key hint.
- Agents run as child processes with your operating-system permissions. Several
  presets use permission-bypass flags so they can finish a task. Relay is not a
  sandbox, container, or virtual machine.
- Output from one agent is treated as data, but prompt injection between agents
  is still possible. Do not chain auto-approving agents over a repository you
  cannot restore.
- Only one run executes at a time. Stop kills the process tree, not the entire
  operating-system session.

## Hardening checklist

- Keep the server on loopback.
- Use a dedicated OS account or a container/VM when the blast radius matters.
- Point new chats at the project folder you intend to change, not at your home
  directory.
- Review diffs before accepting agent work.
- Rotate a provider key immediately if you believe it was exposed.
- Delete `sessions/connections.json` and `sessions/` before sharing a machine
  image or a copy of the app.
