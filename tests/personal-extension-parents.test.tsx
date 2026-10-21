import { invalidateMessageQuoteSources } from '../src/client/message-quote-invalidations.js'
import { invalidateMessageMarks } from '../src/client/message-mark-invalidations.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeTimelineItem, ArkmeTimelineExtensionParent } from '../src/types.js'
import { usePersonalExtensionParents } from '../src/client/use-personal-extension-parents.js'

const { callArkme } = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme }))
const item = (uid: string): ArkmeTimelineItem => ({ itemUid: uid, messageActionRef: `action:${uid}`,
  senderName: '我', isMe: true, title: '', textContent: uid, sendAtMillis: 1, status: 1 })
const parent = (uid: string): ArkmeTimelineExtensionParent => ({ itemUid: `parent:${uid}`, senderName: '我', title: '', textContent: '来源' })
const element = (uid: string) => ({ getAttribute: () => uid })
let current: ReadonlyMap<string, ArkmeTimelineExtensionParent>
function Harness({ scope = 'account:topic', sourceRef = 'topic', items, isChat = false }: {
  scope?: string; sourceRef?: string; items: ArkmeTimelineItem[]; isChat?: boolean
}) { current = usePersonalExtensionParents(scope, sourceRef, items, 'stable-source', isChat); return null }
let observers: { emit: (entries: unknown[]) => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[]
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  callArkme.mockReset()
  observers = []
  vi.stubGlobal('document', { querySelectorAll: () => ['a', 'b', 'c'].map(element) })
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(readonly emit: (entries: unknown[]) => void) { observers.push(this) }
  })
})
afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals() })
const visible = (uids: string[], observer = observers.at(-1)!) => observer.emit(uids.map(uid => ({ target: element(uid), isIntersecting: true })))

describe('personal cross-topic source previews', () => {
  it('reads visible rows only, limits concurrency to two, and does not re-read completed rows', async () => {
    const resolve: ((value: unknown) => void)[] = []
    callArkme.mockImplementation(() => new Promise(done => resolve.push(done)))
    const items = ['a', 'b', 'c'].map(item)
    await act(async () => { renderer = create(<Harness items={items} />) })
    expect(callArkme).not.toHaveBeenCalled()
    await act(async () => visible(['a', 'b', 'c']))
    expect(callArkme).toHaveBeenCalledTimes(2)
    await act(async () => resolve[0]!({ recordUid: 'a', extensionParent: parent('a') }))
    expect(callArkme).toHaveBeenCalledTimes(3)
    expect(current.get('a')).toEqual(parent('a'))
    await act(async () => {
      resolve[1]!({ recordUid: 'b' }); resolve[2]!({ recordUid: 'c' })
    })
    await act(async () => { renderer!.update(<Harness items={[...items]} />) })
    await act(async () => visible(['a', 'b', 'c']))
    expect(callArkme).toHaveBeenCalledTimes(3)
  })

  it('cancels previous-account work, drops its cached previews and ignores late results', async () => {
    let resolve!: (value: unknown) => void
    callArkme.mockImplementation(() => new Promise(done => { resolve = done }))
    const items = [item('a')]
    await act(async () => { renderer = create(<Harness items={items} />) })
    await act(async () => visible(['a']))
    const signal = callArkme.mock.calls[0]![2] as AbortSignal
    const oldObserver = observers[0]!
    await act(async () => { renderer!.update(<Harness scope="other-account:topic" items={items} />) })
    expect(signal.aborted).toBe(true)
    expect(oldObserver.disconnect).toHaveBeenCalled()
    await act(async () => resolve({ recordUid: 'a', extensionParent: parent('a') }))
    expect(current.size).toBe(0)
  })

  it('skips supplied quotes and tombstones, and refreshes when a record changes', async () => {
    callArkme.mockImplementation(async (_operation, payload) => ({ recordUid: payload.messageActionRef.slice(7), extensionParent: parent('a') }))
    const items = [{ ...item('a'), recordVersion: 1 }, { ...item('b'), extensionParent: parent('b') }, { ...item('c'), status: 2 }]
    await act(async () => { renderer = create(<Harness items={items} />) })
    await act(async () => visible(['a', 'b', 'c']))
    expect(callArkme).toHaveBeenCalledTimes(1)
    await act(async () => { renderer!.update(<Harness items={[{ ...item('a'), recordVersion: 2 }]} />) })
    await act(async () => visible(['a']))
    expect(callArkme).toHaveBeenCalledTimes(2)
  })

  it('does not mark a failed or mismatched lookup as a confirmed empty source', async () => {
    callArkme.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ recordUid: 'wrong' })
      .mockResolvedValueOnce({ recordUid: 'a', extensionParent: parent('a') })
    for (let attempt = 0; attempt < 3; attempt++) {
      await act(async () => {
        if (renderer) renderer.update(<Harness items={[item('a')]} />)
        else renderer = create(<Harness items={[item('a')]} />)
      })
      await act(async () => visible(['a']))
    }
    expect(callArkme).toHaveBeenCalledTimes(3)
    expect(current.get('a')).toEqual(parent('a'))
  })
})

it('revalidates only visible quoted chat occurrences and clears cached text before a failed read', async () => {
  const quote = { version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: 'a'.repeat(64), start: 0, end: 2, text: '私密', prefix: '', suffix: '' }
  const child = { ...item('a'), recordOwnerUserId: 7, sequence: 4, extensionParent: { ...parent('a'), quote, quoteState: 'available' as const } }
  const items = [child, item('b')]
  callArkme.mockResolvedValue({ items: [child] })
  await act(async () => { renderer = create(<Harness items={items} isChat />) })
  await act(async () => visible(['a','b']))
  expect(callArkme).toHaveBeenCalledTimes(1)
  expect(callArkme.mock.calls[0]!.slice(0,2)).toEqual(['source.timeline-around', { sourceRef:'topic', itemUid:'a', recordOwnerUserId:7, beforeLimit:1, afterLimit:1 }])
  expect(current.get('a')?.quote?.text).toBe('私密')
  act(() => invalidateMessageMarks())
  expect(callArkme).toHaveBeenCalledTimes(1)
  callArkme.mockRejectedValue(new Error('permission lookup unavailable'))
  await act(async () => invalidateMessageQuoteSources('stable-source'))
  expect(current.get('a')?.quote).toBeUndefined()
  expect(current.get('a')?.quoteState).toBe('unavailable')
  await act(async () => visible(['a']))
  expect(current.get('a')?.quote).toBeUndefined()
})

it.each(['denied', 'missing-edge'])('closes a supplied cached quote when its initial visible reread is %s without requiring an invalidation hint', async failure => {
  const quote = { version:1 as const, projection:'arkme-text-v1' as const, sourceDigest:'a'.repeat(64), start:0, end:2, text:'私密', prefix:'', suffix:'' }
  const child = { ...item('a'), recordOwnerUserId:7, sequence:4, extensionParent:{ ...parent('a'), quote, quoteState:'available' as const } }
  if (failure === 'denied') callArkme.mockRejectedValue({httpStatus:403,code:'permission-denied'})
  else callArkme.mockResolvedValue({items:[{...child,extensionParent:undefined}]})
  await act(async () => { renderer = create(<Harness items={[child]} isChat />) })
  await act(async () => visible(['a']))
  const rendered = current.has('a') ? current.get('a') : child.extensionParent
  expect(rendered?.quote).toBeUndefined()
  expect(rendered?.quoteState).toBe('unavailable')
  expect(child.textContent).toBe('a')
})
