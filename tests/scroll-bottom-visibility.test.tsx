import { useLayoutEffect } from 'react'
import { useConversationResizeAnchor } from '../src/client/conversation-resize-anchor.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScrollBottomVisibility } from '../src/client/use-scroll-bottom-visibility.js'

describe('scroll bottom visibility (not auto-follow or unread state)', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals() })

  it('uses the strict 100px boundary without changing scroll position', () => {
    const body = { scrollTop: 800, scrollHeight: 1500, clientHeight: 600 }
    const viewport = { current: body as HTMLElement }
    const content = { current: null }
    function Harness({ active = true }: { active?: boolean }) {
      const control = useScrollBottomVisibility(viewport, content, active, 0)
      return <button hidden={!control.visible} onClick={control.measure} />
    }
    act(() => { renderer = create(<Harness />) })
    const visible = () => !renderer!.root.findByType('button').props.hidden
    expect(visible()).toBe(false)
    act(() => { body.scrollTop = 799; renderer!.root.findByType('button').props.onClick() })
    expect(visible()).toBe(true)
    expect(body.scrollTop).toBe(799)
    act(() => { renderer!.update(<Harness active={false} />) })
    expect(visible()).toBe(false)
    act(() => { body.clientHeight = 0; renderer!.update(<Harness />) })
    expect(visible()).toBe(false)
    act(() => { body.clientHeight = 1600; body.scrollTop = 0; renderer!.update(<Harness />) })
    expect(visible()).toBe(false)
  })

  it('shares the list with auto-follow while keeping visibility and navigation intent separate', () => {
    const callbacks = new Set<() => void>()
    const listeners = new Set<() => void>()
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) { callbacks.add(callback) }
      observe() {}
      disconnect() { callbacks.delete(this.callback) }
    })
    let top = 200
    let contentHeight = 1500
    const body = {
      get scrollTop() { return top },
      set scrollTop(value: number) { top = value },
      scrollHeight: 1500, clientHeight: 600,
      addEventListener: (_: string, listener: () => void) => { listeners.add(listener) },
      removeEventListener: (_: string, listener: () => void) => { listeners.delete(listener) },
    }
    const viewport = { current: body as unknown as HTMLDivElement }
    const content = { current: { getBoundingClientRect: () => ({ height: contentHeight }) } as HTMLElement }
    const restoreIntent = { current: undefined as boolean | undefined }
    function Harness({ follow }: { follow?: boolean }) {
      useLayoutEffect(() => { restoreIntent.current = follow }, [follow])
      useConversationResizeAnchor(viewport, 'chat', undefined, false, content, restoreIntent)
      const visibility = useScrollBottomVisibility(viewport, content, true, 0)
      return <button hidden={!visibility.visible} onClick={() => {
        body.scrollTop = body.scrollHeight - body.clientHeight
        listeners.forEach(listener => { listener() })
        visibility.measure()
      }} />
    }
    const resize = () => { callbacks.forEach(callback => { callback() }) }
    act(() => { renderer = create(<Harness />) })
    act(() => { contentHeight = body.scrollHeight = 1700; resize() })
    expect(body.scrollTop).toBe(200)
    expect(renderer!.root.findByType('button').props.hidden).toBe(false)
    act(() => { renderer!.root.findByType('button').props.onClick() })
    expect(body.scrollTop).toBe(1100)
    act(() => { contentHeight = body.scrollHeight = 1900; resize() })
    expect(body.scrollTop).toBe(1300)
    expect(renderer!.root.findByType('button').props.hidden).toBe(true)
    // A historical restore must supersede the previous bottom-follow intent.
    act(() => { body.scrollTop = 300; renderer!.update(<Harness follow={false} />) })
    act(() => { contentHeight = body.scrollHeight = 2100; resize() })
    expect(body.scrollTop).toBe(300)
    expect(renderer!.root.findByType('button').props.hidden).toBe(false)
    act(() => { renderer!.unmount() })
    renderer = undefined
    expect(callbacks.size).toBe(0)
    expect(listeners.size).toBe(0)
  })

  it('remeasures viewport and async content resize, and releases observers', () => {
    let resized = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe = observe
      disconnect = disconnect
    })
    const body = { scrollTop: 900, scrollHeight: 1500, clientHeight: 600 }
    const viewport = { current: body as HTMLElement }
    const content = { current: {} as HTMLElement }
    function Harness({ revision = 0 }: { revision?: number }) {
      const control = useScrollBottomVisibility(viewport, content, true, revision)
      return <span>{String(control.visible)}</span>
    }
    act(() => { renderer = create(<Harness />) })
    expect(observe.mock.calls.map(([element]) => element)).toEqual([body, content.current])
    act(() => { body.scrollHeight = 1700; resized() })
    expect(renderer!.root.findByType('span').children).toEqual(['true'])
    expect(body.scrollTop).toBe(900)
    act(() => { body.clientHeight = 800; resized() })
    expect(renderer!.root.findByType('span').children).toEqual(['false'])
    act(() => { renderer!.update(<Harness revision={1} />) })
    expect(disconnect).toHaveBeenCalledTimes(1)
    act(() => { renderer!.unmount() })
    renderer = undefined
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
