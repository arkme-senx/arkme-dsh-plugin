// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeStorageUsageBreakdown, ArkmeTokenUsageBreakdown } from '../src/client/ArkmeUsageBreakdown.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
const scope = 'prod:11'
const tokens = { promptTokens: 10, completionTokens: 20, totalTokens: 30, cachedTokens: 4, cacheMissTokens: 6, cacheCreationInputTokens: 0 }
const summary = { accountScope: scope, monthKey: '2026-09', timezone: 'Asia/Shanghai', availableMonths: ['2026-09', '2026-08'], windowStartMs: 1, windowEndMs: 2, availableFromMs: 1, callCount: 2, tokens, partialUsage: false }
const operation = { operationUid: 'op1', bizCode: 12, displayName: '记录摘要', occurredAtMs: 1, callCount: 2, models: ['test-model'], cacheStatus: 3, tokens, partialUsage: false }
const call = { occurredAtMs: 1, model: 'test-model', usageStatus: 3, cacheStatus: 3, tokens }
const page = (items: unknown[], nextCursor = '') => ({ accountScope: scope, items, nextCursor })
let host: HTMLDivElement, root: Root
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mocks.call.mockReset()
  mocks.call.mockImplementation(async op => op.endsWith('summary') ? summary : op.endsWith('operations') ? page([operation]) : page([call]))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function render(revision = 0, accountScope = scope) { await act(async () => root.render(<ArkmeTokenUsageBreakdown key={accountScope} scope={accountScope} revision={revision} />)) }
function button(text: string) { return [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))! }
async function click(text: string) { await act(async () => button(text).click()) }
async function month(value: string) { await act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) }) }

