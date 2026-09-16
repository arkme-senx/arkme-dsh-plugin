// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeCalendarRecordItem } from '../src/types.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({
  callArkme: api.call,
  ArkmeClientError: class extends Error { body = { message: this.message } },
}))

import { ArkmeSelfCalendarPopover } from '../src/client/ArkmeCalendarSurface.js'

let root: Root
let host: HTMLDivElement
let anchor: HTMLButtonElement

const localDateKey = (date: Date) => [
  String(date.getFullYear()).padStart(4, '0'),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  anchor = document.createElement('button')
  anchor.getBoundingClientRect = () => ({
    x: 800, y: 20, top: 20, right: 828, bottom: 48, left: 800, width: 28, height: 28,
    toJSON: () => ({}),
  })
  document.body.append(host, anchor)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  anchor.remove()
  api.call.mockReset()
  vi.unstubAllGlobals()
})

it('reuses the counted month calendar and resolves a populated day before navigation', async () => {
  const today = new Date()
  const todayKey = localDateKey(today)
  const record: ArkmeCalendarRecordItem = {
    recordUid: 'record-on-selected-day', sendAtMillis: today.getTime(), accessState: 'available',
    title: '', textContent: '当天记录', preview: '当天记录', sourceKind: 'self',
    creationSource: 0, templateKind: 1, displayKind: 0, protected: false,
  }
  api.call.mockImplementation(async (operation: string) => {
    if (operation === 'calendar.buckets') return {
      days: [{ bucketDate: todayKey, count: 3, protectedCount: 0, hasRecords: true }],
    }
    if (operation === 'calendar.records') return { items: [record], hasMore: false }
    throw new Error(operation)
  })
  const close = vi.fn()
  const select = vi.fn()

  await act(async () => {
    root.render(<ArkmeSelfCalendarPopover
      open
      sourceRef="selected-topic"
      anchor={{ current: anchor }}
      onClose={close}
      onSelectRecord={select}
    />)
  })

  const day = document.querySelector<HTMLButtonElement>(`[aria-label="${todayKey} 3 条记录"]`)
  expect(day).not.toBeNull()
  expect(day?.textContent).toContain('3')
  await act(async () => { day?.click() })

  expect(api.call.mock.calls.map(([operation]) => operation)).toEqual(['calendar.buckets', 'calendar.records'])
  expect(api.call.mock.calls[0]?.[1]).toMatchObject({ sourceRef: 'selected-topic' })
  expect(api.call.mock.calls[1]?.[1]).toMatchObject({ bucketDate: todayKey, limit: 1, sourceRef: 'selected-topic' })
  expect(close).toHaveBeenCalledOnce()
  expect(select).toHaveBeenCalledWith(record)
})

it('discards old counts when the topic changes while a month request is pending', async () => {
  const todayKey = localDateKey(new Date())
  let resolveOld!: (value: unknown) => void
  api.call.mockImplementation((_operation: string, params: { sourceRef: string }) => params.sourceRef === 'old'
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ days: [{ bucketDate: todayKey, count: 2, hasRecords: true }] }))
  const render = (sourceRef: string) => root.render(<ArkmeSelfCalendarPopover
    open sourceRef={sourceRef} anchor={{ current: anchor }} onClose={() => {}} onSelectRecord={() => {}}
  />)
  await act(async () => render('old'))
  const oldSignal = api.call.mock.calls[0]?.[2] as AbortSignal
  await act(async () => render('new'))
  expect(oldSignal.aborted).toBe(true)
  await act(async () => resolveOld({ days: [{ bucketDate: todayKey, count: 99, hasRecords: true }] }))
  expect(document.querySelector(`[aria-label="${todayKey} 2 条记录"]`)).not.toBeNull()
  expect(document.querySelector(`[aria-label="${todayKey} 99 条记录"]`)).toBeNull()
})

it('keeps an empty date in the calendar and reports it without requesting records', async () => {
  api.call.mockResolvedValue({ days: [] })
  await act(async () => {
    root.render(<ArkmeSelfCalendarPopover
      open
      anchor={{ current: anchor }}
      onClose={() => {}}
      onSelectRecord={() => {}}
    />)
  })
  const emptyDay = document.querySelector<HTMLButtonElement>('button[data-selected="false"]:not(:disabled)')
  expect(emptyDay).not.toBeNull()
  await act(async () => { emptyDay?.click() })

  expect(document.body.textContent).toContain('这一天没有发给自己的记录')
  expect(api.call.mock.calls.map(([operation]) => operation)).toEqual(['calendar.buckets'])
})
