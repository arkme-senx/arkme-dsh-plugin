// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import { CONVERSATION_MENU_LAYOUT } from '../src/client/conversation-selector-style.js'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArkmeSourceItem } from '../src/types.js'

let host: HTMLDivElement
let root: Root

async function render(userId: number) {
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb
      userId={userId}
      selectedSource={undefined}
      sources={[]}
      onSelect={vi.fn()}
      onSelectAggregate={vi.fn()}
    />)
  })
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find(candidate => (
    candidate.getAttribute('aria-label') === label || candidate.textContent === label
    || candidate.querySelector(`[aria-label="${label}"]`) !== null
  ))
  expect(button).toBeDefined()
  await act(async () => { button!.click() })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses an animated loading icon instead of dots, and retains complete counts during background refresh', async () => {
  const sources: ArkmeSourceItem[] = [
    { sourceRef: 'p', kind: 'topic', displayName: '父主题', recordCount: 2 },
    { sourceRef: 'c', kind: 'topic', displayName: '子主题', parentSourceRef: 'p', recordCount: 3 },
  ]
  const props = { sources, selectedSource: undefined, onSelect() {}, onSelectAggregate() {}, loading: true }
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady={false} />))
  await clickButton('选择主题')
  const counts = () => [...document.querySelectorAll('[data-arkme-topic-count]')]
  expect(counts().map(el => el.textContent)).toEqual(['', '', '3'])
  expect(document.querySelectorAll('[data-arkme-topic-count] animateTransform')).toHaveLength(2)
  expect(document.querySelectorAll('[data-arkme-topic-count] [role="status"]')).toHaveLength(2)
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady />))
  expect(counts().map(el => el.textContent)).toEqual(['5', '5', '3'])
  expect(document.querySelectorAll('[data-arkme-topic-count] animateTransform')).toHaveLength(0)
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady error="offline" />))
  expect(counts().map(el => el.textContent)).toEqual(['5', '5', '3'])
  await act(async () => root.render(<ArkmeSourceBreadcrumb {...props} countsReady={false} loading={false} error="offline" />))
  expect(counts().map(el => el.textContent)).toEqual(['—', '—', '3'])
  expect(document.querySelectorAll('[data-arkme-topic-count] animateTransform')).toHaveLength(0)
})

it('closes the topic menu when the header blank area outside the trigger and menu is clicked', async () => {
  await render(10001)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-menu]')).not.toBeNull()

  const header = host.querySelector<HTMLElement>('nav[aria-label="发给自己主题"]')!
  const blankArea = document.createElement('span')
  blankArea.dataset.testid = 'header-blank-area'
  header.append(blankArea)
  await act(async () => {
    blankArea.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })

  expect(host.querySelector('[data-arkme-self-topic-menu]')).toBeNull()
})

it('restores the last topic sort for the same account across component remounts', async () => {
  await render(10001)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：自定义')
  await clickButton('主题排序方式：自定义')
  const sortMenu = document.querySelector('[role="menu"]')
  expect(sortMenu).not.toBeNull()
  expect(host.contains(sortMenu)).toBe(false)
  expect(sortMenu?.textContent).toContain('有最新内容的主题靠前')
  expect(sortMenu?.textContent).toContain('最多内容的主题靠前')
  expect(sortMenu?.textContent).toContain('可按住主题拖动排序')
  await clickButton('最多')
  expect(host.querySelector('[data-arkme-self-topic-menu]')).not.toBeNull()
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：最多')

  await act(async () => root.unmount())
  root = createRoot(host)
  await render(10001)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：最多')

  await act(async () => root.unmount())
  root = createRoot(host)
  await render(10002)
  await clickButton('选择主题')
  expect(host.querySelector('[data-arkme-self-topic-sort-trigger="true"]')?.getAttribute('aria-label'))
    .toBe('主题排序方式：自定义')
})

