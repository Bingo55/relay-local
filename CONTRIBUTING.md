# Contributing

Thanks for taking a look at Relay. This is a small, local-first project, so the
most useful contributions are focused bug reports, provider corrections, and
small, well-tested patches.

## Development setup

Requirements:

- Node.js 24 or newer
- npm
- At least one supported agent CLI, if you want to exercise a real run

```bash
git clone https://github.com/Bingo55/relay-local.git
cd relay-local
npm install
npm start
```

Open `http://127.0.0.1:7777`.

The marketing site is a separate Vite app:

```bash
cd site
npm install
npm run dev
```

## Before opening a pull request

Run the local checks:

```bash
npm run cli:test
node --check server.mjs
node --check cli.mjs
npm pack --dry-run
```

If you changed the site:

```bash
cd site
npm run build
```

CI runs the CLI tests on Windows and Ubuntu. Keep changes portable unless the
feature is explicitly Windows-only.

## Provider changes

- The catalog lives in `lib/providers.mjs` and `lib/provider-extras.mjs`.
- Relay speaks OpenAI chat completions and Anthropic Messages. Do not add a
  provider that only offers a media, embeddings, or Responses-only API.
- Include the base URL, key URL, a short note, and at least one known model when
  the provider exposes a public model list.
- Verify the base URL parses with `new URL(...)` and has no trailing slash.
- If a provider needs an account-specific hostname, use a clearly documented
  placeholder such as `REPLACE_ACCOUNT_ID`.

## Agent changes

- Keep commands portable: use `kiro-cli`, `cline`, `opencode`, etc., not
  absolute paths from your machine.
- Put local machine state in ignored files, not in `agents.json`.
- Document new flags and known quirks in the README or `CLI.md`.

## Secrets and local data

Never commit:

- `sessions/`
- `sessions/connections.json`
- `scratch/`
- `.env` files
- API keys, tokens, cookies, or logs containing them
- `probe-report.json` if it contains local paths or model output

Use environment variables or the Connect dialog for keys. If you rotate a key,
assume the old one is compromised.

## Style

- Plain ESM JavaScript, no build step for the app.
- Match the existing formatting and naming.
- Prefer small, focused changes over broad rewrites.
- Keep the server bound to `127.0.0.1`.
- Do not add a dependency if the standard library is enough.

## Security

Do not report vulnerabilities in a public issue. See [SECURITY.md](SECURITY.md).
