// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeSelectionHeader } from '../src/client/harness-native-selection-client.js'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

const disposals: Array<() => Promise<void>> = []
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); document.body.replaceChildren(); vi.unstubAllGlobals() })

async function setup() {
  const surface = document.createElement('section')
  surface.dataset.arkmeOwned = 'deepseek-harness-surface'; surface.dataset.arkmeVisible = 'true'
  const frame = document.createElement('iframe'); surface.append(frame); document.body.append(surface)
  const doc = frame.contentDocument!; const win = doc.defaultView!
  const callbacks = new Set<() => void>()
  let node: { key: string; target: string; kind: string; visibility: string; data: { content?: Array<{ type: string; text?: string }>; status?: string; blocks?: Array<{ kind: string; text: string }> } } = { key: 'user:opaque', target: 'chat', kind: 'user', visibility: 'visible', data: {} }
  const chat = { order: [node.key], nodes: {
    get: (key: string) => key === node.key ? node : undefined,
    source: () => ({ subscribe: (cb: () => void) => { callbacks.add(cb); return () => { callbacks.delete(cb) } } }),
  } }
  const subscribe = () => () => {}
  const useChat = (<T,>(select: (value: unknown) => T) => select(useSyncExternalStore(subscribe, () => chat))) as SnapshotSelectorHook<unknown>
  const ioInstances: IO[] = []
  class IO {
    targets = new Set<Element>()
    constructor(public cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) { ioInstances.push(this) }
    observe(e: Element) { this.targets.add(e) }
    unobserve(e: Element) { this.targets.delete(e) }
    disconnect() { this.targets.clear() }
    flush() { this.cb([...this.targets].map(target => ({ target, isIntersecting: true }))) }
  }
  const resizeDisconnect = vi.fn()
  Object.defineProperty(win, 'IntersectionObserver', { value: IO, configurable: true })
  Object.defineProperty(win, 'ResizeObserver', { value: class { observe() {} unobserve() {} disconnect() { resizeDisconnect() } }, configurable: true })
  let rafs = new Map<number, FrameRequestCallback>(); let serial = 0
  win.requestAnimationFrame = cb => { rafs.set(++serial, cb); return serial }
  win.cancelAnimationFrame = id => { rafs.delete(id) }
  const flush = async () => { await act(async () => { ioInstances.forEach(io => io.flush()); const work = rafs; rafs = new Map(); work.forEach(cb => cb(0)) }) }
  doc.body.innerHTML = '<div id="header"></div><div id="scroll" style="overflow-y:auto"><div data-chat-flow><div data-chat-anchor-key="user:opaque" data-chat-flow-kind="user">Original message <button>Copy code</button></div></div></div>'
  const viewport = doc.querySelector<HTMLElement>('#scroll')!; const flow = doc.querySelector<HTMLElement>('[data-chat-flow]')!; const row = doc.querySelector<HTMLElement>('[data-chat-anchor-key]')!
  let left = 80; let top = 100
  const rect = (x: number, y: number, width: number, height: number): DOMRect => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() {} })
  viewport.getBoundingClientRect = () => rect(0, 60, 800, 500)
  flow.getBoundingClientRect = () => rect(left, 70, 680, 900)
  row.getBoundingClientRect = () => rect(left, top, 680, 90)
  Object.defineProperty(viewport, 'clientWidth', { value: 800 }); Object.defineProperty(viewport, 'clientHeight', { value: 500 })
  const root = createRoot(doc.querySelector('#header')!)
  const render = async (sessionId: string) => { await act(async () => root.render(<NativeSelectionHeader sessionId={sessionId} useChat={useChat} doc={doc} />)) }
  await render('one')
  disposals.push(async () => { await act(async () => root.unmount()) })
  const click = async (selector: string) => { await act(async () => (doc.querySelector<HTMLButtonElement>(selector) ?? document.querySelector<HTMLButtonElement>(selector))!.click()) }
  const enter = async () => {
    await act(async () => row.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    await click('[role="menuitem"]'); await flush()
  }
  const enterEmpty = async () => { await enter(); if (doc.querySelector('[role="checkbox"]')) await click('[role="checkbox"]') }
  return { enter, enterEmpty, doc, win, flow, row, viewport, surface, flush, click, render, callbacks, resizeDisconnect, move: (x: number, y: number) => { left = x; top = y }, changeKind: (kind: string) => { node = { ...node, kind }; callbacks.forEach(cb => cb()) },
    setNode: (next: typeof node) => { node = next; callbacks.forEach(cb => cb()) },
    breakNodeSource: () => { chat.nodes.source = () => { throw new Error('source unavailable') } },
    changeView: (view: string) => { if (view === 'chat') viewport.append(flow); else flow.remove() },
  }
}

