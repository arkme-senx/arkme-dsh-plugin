import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const checkout = process.env.ARKME_DSH_CHECKOUT
if (!checkout) throw new Error('ARKME_DSH_CHECKOUT is required')
const { default: harnessConfig } = await import(pathToFileURL(resolve(checkout, 'vitest.web.config.ts')).href)
export default {
  ...harnessConfig,
  test: {
    ...harnessConfig.test,
    include: [resolve(import.meta.dirname, process.env.ARKME_MANAGED_AI_TOOL_IMAGES === '1' ? 'tests/e2e/managed-ai-tool-images.e2e.mjs' : 'tests/e2e/managed-ai.e2e.mjs')],
    fileParallelism: false,
    testTimeout: 180_000,
  },
}
