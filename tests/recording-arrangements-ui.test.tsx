// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeArrangementItem } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mock.call }))
import { RecordingDayArrangements } from '../src/client/recordings/RecordingDayArrangements.js'
import { ArkmeArrangementContent } from '../src/client/ArkmeArrangementContent.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const dateStamp = new Date(2026, 9, 9).getTime()
const item = (n: number): ArkmeArrangementItem => ({ arrangementRef: `ref-${n}`, title: `安排 ${n}`, status: 'following', description: '', reminderEnabled: false, reminderState: '', createdAtMillis: 1, updatedAtMillis: 1,
  recordingSource: { kind: 'daily-summary', state: 'ready', dateStamp, tzOffsetMillis: -new Date(dateStamp).getTimezoneOffset() * 60_000, summaryVersionId: 'original-summary' } })
const page = (items = [item(1)], total = 1) => ({ state: 'ready', items, total, hasMore: false, snapshotVersion: 'snap' })
let host: HTMLDivElement, root: Root
const render = async (date = dateStamp, account = 'prod:1', active = true) => { await act(async () => root.render(<RecordingDayArrangements dateStamp={date} accountScope={account} active={active} refreshRevision="1" />)) }
const click = async (button: HTMLButtonElement) => { await act(async () => button.click()) }
const entry = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.call.mockReset().mockResolvedValue(page())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('refreshes the same records when opening, pages, and returns to the source summary', async () => {
  mock.call.mockResolvedValueOnce({ ...page(), total: 3, hasMore: true, nextOffset: 1 })
    .mockResolvedValueOnce({ ...page([{ ...item(1), status: 'completed' }]), total: 3, hasMore: true, nextOffset: 1 })
    .mockResolvedValueOnce(page([item(2), item(3)], 3))
  await render()
  expect(entry().textContent).toContain('3 项')
  await click(entry())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.querySelector('[data-arrangement-status]')?.textContent).toBe('已完成')
  await click(button('加载更多'))
  expect(document.querySelectorAll('.arkme-arrangement-card')).toHaveLength(3)
  expect(mock.call.mock.calls.at(-1)?.slice(0, 2)).toEqual(['arrangements.recording-day', expect.objectContaining({ offset: 1, snapshotVersion: 'snap', dateStamp })])
  await click(button('来源：'))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'recordings', recordingTarget: { dateStamp, summary: { versionId: 'original-summary' } } })
  expect(mock.call.mock.calls.every(([op]) => op === 'arrangements.recording-day')).toBe(true)
})

it('shows unavailable association without inventing zero and restores keyboard focus', async () => {
  mock.call.mockResolvedValue({ state: 'unavailable', total: null, items: [], hasMore: false })
  await render(); entry().focus(); await click(entry())
  expect(entry().textContent).toContain('暂不可用')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('关联暂不可用')
  expect(document.body.textContent).not.toContain('0 项')
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!
  expect(document.activeElement).toBe(close)
  await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(entry())
})

it('distinguishes pending zero from a confirmed empty day', async () => {
  mock.call.mockResolvedValue({ ...page([], 0), state: 'partial' })
  await render(); await click(entry())
  expect(entry().textContent).toContain('暂不可用')
  expect(document.body.textContent).not.toContain('0 项')
  mock.call.mockResolvedValue(page([], 0))
  await click(button('刷新'))
  expect(entry().textContent).toContain('0 项')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('尚未识别出安排')
})

it('does not leak a late result across dates or accounts and closes the old drawer', async () => {
  let resolveOld!: (value: unknown) => void
  mock.call.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  await render()
  await render(dateStamp + 86_400_000, 'prod:2')
  await click(entry())
  await act(async () => resolveOld(page([item(7)], 99)))
  expect(entry().textContent).toContain('1 项')
  expect(document.body.textContent).not.toContain('99 项')
  expect(document.body.textContent).not.toContain('安排 7')
  await render(dateStamp + 86_400_000, 'prod:2', false)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mock.call.mock.calls[0]?.[2].aborted).toBe(true)
})

it('shows a refresh error as unknown and allows recovery', async () => {
  await render()
  mock.call.mockRejectedValueOnce(new Error('offline'))
  await click(entry())
  expect(entry().textContent).toContain('暂不可用')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('加载失败')
  await click(button('刷新'))
  expect(entry().textContent).toContain('1 项')
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

it('leaves old recording-derived cards readable without a guessed return link', async () => {
  await act(async () => root.render(<ArkmeArrangementContent item={{ ...item(1), recordingSource: { kind: 'daily-summary', state: 'unavailable' } }} expanded={false} />))
  expect(host.textContent).toContain('来源暂不可定位')
  expect(host.querySelector('button')).toBeNull()
})
