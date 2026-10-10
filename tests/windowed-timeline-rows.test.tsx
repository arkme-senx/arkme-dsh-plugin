// @vitest-environment jsdom
import { act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
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
