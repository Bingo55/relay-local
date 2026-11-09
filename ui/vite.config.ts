import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: '../public', emptyOutDir: true,
    rollupOptions: { output: { manualChunks(id) {
      if (!id.includes('node_modules')) return
      if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
      if (/node_modules\/(marked|react-markdown|remark-|rehype-|micromark|mdast-|hast-|unified|vfile|unist-)/.test(id)) return 'markdown'
    } } },
  },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:7777' } },
})
