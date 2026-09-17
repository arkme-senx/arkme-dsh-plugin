// @vitest-environment jsdom
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import { watchSelfTopicMenuHover } from '../src/client/self-topic-menu-hover.js'
import type { ArkmeSourceItem } from '../src/types.js'

let host: HTMLDivElement
let anchor: HTMLButtonElement
let root: Root
let stop: (() => void) | undefined

const topic: ArkmeSourceItem = {
  sourceRef: 'topic:a', kind: 'topic', displayName: '主题 A', recordCount: 3,
}

function pointer(type: string, pointerType = 'mouse', x = 0, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  anchor = document.createElement('button')
  anchor.setAttribute('aria-expanded', 'false')
  document.body.append(host, anchor)
  root = createRoot(host)
  const rect = { left: 20, right: 300, top: 100, bottom: 164, width: 280, height: 64, x: 20, y: 100, toJSON() {} }
  vi.spyOn(anchor, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect)
})

afterEach(async () => {
  stop?.(); stop = undefined
  await act(async () => { root.unmount() })
  host.remove(); anchor.remove()
  document.body.querySelectorAll('[data-arkme-self-topic-menu]').forEach(node => { node.remove() })
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

it('opens the one existing breadcrumb menu on hover and keeps its complete footer and actions', async () => {
  const order: string[] = []
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb
      trigger="none"
      selectedSource={undefined}
      sources={[topic]}
      onSelect={() => { order.push('topic') }}
      onSelectAggregate={() => { order.push('aggregate') }}
      onCreateTopic={() => { order.push('create') }}
    />)
  })
  stop = watchSelfTopicMenuHover(anchor, () => { order.push('activate') })

  await act(async () => {
    anchor.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(199)
  })
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBeNull()

  await act(async () => { vi.advanceTimersByTime(1) })
  const menu = document.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')
  expect(menu).not.toBeNull()
  expect(document.querySelectorAll('[data-arkme-self-topic-menu]')).toHaveLength(1)
  expect(document.querySelector('[data-arkme-self-topic-hover-preview]')).toBeNull()
  expect(menu?.style.position).toBe('fixed')
  expect(menu?.querySelector('[data-arkme-self-topic-footer="true"]')).not.toBeNull()
  expect(menu?.querySelector('button[aria-label="新主题"]')).not.toBeNull()
  expect(menu?.querySelector('button[data-arkme-self-topic-sort-trigger="true"]')).not.toBeNull()
  expect(anchor.getAttribute('aria-expanded')).toBe('true')

  // The hover menu is portaled to body, outside the inactive workspace layer.
  // Its shared footer styles must not depend on a workspace ancestor.
  const css = readFileSync('src/client/redesign/arkme-redesign.css', 'utf8')
  const style = document.createElement('style')
  style.textContent = css.slice(css.indexOf('/* Match DSH\'s solid selector footer'), css.indexOf('.arkme-self-topic-sort-option {'))
  document.head.append(style)
  try {
    expect(menu!.closest('[data-arkme-workspace]')).toBeNull()
    expect(getComputedStyle(menu!.querySelector('.arkme-self-topic-create-button')!).height).toBe('38px')
    expect(getComputedStyle(menu!.querySelector('.arkme-dsh-view-options-button')!).width).toBe('28px')
  } finally { style.remove() }

  const topicButton = [...menu!.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes('主题 A'))
  expect(topicButton).toBeDefined()
  await act(async () => { topicButton!.click() })
  expect(order).toEqual(['activate', 'topic'])
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBeNull()
  expect(anchor.getAttribute('aria-expanded')).toBe('false')
})

it('bridges the narrow row/menu gap but closes immediately after leaving both', async () => {
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb trigger="none" selectedSource={undefined} sources={[topic]}
      onSelect={() => {}} onSelectAggregate={() => {}} />)
  })
  stop = watchSelfTopicMenuHover(anchor, () => {})
  await act(async () => {
    anchor.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(200)
  })
  const menu = document.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')!
  const rect = { left: 308, right: 628, top: 100, bottom: 660 } as DOMRect
  vi.spyOn(menu, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect)
  await act(async () => {
    anchor.dispatchEvent(pointer('pointerleave', 'mouse', 304, 130))
    vi.advanceTimersByTime(500)
  })
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBe(menu)
  await act(async () => {
    menu.dispatchEvent(pointer('pointerover', 'mouse', 320, 130))
    vi.advanceTimersByTime(500)
  })
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBe(menu)
  await act(async () => {
    menu.dispatchEvent(pointer('pointerout', 'mouse', 700, 200))
  })
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBeNull()
})

it('does not reset shared footer controls when the same menu is inside the conversation workspace', async () => {
  host.setAttribute('data-arkme-workspace', '')
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb selectedSource={undefined} sources={[topic]}
      onSelect={() => {}} onSelectAggregate={() => {}} onCreateTopic={() => {}} />)
  })
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="选择主题"]')!.click() })
  const menu = host.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')!
  expect(menu).not.toBeNull()
  const create = menu.querySelector<HTMLButtonElement>('button[aria-label="新主题"]')!
  const settings = menu.querySelector<HTMLButtonElement>('.arkme-dsh-view-options-button')!
  const css = readFileSync('src/client/redesign/arkme-redesign.css', 'utf8')
  // Include the workspace reset, not just the footer rules. DOM selector matching
  // catches the ancestor-dependent cascade regression that a component test missed.
  const resetRules = [...css.slice(0, css.indexOf('.arkme-redesign-root {')).matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter(([, selector]) => selector!.includes('button'))
  expect(resetRules.length).toBeGreaterThan(0)
  const ordinary = document.createElement('button')
  host.append(ordinary)
  for (const [, rawSelector] of resetRules) {
    const selector = rawSelector!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    expect(ordinary.matches(selector)).toBe(true)
    expect(create.matches(selector)).toBe(false)
    expect(settings.matches(selector)).toBe(false)
  }
  const style = document.createElement('style')
  style.textContent = css.slice(css.indexOf('/* Match DSH\'s solid selector footer'), css.indexOf('.arkme-self-topic-sort-option {'))
  document.head.append(style)
  try {
    const values = (button: HTMLElement) => {
      const computed = getComputedStyle(button)
      return ['height', 'width', 'borderRadius', 'borderWidth', 'backgroundColor', 'color'].map(key => computed[key as keyof CSSStyleDeclaration])
    }
    const inside = [values(create), values(settings)]
    document.body.append(menu)
    expect([values(create), values(settings)]).toEqual(inside)
    host.querySelector('nav')!.append(menu)
  } finally { style.remove() }
})
