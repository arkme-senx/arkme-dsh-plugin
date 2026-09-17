import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { act, create } from 'react-test-renderer'
import { createElement } from 'react'
import { exposeHarnessConversationLayout, harnessConversationLayoutAsset, readHarnessConversationLayout } from '../src/harness-conversation-layout-assets.js'
import { HARNESS_LAYOUT_MODULES } from '../src/harness-conversation-layout-contract.js'

const fixture = `window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-conversation",
  factory: (require) => {
    var module = { exports: {} };
    function WidthHandle(props) { return props.side; }
    function resolveContentWidth(column, preference) { return preference || column; }
    var ConversationRoot_module_css_default = { root: "native-root" };
    module.exports.apply = () => { throw new Error("Must never apply the presentation factory as a plugin"); };
    return module.exports;
  }
});
//# sourceMappingURL=client.js.map`

describe('optional native conversation layout export bridge', () => {
  it('changes only module identity and exports, never the native implementation', () => {
    const source = exposeHarnessConversationLayout(fixture, 'width')
    let result: any
    new Function('window', source)({ __ModuleLoader__: { load: ({ id, factory }: any) => {
      expect(id).toBe(HARNESS_LAYOUT_MODULES.width.id)
      result = factory(() => {})
    } } })
    expect(result.WidthHandle({ side: 'left' })).toBe('left')
    expect(result.resolveContentWidth(900, 700)).toBe(700)
    expect(result.classes.root).toBe('native-root')
    expect(result.apply).toBeUndefined()
    expect(Object.isFrozen(result)).toBe(true)
    expect(source).toContain('function WidthHandle(props) { return props.side; }')
    expect(source).not.toContain('sourceMappingURL')
  })
  it.each([
    fixture.replace('function WidthHandle(', 'function ChangedHandle('),
    fixture.replace('var ConversationRoot_module_css_default =', 'var ChangedStyles ='),
    fixture.replace('return module.exports;', 'return changed;'),
    fixture.replace('window.__ModuleLoader__', 'otherLoader'),
  ])('fails closed on unsupported or changed native contracts', source => {
    expect(() => exposeHarnessConversationLayout(source, 'width')).toThrow('Unsupported Harness')
  })
  it('serves cache-validated JS, HEAD, and safe unavailable responses', () => {
    const response: any = { writeHead: vi.fn().mockReturnThis(), end: vi.fn() }
    const serve = harnessConversationLayoutAsset(fixture)
    serve({ method: 'GET', headers: {} } as any, response)
    expect(response.end).toHaveBeenLastCalledWith(fixture)
    const etag = response.writeHead.mock.calls[0][1].ETag
    serve({ method: 'GET', headers: { 'if-none-match': etag } } as any, response)
    expect(response.writeHead.mock.lastCall[0]).toBe(304)
    serve({ method: 'HEAD', headers: {} } as any, response)
    expect(response.end.mock.lastCall).toEqual([undefined])
    serve({ method: 'POST', headers: {} } as any, response)
    expect(response.writeHead.mock.lastCall[0]).toBe(405)
    harnessConversationLayoutAsset(undefined)({ method: 'GET' } as any, response)
    expect(response.writeHead.mock.lastCall[0]).toBe(503)
  })

  // Explicit opt-in: checks the actual installed runtime without editing it.
  it.skipIf(!process.env.ARKME_TEST_DSH_BIN)('loads current official factories and their CSS without plugin apply', () => {
    const bin = process.env.ARKME_TEST_DSH_BIN!
    const runtime = createRequire(bin)
    const local = createRequire(import.meta.url)
    const dom = new JSDOM('<html><head></head><body></body></html>')
    const cache = new Map<string, unknown>()
    const nativeRequire = (id: string): any => {
      if (cache.has(id)) return cache.get(id)
      if (['react', 'react-dom', 'react/jsx-runtime'].includes(id) || id === '@deepseek-ai/cordis') return local(id)
      // Browser-only virtual store module has no Node package. No store is
      // needed by these two presentation components, nor may the bridge start one.
      if (id === '@deepseek-ai/dsh-client-store') return new Proxy({}, { get: () => () => { throw new Error('Unexpected native store creation') } })
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
      let entry: string
      try { entry = runtime.resolve(`${id}/client`) }
      catch { return runtime(id) }
      const source = readFileSync(entry, 'utf8')
      let value: unknown
      const window = { __ModuleLoader__: { load: ({ factory }: any) => { value = factory(nativeRequire) } } }
      new Function('window', 'document', source)(window, dom.window.document)
      cache.set(id, value)
      return value
    }
    try {
      const results: any[] = []
      for (const part of ['width', 'navigation'] as const) {
        const source = readHarnessConversationLayout(bin, part)
        new Function('window', 'document', source)({ __ModuleLoader__: { load: ({ factory }: any) => results.push(factory(nativeRequire)) } }, dom.window.document)
      }
      expect(results[0].resolveContentWidth(1200, null)).toBe(768)
      expect(results[0].resolveContentWidth(1200, 2000)).toBe(1024)
      expect(results[0].WidthHandle).toBeTypeOf('function')
      expect(results[1].TurnNavigator).toBeTruthy()
      expect(results.every(result => !result.apply && !result.inject)).toBe(true)
      expect(dom.window.document.querySelectorAll('style[data-plugin-css]').length).toBeGreaterThan(2)
      // Validate our additive avatar content against the real native preview,
      // including focus navigation. No replacement tooltip or native source edits.
      const question = createElement('span', { 'data-test-speaker': 'self' }, 'question')
      const answer = createElement('span', { 'data-test-speaker': 'arko' }, 'answer')
      let renderer: ReturnType<typeof create> | undefined
      try {
        act(() => { renderer = create(createElement(results[1].TurnNavigator, {
          items: [
            { turn: 1, prompt: question, response: answer, anchor: { kind: 'loaded', key: 'a' } },
            { turn: 2, prompt: 'second', response: '', anchor: { kind: 'loaded', key: 'b' } },
          ], activeTurn: 1, busyTurn: null, onNavigate: () => {}, t: (key: string) => key,
        })) })
        act(() => { renderer!.root.findAllByType('button')[0]!.props.onFocus() })
        const tooltip = renderer!.root.findByProps({ role: 'tooltip' })
        expect(tooltip.findAllByProps({ 'data-test-speaker': 'self' })).toHaveLength(1)
        expect(tooltip.findAllByProps({ 'data-test-speaker': 'arko' })).toHaveLength(1)
        expect(tooltip.props.className).toBe(results[1].classes.preview)
      } finally { act(() => renderer?.unmount()) }
    } finally { dom.window.close() }
  })
})