it('enters from a message context menu and selects that message', async () => {
  const s = await setup()
  expect(s.doc.querySelector('[data-arkme-native-selection="header"] button')).toBeNull()
  const event = new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 120 })
  await act(async () => s.row.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  expect(document.querySelector('[role="menuitem"]')?.textContent).toContain('多选')
  await s.click('[role="menuitem"]'); await s.flush()
  expect(s.doc.body.textContent).toContain('已选 1 条')
  expect(s.doc.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
})

it('overlays the Arkme action bar on the mounted composer, keeps zero selection, and exits without enabling unfinished actions', async () => {
  const s = await setup()
  const dock = s.doc.createElement('div'); dock.dataset.slot = 'conversation.input.dock'
  const input = s.doc.createElement('textarea')
  const composer = s.doc.createElement('div'); composer.dataset.slot = 'conversation.composer.bar'; composer.append(input)
  input.value = 'unsent draft'
  s.doc.body.append(dock, composer)
  await s.enter()
  const bar = s.doc.querySelector('[data-arkme-native-selection="actions"]')!
  expect(bar?.parentElement).toBe(dock)
  const buttons = [...bar.querySelectorAll('button')]
  expect(buttons.map(button => button.textContent)).toEqual(['复制文本', '复制链接', '转发', '退出多选'])
  expect(buttons.slice(1, 3).every(button => button.disabled && button.title === '暂未接入')).toBe(true)
  expect(buttons[0]!.disabled).toBe(false)
  expect(buttons[3]!.disabled).toBe(false)
  await s.click('[role="checkbox"]')
  expect(s.doc.body.textContent).toContain('已选 0 条')
  expect(buttons[0]!.isConnected).toBe(false)
  expect(bar.querySelector<HTMLButtonElement>('[aria-label="复制文本"]')!.disabled).toBe(true)
  expect(dock.contains(bar)).toBe(true)
  expect(input.isConnected).toBe(true)
  expect(input.value).toBe('unsent draft')
  expect(bar.querySelector('style')?.textContent).toContain('visibility: hidden')
  await s.click('[data-arkme-native-selection="actions"] [aria-label="退出多选"]')
  expect(dock.children.length).toBe(0)
  expect(input.value).toBe('unsent draft')
  expect(input.isConnected).toBe(true)
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
})

it.each([2, 0])('only autofocuses a menu opened without a secondary mouse button (%s)', async button => {
  const s = await setup()
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button })))
  const item = document.querySelector('[role="menuitem"]')!
  expect(item).not.toBeNull()
  expect(document.activeElement === item).toBe(button !== 2)
})

it('highlights only selected message keys and removes styling on cancellation and exit', async () => {
  const s = await setup()
  const original = s.row.outerHTML
  await s.enter()
  const style = () => s.doc.querySelector<HTMLStyleElement>('[data-arkme-native-selection="highlight"]')
  expect(style()?.textContent).toContain('background:')
  const rule = style()!.sheet!.cssRules[0] as CSSStyleRule
  expect(s.row.matches(rule.selectorText)).toBe(true)
  expect(s.flow.matches(rule.selectorText)).toBe(false)
  const background = style()!.sheet!.cssRules[1] as CSSStyleRule
  expect(background.selectorText).toContain('::before')
  expect(background.style.getPropertyValue('left')).toBe('-72px')
  expect(background.style.getPropertyValue('right')).toBe('-32px')
  expect(background.style.getPropertyValue('top')).toBe('-8px')
  expect(background.style.getPropertyValue('bottom')).toBe('-8px')
  expect(background.style.getPropertyValue('pointer-events')).toBe('none')
  expect(background.style.getPropertyValue('border-radius')).toBe('6px')
  expect(s.row.outerHTML).toBe(original)
  await s.click('[role="checkbox"]')
  expect(style()?.textContent ?? '').toBe('')
  expect(s.doc.querySelector('[role="checkbox"]')).not.toBeNull()
  await s.click('[role="checkbox"]')
  expect(style()?.textContent).toContain('background:')
  await s.click('[data-arkme-native-selection="header"] button')
  expect(style()).toBeNull()
  expect(s.row.outerHTML).toBe(original)
})

