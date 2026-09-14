// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RegionMarquee } from '../src/client/selection/RegionMarquee.js'

let host: HTMLDivElement
let root: Root
let renders: number
const commit = vi.fn()
const clicked = vi.fn()
function Harness({ scope = 'one', enabled = true }: { scope?: string; enabled?: boolean }) {
  renders++
  const viewportRef = useRef<HTMLDivElement>(null)
  return <div style={{ position: 'relative' }}>
    <div ref={viewportRef} data-viewport><div data-item onClick={clicked}>message</div></div>
    <RegionMarquee viewportRef={viewportRef} scopeKey={scope} enabled={enabled}
      getItems={() => [{ key: scope, element: host.querySelector('[data-item]')! }]}
      onCommit={keys => commit(scope, [...keys])} style={{ border: '1px solid blue' }} />
  </div>
}
function render(props: Parameters<typeof Harness>[0] = {}) { act(() => root.render(<Harness {...props} />)) }
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } })
  act(() => (type === 'pointerdown' ? host.querySelector('[data-viewport]')! : document).dispatchEvent(event))
}
function start() { pointer('pointerdown', 15, 15); pointer('pointermove', 150, 150) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  commit.mockClear(); clicked.mockClear(); renders = 0
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.hasAttribute('data-item') ? new DOMRect(30, 30, 60, 40) : new DOMRect(10, 10, 200, 200)
  })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('renders the overlay without rerendering its business parent and commits exactly once', () => {
  render(); start()
  expect(renders).toBe(1)
  expect((host.querySelector('[data-region-marquee]') as HTMLElement).hidden).toBe(false)
  pointer('pointerup', 150, 150)
  expect(commit).toHaveBeenCalledExactlyOnceWith('one', ['one'])
})
it.each([{ scope: 'two' }, { enabled: false }])('cancels pending gestures when props change: %j', props => {
  render(); start(); render(props); pointer('pointerup', 150, 150)
  expect(commit).not.toHaveBeenCalled()
  expect((host.querySelector('[data-region-marquee]') as HTMLElement).hidden).toBe(true)
  expect((host.querySelector('[data-viewport]') as HTMLElement).style.userSelect).toBe('')
})
it('uses the new scope port after cancellation instead of leaking old keys', () => {
  render(); start(); render({ scope: 'two' }); pointer('pointerup', 150, 150)
  start(); pointer('pointerup', 150, 150)
  expect(commit).toHaveBeenCalledExactlyOnceWith('two', ['two'])
})
it('preserves an existing user-select value and priority after cancellation', () => {
  render(); const viewport = host.querySelector<HTMLElement>('[data-viewport]')!
  viewport.style.setProperty('user-select', 'text', 'important')
  start(); act(() => window.dispatchEvent(new Event('blur')))
  expect(viewport.style.userSelect).toBe('text')
  expect(viewport.style.getPropertyPriority('user-select')).toBe('important')
  pointer('pointerup', 150, 150); expect(commit).not.toHaveBeenCalled()
})

it('retains release-click protection across a scope change without swallowing keyboard clicks', () => {
  render(); start(); render({ scope: 'two' }); pointer('pointerup', 150, 150)
  const item = host.querySelector<HTMLElement>('[data-item]')!
  const release = new MouseEvent('click', { bubbles: true, detail: 1 })
  Object.defineProperty(release, 'pointerId', { value: 1 })
  act(() => item.dispatchEvent(release))
  expect(clicked).not.toHaveBeenCalled()
  act(() => item.click())
  expect(clicked).toHaveBeenCalledTimes(1)
})
