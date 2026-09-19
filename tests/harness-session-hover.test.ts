// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { watchHarnessSessionHover } from '../src/client/harness-session-hover.js'
import { installHarnessSessionDropdown } from '../src/client/harness-session-dropdown.js'
import { CONVERSATION_MENU_LAYOUT } from '../src/client/conversation-selector-style.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach(stop => stop())
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function fixture(visible = false) {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  document.body.innerHTML = `<button id="card">Harness</button><textarea id="chat">私聊草稿</textarea><section data-arkme-owned="deepseek-harness-surface" data-arkme-account-id="42" data-arkme-account-scope="prod:42" data-arkme-visible="${visible}" data-arkme-follow-session="${visible}" ${visible ? '' : 'aria-hidden="true"'}><iframe></iframe></section>`
  const card = document.querySelector<HTMLButtonElement>('#card')!
  const chat = document.querySelector<HTMLTextAreaElement>('#chat')!
  const surface = document.querySelector<HTMLElement>('section')!
  const iframe = document.querySelector('iframe')!
  const native = iframe.contentDocument!, nw = native.defaultView!
  native.body.innerHTML = `<div style="display:grid;grid-template-columns:280px minmax(0px, 1fr) 0px"><div><div data-slot="sidebar"><div><div><button aria-label="新建会话">brand</button><button aria-label="收起侧边栏">toggle</button></div><button aria-label="新建会话">新会话</button><div data-slot="sidebar.workspaces"><div role="tree"><div role="treeitem" aria-selected="true">会话 A<button>…</button></div><div role="treeitem" aria-selected="false">会话 B</div></div></div></div></div></div><div><div data-slot="conversation.session.header"><header><nav><span><button disabled>会话 A</button></span></nav></header></div></div><div data-rightbar-col></div></div>`
  const rect = { left: 0, right: 300, top: 140, bottom: 700, width: 300, height: 560, x: 0, y: 140, toJSON() {} }
  vi.spyOn(card, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(nw.HTMLElement.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  vi.spyOn(nw.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  nw.HTMLElement.prototype.scrollIntoView = vi.fn()
  cleanups.push(installHarnessSessionDropdown(native))
  const activate = vi.fn()
  cleanups.push(watchHarnessSessionHover(card, 'prod:42', activate))
  const column = native.querySelector<HTMLElement>('[data-arkme-session-column]')!
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ ...rect, left: 20, top: 140, bottom: 204, height: 64 })
  vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({ ...rect, left: 0, top: 0, right: 1024, bottom: 768 })
  vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ ...rect, left: 308, right: 628, top: 140, bottom: 700 })
  const row = native.querySelector<HTMLElement>('[aria-selected="false"]')!
  const trigger = native.querySelector<HTMLButtonElement>('[data-arkme-session-trigger]')!
  const move = (target: Element, type: string, x = 0, y = 0) => target.dispatchEvent(new target.ownerDocument.defaultView!.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
  const enter = () => { move(card, 'pointerenter'); vi.advanceTimersByTime(200) }
  return { card, chat, surface, iframe, native, nw, column, row, trigger, activate, move, enter }
}

it('waits for intentional hover and preserves the current chat, focus, draft and unread-following state', () => {
  const { card, chat, surface, column, activate, move } = fixture()
  chat.focus()
  move(card, 'pointerenter'); vi.advanceTimersByTime(199)
  expect(column.inert).toBe(true)
  vi.advanceTimersByTime(1)
  expect(column.inert).toBe(false)
  expect(surface.hasAttribute('data-arkme-harness-menu-offset')).toBe(false)
  expect(surface.getAttribute('data-arkme-visible')).toBe('false')
  expect(surface.getAttribute('data-arkme-follow-session')).toBe('false')
  expect(document.activeElement).toBe(chat)
  expect(chat.value).toBe('私聊草稿')
  expect(activate).not.toHaveBeenCalled()
})

it('positions only the native menu and never resizes or shifts the iframe or conversation grid', () => {
  const { card, surface, iframe, native, column, enter } = fixture(true)
  const cardRect = { left: 20, right: 300, top: 140, bottom: 204, width: 280, height: 64, x: 20, y: 140, toJSON() {} }
  const frameRect = { left: 0, right: 1024, top: 0, bottom: 700, width: 1024, height: 700, x: 0, y: 0, toJSON() {} }
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(cardRect)
  vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue(frameRect)
  const grid = native.querySelector<HTMLElement>('[data-arkme-session-frame]')!
  const before = [surface.style.cssText, iframe.style.cssText, grid.style.cssText]
  enter()
  expect(column.style.getPropertyValue('--arkme-session-left')).toBe(`${cardRect.right + CONVERSATION_MENU_LAYOUT.hoverGap}px`)
  expect([surface.style.cssText, iframe.style.cssText, grid.style.cssText]).toEqual(before)
  expect(getComputedStyle(grid).transition).toBe('none')
  card.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  expect(surface.style.getPropertyValue('--arkme-session-hover-overflow')).toBe('')
  expect(surface.hasAttribute('data-arkme-harness-menu-offset')).toBe(false)
  expect([surface.style.cssText, iframe.style.cssText, grid.style.cssText]).toEqual(before)
})

