// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ArkmeAccountUsage, ArkmeAccountUsageDetails, ArkmeAccountUsageDialog, formatCompactTokens, formatUsageBytes, formatUsageSeconds, usageLevel } from '../src/client/ArkmeAccountUsage.js'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/read-intent-visibility.js', () => ({ suspendArkmeVisibleReadIntent: () => () => {} }))
vi.mock('../src/client/account-usage.css?inline', async () => ({ default: (await import('node:fs')).readFileSync(`${process.cwd()}/src/client/account-usage.css`, 'utf8') }))
let root: Root, host: HTMLDivElement
const onViewMembership = vi.fn(), onRefreshMembership = vi.fn()
const points = { accountScope: 'prod:11', unit: 'ai_points', availablePoints: '1250', reservedPoints: '250', grantedPoints: '100', purchasedPoints: '1150', observedAt: 1, grants: [{ source: 'membership', availablePoints: '100', expiresAt: 1790784000000 }] }
const storage = { accountScope: 'prod:11', usedBytes: 1024 ** 3, totalBytes: 10 * 1024 ** 3 }
const voice = { accountScope: 'prod:11', usedSeconds: 300, remainingSeconds: 6900 }
const balance = { availableNanoCny: '12500000000', totalNanoCny: '15000000000', reservedNanoCny: '2500000000', currency: 'CNY' }
const defaultValue = (operation: string) => operation === 'billing.quota' ? balance : operation === 'account.usage.voice' ? voice : operation === 'account.points.query' ? points : storage
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mocks.call.mockReset(); onViewMembership.mockReset(); onRefreshMembership.mockReset()
  mocks.call.mockImplementation(async operation => defaultValue(operation))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function render(scope = 'prod:11') { await act(async () => root.render(<ArkmeAccountUsageDetails accountScope={scope} onViewMembership={onViewMembership} onRefreshMembership={onRefreshMembership} />)) }
const refresh = () => host.querySelector<HTMLButtonElement>('[aria-label="刷新用量与额度"]')!

