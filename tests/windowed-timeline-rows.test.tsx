// @vitest-environment jsdom
import { act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { arkmeConversationTargetAnchor, arkmeConversationTargetRow } from '../src/client/conversation-viewport.js'
import { WindowedTimelineRows } from '../src/client/WindowedTimelineRows.js'
it('does not remount existing rows when a new message extends the last chunk', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {}; disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  const mount = vi.fn(), unmount = vi.fn()
  function Row({ id }: { id: string }) {
    useEffect(() => { mount(id); return () => unmount(id) }, [id])
    return <li data-row={id}>{id}</li>
  }
  function Fixture({ count }: { count: number }) {
    const body = useRef<HTMLDivElement>(null)
    const rows = Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }))
    return <div ref={body}><ul><WindowedTimelineRows rowIds={rows} scrollport={body}>
      {rows.map(row => <Row key={row.id} id={row.id} />)}
    </WindowedTimelineRows></ul></div>
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<Fixture count={1999} />))
    mount.mockClear(); unmount.mockClear()
    await act(async () => root.render(<Fixture count={2000} />))
    expect(mount.mock.calls).toEqual([['row-1999']])
    expect(unmount).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
it('resumes the visible window when a text selection ends without another scroll', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let notify: IntersectionObserverCallback
  vi.stubGlobal('IntersectionObserver', class { observe() {}; disconnect() {}; constructor(callback: IntersectionObserverCallback) { notify = callback } })
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  let selected = true
  vi.spyOn(window, 'getSelection').mockImplementation(() => ({ isCollapsed: !selected }) as Selection)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  function Fixture() {
    const body = useRef<HTMLDivElement>(null)
    const rows = Array.from({ length: 2000 }, (_, index) => ({ id: `row-${index}` }))
    return <div ref={body}><ul><WindowedTimelineRows rowIds={rows} scrollport={body} anchorId="row-1005">
      {rows.map(row => <li key={row.id} data-row={row.id}>{row.id}</li>)}
    </WindowedTimelineRows></ul></div>
  }
  try {
    await act(async () => root.render(<Fixture />))
    const target = host.querySelectorAll('[data-arkme-timeline-chunk]')[40]!
    await act(async () => { notify!([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); await vi.advanceTimersByTimeAsync(20) })
    expect(host.querySelector('[data-row="row-1600"]')).toBeNull()
    selected = false
    await act(async () => { document.dispatchEvent(new Event('selectionchange')); await vi.advanceTimersByTimeAsync(20) })
    expect(host.querySelector('[data-row="row-1600"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-row]').length).toBeLessThanOrEqual(240)
  } finally {
    await act(async () => root.unmount())
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  }
})
it('mounts bounded rows around a restored anchor and disconnects observers on unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const disconnect = vi.fn(), observe = vi.fn()
  vi.stubGlobal('IntersectionObserver', class { observe = observe; disconnect = disconnect; constructor(public callback: unknown) {} })
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = disconnect })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  function Fixture() {
    const body = useRef<HTMLDivElement>(null)
    const rows = Array.from({ length: 2000 }, (_, index) => ({ id: `row-${index}` }))
    return <div ref={body}><ul><WindowedTimelineRows rowIds={rows} scrollport={body} anchorId="row-1005">
      {rows.map(row => <li key={row.id} data-row={row.id}>{row.id}</li>)}
    </WindowedTimelineRows></ul></div>
  }
  try {
    await act(async () => root.render(<Fixture />))
    expect(host.querySelector('[data-row="row-1005"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-row]')).toHaveLength(40)
    expect(observe).toHaveBeenCalledTimes(50)
    await act(async () => root.unmount())
    expect(disconnect).toHaveBeenCalled()
  } finally { host.remove(); vi.unstubAllGlobals() }
})

