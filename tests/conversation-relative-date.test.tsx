// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeConversationDate } from '../src/client/ArkmeConversationDate.js'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('updates every mounted date after midnight, retains the full date, and releases its timer', () => {
  const at = new Date(2026, 9, 15, 23, 59, 59).getTime()
  vi.setSystemTime(at)
  act(() => root.render(<><ArkmeConversationDate at={at} /><ArkmeConversationDate at={at} /></>))
  expect(host.textContent).toBe('今天今天')
  expect(host.querySelector('time')?.title).toBe('2026年10月15日')
  expect(host.querySelector('time')?.dateTime).toBe('2026-10-15')
  act(() => vi.advanceTimersByTime(1100))
  expect(host.textContent).toBe('昨天昨天')
  act(() => root.render(null))
  expect(vi.getTimerCount()).toBe(0)
})

it('refreshes after the app sleeps across several days', () => {
  const at = new Date(2026, 9, 15, 12).getTime()
  vi.setSystemTime(at)
  act(() => root.render(<ArkmeConversationDate at={at} />))
  vi.setSystemTime(new Date(2026, 9, 17, 9))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(host.textContent).toBe('前天')
  vi.setSystemTime(new Date(2026, 9, 18, 9))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(host.textContent).toBe('今年 10月15日')
})