it('keeps the DSH-style topic actions in a seamless solid footer outside the scrolling list', async () => {
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb
      userId={10003}
      selectedSource={undefined}
      sources={[]}
      onSelect={vi.fn()}
      onSelectAggregate={vi.fn()}
      onCreateTopic={vi.fn()}
    />)
  })
  await clickButton('选择主题')

  const footer = host.querySelector<HTMLElement>('[data-arkme-self-topic-footer="true"]')
  expect(footer).not.toBeNull()
  expect(footer?.style.position).toBe('')
  expect(host.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')?.style.background)
    .toBe('var(--dsw-specific-sidebar-fill, #f9fafb)')
  expect(footer?.style.background).toBe('var(--dsw-specific-sidebar-fill, #f9fafb)')
  expect(footer?.style.borderTopWidth).toBe('')
  expect(footer?.style.marginTop).toBe('')
  const create = footer?.querySelector('button[aria-label="新主题"]')
  expect(create?.textContent).toBe('新主题')
  const glyph = document.createElement('div')
  glyph.innerHTML = renderToStaticMarkup(<IconNewChatOutline16 size={14} />)
  expect(create?.querySelector('svg')?.outerHTML).toBe(glyph.querySelector('svg')?.outerHTML)
  expect(footer?.querySelector('button[data-arkme-self-topic-sort-trigger="true"]')).not.toBeNull()
  const fade = host.querySelector<HTMLElement>('[data-arkme-self-topic-fade]')!
  expect(fade.getAttribute('aria-hidden')).toBe('true')
  expect(fade.style.pointerEvents).toBe('none')
  expect(fade.style.height).toBe(`${CONVERSATION_MENU_LAYOUT.fadeHeight}px`)
  expect(fade.style.background).toContain('linear-gradient')
  const scroller = fade.previousElementSibling as HTMLElement
  expect(scroller.style.overflowY).toBe('auto')
  expect(scroller.style.paddingBottom).toBe(`${CONVERSATION_MENU_LAYOUT.listBottomPadding}px`)
  expect(scroller.contains(footer)).toBe(false)
  expect(scroller.hasAttribute('data-arkme-menu-scroll')).toBe(true)
  expect(scroller.parentElement?.style.marginRight).toBe(`-${CONVERSATION_MENU_LAYOUT.paddingX}px`)
  expect(fade.style.right).toBe(`${CONVERSATION_MENU_LAYOUT.paddingX}px`)
  expect(getComputedStyle(footer!.querySelector('.arkme-dsh-view-options-button')!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
})

it('uses native DSH menu width, type scale and spacing without changing topic drag hit regions', async () => {
  await act(async () => {
    root.render(<ArkmeSourceBreadcrumb userId={10004} selectedSource={undefined}
      sources={[{ sourceRef: 'topic:a', kind: 'topic', displayName: '主题 A', recordCount: 3 }]}
      onSelect={vi.fn()} onSelectAggregate={vi.fn()} onCreateTopic={vi.fn()} onMoveTopic={vi.fn()} />)
  })
  await clickButton('选择主题')
  const menu = host.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')!
  expect(menu.style.width).toBe(`${CONVERSATION_MENU_LAYOUT.width}px`)
  expect(menu.style.maxWidth).toBe(`min(calc(100vw - 24px), var(--arkme-topic-menu-available-width, ${CONVERSATION_MENU_LAYOUT.width}px))`)
  expect(menu.style.maxHeight).toBe(`min(${CONVERSATION_MENU_LAYOUT.maxHeight}px, calc(100vh - 116px))`)
  expect(menu.style.padding).toBe(`${CONVERSATION_MENU_LAYOUT.paddingY}px ${CONVERSATION_MENU_LAYOUT.paddingX}px`)
  const row = menu.querySelector<HTMLElement>('[data-arkme-self-topic-hit-region]')!
  expect(row.draggable).toBe(true)
  expect(row.style.minHeight).toBe(`${CONVERSATION_MENU_LAYOUT.rowHeight}px`)
  expect(row.parentElement?.style.marginTop).toBe(`${CONVERSATION_MENU_LAYOUT.rowGap}px`)
  const select = [...row.querySelectorAll('button')].find(button => button.textContent?.includes('主题 A'))!
  expect(select.style.fontSize).toBe(`${CONVERSATION_MENU_LAYOUT.titleFontSize}px`)
  expect(select.style.lineHeight).toBe(CONVERSATION_MENU_LAYOUT.lineHeight)
  const count = select.lastElementChild as HTMLElement
  expect(count.style.fontSize).toBe(`${CONVERSATION_MENU_LAYOUT.secondaryFontSize}px`)
  expect(count.style.lineHeight).toBe(CONVERSATION_MENU_LAYOUT.lineHeight)
})

it('limits the inline menu to the space remaining beside the conversation list on resize', async () => {
  await render(10005)
  const nav = host.querySelector<HTMLElement>('nav')!
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ left: 312 } as DOMRect)
  vi.stubGlobal('innerWidth', 600)
  await clickButton('选择主题')
  const menu = host.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')!
  expect(menu.style.getPropertyValue('--arkme-topic-menu-available-width')).toBe('276px')
  vi.stubGlobal('innerWidth', 500)
  await act(async () => { window.dispatchEvent(new Event('resize')) })
  expect(menu.style.getPropertyValue('--arkme-topic-menu-available-width')).toBe('176px')
})
