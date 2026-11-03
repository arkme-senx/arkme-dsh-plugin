// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/read-intent-visibility.js', () => ({ suspendArkmeVisibleReadIntent: () => () => {} }))
import { ArkmeLoginDevices, LoginDeviceEntry } from '../src/client/ArkmeLoginDevices.js'

const device = { id: 'stable', ref: 'opaque', name: '工作电脑', platform: 'macos', isCurrent: false, presence: 'unknown', lastActiveAt: null, canLogout: true, canForget: true, notificationsSupported: false }
const page = { accountScope: 'test:7', items: [device], total: 1, countComplete: false, observedAt: 1800000000000 }
let root: Root, host: HTMLElement
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)!
const render = async () => { await act(async () => root.render(<ArkmeLoginDevices accountScope="test:7" onClose={() => {}} returnFocusRef={{ current: null }} />)) }
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.call.mockReset(); mocks.call.mockResolvedValue(page)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
describe('confirmed login devices UI', () => {
  it('keeps the approved layout and removed copy absent; unknown count is not zero', async () => {
    await render()
    expect(document.body.textContent).toContain('工作电脑')
    expect(document.body.textContent).toContain('状态待确认')
    expect(document.body.textContent).toContain('活跃时间暂不可用')
    expect(document.body.textContent).not.toMatch(/常见问题|macOS|登录状态与实时在线状态分别显示|0 台设备/)
    await act(async () => root.render(<LoginDeviceEntry accountScope="test:7" onOpen={() => {}} />))
    expect(host.textContent).toBe('登录设备管理')
  })
  it('does not write before confirmation and does not double-submit', async () => {
    mocks.call.mockImplementation(async (_op, input) => input.action === 'prepare' ? { accountScope: 'test:7', kind: 'logout', name: '工作电脑', ticket: 'ticket', expiresAt: Date.now() + 300000 } : page)
    await render(); await act(async () => button('退出登录').click())
    expect(mocks.call.mock.calls.some(c => c[1].action === 'confirm')).toBe(false)
    mocks.call.mockImplementation(() => new Promise(() => {}))
    await act(async () => { const b = button('确认退出'); b.click(); b.click() })
    expect(mocks.call.mock.calls.filter(c => c[1].action === 'confirm')).toHaveLength(1)
  })
  it('retains target and reconciles the same ticket after an ambiguous outcome', async () => {
    mocks.call.mockImplementation(async (_op, input) => input.action === 'prepare' ? { accountScope: 'test:7', kind: 'logout', name: '工作电脑', ticket: 'same-ticket', expiresAt: Date.now() + 300000 } : input.action === 'confirm' ? { accountScope: 'test:7', kind: 'logout', ticket: 'same-ticket', state: 'unknown', cleanup: 'pending' } : page)
    await render(); await act(async () => button('退出登录').click()); await act(async () => button('确认退出').click())
    expect(document.body.textContent).toContain('工作电脑')
    expect(document.body.textContent).not.toContain('登录权限已撤销；')
    mocks.call.mockResolvedValue({ accountScope: 'test:7', kind: 'logout', ticket: 'same-ticket', state: 'unknown', cleanup: 'pending' })
    await act(async () => button('重新核实').click())
    expect(mocks.call.mock.lastCall?.[1]).toMatchObject({ action: 'operation', ticket: 'same-ticket' })
  })
  it('keeps writes usable after StrictMode effect replay', async () => {
    mocks.call.mockImplementation(async (_op, input, signal) => {
      if (input.action === 'prepare') {
        expect(signal.aborted).toBe(false)
        return { accountScope: 'test:7', kind: 'logout', name: '工作电脑', ticket: 'ticket', expiresAt: Date.now() + 300000 }
      }
      return page
    })
    await act(async () => root.render(<StrictMode><ArkmeLoginDevices accountScope="test:7" onClose={() => {}} returnFocusRef={{ current: null }} /></StrictMode>))
    await act(async () => button('退出登录').click())
    expect(document.body.textContent).toContain('确认退出')
  })
  it('releases request scopes and portals over 100 open/close cycles', async () => {
    for (let i = 0; i < 100; i++) {
      await render()
      const signal = mocks.call.mock.lastCall?.[2] as AbortSignal
      expect(signal.aborted).toBe(false)
      await act(async () => root.render(null))
      expect(signal.aborted).toBe(true)
      expect(document.querySelectorAll('.device-dialog')).toHaveLength(0)
    }
    expect(mocks.call).toHaveBeenCalledTimes(100)
  })
  it('aborts reads when closed and ignores their late response', async () => {
    let resolve!: (value: unknown) => void
    mocks.call.mockImplementation(() => new Promise(r => { resolve = r }))
    await render(); const signal = mocks.call.mock.calls[0]![2] as AbortSignal
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true)
    await act(async () => resolve(page)); expect(document.querySelector('.device-dialog')).toBeNull()
  })
})
