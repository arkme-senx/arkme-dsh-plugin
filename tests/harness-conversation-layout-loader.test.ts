import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { installHarnessConversationLayoutLoader, loadHarnessConversationLayout } from '../src/client/harness-conversation-layout.js'
import { HARNESS_LAYOUT_MODULES } from '../src/harness-conversation-layout-contract.js'
import { readFileSync } from 'node:fs'

afterEach(() => vi.restoreAllMocks())
describe('lazy native layout loader', () => {
  it('declares the Cordis modules injection before accessing its guarded service', () => {
    const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/export const inject = \[[^\]]*'modules'/)
    const ctx = new Proxy({}, { get() { throw new Error('cannot get property modules without inject') } })
    const dom = new JSDOM('')
    try { expect(() => installHarnessConversationLayoutLoader(ctx as any, dom.window.document)()).not.toThrow() }
    finally { dom.window.close() }
  })
  it('shares one load, only imports presentation exports, and cleans up scripts', async () => {
    const dom = new JSDOM('', { url: 'http://localhost' })
    const native = { version: 1, WidthHandle: () => null, resolveContentWidth: () => 700, classes: { root: 'native' } }
    const navigation = { version: 1, TurnNavigator: { $$typeof: Symbol.for('react.memo') } }
    const importModule = vi.fn(async (id: string) => id === HARNESS_LAYOUT_MODULES.width.id ? native : navigation)
    const dispose = installHarnessConversationLayoutLoader({ modules: { import: importModule } } as any, dom.window.document)
    try {
      expect(dom.window.document.querySelectorAll('script')).toHaveLength(0)
      const first = loadHarnessConversationLayout()
      expect(loadHarnessConversationLayout()).toBe(first)
      const scripts = [...dom.window.document.querySelectorAll('script')]
      expect(scripts).toHaveLength(2)
      scripts.forEach(script => script.dispatchEvent(new dom.window.Event('load')))
      expect((await first)?.rootClass).toBe('native')
      expect(importModule).toHaveBeenCalledTimes(2)
      expect(dom.window.document.querySelectorAll('script')).toHaveLength(0)
    } finally { dispose(); dom.window.close() }
    expect(await loadHarnessConversationLayout()).toBeUndefined()
  })
  it('fails non-fatally and cancels a pending load on disposal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dom = new JSDOM('', { url: 'http://localhost' })
    const dispose = installHarnessConversationLayoutLoader({ modules: { import: vi.fn() } } as any, dom.window.document)
    const promise = loadHarnessConversationLayout()
    dispose()
    expect(await promise).toBeUndefined()
    expect(dom.window.document.querySelectorAll('script')).toHaveLength(0)
    dom.window.close()
  })
})