it.each(['account', 'hidden', 'pagehide', 'view', 'session', 'source-failure'])('removes expanded highlight and subscriptions on %s', async reason => {
  const s = await setup()
  const dock = s.doc.createElement('div'); dock.dataset.slot = 'conversation.input.dock'
  const composer = s.doc.createElement('div'); composer.dataset.slot = 'conversation.composer.bar'; s.doc.body.append(dock, composer)
  await s.enter()
  expect(dock.querySelector('[data-arkme-native-selection="actions"]')).not.toBeNull()
  expect(s.doc.querySelector('[data-arkme-native-selection="highlight"]')?.textContent).toContain('::before')
  if (reason === 'session') await s.render('another-session')
  else await act(async () => {
    if (reason === 'account') s.surface.dataset.arkmeAccountId = 'different'
    if (reason === 'hidden') s.surface.dataset.arkmeVisible = 'false'
    if (reason === 'pagehide') s.win.dispatchEvent(new s.win.Event('pagehide'))
    if (reason === 'view') s.changeView('trajectory')
    if (reason === 'source-failure') {
      s.breakNodeSource()
      s.row.dataset.chatAnchorKey = 'replacement'
    }
  })
  await s.flush()
  expect(s.doc.querySelector('[data-arkme-native-selection="highlight"]')).toBeNull()
  expect(s.doc.querySelector('[data-arkme-native-selection="controls"]')).toBeNull()
  expect(dock.children.length).toBe(0)
  expect(s.callbacks.size).toBe(0)
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(false)
})

it('remeasures expanded background after resizing without changing selected identity', async () => {
  const s = await setup()
  await s.enter()
  s.move(120, 100)
  await act(async () => s.win.dispatchEvent(new s.win.Event('resize')))
  await s.flush()
  const style = s.doc.querySelector<HTMLStyleElement>('[data-arkme-native-selection="highlight"]')!
  const background = style.sheet!.cssRules[1] as CSSStyleRule
  expect(background.style.getPropertyValue('left')).toBe('-112px')
  expect(background.style.getPropertyValue('right')).toBe('-0px')
  expect(s.doc.body.textContent).toContain('已选 1 条')
  expect(s.row.style.cssText).toBe('')
})

