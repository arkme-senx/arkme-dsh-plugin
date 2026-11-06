import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Let jsdom own browser storage; Node 25+ exposes a separate native store.
    // Set this on workers because Vitest does not forward all parent Node flags.
    execArgv: ['--no-experimental-webstorage'],
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives', 'katex'],
      },
    },
  },
})
