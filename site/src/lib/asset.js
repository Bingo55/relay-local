const base = import.meta.env.BASE_URL || '/'

// Resolve a public asset against Vite's configured base path. This keeps the
// site working both at the domain root and under a GitHub Pages project path.
export const asset = (path) => `${base}${String(path).replace(/^\//, '')}`