describe('account points and independent usage', () => {
  it('loads settled consumption only after opening details and cancels on close', async () => {
    await render()
    expect(mocks.call.mock.calls.some(call => call[0] === 'account.points.consumption')).toBe(false)
    let signal: AbortSignal | undefined
    mocks.call.mockImplementation((_operation, _params, value) => { signal = value; return new Promise(() => {}) })
    const toggle = () => host.querySelector<HTMLButtonElement>('[aria-controls][aria-expanded]')!
    await act(async () => toggle().click())
    expect(host.querySelector('[data-usage-detail="points"]')).not.toBeNull()
    expect(mocks.call.mock.calls.at(-1)?.[0]).toBe('account.points.consumption')
    await act(async () => toggle().click())
    expect(signal?.aborted).toBe(true)
    expect(host.querySelector('[data-usage-detail="points"]')).toBeNull()
  })
  it('shows one point unit and distinct funding, retaining storage and voice units', async () => {
    await render()
    expect(host.querySelectorAll('.arkme-usage-metric')).toHaveLength(4)
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(2)
    expect(host.textContent).toContain('可用 1,250 积分')
    const balanceLine = host.querySelector('[data-usage-kind="ai-points"] p')!
    expect(balanceLine.textContent).toContain('可用 1,250 积分')
    expect(balanceLine.textContent).toContain('赠送 100 · 充值 1,150')
    expect(host.textContent).not.toContain('优先使用')
    expect(host.textContent).not.toContain('1 元 = 100 积分')
    expect(host.querySelector('[data-usage-kind="ai-points"] .arkme-usage-label')?.textContent).not.toContain('消费记录')
    expect(host.querySelector('.arkme-points-disclosure')?.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).toContain('暂占 250 积分')
    expect(host.textContent).toContain('已用 1 GB / 共 10 GB')
    expect(host.textContent).toContain('已用 5 分 / 剩余 1 小时 55 分')
    expect(host.querySelector('[data-usage-kind="recording-transcription"]')?.textContent).toContain('暂未做限制')
    expect(mocks.call.mock.calls.map(call => call[0])).toEqual(['account.points.query', 'account.usage.storage', 'account.usage.voice'])
    for (const text of ['Token', '实体提取', '阿森有想法', '¥', '永久免费']) expect(host.textContent).not.toContain(text)
  })
  it('refreshes all visible quotas and membership with one action', async () => {
    await render()
    mocks.call.mockImplementation(async operation => operation === 'account.points.query' ? { ...points, availablePoints: '300', purchasedPoints: '200' } : operation === 'account.usage.voice' ? { ...voice, usedSeconds: 600, remainingSeconds: 6600 } : storage)
    await act(async () => refresh().click())
    expect(host.textContent).toContain('可用 300 积分')
    expect(host.textContent).toContain('已用 10 分 / 剩余 1 小时 50 分')
    expect(mocks.call).toHaveBeenCalledTimes(6)
    expect(onRefreshMembership).toHaveBeenCalledOnce()
  })
  it.each(['account.points.query', 'account.usage.storage', 'account.usage.voice'])('isolates and retries %s failure without inventing zeros', async failed => {
    mocks.call.mockImplementation(async operation => { if (operation === failed) throw new Error('offline'); return defaultValue(operation) })
    await render()
    expect(host.textContent).toContain('暂时无法读取，请刷新重试')
    expect(host.textContent).not.toContain('已用 0')
    if (failed !== 'account.points.query') expect(host.textContent).toContain('可用 1,250 积分')
    if (failed !== 'account.usage.storage') expect(host.textContent).toContain('已用 1 GB')
    expect(refresh().disabled).toBe(false)
    mocks.call.mockImplementation(async operation => defaultValue(operation))
    await act(async () => refresh().click())
    expect(host.textContent).not.toContain('无法读取')
  })
  it('retains membership actions for depleted storage and voice without creating an order', async () => {
    mocks.call.mockImplementation(async operation => operation === 'account.points.query' ? points : operation === 'account.usage.voice' ? { ...voice, remainingSeconds: 0 } : { ...storage, usedBytes: storage.totalBytes * 1.2 })
    await render()
    expect(host.querySelectorAll('[data-usage-level="exhausted"]')).toHaveLength(2)
    expect([...host.querySelectorAll('[role="progressbar"]')].every(bar => bar.getAttribute('aria-valuenow') === '100')).toBe(true)
    const membership = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('查看存储权益'))!
    await act(async () => membership.click())
    expect(onViewMembership).toHaveBeenCalledOnce()
    expect(mocks.call.mock.calls.some(call => call[0].startsWith('billing.order.'))).toBe(false)
  })
  it('hides previous results immediately while another account loads', async () => {
    await render()
    mocks.call.mockImplementation(() => new Promise(() => {}))
    await render('prod:12')
    for (const text of ['1,250', '1 GB', '1 小时 55 分']) expect(host.textContent).not.toContain(text)
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    expect(refresh().disabled).toBe(true)
  })
  it('ignores late results after environment changes', async () => {
    const pending: Array<(value: unknown) => void> = []
    mocks.call.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    await render()
    mocks.call.mockImplementation(async operation => ({ ...defaultValue(operation), accountScope: 'test:11', ...(operation === 'account.points.query' ? { availablePoints: '88' } : {}) }))
    await render('test:11')
    await act(async () => { pending[0]!(points); pending[1]!(storage); pending[2]!(voice) })
    expect(host.textContent).toContain('可用 88 积分')
    expect(host.textContent).not.toContain('1,250')
  })
  it('shows authoritative zero without a fabricated progress percentage', async () => {
    mocks.call.mockImplementation(async operation => operation === 'account.points.query' ? { ...points, availablePoints: '0', grantedPoints: '0', purchasedPoints: '0', reservedPoints: '0', grants: [] } : defaultValue(operation))
    await render()
    const row = host.querySelector('[data-usage-kind="ai-points"]')!
    expect(row.textContent).toContain('可用 0 积分')
    expect(row.textContent).not.toContain('暂占')
    expect(row.querySelector('[role="progressbar"]')).toBeNull()
  })
  it('opens recharge above details without placing an order and restores focus', async () => {
    mocks.call.mockImplementation(async operation => operation === 'billing.products' ? { items: [] } : defaultValue(operation))
    await act(async () => root.render(<ArkmeAccountUsageDialog accountScope="prod:11" onViewMembership={onViewMembership} onRefreshMembership={onRefreshMembership} onClose={() => {}} />))
    const recharge = document.querySelector<HTMLButtonElement>('[data-usage-kind="ai-points"] button')!
    recharge.focus(); await act(async () => recharge.click())
    expect(document.querySelector<HTMLDialogElement>('.arkme-billing-modal-host')?.open).toBe(true)
    expect(document.querySelector('[aria-label="积分充值"]')).not.toBeNull()
    expect(mocks.call.mock.calls.some(call => call[0].startsWith('billing.order.'))).toBe(false)
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭充值弹窗"]')!.click())
    expect(document.querySelector('.arkme-billing-modal-host')).toBeNull()
    expect(document.activeElement).toBe(recharge)
  })
  it('retains exact unrelated duration/storage formatting and depletion thresholds', () => {
    for (const [value, text] of [[0, '0 秒'], [1, '1 秒'], [61, '1 分 1 秒'], [3661, '1 小时 1 分 1 秒']] as const) expect(formatUsageSeconds(value)).toBe(text)
    expect(formatUsageBytes(0)).toBe('0 B'); expect(formatUsageBytes(1024)).toBe('1 KB'); expect(formatUsageBytes(1024 ** 4)).toBe('1 TB')
    expect(usageLevel(0, 0)).toBe('exhausted'); expect(usageLevel(90, 100)).toBe('low'); expect(usageLevel(89, 100)).toBe('normal')
    expect(formatCompactTokens(50_000_000)).toBe('5,000 万')
  })
  it('keeps semantic-theme and viewport bounds', () => {
    const dispose = installArkmeRedesignStyles()
    expect(document.head.textContent).toContain('max-height: calc(100dvh - 28px)')
    expect(document.head.textContent).toContain('var(--dsw-alias-label-primary'); dispose()
    expect(readFileSync(`${process.cwd()}/src/client/ArkmeProductNavigation.tsx`, 'utf8')).toContain('<ArkmeAccountUsage key={memberScope}')
  })
})

