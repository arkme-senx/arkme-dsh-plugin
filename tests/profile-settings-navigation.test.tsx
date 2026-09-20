// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { selectArkmeSettingsSection } from '../src/client/settings-navigation.js'
import { ArkmeUiController } from '../src/client/ui-controller.js'
import { ArkmeDataManagementSettings } from '../src/client/ArkmeDataManagementSettings.js'
import { ArkmeAccountUsageSettings } from '../src/client/ArkmeAccountUsageSettings.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeAccountUsage.js', () => ({ ArkmeAccountUsageDetails: ({ accountScope }: { accountScope: string }) => <div data-account={accountScope}>用量详情内容</div> }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.call.mockReset()
  mocks.call.mockImplementation(async (operation: string) => operation === 'data.deleted' ? { accountScope: 'prod:11', items: [{ recordUid: 'rec1', version: 2, title: '已删快记', text: '详情', sendAtMillis: 12345 }], mayHaveMore: false } : { accountScope: 'prod:11', canExport: true, recordCount: 10, voiceCount: 1, imageCount: 2, message: '', latestAtMillis: 0 })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 11 })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
describe('profile/settings navigation', () => {
  it('opens mine explicitly every time and public World stays all', () => {
    const ui = new ArkmeUiController()
    ui.showWorld('mine')
    expect(ui.getSnapshot()).toMatchObject({ mode: 'world', worldInitialScope: 'mine' })
    const first = ui.getSnapshot().worldNavigationRevision
    ui.showWorld('mine'); expect(ui.getSnapshot().worldNavigationRevision).toBe(first! + 1)
    ui.showWorld(); expect(ui.getSnapshot().worldInitialScope).toBe('all')
    const open = vi.fn(); ui.bindSettingsOpener(open); ui.openDshSettings('arkme-usage')
    expect(open).toHaveBeenCalledWith('arkme-usage')
  })
  it('selects only the settings nav, not identical text in arbitrary dialogs/content', () => {
    host.innerHTML = '<button>用量与额度</button><div role="dialog"><nav><button>用量与额度</button></nav></div><div role="dialog"><nav><span data-slot="settings.header">设置</span><button>我的账户</button><button>用量与额度</button></nav><button>用量与额度</button></div>'
    const buttons = [...host.querySelectorAll('button')], clicks = buttons.map(() => vi.fn())
    buttons.forEach((b, i) => b.addEventListener('click', clicks[i]!))
    expect(selectArkmeSettingsSection('arkme-usage')).toBe(true)
    expect(clicks.map(f => f.mock.calls.length)).toEqual([0, 0, 0, 1, 0])
    expect(selectArkmeSettingsSection('arkme-data')).toBe(false)
    host.innerHTML = ''
  })
  it('registers usage immediately after account and has no profile usage modal', () => {
    const index = readFileSync(`${process.cwd()}/src/client/index.tsx`, 'utf8')
    expect(index).toMatch(/id: 'arkme-account',\s+order: -3/)
    expect(index).toContain("id: 'arkme-usage', order: -2")
    const nav = readFileSync(`${process.cwd()}/src/client/ArkmeProductNavigation.tsx`, 'utf8')
    expect(nav.indexOf('className="arkme-member-entry"')).toBeGreaterThan(nav.indexOf('className="arkme-profile-identity-row"'))
    const trigger = nav.slice(nav.indexOf('<button ref={profileTriggerRef}'))
    expect(trigger.indexOf('className="arkme-member-label"')).toBeLessThan(trigger.indexOf('<ArkmeUserAvatar'))
    expect(nav).not.toContain('ArkmeAccountUsageDialog')
    expect(nav).not.toContain('设置声音识别')
    expect(nav).not.toContain('打开 DSH 应用设置')
  })
  it('shows data entries without requesting or mutating data on entry', async () => {
    await act(async () => root.render(<ArkmeDataManagementSettings />))
    expect(mocks.call).not.toHaveBeenCalled()
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['最近删除', '导入数据', '导出数据'])
    await act(async () => button('导入数据').click())
    expect(host.querySelector('a')?.href).toBe('https://jiwo.cc/import')
    expect(host.querySelector('a')?.rel).toContain('noopener')
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('requires explicit restore confirmation; cancel never writes', async () => {
    await act(async () => root.render(<ArkmeDataManagementSettings />))
    await act(async () => button('最近删除').click())
    expect(mocks.call).toHaveBeenCalledTimes(1)
    await act(async () => button('恢复').click())
    expect(mocks.call).toHaveBeenCalledTimes(1)
    await act(async () => button('取消').click())
    expect(mocks.call).toHaveBeenCalledTimes(1)
    await act(async () => button('恢复').click())
    await act(async () => button('确认恢复').click())
    expect(mocks.call).toHaveBeenLastCalledWith('data.recover', { expectedAccountScope: 'prod:11', recordUid: 'rec1', version: 2 })
    expect(host.textContent).toContain('已恢复')
    expect(host.querySelectorAll('li')).toHaveLength(0)
  })
  it('makes export limitations explicit without creating an export session', async () => {
    await act(async () => root.render(<ArkmeDataManagementSettings />))
    await act(async () => button('导出数据').click())
    expect(mocks.call.mock.calls.map(c => c[0])).toEqual(['data.export.preflight'])
    expect(host.textContent).toContain('当前插件尚未接入完整文件打包下载')
    expect(host.textContent).toContain('10 条快记')
  })
  it('renders usage in settings and unmounts account content immediately on logout', async () => {
    await act(async () => root.render(<ArkmeAccountUsageSettings />))
    expect(host.querySelector('[data-account]')?.getAttribute('data-account')).toBe('prod:11')
    await act(async () => arkmeAuthStore.setAuth({ status: 'logged_out', environment: 'prod' } as never))
    expect(host.textContent).toContain('登录后查看用量与额度')
    expect(host.querySelector('[data-account]')).toBeNull()
  })
  it('does not show a cross-account read as an empty successful list', async () => {
    mocks.call.mockResolvedValue({ accountScope: 'prod:12', items: [], mayHaveMore: false })
    await act(async () => root.render(<ArkmeDataManagementSettings />))
    await act(async () => button('最近删除').click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('暂时无法读取')
    expect(host.textContent).not.toContain('暂无最近删除')
  })
  it('does not claim the whole bin is empty when the first batch is filtered out', async () => {
    mocks.call.mockResolvedValue({ accountScope: 'prod:11', items: [], mayHaveMore: true, unverifiedCount: 0 })
    await act(async () => root.render(<ArkmeDataManagementSettings />))
    await act(async () => button('最近删除').click())
    expect(host.textContent).toContain('本次读取范围内暂无可恢复记录，更多记录请在手机端查看。')
    expect(host.textContent).not.toContain('暂无最近删除的记录')
    expect(button('恢复')).toBeUndefined()
  })
  it('does not offer recovery or a verified empty-state claim for unknown lifecycle rows', async () => {
    mocks.call.mockResolvedValue({ accountScope: 'prod:11', items: [], mayHaveMore: false, unverifiedCount: 2 })
    await act(async () => root.render(<ArkmeDataManagementSettings />))
    await act(async () => button('最近删除').click())
    expect(host.textContent).toContain('部分记录状态无法确认，已隐藏')
    expect(host.textContent).not.toContain('暂无最近删除')
    expect([...host.querySelectorAll('button')].some(item => item.textContent === '恢复')).toBe(false)
  })
  it('aborts data reads when switching accounts and does not reveal late results', async () => {
    let finish!: (value: unknown) => void
    mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await act(async () => root.render(<ArkmeDataManagementSettings />))
    await act(async () => button('最近删除').click())
    const signal = mocks.call.mock.calls[0]![2] as AbortSignal
    await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 12 }))
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ accountScope: 'prod:11', items: [{ recordUid: 'old', version: 1, title: '旧账号记录', text: '', sendAtMillis: 1 }], mayHaveMore: false }))
    expect(host.textContent).not.toContain('旧账号记录')
    expect(host.querySelectorAll('li')).toHaveLength(0)
  })
})