it('keeps surviving message components mounted as the bounded tail slides for 300 arrivals', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {}; disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  const mounts = new Map<number, number>()
  function Row({ id }: { id: number }) {
    useEffect(() => { mounts.set(id, (mounts.get(id) ?? 0) + 1) }, [id])
    return <li data-row={id}>{id}</li>
  }
  function Fixture({ end }: { end: number }) {
    const body = useRef<HTMLDivElement>(null)
    const rows = Array.from({ length: 80 }, (_, i) => ({ id: String(end - 79 + i) }))
    return <div ref={body}><ul><WindowedTimelineRows rowIds={rows} scrollport={body}>
      {rows.map(row => <Row key={row.id} id={Number(row.id)} />)}
    </WindowedTimelineRows></ul></div>
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    for (let end = 79; end < 380; end++) await act(async () => root.render(<Fixture end={end} />))
    expect([...mounts.values()].every(n => n === 1)).toBe(true)
    expect(host.querySelectorAll('[data-row]')).toHaveLength(80)
    expect(host.querySelectorAll('[data-arkme-timeline-chunk]').length).toBeLessThanOrEqual(3)
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it('fills the viewport after removals leave many short chunks, while keeping the row budget', async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let notify: IntersectionObserverCallback
  vi.stubGlobal('IntersectionObserver', class { observe() {}; disconnect() {}; constructor(callback: IntersectionObserverCallback) { notify = callback } })
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  function Fixture({ sparse }: { sparse: boolean }) {
    const body = useRef<HTMLDivElement>(null)
    const rows = Array.from({ length: 2000 }, (_, n) => ({ id: `row-${n}` })).filter((_, n) => !sparse || n % 40 < 4)
    return <div ref={body}><ul><WindowedTimelineRows rowIds={rows} scrollport={body}>
      {rows.map(row => <li key={row.id} data-row={row.id}>{row.id}</li>)}
    </WindowedTimelineRows></ul></div>
  }
  try {
    await act(async () => root.render(<Fixture sparse={false} />))
    await act(async () => root.render(<Fixture sparse />))
    await act(async () => {
      notify!([...host.querySelectorAll('[data-arkme-timeline-chunk]')].slice(0, 20).map(target => ({ target, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver)
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(host.querySelector('[data-row="row-763"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-row]').length).toBeLessThanOrEqual(240)
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() }
})

it('mounts an offscreen context target in a long conversation before DOM locating', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {}; disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const rows = Array.from({ length: 2000 }, (_, index) => index === 505
    ? { id: 'context:505', kind: 'offline-context', entryRef: 'opaque-card' }
    : { id: `message:${index}`, kind: 'message', item: { itemUid: String(index) } })
  function Fixture({ locate }: { locate: boolean }) {
    const body = useRef<HTMLDivElement>(null)
    const target = { itemUid: 'opaque-card', contextRef: 'opaque-card' }
    return <div ref={body}><ul><WindowedTimelineRows rowIds={rows} scrollport={body}
      anchorId={locate ? arkmeConversationTargetAnchor(rows, target) : undefined}>
      {rows.map(row => <li key={row.id} data-offline-context-ref={row.entryRef}>{row.id}</li>)}
    </WindowedTimelineRows></ul></div>
  }
  try {
    await act(async () => root.render(<Fixture locate={false} />))
    expect(arkmeConversationTargetRow(host, { itemUid: 'opaque-card', contextRef: 'opaque-card' })).toBeUndefined()
    await act(async () => root.render(<Fixture locate />))
    expect(arkmeConversationTargetRow(host, { itemUid: 'opaque-card', contextRef: 'opaque-card' })).toBeDefined()
    expect(host.querySelectorAll('[data-arkme-timeline-chunk]:not([aria-hidden])')).toHaveLength(1)
    expect(arkmeConversationTargetAnchor(rows, { itemUid: '3' })).toBe('message:3')
    expect(arkmeConversationTargetAnchor(rows, { itemUid: 'missing', contextRef: 'missing' })).toBeUndefined()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it('locates a system event by its signed row identity, never by an unrelated record at the same time', () => {
 const rows = [{ id: 'chat-event:signed-system', kind: 'notice' }, { id: 'message:other', kind: 'message', item: { itemUid: 'chat-event:signed-system' } }]
 const target = { itemUid: 'chat-event:signed-system', systemRef: 'opaque-anchor' }
 expect(arkmeConversationTargetAnchor(rows, target)).toBe('chat-event:signed-system')
 const host = document.createElement('div')
 host.innerHTML = '<li data-arkme-message-item-uid="chat-event:signed-system"></li><li data-arkme-conversation-row="chat-event:signed-system"></li>'
 expect(arkmeConversationTargetRow(host, target)).toBe(host.children[1])
 expect(arkmeConversationTargetRow(host, { ...target, itemUid: 'missing' })).toBeUndefined()
})