describe('inline usage details', () => {
  it('lazily loads calls, separates model totals from allowances and can close an operation', async () => {
    await render()
    expect(mocks.call.mock.calls.map(c => c[0])).toEqual(['account.usage.token.summary', 'account.usage.token.operations'])
    expect(host.textContent).toContain('模型实际调用用量，不等同于月度额度扣减或充值消费')
    await click('记录摘要')
    expect(mocks.call.mock.calls.at(-1)?.slice(0, 2)).toEqual(['account.usage.token.calls', expect.objectContaining({ expectedAccountScope: scope, operationUid: 'op1', bizCode: 12, monthKey: '2026-09', timezone: 'Asia/Shanghai', cursor: '' })])
    expect(host.textContent).toContain('输入 10 · 输出 20')
    expect(host.textContent).toContain('命中 4 · 未命中 6')
    await click('记录摘要')
    expect(host.querySelector('.arkme-usage-calls')).toBeNull()
    expect(mocks.call.mock.calls.at(-1)?.[2].aborted).toBe(true)
  })
  it('retains results on a pagination failure and deduplicates operation identities on retry', async () => {
    let failures = 0
    mocks.call.mockImplementation(async (op, params) => {
      if (op.endsWith('summary')) return summary
      if (!params.cursor) return page([operation], 'cursor2')
      if (failures++ === 0) throw new Error('offline')
      return page([operation, { ...operation, operationUid: 'op2', displayName: '对话整理' }])
    })
    await render(); await click('加载更多')
    expect(host.textContent).toContain('已有结果保留')
    expect(host.querySelectorAll('.arkme-token-operation')).toHaveLength(1)
    await click('重试')
    expect(host.querySelectorAll('.arkme-token-operation')).toHaveLength(2)
    expect(host.textContent).not.toContain('已有结果保留')
    expect(button('加载更多')).toBeUndefined()
  })
  it('does not drop distinct calls with identical time/model/usage fields', async () => {
    mocks.call.mockImplementation(async op => op.endsWith('summary') ? summary : op.endsWith('operations') ? page([operation]) : page([call, call]))
    await render(); await click('记录摘要')
    expect(host.querySelectorAll('.arkme-usage-calls li')).toHaveLength(2)
  })
  it('cancels old calls and resets pagination and expanded rows when the month changes', async () => {
    let resolveCall: (value: unknown) => void = () => {}
    mocks.call.mockImplementation((op, params) => op.endsWith('summary') ? Promise.resolve({ ...summary, monthKey: params.monthKey || summary.monthKey })
      : op.endsWith('operations') ? Promise.resolve(page([operation], 'cursor2')) : new Promise(resolve => { resolveCall = resolve }))
    await render(); await click('记录摘要')
    const signal = mocks.call.mock.calls.at(-1)![2]
    await month('2026-08')
    expect(signal.aborted).toBe(true)
    expect(host.querySelector('.arkme-usage-calls')).toBeNull()
    expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({ monthKey: '2026-08', cursor: '' })
    await act(async () => resolveCall(page([{ ...call, model: 'stale-model' }])))
    expect(host.textContent).not.toContain('stale-model')
  })
  it('blocks duplicate rapid paging clicks', async () => {
    mocks.call.mockImplementation(async op => op.endsWith('summary') ? summary : page([operation], 'cursor2'))
    await render()
    const before = mocks.call.mock.calls.length
    await act(async () => { const more = button('加载更多'); more.click(); more.click() })
    expect(mocks.call).toHaveBeenCalledTimes(before + 1)
    expect(host.textContent).toContain('已有结果保留') // a repeated cursor cannot loop forever
  })
  it('ignores late summaries after closing and reports mismatching account data safely', async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.call.mockImplementation(() => new Promise(done => { resolve = done }))
    await render()
    const signal = mocks.call.mock.calls[0]![2]
    await act(async () => root.render(null))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(summary))
    expect(host.textContent).toBe('')
    mocks.call.mockResolvedValue({ ...summary, accountScope: 'prod:12' })
    await render()
    expect(host.textContent).toContain('暂时无法读取用量明细')
    expect(host.querySelectorAll('.arkme-token-operation')).toHaveLength(0)
  })
  it('retries failed summaries and refreshes the selected month without reusing expanded calls', async () => {
    mocks.call.mockRejectedValueOnce(new Error('offline'))
    await render(); await click('重试')
    mocks.call.mockImplementation(async (op, params) => op.endsWith('summary') ? { ...summary, monthKey: params.monthKey || summary.monthKey } : page([operation]))
    await month('2026-08'); await click('记录摘要')
    await render(1)
    expect(host.querySelector('.arkme-usage-calls')).toBeNull()
    expect(mocks.call.mock.calls.at(-2)?.[1]).toMatchObject({ monthKey: '2026-08' })
    expect(host.querySelector('select')?.value).toBe('2026-08')
  })
  it('starts a new account without displaying the previous account details', async () => {
    await render()
    mocks.call.mockImplementation(() => new Promise(() => {}))
    await render(0, 'prod:12')
    expect(host.textContent).not.toContain('记录摘要')
    expect(host.querySelector('select')).toBeNull()
    expect(mocks.call.mock.calls.at(-1)?.[1].expectedAccountScope).toBe('prod:12')
  })
  it('shows storage percentages against used space, not total capacity', async () => {
    await act(async () => root.render(<ArkmeStorageUsageBreakdown usage={{ accountScope: scope, usedBytes: 100, totalBytes: 1000, breakdown: [{ category: 'image', bytes: 80, fileCount: 2 }, { category: 'other', bytes: 20, fileCount: 1 }] }} formatBytes={n => `${n} B`} />))
    expect(host.textContent).toContain('80 B80%')
    expect(host.textContent).toContain('20 B20%')
    expect(host.textContent).toContain('文字、快记短语音和缩略图不计入存储空间')
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('distinguishes unavailable composition from an authoritative empty breakdown', async () => {
    const storage = { accountScope: scope, usedBytes: 0, totalBytes: 1000 }
    await act(async () => root.render(<ArkmeStorageUsageBreakdown usage={storage} formatBytes={String} />))
    expect(host.textContent).toContain('存储分类明细暂不可用')
    expect(host.textContent).not.toContain('当前未使用')
    await act(async () => root.render(<ArkmeStorageUsageBreakdown usage={{ ...storage, breakdown: [] }} formatBytes={String} />))
    expect(host.textContent).toContain('当前未使用云存储空间')
  })
})