it('keeps checked controls visible throughout scrolling and follows the row', async () => {
  const s = await setup()
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  await s.click('[role="menuitem"]'); await s.flush()
  const layer = s.doc.querySelector<HTMLElement>('[data-arkme-native-selection="controls"]')!
  for (const top of [130, 160, 190]) {
    s.move(80, top)
    await act(async () => s.viewport.dispatchEvent(new s.win.Event('scroll')))
    expect(layer.style.visibility).not.toBe('hidden')
    expect(s.doc.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
    await s.flush()
    expect(s.doc.querySelector<HTMLElement>('[data-arkme-native-selection-key]')?.style.top).toContain(`${top}px`)
    expect(s.doc.body.textContent).toContain('已选 1 条')
  }
})

it('reuses Arkme checkboxes, preserves native clicks, and clears on session switch', async () => {
  const s = await setup(); const original = s.row.outerHTML
  const nativeClick = vi.fn(); s.row.querySelector('button')!.onclick = nativeClick
  await s.enterEmpty(); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('false')
  expect((s.doc.querySelector('[role="checkbox"]') as HTMLElement).style.width).toBe('32px')
  expect(s.doc.querySelector('[data-arkme-native-selection="controls"]')?.parentElement === s.viewport).toBe(true)
  expect(s.flow.querySelector('[data-arkme-native-selection]')).toBeNull()
  await s.click('[role="checkbox"]')
  expect(s.doc.body.textContent).toContain('已选 1 条')
  await s.click('[data-chat-anchor-key] button')
  expect(nativeClick).toHaveBeenCalledOnce()
  expect(s.row.outerHTML).toBe(original)
  await s.render('two')
  expect(s.doc.querySelector('[data-arkme-native-selection="controls"]')).toBeNull()
  expect(s.doc.body.textContent).not.toContain('已选 1 条')
  expect(s.callbacks.size).toBe(0)
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(false)
})

it('rejects stale click positions, pauses for narrow space, and retains the selected key', async () => {
  const s = await setup()
  await s.enterEmpty(); await s.flush()
  s.move(80, 160)
  await s.click('[role="checkbox"]')
  expect(s.doc.body.textContent).toContain('已选 0 条')
  await s.flush(); await s.click('[role="checkbox"]')
  expect(s.doc.body.textContent).toContain('已选 1 条')
  s.move(32, 160); s.win.dispatchEvent(new s.win.Event('resize')); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  expect(s.doc.body.textContent).toContain('请扩大窗口')
  expect(s.doc.body.textContent).toContain('已选 1 条')
  s.move(80, 160); s.win.dispatchEvent(new s.win.Event('resize')); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
  await act(async () => { s.surface.dataset.arkmeVisible = 'false' })
  expect(s.doc.querySelector('[data-arkme-native-selection="controls"]')).toBeNull()
  expect(s.callbacks.size).toBe(0)
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(false)
})

it('keeps zero selection active and isolates missing native DOM', async () => {
  const s = await setup()
  await s.enterEmpty(); await s.flush()
  await s.click('[role="checkbox"]'); await s.click('[role="checkbox"]')
  expect(s.doc.body.textContent).toContain('已选 0 条')
  await s.click('[data-arkme-native-selection="header"] button')
  s.flow.removeAttribute('data-chat-flow')
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(s.doc.body.textContent).toContain('Original message')
  expect(s.doc.querySelector('[data-arkme-native-selection="controls"]')).toBeNull()
})

it('does not steal Escape from native input or menus and restores focus on its own exit', async () => {
  const s = await setup()
  await s.enterEmpty(); await s.flush()
  const native = s.row.querySelector('button')!
  native.focus()
  await act(async () => native.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(s.doc.body.textContent).toContain('已选 0 条')
  const control = s.doc.querySelector<HTMLButtonElement>('[role="checkbox"]')!
  const menu = s.doc.createElement('div'); menu.setAttribute('role', 'menu'); s.doc.body.append(menu)
  await act(async () => control.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(s.doc.body.textContent).toContain('已选 0 条')
  menu.remove(); control.focus()
  await act(async () => control.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  expect(s.doc.activeElement).toBe(s.doc.body)
})

it('retains selection when a row temporarily unmounts and refuses changed node kinds', async () => {
  const s = await setup()
  await s.enterEmpty(); await s.flush()
  await s.click('[role="checkbox"]')
  await act(async () => s.row.remove()); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  expect(s.doc.body.textContent).toContain('已选 1 条')
  await act(async () => s.flow.append(s.row)); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
  await act(async () => s.changeKind('tool-call')); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  expect(s.doc.body.textContent).toContain('已选 0 条')
})

it('unmounts selection when leaving native chat, without treating navigation as a failure', async () => {
  const s = await setup()
  await s.enterEmpty(); await s.flush()
  await s.click('[role="checkbox"]')
  await act(async () => s.changeView('trajectory'))
  expect(s.doc.querySelector('[data-arkme-native-selection="controls"]')).toBeNull()
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
  expect(s.callbacks.size).toBe(0)
  await act(async () => s.changeView('chat'))
  expect(s.doc.body.textContent).not.toContain('多选暂不可用')
  await s.enterEmpty(); await s.flush()
  expect(s.doc.body.textContent).toContain('已选 0 条')
})

it('translates viewport coordinates into the plugin layer containing block', async () => {
  const s = await setup()
  const nativeRect = s.win.HTMLElement.prototype.getBoundingClientRect
  const spy = vi.spyOn(s.win.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.arkmeNativeSelection === 'controls') return { x: 20, y: 60, left: 20, top: 60, right: 820, bottom: 560, width: 800, height: 500, toJSON() {} }
    return nativeRect.call(this)
  })
  try {
    await s.enterEmpty(); await s.flush()
    const layer = s.doc.querySelector<HTMLElement>('[data-arkme-native-selection="controls"]')!
    expect(layer.style.position).toBe('relative')
    expect(layer.style.height).toBe('0px')
    expect(layer.style.getPropertyValue('--arkme-selection-origin-x')).toBe('20px')
    expect(layer.style.getPropertyValue('--arkme-selection-origin-y')).toBe('60px')
    const seat = layer.querySelector<HTMLElement>('[data-arkme-native-selection-key]')!
    expect(seat.style.top).toContain('var(--arkme-selection-origin-y, 0px)')
    expect(s.row.style.cssText).toBe('')
  } finally { spy.mockRestore() }
})


it('exposes an assistant only after settling with text and removes it if interrupted', async () => {
  const s = await setup()
  await s.enterEmpty()
  await act(async () => {
    s.row.dataset.chatFlowKind = 'assistant-step'
    s.setNode({ key: 'user:opaque', target: 'chat', visibility: 'visible', kind: 'assistant-step', data: { status: 'running', blocks: [{ kind: 'text', text: 'draft' }] } })
  })
  await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  const assistant = { key: 'user:opaque', target: 'chat', visibility: 'visible', kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text: 'answer' }] } }
  await act(async () => s.setNode(assistant)); await s.flush()
  await s.click('[role="checkbox"]')
  expect(s.doc.body.textContent).toContain('已选 1 条')
  await act(async () => s.setNode({ ...assistant, data: { ...assistant.data, status: 'interrupted' } })); await s.flush()
  expect(s.doc.body.textContent).toContain('已选 0 条')
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
})

