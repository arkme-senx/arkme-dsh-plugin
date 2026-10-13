// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectArkmeLocale, resolveArkmeLocale } from '../src/client/locale.js'
import { connectDesktopBranding } from '../src/client/desktop-branding.js'
import { ArkmeJiwoBrandMark } from '../src/client/ArkmeJiwoBrandMark.js'
import { ArkmeAboutProduct } from '../src/client/ArkmeAboutDetails.js'
import { ArkmeHeroBrandMark } from '../src/client/ArkmeBrand.js'
import { getArkmeBrand } from '../src/client/product-brand.js'

let active = 'zh', changed: () => void, dispose: () => void
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  active = 'zh'
  dispose = connectArkmeLocale({ getLocale: () => ({ active }), subscribe: fn => { changed = fn; return () => {} } })
})
afterEach(() => { active = 'zh'; changed(); dispose() })
const switchTo = async (locale: string) => { await act(async () => { active = locale; changed() }) }

describe('localized product identity', () => {
  it('maps every Chinese variant to 即我 and other languages to Arkme', () => {
    for (const locale of ['zh', 'zh-CN', 'zh-TW', 'ZH_hant']) expect(resolveArkmeLocale(locale)).toBe('zh')
    for (const locale of ['en', 'fr', 'ja', '']) expect(resolveArkmeLocale(locale)).toBe('en')
  })
  it('updates navigation, hero and About in place in both directions', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    await act(async () => root.render(<><ArkmeJiwoBrandMark /><ArkmeHeroBrandMark size={40} /><ArkmeAboutProduct /></>))
    const first = host.querySelector('img')!
    expect(first.alt).toBe('即我')
    expect(first.src).toBe(getArkmeBrand('zh').wordmark)
    await switchTo('en')
    expect(host.querySelector('img')).toBe(first)
    expect([...host.querySelectorAll('img')].every(img => img.alt === 'Arkme')).toBe(true)
    expect(first.src).toBe(getArkmeBrand('en').wordmark)
    expect(host.querySelector('.arkme-about-product img')?.getAttribute('src')).toBe(getArkmeBrand('en').about)
    await switchTo('zh-Hant')
    expect([...host.querySelectorAll('img')].every(img => img.alt === '即我')).toBe(true)
    await act(async () => root.unmount())
  })
  it('sends the initial locale, coalesces fast switches, and releases its subscription', async () => {
    let resolve: (value: boolean) => void = () => {}
    const setLocale = vi.fn().mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done })).mockResolvedValue(true)
    const stop = connectDesktopBranding({ schemaVersion: 1, setLocale })
    expect(setLocale).toHaveBeenCalledWith('zh')
    await switchTo('en'); await switchTo('zh'); await switchTo('en')
    expect(setLocale).toHaveBeenCalledTimes(1)
    resolve(true); await Promise.resolve(); await Promise.resolve()
    expect(setLocale.mock.calls.map(call => call[0])).toEqual(['zh', 'en'])
    stop(); await switchTo('zh')
    expect(setLocale).toHaveBeenCalledTimes(2)
  })
  it('works in a plain browser or an older desktop and contains bridge failures', async () => {
    connectDesktopBranding(undefined)()
    const setLocale = vi.fn().mockRejectedValue(new Error('disposed'))
    const stop = connectDesktopBranding({ schemaVersion: 1, setLocale })
    await Promise.resolve(); await switchTo('en')
    expect(setLocale).toHaveBeenCalledWith('en')
    stop()
  })
});
