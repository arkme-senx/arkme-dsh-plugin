import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const checkout = process.env.ARKME_DSH_CHECKOUT
if (!checkout) throw new Error('ARKME_DSH_CHECKOUT is required')
const { default: harnessConfig } = await import(pathToFileURL(resolve(realpathSync(checkout), 'vitest.web.config.ts')).href)
export default { ...harnessConfig, test: { ...harnessConfig.test, include: [resolve(import.meta.dirname, 'tests/e2e/recording-entities.e2e.mjs')], fileParallelism: false } }