it.each(['account', 'account-id', 'pagehide'])('clears selected data and subscriptions on %s', async reason => {
  const s = await setup()
  await s.enterEmpty(); await s.flush()
  await s.click('[role="checkbox"]')
  await act(async () => {
    if (reason === 'account') s.surface.dataset.arkmeAccountScope = 'another-account'
    else if (reason === 'account-id') s.surface.dataset.arkmeAccountId = 'another-id'
    else s.win.dispatchEvent(new s.win.Event('pagehide'))
  })
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  expect(s.callbacks.size).toBe(0)
  await s.enterEmpty(); await s.flush()
  expect(s.doc.body.textContent).toContain('已选 0 条')
})

it('isolates node-source failure and leaves native actions usable', async () => {
  const s = await setup(); const nativeClick = vi.fn()
  s.row.querySelector('button')!.onclick = nativeClick
  s.breakNodeSource()
  await s.enterEmpty(); await s.flush()
  expect(s.doc.body.textContent).toContain('多选暂不可用')
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  await s.click('[data-chat-anchor-key] button')
  expect(nativeClick).toHaveBeenCalledOnce()
  expect(s.callbacks.size).toBe(0)
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(false)
})

it('disables ambiguous duplicate anchors instead of selecting the wrong row', async () => {
  const s = await setup()
  const duplicate = s.row.cloneNode(true) as HTMLElement
  duplicate.getBoundingClientRect = s.row.getBoundingClientRect
  s.flow.append(duplicate)
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  expect(s.callbacks.size).toBe(0)
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(false)
})


it('reports unavailable gutter space when native controls cover every safe seat', async () => {
  const s = await setup()
  const handle = s.doc.createElement('div'); s.doc.body.append(handle)
  s.doc.elementsFromPoint = () => [handle, s.viewport]
  await s.enterEmpty(); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
  expect(s.doc.body.textContent).toContain('请扩大窗口')
  s.doc.elementsFromPoint = () => [s.viewport]
  s.win.dispatchEvent(new s.win.Event('resize')); await s.flush()
  expect(s.doc.querySelector('[role="checkbox"]')).not.toBeNull()
})

