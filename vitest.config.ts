import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    // Unit-test the standalone example against the public SDK source. Its
    // separate package/install acceptance still resolves the packed export.
    alias: { '@senguoyun/dsh-arkme/sdk': fileURLToPath(new URL('./src/sdk/index.ts', import.meta.url)) },
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives', 'katex'],
      },
    },
  },
})
