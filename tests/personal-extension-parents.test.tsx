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
function Harness({ scope = 'account:topic', sourceRef = 'topic', items }: {
  scope?: string; sourceRef?: string; items: ArkmeTimelineItem[]
}) { current = usePersonalExtensionParents(scope, sourceRef, items); return null }
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
