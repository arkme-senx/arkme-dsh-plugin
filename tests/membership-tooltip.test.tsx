// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeMembershipBadge } from '../src/client/ArkmeMembershipBadge.js'

let host: HTMLDivElement, root: Root
const anchor = () => host.querySelector<HTMLElement>('[data-arkme-membership-anchor]')!
const tip = () => document.querySelector<HTMLElement>('[data-arkme-membership-tooltip]')
const hover = () => act(() => { anchor().dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) })
const render = (type: 'vip' | 'svip' | 'free' | 'unknown' = 'vip') => act(() => root.render(<ArkmeMembershipBadge memberType={type} />))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })

it.each(['vip', 'svip'] as const)('immediately explains %s in an unclipped tooltip without a delayed native title', type => {
  host.style.overflow = 'hidden'
  render(type); hover()
  expect(tip()?.textContent).toBe(`${type.toUpperCase()} 会员`)
  expect(tip()?.parentElement).toBe(document.body)
  expect(tip()?.style.pointerEvents).toBe('none')
  expect(anchor().getAttribute('aria-describedby')).toBe(tip()?.id)
  expect(host.querySelector('[title]')).toBeNull()
  act(() => anchor().dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
  expect(tip()).toBeNull()
})

it('supports keyboard focus and never keeps a previous membership when the type changes', () => {
  render('vip'); act(() => anchor().focus())
  expect(tip()?.textContent).toBe('VIP 会员')
  render('svip'); expect(tip()).toBeNull(); hover()
  expect(tip()?.textContent).toBe('SVIP 会员')
  render('free'); expect(tip()).toBeNull(); expect(anchor()).toBeNull()
  render('unknown'); expect(anchor()).toBeNull()
})

it.each(['scroll', 'resize', 'blur', 'Escape', 'pointercancel'])('clears the hint on %s', kind => {
  render(); hover()
  act(() => {
    if (kind === 'scroll') host.dispatchEvent(new Event('scroll'))
    else if (kind === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: kind }))
    else if (kind === 'pointercancel') anchor().dispatchEvent(new Event(kind, { bubbles: true }))
    else window.dispatchEvent(new Event(kind))
  })
  expect(tip()).toBeNull()
})

it('keeps the tooltip inside an owning native dialog and preserves conversation row clicks', () => {
  const click = vi.fn()
  act(() => root.render(<dialog open><button onClick={click}><ArkmeMembershipBadge memberType="svip" /></button></dialog>))
  hover()
  expect(tip()?.parentElement).toBe(host.querySelector('dialog'))
  act(() => anchor().click())
  expect(click).toHaveBeenCalledOnce()
  act(() => root.render(null))
  expect(tip()).toBeNull()
})
