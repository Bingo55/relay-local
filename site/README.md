# Relay marketing site

Vite + React + Tailwind + anime.js. This is a separate app from the Relay server.

## Development

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>.

## Build

```bash
npm run build
npm run preview
```

The production build lands in `dist/` (ignored by git).

## GitHub Pages

The repository includes `.github/workflows/pages.yml`, which builds with:

```bash
BASE_PATH=/relay-local/ npm run build
```

If the repository is renamed, update `BASE_PATH` in the workflow and the
canonical/Open Graph URLs in `index.html`.

## Assets

- `public/images/` — local Pexels photography, credited in `CREDITS.md`
- `public/fonts/` — self-hosted OFL fonts, credited in `NOTICE.md`

Do not hotlink images. Add the photographer, source, license, and download date
to `public/images/CREDITS.md` before using a new photo.
