// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecordingTranscriptSearch } from '../src/client/recordings/RecordingTranscriptSearch.js'

let host: HTMLDivElement, root: Root
const find = vi.fn(), previous = vi.fn(), next = vi.fn()
function Search({ initial = '' }) {
  const [query, setQuery] = useState(initial)
  return <><RecordingTranscriptSearch query={query} position={query ? 1 : 0} count={query ? 2 : 0}
    onChange={setQuery} onFind={find} onPrevious={previous} onNext={next} /><button>外部</button></>
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const input = () => host.querySelector<HTMLInputElement>('input')
const outside = () => host.querySelector<HTMLButtonElement>('button:last-child')!
const render = (initial = '') => act(() => root.render(<Search initial={initial} />))
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  find.mockClear(); previous.mockClear(); next.mockClear()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('starts compact, focuses on expansion, and collapses only when an empty search loses focus', () => {
  render(); expect(input()).toBeNull()
  expect(button('搜索').getAttribute('aria-expanded')).toBe('false')
  act(() => button('搜索').click())
  expect(document.activeElement).toBe(input())
  expect(find).not.toHaveBeenCalled()
  act(() => button('搜索').focus())
  expect(input()).not.toBeNull()
  act(() => outside().focus())
  expect(input()).toBeNull()
})

it('retains a nonempty query across blur, keeps navigation working, and Escape clears and restores focus', () => {
  render('测试'); expect(input()?.value).toBe('测试')
  act(() => outside().focus())
  expect(input()?.value).toBe('测试')
  act(() => button('下一个匹配').click()); expect(next).toHaveBeenCalledOnce()
  act(() => button('上一个匹配').click()); expect(previous).toHaveBeenCalledOnce()
  act(() => Simulate.keyDown(input()!, { key: 'Enter' }))
  expect(find).toHaveBeenCalledOnce()
  act(() => Simulate.keyDown(input()!, { key: 'Escape' }))
  expect(input()).toBeNull()
  expect(button('下一个匹配')).toBeNull()
  expect(document.activeElement).toBe(button('搜索'))
  act(() => button('搜索').click())
  expect(input()?.value).toBe('')
})

it('clears in place without closing while focus stays inside search controls', () => {
  render('测试')
  act(() => { button('清除转写搜索').focus(); button('清除转写搜索').click() })
  expect(input()?.value).toBe('')
  act(() => { input()!.focus(); outside().focus() })
  expect(input()).toBeNull()
})

it('shows the search hint on hover and keyboard focus', () => {
  render()
  act(() => { button('搜索').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); vi.advanceTimersByTime(200) })
  expect(host.querySelector('[role="tooltip"]')?.textContent).toBe('搜索')
  act(() => button('搜索').dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  expect(host.querySelector('[role="tooltip"]')).toBeNull()
  act(() => button('搜索').focus())
  expect(host.querySelector('[role="tooltip"]')?.textContent).toBe('搜索')
  act(() => outside().focus())
  expect(host.querySelector('[role="tooltip"]')).toBeNull()
})
