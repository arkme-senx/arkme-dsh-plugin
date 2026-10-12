import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as jsx from 'react/jsx-runtime'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import * as cordis from '@deepseek-ai/cordis'
import { build, type UserConfig } from 'tsdown'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import configs from '../tsdown.config.js'
import { verifyBrowserBundle } from '../scripts/verify-browser-entrypoints.mjs'

const entries = [['harness-model', 'apply'], ['harness-native-selection', 'install']] as const
let output: string
beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'arkme-harness-bundle-'))
  for (const [entry] of entries) {
    const config = (configs as UserConfig[]).find(item => item.name === `@senguoyun/dsh-arkme/${entry}`)
    if (!config) throw new Error(`Missing build configuration for ${entry}`)
    await build({ ...config, config: false, outDir: output, report: false })
  }
}, 60_000)
afterAll(async () => { if (output) await rm(output, { recursive: true, force: true }) })

it.each(entries)('loads the built %s factory using only Harness platform modules', async (entry, entryExport) => {
  const fileName = `${entry}-client.js`
  const source = await readFile(join(output, fileName), 'utf8')
  verifyBrowserBundle(source, fileName)
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://example.test/arkme-self/harness-frame', runScripts: 'outside-only',
  })
  const fetch = vi.fn(async () => { throw new Error('Loading a factory must not issue network requests') })
  Object.assign(dom.window, { fetch })
  const platform = new Map<string, unknown>([
    ['react', React], ['react-dom', ReactDOM], ['react/jsx-runtime', jsx],
    ['@deepseek-ai/dsh-client-ui-primitives', primitives],
    ['@deepseek-ai/dsh-client-ui-slots', slots], ['@deepseek-ai/cordis', cordis],
  ])
  type Factory = { id: string; factory(require: (id: string) => unknown): Record<string, unknown> }
  const registrations: Factory[] = []
  Object.assign(dom.window, { __ModuleLoader__: { load: (factory: Factory) => registrations.push(factory) } })
  try {
    runInContext(source, dom.getInternalVMContext(), { filename: fileName, timeout: 10_000 })
    expect(registrations).toHaveLength(1)
    const registration = registrations[0]!
    expect(registration.id).toBe(`@senguoyun/dsh-arkme/${entry}`)
    // Match DSH's module-table boundary: a browser require cannot read sibling files from disk.
    const exports = registration.factory(id => {
      if (!platform.has(id)) throw new Error(`Unregistered browser module: ${id}`)
      return platform.get(id)
    })
    expect(exports[entryExport]).toBeTypeOf('function')
    expect(fetch).not.toHaveBeenCalled()
  } finally { dom.window.close() }
}, 15_000)
