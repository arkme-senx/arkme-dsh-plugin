// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeCallSurface } from '../src/client/ArkmeCallSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const mocks = vi.hoisted(() => ({ request: vi.fn(), api: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.api, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/outgoing-call-ui-controller.js', () => ({ outgoingCallUi: { request: mocks.request, subscribeSettled: () => () => {} } }))
let root: Root, host: HTMLDivElement, account = 4000
let createdAt: number, historyReady: boolean
class DemoAudio {
  static latest: DemoAudio | undefined
  onended: (() => void) | null = null
  onerror = null; onplaying = null; onwaiting = null
  paused = false
  constructor(public src: string) { DemoAudio.latest = this }
  async play() {}
  pause() { this.paused = true }
  load() {}
  removeAttribute() {}
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 55)) }) }
async function mount(initialPickerOpen = false) { await act(async () => root.render(<StrictMode><ArkmeCallSurface initialPickerOpen={initialPickerOpen} /></StrictMode>)); await settle() }
function panel() { return document.querySelector('[data-arkme-call-tour-panel]') }
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent === text)
  expect(button, text).toBeDefined()
  await act(async () => button!.click()); await settle()
}
function focusedTarget() { return document.querySelector('[data-arkme-call-tour-spotlight]')?.getAttribute('data-arkme-call-tour-spotlight') }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Audio', DemoAudio); DemoAudio.latest = undefined
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.hidden) return new DOMRect()
    if (this.hasAttribute('data-arkme-call-surface')) return new DOMRect(0, 0, 1200, 900)
    if (this.hasAttribute('data-arkme-call-tour-viewport')) return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    return new DOMRect(120, 160, 280, 80)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(280)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80)
  createdAt = Date.parse('2026-09-10T00:00:00+08:00'); historyReady = true
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  mocks.request.mockReset(); mocks.api.mockReset()
  mocks.api.mockImplementation(async (operation: string) => {
    if (operation === 'user.profile') return { profile: { userId: account, createdAt } }
    if (operation === 'calls.history.list') {
      if (!historyReady) throw new Error('offline')
      return { items: [], recentContacts: [], hasMore: false }
    }
    if (operation === 'sources.list') return { directory: 'root', items: [], hasMore: false }
    if (operation === 'chat.official-author.profile') return { userId: 77, displayName: '即我作者' }
    if (operation === 'chat.official-author.private.open') return { source: { sourceRef: 'author', kind: 'private_chat', displayName: '即我作者' } }
    throw new Error(`unexpected operation: ${operation}`)
  })
  account++
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: account })
  arkmeUi.showCalls()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('guides the real call surface through six steps and enables utterance playback only after completion', async () => {
  await mount(); expect(panel()?.textContent).toContain('1 / 6'); expect(focusedTarget()).toBe('start')
  await click('下一步'); expect(panel()?.textContent).toContain('2 / 6'); expect(focusedTarget()).toBe('types')
  expect(document.querySelector('[aria-label="选择通话联系人"]')).not.toBeNull()
  await click('下一步'); expect(focusedTarget()).toBe('recent'); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click('下一步'); expect(focusedTarget()).toBe('summary')
  expect(document.querySelector('[data-arkme-call-detail-content]')?.textContent).toContain('确认了发布会演示顺序')
  await click('下一步'); expect(focusedTarget()).toBe('video')
  await click('下一步'); expect(focusedTarget()).toBe('utterance')
  const utterance = document.querySelector<HTMLButtonElement>('[data-arkme-call-tour-target="utterance"]')!
  expect(utterance.tagName).toBe('BUTTON')
  await act(async () => utterance.click()); await settle()
  expect(utterance.textContent).not.toContain('正在播放')
  expect(DemoAudio.latest).toBeUndefined()
  expect(panel()?.textContent).toContain('6 / 6')
  expect(mocks.request).not.toHaveBeenCalled()
  await click('完成引导'); expect(panel()).toBeNull()
  await act(async () => utterance.click()); await settle()
  expect(utterance.textContent).toContain('正在播放')
  expect(DemoAudio.latest?.src).toBe('/arkme-self/api/call/call-demo-utterance-v1.m4a')
  expect(localStorage.getItem(`dsh-arkme:call-tour:v1:prod:${account}`)).toBe('done')
  await act(async () => root.render(<div />)); await mount(); expect(panel()).toBeNull()
})

it('supports previous and closes the tour-owned picker when skipped', async () => {
  await mount(); await click('下一步'); await click('下一步'); await click('上一步')
  expect(panel()?.textContent).toContain('2 / 6'); expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click('上一步'); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click('下一步'); await click('跳过引导'); expect(panel()).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('[data-arkme-call-tour-target="start"]'))
})

it('blocks highlighted call choices until the user exits the guide', async () => {
  await mount(); await click('下一步')
  const button = document.querySelector<HTMLButtonElement>('[aria-label="和即我作者语音通话"]')!
  await act(async () => button.click()); await settle()
  expect(panel()?.textContent).toContain('2 / 6'); expect(mocks.request).not.toHaveBeenCalled()
  await click('跳过引导'); await click('发起通话')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="和即我作者语音通话"]')!.click()); await settle()
  expect(panel()).toBeNull(); expect(mocks.request).toHaveBeenCalledWith({ sourceRef: 'author', displayName: '即我作者', mediaType: 'audio' })
})

