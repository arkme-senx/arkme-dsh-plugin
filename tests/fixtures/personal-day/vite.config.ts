import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Build-only fixture. Browser tests intercept all requests; never use a real login.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), base: './',
  build: { chunkSizeWarningLimit: 7000 } })