it.each(['button', 'a', 'input', 'textarea'])('preserves native %s context menus', async tag => {
  const s = await setup(); const target = s.doc.createElement(tag); s.row.append(target)
  const event = new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  await act(async () => target.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it.each(['scroll', 'outside', 'escape'])('dismisses a context menu on %s without entering selection', async reason => {
  const s = await setup()
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await act(async () => {
    if (reason === 'scroll') s.viewport.dispatchEvent(new s.win.Event('scroll'))
    else if (reason === 'outside') s.doc.body.dispatchEvent(new s.win.MouseEvent('mousedown', { bubbles: true }))
    else s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
})

it('revalidates the context message before selecting and does not intercept removed views', async () => {
  const s = await setup()
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  await act(async () => s.changeKind('tool-call'))
  await s.click('[role="menuitem"]')
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
  await act(async () => s.changeView('trajectory'))
  const event = new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  await act(async () => s.doc.body.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
})

it('leaves an already handled native context event untouched', async () => {
  const s = await setup()
  s.row.addEventListener('contextmenu', event => event.preventDefault())
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
})

it('closes an open context menu on account change before it can select old data', async () => {
  const s = await setup()
  await act(async () => s.row.dispatchEvent(new s.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="menuitem"]')).not.toBeNull()
  await act(async () => { s.surface.dataset.arkmeAccountScope = 'other-account' })
  expect(document.querySelector('[role="menuitem"]')).toBeNull()
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
  expect(s.callbacks.size).toBe(0)
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(false)
})

it('does not revive controls from queued layout work after exit', async () => {
  const s = await setup(); await s.enter()
  s.move(80, 150)
  await act(async () => s.viewport.dispatchEvent(new s.win.Event('scroll')))
  await s.click('[data-arkme-native-selection="header"] button')
  await s.flush()
  expect(s.doc.querySelector('[data-arkme-native-selection="controls"]')).toBeNull()
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
  expect(s.callbacks.size).toBe(0)
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(false)
})

it('keeps header exit available without hiding an unrecognized composer', async () => {
  const s = await setup()
  const dock = s.doc.createElement('div'); dock.dataset.slot = 'conversation.input.dock'; s.doc.body.append(dock)
  await s.enter()
  expect(s.doc.querySelector('[data-arkme-native-selection="actions"]')).toBeNull()
  await s.click('[data-arkme-native-selection="header"] button')
  expect(s.doc.querySelector('[role="checkbox"]')).toBeNull()
})

it('copies one current native message and retains selection with success feedback', async () => {
  const s = await setup()
  const dock = s.doc.createElement('div'); dock.dataset.slot = 'conversation.input.dock'
  const composer = s.doc.createElement('div'); composer.dataset.slot = 'conversation.composer.bar'; s.doc.body.append(dock, composer)
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(s.win.navigator, 'clipboard', { configurable: true, value: { writeText } })
  await s.enter()
  await act(async () => s.setNode({ key: 'user:opaque', target: 'chat', kind: 'user', visibility: 'visible', data: { content: [{ type: 'text', text: '  hello  ' }] } }))
  await s.click('[aria-label="复制文本"]')
  expect(writeText).toHaveBeenCalledWith('hello')
  expect(s.doc.body.textContent).toContain('已复制')
  expect(s.doc.body.textContent).toContain('已选 1 条')
})

it('toggles selection from body and row whitespace only while selection is active', async () => {
  const s = await setup()
  const body = s.doc.createElement('span'); body.textContent = 'body'; s.row.append(body)
  await act(async () => body.click())
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
  await s.enter()
  await act(async () => body.click())
  expect(s.doc.body.textContent).toContain('已选 0 条')
  await act(async () => s.row.click())
  expect(s.doc.body.textContent).toContain('已选 1 条')
  await s.click('[role="checkbox"]')
  expect(s.doc.body.textContent).toContain('已选 0 条')
  await s.click('[data-arkme-native-selection="header"] button')
  await act(async () => body.click())
  expect(s.doc.querySelector('[data-arkme-native-selection="header"]')).toBeNull()
})

it.each(['button', 'a', 'input', 'textarea', 'select', 'role-link', 'role-button', 'editable'])('preserves native %s interaction without toggling selection', async kind => {
  const s = await setup()
  const control = s.doc.createElement(kind.startsWith('role-') || kind === 'editable' ? 'span' : kind)
  if (kind.startsWith('role-')) control.setAttribute('role', kind.slice(5))
  if (kind === 'editable') control.setAttribute('contenteditable', 'true')
  const action = vi.fn(); control.addEventListener('click', action); s.row.append(control)
  await s.enter()
  await act(async () => control.click())
  expect(action).toHaveBeenCalledOnce()
  expect(s.doc.body.textContent).toContain('已选 1 条')
})

it('does not toggle canceled or no-longer-selectable message clicks', async () => {
  const s = await setup(); await s.enter()
  const cancel = (event: Event) => event.preventDefault()
  s.row.addEventListener('click', cancel)
  await act(async () => s.row.click())
  expect(s.doc.body.textContent).toContain('已选 1 条')
  s.row.removeEventListener('click', cancel)
  await act(async () => s.changeKind('tool'))
  await act(async () => s.row.click())
  expect(s.doc.body.textContent).toContain('已选 0 条')
})

it('selects expanded gutter space and prevents text selection only within selectable messages', async () => {
  const s = await setup(); await s.enter()
  const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 120 })
  await act(async () => s.viewport.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(true)
  await act(async () => s.viewport.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, clientX: 20, clientY: 120 })))
  expect(s.doc.body.textContent).toContain('已选 0 条')
  const bodyDown = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(bodyDown))
  expect(bodyDown.defaultPrevented).toBe(true)
  const controlDown = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.querySelector('button')!.dispatchEvent(controlDown))
  expect(controlDown.defaultPrevented).toBe(false)
  const outsideDown = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 400 })
  await act(async () => s.viewport.dispatchEvent(outsideDown))
  expect(outsideDown.defaultPrevented).toBe(false)
  await s.click('[data-arkme-native-selection="header"] button')
  const restored = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => s.row.dispatchEvent(restored))
  expect(restored.defaultPrevented).toBe(false)
})