it('cancels brief pass-throughs, bridges only the card/menu gap, and closes immediately outside', () => {
  const { card, column, surface, row, move, enter } = fixture()
  move(card, 'pointerenter'); vi.advanceTimersByTime(100); move(card, 'pointerleave'); vi.advanceTimersByTime(400)
  expect(column.inert).toBe(true)
  enter(); move(card, 'pointerleave', 304, 170); vi.advanceTimersByTime(500)
  expect(column.inert).toBe(false)
  move(row, 'pointerover', 320, 170); vi.advanceTimersByTime(500)
  expect(column.inert).toBe(false)
  move(row.ownerDocument.body, 'pointermove', 700, 300)
  expect(column.inert).toBe(true)
  expect(surface.hasAttribute('data-arkme-harness-menu-preview')).toBe(false)
  expect(surface.getAttribute('aria-hidden')).toBe('true')
})

it('normalizes iframe pointer coordinates when returning through the gap to the card', () => {
  const { card, column, iframe, native, move, enter } = fixture()
  vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20 } as DOMRect)
  vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ left: 298, right: 618, top: 120, bottom: 680 } as DOMRect)
  enter()
  move(card, 'pointerleave', 304, 170)
  move(native.body, 'pointermove', 294, 150)
  expect(column.inert).toBe(false)
  move(native.body, 'pointerout', 280, 150)
  expect(column.inert).toBe(false)
  move(card, 'pointerover', 290, 170)
  move(card, 'pointerleave', 100, 210)
  expect(column.inert).toBe(true)
})

it('runs the original native row action before activating DSH and keeps one list mounted', () => {
  const { row, column, activate, native, enter } = fixture()
  const order: string[] = []
  row.addEventListener('click', () => order.push('native'))
  activate.mockImplementation(() => order.push('arkme'))
  enter(); row.click()
  expect(order).toEqual(['native', 'arkme'])
  expect(column.inert).toBe(true)
  expect(native.querySelector('[aria-selected="false"]')).toBe(row)
  expect(native.querySelectorAll('[data-slot="sidebar"]')).toHaveLength(1)
})

it('supports the native create action and keeps title-dropdown and hover-dropdown mutually exclusive', () => {
  const { trigger, card, column, native, enter, activate } = fixture(true)
  trigger.click(); expect(trigger.getAttribute('aria-expanded')).toBe('true')
  enter(); expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(card.getAttribute('aria-expanded')).toBe('true')
  trigger.click()
  expect(card.getAttribute('aria-expanded')).toBe('false')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  trigger.click(); enter()
  native.querySelector<HTMLButtonElement>('[data-arkme-session-create]')!.click()
  expect(column.inert).toBe(true); expect(activate).toHaveBeenCalledOnce()
})

it('closes on parent outside click or iframe Escape and supports keyboard entry without stealing hover focus', () => {
  const { card, chat, column, native, nw, enter, move } = fixture()
  enter(); move(chat, 'pointerdown'); expect(column.inert).toBe(true)
  card.focus(); card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(native.activeElement?.getAttribute('role')).toBe('treeitem')
  native.dispatchEvent(new nw.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(column.inert).toBe(true); expect(document.activeElement).toBe(card)
})

it('cleans up on account changes or frame reload and does not expose another account or an unsupported host', async () => {
  const { card, surface, iframe, column, enter, native } = fixture()
  enter(); surface.setAttribute('data-arkme-account-scope', 'prod:99'); await flush()
  expect(column.inert).toBe(true); enter(); expect(column.inert).toBe(true)
  surface.setAttribute('data-arkme-account-scope', 'prod:42'); enter(); iframe.dispatchEvent(new Event('load'))
  expect(column.inert).toBe(true); expect(surface.hasAttribute('data-arkme-harness-menu-preview')).toBe(false)
  native.querySelector<HTMLElement>('[data-arkme-session-frame]')!.style.gridTemplateColumns = '1fr'
  await flush(); enter()
  expect(card.getAttribute('aria-expanded')).toBe('false')
  expect(surface.hasAttribute('data-arkme-harness-menu-preview')).toBe(false)
})