it('ignores clicks on the highlighted start button, recent records, and navigation outside the call surface', async () => {
  const navigation = document.createElement('button')
  navigation.onclick = () => arkmeUi.showRecordings()
  document.body.append(navigation)
  await mount()
  await act(async () => host.querySelector<HTMLButtonElement>('[data-arkme-call-tour-target="start"]')!.click()); await settle()
  expect(panel()?.textContent).toContain('1 / 6')
  await act(async () => navigation.click()); await settle()
  expect(arkmeUi.getSnapshot().mode).toBe('calls'); expect(panel()?.textContent).toContain('1 / 6')
  await click('下一步'); await click('下一步')
  const records = document.querySelectorAll<HTMLButtonElement>('[data-arkme-call-tour-target="recent"] li button')
  expect(records.length).toBeGreaterThan(1)
  for (const record of records) { await act(async () => record.click()); await settle() }
  expect(panel()?.textContent).toContain('3 / 6')
  expect(document.querySelector('[data-arkme-call-detail-content]')).toBeNull()
  await click('跳过引导')
  await act(async () => navigation.click()); await settle()
  expect(arkmeUi.getSnapshot().mode).toBe('recordings')
})

it('waits for other guides and interrupts for external dialogs without marking completion', async () => {
  document.body.setAttribute('data-arkme-home-tour-running', 'true')
  await mount(); expect(panel()).toBeNull()
  document.body.removeAttribute('data-arkme-home-tour-running'); await settle(); expect(panel()).not.toBeNull()
  await click('下一步')
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog)
  await settle(); expect(panel()).toBeNull(); expect(document.querySelector('[aria-label="选择通话联系人"]')).toBeNull()
  expect(localStorage.getItem(`dsh-arkme:call-tour:v1:prod:${account}`)).toBeNull()
  dialog.remove(); await settle(); expect(panel()).toBeNull()
})

it.each(['old-account', 'inactive', 'explicit-picker', 'history-error'])('does not take over %s', async scenario => {
  if (scenario === 'old-account') createdAt = Date.parse('2026-09-09T00:00:00+08:00')
  if (scenario === 'inactive') arkmeUi.showRecordings()
  if (scenario === 'history-error') historyReady = false
  await mount(scenario === 'explicit-picker'); expect(panel()).toBeNull()
  if (scenario === 'explicit-picker') expect(document.querySelector('[aria-label="选择通话联系人"]')).not.toBeNull()
})

it('cleans up when leaving calls and does not restart in the same page session', async () => {
  await mount(); await click('下一步')
  await act(async () => arkmeUi.showRecordings()); await settle()
  expect(panel()).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => arkmeUi.showCalls()); await settle(); expect(panel()).toBeNull()
  expect(localStorage.getItem(`dsh-arkme:call-tour:v1:prod:${account}`)).toBeNull()
})

it('keeps focus and Tab navigation in the guide, then Escape finishes', async () => {
  await mount(); await click('下一步')
  const next = [...panel()!.querySelectorAll('button')].find(button => button.textContent === '下一步')!
  host.querySelector<HTMLButtonElement>('[aria-label="和即我作者语音通话"]')!.focus()
  expect(document.activeElement).toBe(next)
  next.focus()
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭通话引导')
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(next)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); await settle()
  expect(panel()).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(localStorage.getItem(`dsh-arkme:call-tour:v1:prod:${account}`)).toBe('done')
})

it('does not restore focus over a newly opened notification overlay', async () => {
  await mount(); await click('下一步')
  const overlay = document.createElement('div'); overlay.setAttribute('data-arkme-notification-blocking-overlay', 'true')
  const action = document.createElement('button'); overlay.append(action); document.body.append(overlay); action.focus()
  await act(async () => [...panel()!.querySelectorAll('button')].find(button => button.textContent === '跳过引导')!.click())
  expect(document.activeElement).toBe(action)
  await settle(); expect(panel()).toBeNull()
})

it('remeasures a moving target and hides the guide while that target is clipped out of view', async () => {
  await mount()
  const target = host.querySelector<HTMLElement>('[data-arkme-call-tour-target="start"]')!
  let top = 220
  target.getBoundingClientRect = () => new DOMRect(120, top, 280, 80)
  await act(async () => target.dispatchEvent(new Event('scroll', { bubbles: true }))); await settle()
  expect(document.querySelector('[data-arkme-call-tour-spotlight]')?.getAttribute('y')).toBe('220')
  expect(document.querySelector<HTMLElement>('.arkme-home-tour-target-placeholder')?.style.top).toBe('214px')
  top = 1500
  await act(async () => target.dispatchEvent(new Event('scroll', { bubbles: true }))); await settle(); expect(panel()).toBeNull()
  top = 240
  await act(async () => target.dispatchEvent(new Event('scroll', { bubbles: true }))); await settle()
  expect(panel()?.textContent).toContain('1 / 6')
  expect(document.querySelector('[data-arkme-call-tour-spotlight]')?.getAttribute('y')).toBe('240')
})

it('relinquishes navigation to a notification and allows a different account to be guided', async () => {
  await mount(); await click('下一步')
  await act(async () => arkmeUi.activateNotificationSource({ sourceRef: 'notification', kind: 'private_chat', displayName: '通知联系人', activeAtMillis: 1, unreadCount: 1 })); await settle()
  expect(panel()).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).toBe('notification')
  await act(async () => { account++; arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: account }); arkmeUi.showCalls() }); await settle()
  expect(panel()?.textContent).toContain('1 / 6')
  await click('跳过引导')
  expect(localStorage.getItem(`dsh-arkme:call-tour:v1:test:${account}`)).toBe('done')
  expect(localStorage.getItem(`dsh-arkme:call-tour:v1:prod:${account}`)).toBeNull()
})

it('does not carry a previous account completion into another account on the same mounted surface', async () => {
  await mount(); await click('跳过引导')
  await act(async () => { account++; arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: account }) }); await settle()
  expect(panel()?.textContent).toContain('1 / 6')
  expect(localStorage.getItem(`dsh-arkme:call-tour:v1:prod:${account}`)).toBeNull()
})