describe('compact summary and dialog', () => {
  it('shows unknown values as pending while retaining all independent quota rows', async () => {
    mocks.call.mockImplementation(() => new Promise(() => {}))
    await act(async () => root.render(<ArkmeAccountUsage accountScope="prod:11" onOpenDetails={() => {}} />))
    expect(host.querySelectorAll('.arkme-usage-summary-row')).toHaveLength(4)
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    expect([...host.querySelectorAll('.arkme-usage-summary-total')].map(el => el.textContent)).toEqual(['读取中…', '读取中…', '读取中…', '暂未做限制'])
  })
  it('shows available points and preserves measured storage/voice bars', async () => {
    const open = vi.fn()
    await act(async () => root.render(<ArkmeAccountUsage accountScope="prod:11" onOpenDetails={open} />))
    expect([...host.querySelectorAll('.arkme-usage-summary-total')].map(el => el.textContent)).toEqual(['1,250 积分', '10 GB', '2 小时', '暂未做限制'])
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(2)
    expect(host.textContent).not.toContain('Token')
    expect(host.querySelector('[data-usage-kind="storage"] [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('10')
    await act(async () => host.querySelector('button')!.click()); expect(open).toHaveBeenCalledOnce()
  })
  it('keeps a genuine zero voice quota exhausted and usable detail navigation on failures', async () => {
    mocks.call.mockImplementation(async operation => { if (operation === 'account.usage.storage') throw new Error('offline'); return operation === 'account.usage.voice' ? { ...voice, usedSeconds: 0, remainingSeconds: 0 } : defaultValue(operation) })
    const open = vi.fn(); await act(async () => root.render(<ArkmeAccountUsage accountScope="prod:11" onOpenDetails={open} />))
    const speech = host.querySelector('[data-usage-kind="voice-transcription"]')!
    expect(speech.getAttribute('data-usage-level')).toBe('exhausted')
    expect(speech.querySelector('.arkme-usage-summary-total')?.textContent).toBe('0 秒')
    expect(host.textContent).toContain('暂不可用')
    await act(async () => host.querySelector('button')!.click()); expect(open).toHaveBeenCalledOnce()
  })
  it('supports dialog cancellation and focus restoration', async () => {
    const close = vi.fn(), ref = createRef<HTMLButtonElement>()
    await act(async () => root.render(<><button ref={ref}>头像</button><ArkmeAccountUsageDialog accountScope="prod:11" onViewMembership={onViewMembership} onRefreshMembership={onRefreshMembership} onClose={close} returnFocusRef={ref} /></>))
    const dialog = document.querySelector('dialog')!
    expect(dialog.open).toBe(true); expect(dialog.textContent).toContain('可用 1,250 积分')
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭用量与额度详情"]')!.click())
    await act(async () => dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })))
    expect(close).toHaveBeenCalledTimes(2)
    await act(async () => root.render(<button ref={ref}>头像</button>))
    expect(document.activeElement).toBe(ref.current)
  })
})
