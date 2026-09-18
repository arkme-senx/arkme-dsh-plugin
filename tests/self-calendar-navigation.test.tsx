// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSelfCalendarNavigation } from '../src/client/use-self-calendar-navigation.js'
import { ArkmeCalendarNavigationStatus } from '../src/client/ArkmeCalendarNavigationStatus.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ IconLoadingOutline16: () => <i data-spinner /> }))
let host: HTMLDivElement, root: Root
let navigation: ReturnType<typeof useSelfCalendarNavigation>
let supersede: (revision: number | undefined) => void
const locate = vi.fn()
const locateMoment = vi.fn()
const cancelTarget = vi.fn()
const selection = { bucketDate: '2020-01-02', timezone: 'Asia/Shanghai' }
function Harness({ scope = 'account:all' }: { scope?: string }) {
  const [revision, setRevision] = useState<number>()
  supersede = setRevision
  navigation = useSelfCalendarNavigation({ scopeKey: scope, sourceRef: scope, targetRevision: revision,
    locate: item => { locate(item); setRevision(7); return 7 },
    locateMoment: item => { locateMoment(item); setRevision(8); return 8 },
    cancelTarget: value => { cancelTarget(value); setRevision(undefined) },
  })
  return navigation.status && <ArkmeCalendarNavigationStatus status={navigation.status}
    onCancel={navigation.cancel} onRetry={navigation.retry} />
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api.call.mockReset(); locate.mockClear(); locateMoment.mockClear(); cancelTarget.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('locates an interaction in the current conversation with shared progress, retry and cancellation', async () => {
  const momentAnchor = { momentId: 'interaction', occurredAtMillis: 1577923200000,
    contextAnchor: { recordUid: 'private-context', recordOwnerUserId: '9223372036854775806', sendAtMillis: 1577800000000 } }
  await act(async () => root.render(<Harness scope="account:private" />))
  await act(async () => navigation.select({ ...selection, momentAnchor }))
  expect(api.call).not.toHaveBeenCalled()
  expect(locate).not.toHaveBeenCalled()
  expect(locateMoment).toHaveBeenCalledWith(momentAnchor)
  expect(host.textContent).toContain('正在定位')
  await act(async () => { navigation.finish(8, '互动加载失败') })
  await act(async () => supersede(undefined))
  expect(host.textContent).toContain('互动加载失败')
  await act(async () => navigation.retry())
  expect(locateMoment).toHaveBeenCalledTimes(2)
  await act(async () => root.render(<Harness scope="account:other" />))
  expect(cancelTarget).toHaveBeenCalledWith(8)
  expect(host.textContent).toBe('')
})

it('keeps feedback across the day request and subsequent history paging until the row is located', async () => {
  const pending = deferred(); api.call.mockReturnValue(pending.promise)
  await act(async () => root.render(<Harness />))
  await act(async () => navigation.select(selection))
  expect(host.textContent).toContain('正在定位 2020年01月02日')
  expect(host.querySelector('[data-spinner]')).not.toBeNull()
  await act(async () => pending.resolve({ items: [{ recordUid: 'old' }] }))
  expect(locate).toHaveBeenCalledWith({ recordUid: 'old' })
  expect(host.textContent).toContain('正在定位')
  await act(async () => { expect(navigation.finish(6)).toBe(false) })
  expect(host.textContent).toContain('正在定位')
  await act(async () => { expect(navigation.finish(7)).toBe(true) })
  expect(host.textContent).toBe('')
})

it.each(['cancel', 'switch', 'supersede'] as const)('aborts the day request on %s and ignores its late response', async action => {
  const pending = deferred(); api.call.mockReturnValue(pending.promise)
  await act(async () => root.render(<Harness />))
  await act(async () => navigation.select(selection))
  const signal = api.call.mock.calls[0]![2] as AbortSignal
  await act(async () => {
    if (action === 'cancel') navigation.cancel()
    else if (action === 'switch') root.render(<Harness scope="other-account:topic" />)
    else supersede(99)
  })
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve({ items: [{ recordUid: 'old' }] }))
  expect(locate).not.toHaveBeenCalled()
  expect(host.textContent).toBe('')
})

it('keeps errors inline and retries the same date; cancellation also stops timeline locating', async () => {
  api.call.mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValue({ items: [{ recordUid: 'old' }] })
  await act(async () => root.render(<Harness />))
  await act(async () => navigation.select(selection))
  expect(host.textContent).toContain('网络暂时不可用')
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(api.call.mock.calls[1]![1]).toMatchObject(selection)
  expect(host.textContent).toContain('正在定位')
  await act(async () => { navigation.finish(7, '历史记录加载失败') })
  await act(async () => supersede(undefined))
  expect(host.textContent).toContain('历史记录加载失败')
  await act(async () => navigation.retry())
  await act(async () => navigation.cancel())
  expect(cancelTarget).toHaveBeenCalledWith(7)
  expect(host.textContent).toBe('')
})

it('a newly selected date replaces the old request without jumping back', async () => {
  const first = deferred(), second = deferred()
  api.call.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  await act(async () => root.render(<Harness />))
  await act(async () => navigation.select(selection))
  await act(async () => navigation.select({ ...selection, bucketDate: '2021-02-03' }))
  await act(async () => first.resolve({ items: [{ recordUid: 'old' }] }))
  expect(locate).not.toHaveBeenCalled()
  expect(host.textContent).toContain('2021年02月03日')
  await act(async () => second.resolve({ items: [{ recordUid: 'new' }] }))
  expect(locate).toHaveBeenCalledWith({ recordUid: 'new' })
})

it('uses the chat date anchor directly and retains its exact owner for around navigation', async () => {
  const anchor = { recordUid: 'chat-old', recordOwnerUserId: '9223372036854775806', sendAtMillis: 1577923200000 }
  await act(async () => root.render(<Harness scope="account:group" />))
  await act(async () => navigation.select({ ...selection, anchor }))
  expect(api.call).not.toHaveBeenCalled()
  expect(locate).toHaveBeenCalledWith(anchor)
  expect(host.textContent).toContain('正在定位')
  await act(async () => { navigation.finish(7, '消息已不可访问') })
  await act(async () => supersede(undefined))
  expect(host.textContent).toContain('消息已不可访问')
  await act(async () => navigation.retry())
  expect(locate).toHaveBeenCalledTimes(2)
  await act(async () => navigation.cancel())
  expect(cancelTarget).toHaveBeenCalledWith(7)
})
