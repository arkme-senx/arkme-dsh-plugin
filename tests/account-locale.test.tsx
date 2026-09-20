// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectArkmeLocale, tr, calendarWeekdays, arkmeIntlLocale } from '../src/client/locale.js'
import { ArkmeProfileEditor } from '../src/client/ArkmeProfileEditor.js'
import { ArkmeAboutDetails, ArkmeAboutProduct } from '../src/client/ArkmeAboutDetails.js'
import { WechatBindingSettingsRow } from '../src/client/ArkmeSettingsSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeUserProfile } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call, ArkmeClientError: class extends Error {} }))
let active = 'zh', callback: () => void, cleanup: () => void
const profile = { userId: 42, nickname: '中文昵称', displayName: '中文昵称', avatarRef: '', contact: {}, bindings: {} } as ArkmeUserProfile
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  active = 'zh'; cleanup = connectArkmeLocale({ getLocale: () => ({ active }), subscribe: fn => { callback = fn; return () => {} } })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true } })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 42 }); mock.call.mockReset()
})
afterEach(() => { act(() => { active = 'zh'; callback() }); cleanup() })
const switchEnglish = () => act(() => { active = 'en'; callback() })
describe('account UI language and editing', () => {
  it('switches copy without changing interpolation values', () => {
    switchEnglish()
    expect(tr('我的账户')).toBe('My account')
    expect(tr('正在给 {v0} 发消息', { v0: '周鹏' })).toBe('Messaging 周鹏')
    expect(tr('{v0}，{v1} 条未读', { v0: '周鹏', v1: 3 })).toBe('周鹏, 3 unread')
    expect(calendarWeekdays()[0]).toBe('Mon'); expect(arkmeIntlLocale()).toBe('en-US')
    expect(tr('unexpected-key')).toBe('unexpected-key')
  })
  it('preserves the editing dialog and draft when language switches, cancel never saves', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(<ArkmeProfileEditor profile={profile} accountScope="prod:42" onUpdated={() => {}} />))
    await act(async () => (host.querySelectorAll('button')[1] as HTMLButtonElement).click())
    const input = host.querySelector('dialog input') as HTMLInputElement
    switchEnglish()
    expect(host.querySelector('dialog input')).toBe(input)
    expect(input.value).toBe('中文昵称')
    expect(host.querySelector('h3')?.textContent).toBe('Edit nickname')
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!.click())
    expect(host.querySelector('dialog')).toBeNull(); expect(mock.call).not.toHaveBeenCalled()
    await act(async () => root.unmount()); host.remove()
  })
  it('keeps provider nicknames verbatim and uses the provider icon, not the Arkme avatar', async () => {
    switchEnglish(); const host = document.createElement('div'); const root = createRoot(host)
    await act(async () => root.render(<WechatBindingSettingsRow bound nickname="微信昵称" />))
    expect(host.textContent).toContain('微信昵称'); expect(host.textContent).toContain('WeChat')
    expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
  })
  it('renders official About identifiers and does not fetch invitation data before opening', async () => {
    const host = document.createElement('div'); const root = createRoot(host)
    await act(async () => root.render(<><ArkmeAboutProduct /><ArkmeAboutDetails accountScope="prod:42" /></>))
    expect(host.querySelectorAll('.arkme-about-product img')).toHaveLength(1)
    expect(host.querySelector('.arkme-about-product')?.textContent).toBe('')
    expect(host.querySelectorAll('.arkme-about-social img')).toHaveLength(5)
    expect([...host.querySelectorAll('.arkme-about-social img')].every(img => img.getAttribute('alt') === '')).toBe(true)
    for (const text of ['鄂ICP备2024037215号', '鄂B2-20240478', '14519261', '森奇思(武汉)科技有限公司']) expect(host.textContent).toContain(text)
    expect(mock.call).not.toHaveBeenCalled(); switchEnglish()
    expect(host.textContent).toContain('Invite & earn membership')
    expect([...host.querySelectorAll('a')].every(a => a.rel.includes('noopener'))).toBe(true)
    await act(async () => (host.querySelector('.arkme-about-social button') as HTMLButtonElement).click())
    expect(host.querySelector('dialog')?.getAttribute('aria-label')).toBe('WeChat Official Account')
    expect(host.querySelector('dialog img')?.getAttribute('alt')).toBe('Official Account QR code')
    expect(mock.call).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
