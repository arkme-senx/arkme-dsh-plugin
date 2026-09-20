import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeScanGuide } from '../src/client/ArkmeScanGuide.js'
import { defaultArkmeLoginTranslate as t } from '../src/client/arkme-login-locales.js'

describe('scan guide lifecycle', () => {
  afterEach(() => vi.useRealTimers())

  it('opens immediately on hover, advances in order, closes and cancels timers on leave', () => {
    vi.useFakeTimers()
    const renderer = create(<ArkmeScanGuide t={t} />)
    const trigger = renderer.root.findByType('button')
    expect(trigger.props['aria-expanded']).toBe(false)
    act(() => trigger.props.onMouseEnter())
    expect(trigger.props['aria-expanded']).toBe(true)
    expect(renderer.root.findByProps({ className: 'guide-step' }).children).toEqual(['向右滑动'])
    act(() => vi.advanceTimersByTime(2600))
    expect(renderer.root.findByProps({ className: 'guide-step' }).children).toEqual(['点击右上角“＋”'])
    act(() => vi.advanceTimersByTime(2100))
    expect(renderer.root.findByProps({ className: 'guide-step' }).children).toEqual(['点击“扫一扫”'])
    act(() => trigger.props.onMouseLeave())
    expect(trigger.props['aria-expanded']).toBe(false)
    expect(renderer.root.findAllByProps({ role: 'note' })).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    act(() => trigger.props.onMouseEnter())
    expect(renderer.root.findByProps({ className: 'guide-step' }).children).toEqual(['向右滑动'])
    act(() => renderer.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('supports keyboard focus and Escape without requiring a mouse', () => {
    vi.useFakeTimers()
    const renderer = create(<ArkmeScanGuide t={t} />)
    const trigger = renderer.root.findByType('button')
    act(() => trigger.props.onFocus())
    expect(trigger.props['aria-expanded']).toBe(true)
    act(() => trigger.props.onKeyDown({ key: 'Escape' }))
    expect(trigger.props['aria-expanded']).toBe(false)
    act(() => renderer.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })
})
