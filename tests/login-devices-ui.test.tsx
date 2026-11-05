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
  it('explains that forgetting signs out the target and requires verification', async () => {
    mocks.call.mockImplementation(async (_op, input) => input.action === 'prepare' ? { accountScope: 'test:7', kind: 'forget', name: '工作电脑', ticket: 'forget-ticket', expiresAt: Date.now() + 300000 } : page)
    await render()
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('常用设备管理'))!.click())
    expect(document.body.textContent).toContain('移除常用设备会同时退出该设备的登录')
    await act(async () => button('编辑').click())
    await act(async () => button('移除').click())
    expect(document.body.textContent).toContain('此设备将退出登录并取消信任')
    expect(document.body.textContent).not.toMatch(/当前登录不会退出|不会退出当前登录/)
    expect(mocks.call.mock.calls.some(c => c[1].action === 'confirm')).toBe(false)
  })
  it('keeps the approved layout and removed copy absent; unknown count is not zero', async () => {
    await render()
    expect(document.body.textContent).toContain('工作电脑')
    expect(document.querySelector('.device-status')?.textContent).toBe('未知')
    expect(document.body.textContent).toContain('活跃时间暂不可用')
    expect(document.body.textContent).not.toMatch(/常见问题|macOS|登录状态与实时在线状态分别显示|0 台设备/)
    await act(async () => root.render(<LoginDeviceEntry accountScope="test:7" onOpen={() => {}} />))
    expect(host.textContent).toBe('登录设备管理')
  })
  it('hides unidentified credentials in login and trusted lists without hiding known devices with unknown presence', async () => {
    mocks.call.mockResolvedValue({ ...page, countComplete: true, total: 4, items: [
      device,
      { ...device, id: 'legacy', ref: 'legacy', name: '设备', platform: 'unknown' },
      { ...device, id: 'named', ref: 'named', name: '我的旧电脑', platform: '' },
      { ...device, id: 'typed', ref: 'typed', name: '设备', platform: 'windows' },
    ] })
    await render()
    expect([...document.querySelectorAll('.device-name strong')].map(e => e.textContent)).toEqual(['工作电脑', '设备', '我的旧电脑'])
    expect(document.querySelector('.device-summary')).toBeNull()
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('常用设备管理'))!.click())
    expect(document.querySelectorAll('.device-row')).toHaveLength(3)
    expect(mocks.call.mock.calls.every(c => ['list', 'trusted'].includes(c[1].action))).toBe(true)
    await act(async () => root.render(<LoginDeviceEntry accountScope="test:7" onOpen={() => {}} />))
    expect(host.textContent).toBe('登录设备管理')
  })
  it('shows the empty state for unidentified rows and keeps pagination available', async () => {
    mocks.call.mockImplementation(async (_op, input) => input.cursor === 'next'
      ? page : { ...page, items: [{ ...device, name: '设备', platform: '' }], cursor: 'next' })
    await render()
    expect(document.querySelectorAll('.device-row')).toHaveLength(0)
    expect(document.body.textContent).toContain('暂无可显示的设备')
    await act(async () => button('下一页').click())
    expect(document.querySelector('.device-name strong')?.textContent).toBe('工作电脑')
    expect(mocks.call.mock.calls.every(c => c[1].action === 'list')).toBe(true)
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
  it('appends log pages, preserves existing rows on failure and retries the same cursor', async () => {
    const event = (id: string) => ({ id, name: `日志设备${id}`, at: 1800000000000, kind: 'login', method: 'password' })
    let attempts = 0
    mocks.call.mockImplementation(async (_op, input) => {
      if (input.action !== 'events') return page
      if (!input.cursor) return { accountScope: 'test:7', items: [event('1')], coverageStart: 1, cursor: 'older' }
      if (++attempts === 1) throw new Error('offline')
      return { accountScope: 'test:7', items: [event('1'), event('2')], coverageStart: 1 }
    })
    await render()
    await act(async () => button('登录日志查看近期登录与退出记录').click())
    await act(async () => button('加载更多').click())
    expect(document.body.textContent).toContain('日志设备1')
    expect(document.body.textContent).toContain('暂时无法刷新')
    await act(async () => button('加载更多').click())
    expect(mocks.call.mock.lastCall?.[1]).toMatchObject({ action: 'events', cursor: 'older' })
    expect(document.querySelectorAll('.device-log-row')).toHaveLength(2)
    expect(document.body.textContent).toContain('日志设备2')
    await act(async () => button('返回第一页').click())
    expect(document.querySelectorAll('.device-log-row')).toHaveLength(1)
  })
  it('never displays the preceding account while the new account loads', async () => {
    await render()
    mocks.call.mockImplementation(() => new Promise(() => {}))
    await act(async () => root.render(<ArkmeLoginDevices accountScope="test:8" onClose={() => {}} returnFocusRef={{ current: null }} />))
    expect(document.body.textContent).not.toContain('工作电脑')
  })
  it('bounds repeated log loading and can return to the newest page', async () => {
    mocks.call.mockImplementation(async (_op, input) => {
      if (input.action !== 'events') return page
      const offset = Number(input.cursor ?? 0)
      return { accountScope: 'test:7', items: Array.from({ length: 50 }, (_, n) => ({ id: String(offset + n), name: `日志设备${offset + n}`, at: 1800000000000 - offset - n, kind: 'login', method: 'password' })), coverageStart: 1, cursor: String(offset + 50) }
    })
    await render()
    await act(async () => button('登录日志查看近期登录与退出记录').click())
    for (let i = 0; i < 12; i++) await act(async () => button('加载更多').click())
    expect(document.querySelectorAll('.device-log-row')).toHaveLength(500)
    expect(document.querySelector('.device-log-row')?.textContent).toContain('日志设备150')
    await act(async () => button('返回第一页').click())
    expect(document.querySelectorAll('.device-log-row')).toHaveLength(50)
    expect(document.querySelector('.device-log-row')?.textContent).toContain('日志设备0')
  })
})