it('does not select a neighboring message from blank space beside a tool row', async () => {
  const s = await setup(); await s.enter()
  const tool = s.doc.createElement('div'); tool.dataset.chatAnchorKey = 'tool:one'; tool.dataset.chatFlowKind = 'tool'
  tool.getBoundingClientRect = () => ({ left: 80, top: 195, right: 760, bottom: 235, width: 680, height: 40, x: 80, y: 195, toJSON() {} })
  s.flow.append(tool)
  await act(async () => s.viewport.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, clientX: 20, clientY: 196 })))
  expect(s.doc.body.textContent).toContain('已选 1 条')
})

it('does not guess a message for equally close expanded rows', async () => {
  const s = await setup(); await s.enter()
  const next = s.doc.createElement('div'); next.dataset.chatAnchorKey = 'next'; next.dataset.chatFlowKind = 'user'
  next.getBoundingClientRect = () => ({ left: 80, top: 200, right: 760, bottom: 240, width: 680, height: 40, x: 80, y: 200, toJSON() {} })
  s.flow.append(next)
  const event = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 195 })
  await act(async () => s.viewport.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
  await act(async () => s.viewport.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, clientX: 20, clientY: 195 })))
  expect(s.doc.body.textContent).toContain('已选 1 条')
})

it.each([[4, 120], [798, 120], [20, 59], [20, 561], [20, 250]])('ignores gutter points outside the clip or row (%s, %s)', async (x, y) => {
  const s = await setup(); await s.enter()
  const event = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y })
  await act(async () => s.viewport.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
  await act(async () => s.viewport.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, clientX: x, clientY: y })))
  expect(s.doc.body.textContent).toContain('已选 1 条')
})
