import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const checkoutInput = process.env.ARKME_DSH_CHECKOUT
if (!checkoutInput) throw new Error('ARKME_DSH_CHECKOUT required')
const checkout = await realpath(checkoutInput)
const { default: official } = await import(pathToFileURL(resolve(checkout, 'vitest.web.config.ts')).href)
export default { ...official, test: { ...official.test, include: [resolve(import.meta.dirname, 'tests/e2e/recording-voice-preview.e2e.mjs')], fileParallelism: false } }
